/**
 * Lightweight error alerting via Resend (free tier: 100 emails/day).
 *
 * Set RESEND_API_KEY and ALERT_EMAIL in your environment.
 * Optionally override ALERT_FROM_EMAIL; defaults to alerts@govroll.org.
 *
 * Features:
 *  - Deduplicates identical errors within a 5-minute window
 *  - Rate-limits alerts per hour to prevent email floods, with SEPARATE
 *    budgets per source so untrusted client reports can't starve the
 *    server-alert budget (see withinRateLimit).
 */

const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Server-originated alerts (cron jobs, API routes) share this hourly budget.
const MAX_ALERTS_PER_HOUR = 10;
// Client-reported errors (POST /api/errors/report) are untrusted and
// unauthenticated, so they get their OWN, much smaller budget. Without this,
// anyone could POST 10 distinct messages in an hour and exhaust the global
// budget, dropping every genuine server alert that hour — an alert-suppression
// DoS. Keeping the budgets disjoint means client floods can only starve other
// client reports, never the server's alerts.
const MAX_CLIENT_ALERTS_PER_HOUR = 3;

const recentErrors = new Map<string, number>();

type RateBucket = { count: number; windowStart: number };
const rateBuckets = new Map<string, RateBucket>();

/**
 * Fixed-window hourly rate limit, scoped per bucket key. Returns true and
 * consumes a slot when the alert is allowed, false when the bucket is spent.
 */
function withinRateLimit(bucketKey: string, maxPerHour: number): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket || now - bucket.windowStart > HOUR_MS) {
    bucket = { count: 0, windowStart: now };
    rateBuckets.set(bucketKey, bucket);
  }
  if (bucket.count >= maxPerHour) return false;
  bucket.count++;
  return true;
}

function fingerprint(message: string, stack?: string): string {
  // Use first stack frame + message for dedup
  const firstFrame = stack?.split("\n")[1]?.trim() ?? "";
  return `${message}::${firstFrame}`;
}

export async function reportError(
  error: unknown,
  context?: Record<string, unknown>,
) {
  const apiKey = process.env.RESEND_API_KEY;
  const alertEmail = process.env.ALERT_EMAIL;
  if (!apiKey || !alertEmail) {
    // Alerting not configured — fall through to console only
    return;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const fp = fingerprint(err.message, err.stack);

  // ── Deduplicate ──────────────────────────────────────────────
  const lastSeen = recentErrors.get(fp);
  if (lastSeen && Date.now() - lastSeen < DEDUP_WINDOW_MS) return;
  recentErrors.set(fp, Date.now());

  // Clean stale entries
  for (const [key, time] of recentErrors) {
    if (Date.now() - time > DEDUP_WINDOW_MS) recentErrors.delete(key);
  }

  // ── Rate-limit (per-source budgets) ──────────────────────────
  // Client-reported errors are untrusted; bucket them apart from server
  // alerts so neither stream can suppress the other.
  const isClient = context?.source === "client";
  const bucketKey = isClient ? "client" : "server";
  const maxPerHour = isClient
    ? MAX_CLIENT_ALERTS_PER_HOUR
    : MAX_ALERTS_PER_HOUR;
  if (!withinRateLimit(bucketKey, maxPerHour)) return;

  // ── Send alert ───────────────────────────────────────────────
  const from =
    process.env.ALERT_FROM_EMAIL || "Govroll Alerts <alerts@govroll.org>";

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: alertEmail,
        subject: `[Govroll] ${err.message.slice(0, 100)}`,
        text: [
          `Error: ${err.message}`,
          `Time:  ${new Date().toISOString()}`,
          context ? `Context: ${JSON.stringify(context, null, 2)}` : null,
          `Stack:\n${err.stack || "No stack trace"}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      }),
    });
  } catch {
    // Don't let alerting failures break the app
    console.error("Failed to send error alert email");
  }
}

/**
 * Lightweight error alerting via Resend (free tier: 100 emails/day).
 *
 * Set RESEND_API_KEY and ALERT_EMAIL in your environment.
 * Optionally override ALERT_FROM_EMAIL; defaults to alerts@govroll.org.
 *
 * Features:
 *  - Deduplicates identical errors within a 5-minute window
 *  - Rate-limits to 10 alerts per hour to prevent email floods
 */

const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const MAX_ALERTS_PER_HOUR = 10;

const recentErrors = new Map<string, number>();
let alertCount = 0;
let alertWindowStart = Date.now();

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

  // ── Rate-limit ───────────────────────────────────────────────
  if (Date.now() - alertWindowStart > 60 * 60 * 1000) {
    alertCount = 0;
    alertWindowStart = Date.now();
  }
  if (alertCount >= MAX_ALERTS_PER_HOUR) return;
  alertCount++;

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

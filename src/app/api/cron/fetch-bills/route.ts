import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";
import { fetchBillsFunction } from "@/scripts/fetch-bills";
import { reportError } from "@/lib/error-reporting";

/**
 * GET /api/cron/fetch-bills
 *
 * Pulls new bills from GovTrack since the most recent one in our DB.
 * Idempotent via upsert on billId. Designed to be invoked by an external
 * scheduler (GitHub Actions) rather than Vercel's cron — the Hobby plan
 * caps cron frequency at once per day, and we want ingest latency closer
 * to an hour than a day. See .github/workflows/ingest.yml.
 *
 * Protected by CRON_SECRET (Authorization: Bearer <secret>).
 */

// Fluid Compute caps at 300s; the script's internal deadline (280s) bails
// first. The headroom matters for catch-up: a dense backlog window is full of
// brand-new bills, each needing a Congress.gov detail call, so one window can
// blow the old 60s cap — which livelocked the cursor after the ingest outage.
export const maxDuration = 300;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const auth = request.headers.get("authorization");
  if (!timingSafeEqualStr(auth, `Bearer ${expected}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    // Cursor-driven — each invocation walks 6-hour updateDate windows,
    // persisting the cursor after each, and bails at the internal 280s deadline
    // (enforced as a hard AbortSignal on in-flight Congress.gov requests), just
    // under the 300s Fluid maxDuration above. GitHub Actions reinvokes every 3h.
    const result = await fetchBillsFunction();
    const ms = Date.now() - start;
    // A quota stop is expected backpressure, not a failure — keep it a green
    // 200 (cursor preserved, next run resumes) but log loudly so it's visible
    // in the function logs without paging. Previously the underlying 429 became
    // a 500 + an alert email on every occurrence.
    if (result && "quotaLimited" in result && result.quotaLimited) {
      console.warn(
        `[fetch-bills cron] stopped on Congress.gov 429 (quota); cursor preserved, resuming next run`,
      );
    }
    console.log(`[fetch-bills cron] completed in ${ms}ms`, result);
    return NextResponse.json({ ok: true, ms, ...result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[fetch-bills cron] failed:`, msg);
    await reportError(error instanceof Error ? error : new Error(msg), {
      context: "fetch-bills cron",
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

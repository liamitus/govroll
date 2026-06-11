import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";
import { computeMomentumFunction } from "@/scripts/compute-momentum";
import { reportError } from "@/lib/error-reporting";

/**
 * GET /api/cron/compute-momentum
 *
 * Recomputes the alive/dormant/dead momentum signal on Bill. No external
 * API calls — pulls directly from Postgres. Cheap enough to run
 * frequently; the scoring drives the bills feed so staleness shows up
 * as wrong ordering.
 *
 * Query params:
 *   - limit (default 600) — max bills to process this invocation.
 *     Incremental by default: stale (>20h old) + any bills with recent
 *     activity. Pass `full=1` to recompute every bill. The function also
 *     self-bails at an internal deadline well under maxDuration, so a large
 *     backlog spans several runs rather than timing out.
 *
 * Idempotent. Invoked by GitHub Actions. Protected by CRON_SECRET.
 */

export const maxDuration = 60;

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

  const url = new URL(request.url);
  const limit = Math.min(
    5000,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "600", 10)),
  );
  const full = url.searchParams.get("full") === "1";

  const start = Date.now();
  try {
    const result = await computeMomentumFunction(
      limit,
      full ? "full" : "incremental",
    );
    const ms = Date.now() - start;
    console.log(
      `[compute-momentum cron] ok=${result.ok} failed=${result.failed} timedOut=${result.timedOut} in ${ms}ms (full=${full})`,
    );
    return NextResponse.json({ ok: true, ms, limit, full, result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[compute-momentum cron] failed:`, msg);
    await reportError(error instanceof Error ? error : new Error(msg), {
      context: "compute-momentum cron",
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";
import { refreshBillMetadataFunction } from "@/scripts/refresh-bill-metadata";
import { reportError } from "@/lib/error-reporting";

/**
 * GET /api/cron/refresh-bill-metadata
 *
 * Fast metadata-only refresh — sponsor, policyArea, latestAction, CRS
 * summary. No XML downloads. ~2-3s per bill. Prioritizes bills that have
 * never been backfilled (sponsor IS NULL) then bills missing CRS summaries.
 *
 * Query params:
 *   - limit (default 25, max 50) — how many bills to process this invocation
 *
 * Idempotent (repeated runs re-refresh the same bills cheaply). Meant to
 * be invoked by GitHub Actions on a cadence. Protected by CRON_SECRET.
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
    50,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "25", 10)),
  );

  const start = Date.now();
  try {
    await refreshBillMetadataFunction(limit);
    const ms = Date.now() - start;
    console.log(`[refresh-bill-metadata cron] ${limit} bills in ${ms}ms`);
    return NextResponse.json({ ok: true, ms, limit });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[refresh-bill-metadata cron] failed:`, msg);
    await reportError(error instanceof Error ? error : new Error(msg), {
      context: "refresh-bill-metadata cron",
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

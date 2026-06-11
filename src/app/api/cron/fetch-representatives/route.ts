import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";
import { fetchRepresentativesFunction } from "@/scripts/fetch-representatives";
import { reportError } from "@/lib/error-reporting";

/**
 * GET /api/cron/fetch-representatives
 *
 * Refreshes the Representative roster from GovTrack. Slow-cadence —
 * the member list changes rarely (swearing-in, deaths, resignations,
 * special elections). Weekly is plenty.
 *
 * Idempotent (upserts by bioguideId). Invoked by GitHub Actions.
 * Protected by CRON_SECRET.
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

  const start = Date.now();
  try {
    await fetchRepresentativesFunction();
    const ms = Date.now() - start;
    console.log(`[fetch-representatives cron] completed in ${ms}ms`);
    return NextResponse.json({ ok: true, ms });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[fetch-representatives cron] failed:`, msg);
    await reportError(error instanceof Error ? error : new Error(msg), {
      context: "fetch-representatives cron",
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

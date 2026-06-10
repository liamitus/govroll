import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";
import { fetchVotesFunction } from "@/scripts/fetch-votes";
import { reportError } from "@/lib/error-reporting";

/**
 * Dedicated votes-only cron.
 *
 * The main /api/cron/fetch-data runs once a day and handles bills,
 * bill text, cosponsors, momentum, etc. Votes trail at stage 7,
 * which means a recorded roll call that happens right after the
 * cron fires may not appear on the site for ~24 hours — and if the
 * earlier stages exhaust the time budget, the votes stage can get
 * skipped entirely.
 *
 * For the "how did my rep vote?" question — the thing citizens
 * actually care about — that's too slow. This endpoint runs votes
 * in isolation every few hours so a Senate roll call at 6pm ET
 * shows up by 10pm ET, not the next morning.
 *
 * Idempotent: fetchVotesFunction upserts by (representativeId,
 * billId, rollCallNumber), so overlapping windows are fine.
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
  // Hobby plan caps this function at 60s. The per-day loop inside
  // fetchVotesFunction does 3–4 sequential DB round-trips per voter, so a
  // 7-day re-walk regularly blew the budget. The cron fires every 30m, so
  // a 2-day overlap is plenty to self-heal any missed runs.
  const since = new Date();
  since.setDate(since.getDate() - 2);

  try {
    await fetchVotesFunction(since);
    const ms = Date.now() - start;
    console.log(`[fetch-votes cron] completed in ${ms}ms`);
    return NextResponse.json({ ok: true, ms });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[fetch-votes cron] failed:`, msg);
    await reportError(error instanceof Error ? error : new Error(msg), {
      context: "fetch-votes cron",
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

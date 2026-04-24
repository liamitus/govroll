import { NextResponse } from "next/server";
import { generateChangeSummariesFunction } from "@/scripts/generate-change-summaries";
import { reportError } from "@/lib/error-reporting";

/**
 * GET /api/cron/generate-change-summaries
 *
 * Generates AI-powered plain-language summaries of what changed between
 * bill text versions. Uses Claude Haiku. Gated by the budget ledger —
 * if the monthly AI budget is exhausted the underlying function refuses
 * gracefully and this endpoint reports ok with zero work done.
 *
 * Scope: only versions published in the last `sinceDays` days (default 7).
 * The historical backlog (~20k versions) is served on-demand from the bill
 * page via /api/bills/[id]/summary — the cron just keeps fresh content
 * moving through without an expensive drain. Override with ?sinceDays=.
 *
 * Query params:
 *   - limit (default 5, max 25) — cap on bills touched per run. Each
 *     version within those bills costs ~$0.02 and takes 3-6s.
 *   - sinceDays (default 7) — window of recent versions to consider.
 *
 * Idempotent (skips versions that already have a summary). Invoked by
 * GitHub Actions on a slow cadence so billing stays predictable.
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
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(
    25,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "5", 10)),
  );
  const sinceDays = Math.max(
    1,
    parseInt(url.searchParams.get("sinceDays") ?? "7", 10),
  );

  const start = Date.now();
  try {
    await generateChangeSummariesFunction(undefined, limit, sinceDays);
    const ms = Date.now() - start;
    console.log(
      `[change-summaries cron] processed up to ${limit} in ${ms}ms (last ${sinceDays}d)`,
    );
    return NextResponse.json({ ok: true, ms, limit, sinceDays });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[change-summaries cron] failed:`, msg);
    await reportError(error instanceof Error ? error : new Error(msg), {
      context: "change-summaries cron",
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

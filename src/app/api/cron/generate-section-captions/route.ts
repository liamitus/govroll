import { NextResponse } from "next/server";

import { generateSectionCaptionsFunction } from "@/scripts/generate-section-captions";
import { reportError } from "@/lib/error-reporting";

/**
 * GET /api/cron/generate-section-captions
 *
 * Warms AI section captions for hot bills (high momentum + null
 * captions). Uses Claude Haiku via Vercel AI Gateway. Gated by the
 * monthly budget ledger — if AI is paused the underlying function
 * refuses gracefully and this endpoint reports ok with zero work
 * done.
 *
 * Query params:
 *   - limit (default 8, max 25) — cap on bills processed per run.
 *     Each bill costs ~$0.012 and takes 2-5s. The 6h cadence in
 *     ingest.yml means ~32 bills/day pre-warmed without burning a
 *     hole in the budget.
 *
 * Idempotent (skips versions that already have `sectionCaptions`).
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
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "8", 10)),
  );

  const start = Date.now();
  try {
    await generateSectionCaptionsFunction(undefined, limit);
    const ms = Date.now() - start;
    console.log(`[section-captions cron] processed up to ${limit} in ${ms}ms`);
    return NextResponse.json({ ok: true, ms, limit });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[section-captions cron] failed:`, msg);
    await reportError(error instanceof Error ? error : new Error(msg), {
      context: "section-captions cron",
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

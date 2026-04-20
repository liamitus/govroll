import { NextResponse } from "next/server";
import { generateBillExplainersFunction } from "@/scripts/generate-bill-explainers";
import { reportError } from "@/lib/error-reporting";

/**
 * GET /api/cron/generate-bill-explainers
 *
 * Generates AI-powered plain-language explainers (short description +
 * key-point bullets) for bills shown at the top of the bill detail page.
 * Uses Claude Haiku. Gated by the budget ledger — if the monthly AI
 * budget is exhausted the underlying function refuses gracefully.
 *
 * Query params:
 *   - limit (default 5, max 25) — cap on explainers generated per run.
 *     Each call costs roughly a penny at current Haiku pricing; keeping
 *     per-run work small means each invocation fits inside Vercel's 60s
 *     function cap.
 *
 * Idempotent (skips bills whose explainer is up-to-date for their latest
 * substantive text version). Invoked by GitHub Actions. Protected by
 * CRON_SECRET.
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

  const start = Date.now();
  try {
    await generateBillExplainersFunction(undefined, limit);
    const ms = Date.now() - start;
    console.log(`[bill-explainers cron] processed up to ${limit} in ${ms}ms`);
    return NextResponse.json({ ok: true, ms, limit });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[bill-explainers cron] failed:`, msg);
    await reportError(error instanceof Error ? error : new Error(msg), {
      context: "bill-explainers cron",
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

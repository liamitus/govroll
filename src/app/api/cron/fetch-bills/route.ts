import { NextResponse } from "next/server";
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

  const start = Date.now();
  try {
    // Cursor-driven — each invocation processes a few 2-day windows, bails
    // at the internal 50s deadline, and persists progress. GitHub Actions
    // reinvokes hourly; the cursor converges within a couple of runs.
    const result = await fetchBillsFunction();
    const ms = Date.now() - start;
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

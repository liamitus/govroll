import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { backfillCosponsors } from "@/scripts/backfill-cosponsors";
import { reportError } from "@/lib/error-reporting";

/**
 * GET /api/cron/backfill-cosponsors
 *
 * Paginated catch-up for the BillCosponsor table. The schema + fetcher
 * shipped with PR #3 but the initial drain never ran, so 1,766 live
 * bills with aggregate cosponsor counts have zero individual records.
 * The rep-interaction UI depends on this table being populated.
 *
 * Protected by CRON_SECRET. Processes up to `limit` live bills per call,
 * oldest-first so the daily cron's new bills stay at the back of the
 * queue. Each call is idempotent (upserts) and self-resuming — keep
 * calling until `remaining: 0`.
 *
 * Cost per bill: one /cosponsors API call (~1s) + DB writes. We cap each
 * bill at PER_BILL_TIMEOUT_MS so a single slow Congress.gov page can't eat
 * the whole 60s budget — that's what was causing 504s in production.
 */

export const maxDuration = 60;
const TIMEOUT_MS = 45_000;
const PER_BILL_TIMEOUT_MS = 8_000;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(
    15,
    parseInt(url.searchParams.get("limit") ?? "8", 10),
  );
  const tiers = (url.searchParams.get("tiers") ?? "ACTIVE,ADVANCING,ENACTED")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const started = Date.now();
  const deadline = started + TIMEOUT_MS;

  // Select live bills whose stored cosponsor rows fall short of the aggregate
  // count — either zero rows or a partial set from a prior truncated run. The
  // earlier `cosponsors: { none: {} }` filter trapped bills that received
  // even one row, so mid-pagination interruptions or the old 250-limit bug
  // left ~126 live bills permanently stuck. Raw SQL lets us compare counts.
  const batch = await prisma.$queryRaw<Array<{ billId: string }>>`
    SELECT b."billId"
    FROM "Bill" b
    LEFT JOIN (
      SELECT "billId", COUNT(*)::int AS actual
      FROM "BillCosponsor"
      GROUP BY "billId"
    ) bc ON bc."billId" = b.id
    WHERE b."momentumTier" = ANY(${tiers}::text[])
      AND b."cosponsorCount" > 0
      AND COALESCE(bc.actual, 0) < b."cosponsorCount"
    ORDER BY b."currentStatusDate" DESC
    LIMIT ${limit}
  `;

  let processed = 0;
  let timedOut = false;
  let perBillTimeouts = 0;
  const errors: Array<{ billId: string; error: string }> = [];

  for (const b of batch) {
    if (Date.now() >= deadline) {
      timedOut = true;
      break;
    }
    const billSignal = AbortSignal.timeout(PER_BILL_TIMEOUT_MS);
    try {
      await backfillCosponsors([b.billId], { signal: billSignal });
      // fetchBillCosponsors swallows axios CanceledError and returns [],
      // so a per-bill timeout doesn't surface as a thrown error here. Check
      // the signal directly to count it as a soft skip rather than success.
      if (billSignal.aborted) {
        perBillTimeouts++;
      } else {
        processed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ billId: b.billId, error: msg });
    }
  }

  const remainingRows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n
    FROM "Bill" b
    LEFT JOIN (
      SELECT "billId", COUNT(*)::int AS actual
      FROM "BillCosponsor"
      GROUP BY "billId"
    ) bc ON bc."billId" = b.id
    WHERE b."momentumTier" = ANY(${tiers}::text[])
      AND b."cosponsorCount" > 0
      AND COALESCE(bc.actual, 0) < b."cosponsorCount"
  `;
  const remaining = Number(remainingRows[0]?.n ?? 0);

  const elapsedMs = Date.now() - started;

  if (errors.length > 0) {
    reportError(new Error(`Cosponsor backfill errors: ${errors.length}`), {
      route: "GET /api/cron/backfill-cosponsors",
      errors: errors.slice(0, 10),
    });
  }

  return NextResponse.json({
    ok: true,
    processed,
    perBillTimeouts,
    errorCount: errors.length,
    errors: errors.slice(0, 5),
    remaining,
    timedOut,
    elapsedMs,
    elapsedSec: Math.round(elapsedMs / 1000),
  });
}

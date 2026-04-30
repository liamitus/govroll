/**
 * Lean backfill for `Bill.sponsorBioguideId`.
 *
 * Why a separate script (vs `backfill-bill-metadata.ts`):
 * - 1 Congress.gov call per bill instead of 4 — only fetches the bill
 *   detail endpoint, ignores cosponsors / summaries / titles.
 * - Updates only the new column. Won't rewrite `latestActionText`,
 *   `shortText`, or other fields that may already be fresher than
 *   what Congress.gov returns right now.
 * - Won't pull CRS summaries we don't already have, so it adds
 *   essentially zero new bytes to the DB (only ~14 bytes per bill,
 *   the bioguideId itself).
 *
 * Resumable: only picks up rows where `sponsor IS NOT NULL AND
 * sponsorBioguideId IS NULL`, so re-running after an interruption
 * just continues where the last run left off.
 *
 * Throttle: serial with `THROTTLE_MS` between request starts. Set
 * conservatively to stay under Congress.gov's 5,000/hr limit even
 * with retries.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-sponsor-bioguide.ts                 # all rows
 *   npx tsx src/scripts/backfill-sponsor-bioguide.ts --limit 500     # cap
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { fetchBillSponsorBioguideId } from "../lib/congress-api";
import { parseBillId } from "../lib/parse-bill-id";

interface Args {
  limit: number;
  throttleMs: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback: number) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? parseInt(argv[i + 1] || `${fallback}`, 10) : fallback;
  };
  return {
    // Default high enough that "no limit" doesn't surprise anyone.
    limit: get("--limit", 1_000_000),
    // 800ms between request starts → 1.25 req/s → 4,500/hr, safely
    // under Congress.gov's documented 5,000/hr limit. Leaves headroom
    // for occasional retries.
    throttleMs: get("--throttle-ms", 800),
  };
}

async function main() {
  const { limit, throttleMs } = parseArgs();

  const bills = await prisma.bill.findMany({
    where: {
      AND: [{ sponsor: { not: null } }, { sponsorBioguideId: null }],
    },
    select: { id: true, billId: true },
    // Newest first so the user-facing benefit hits actively-watched
    // bills before historical ones.
    orderBy: { introducedDate: "desc" },
    take: limit,
  });

  if (bills.length === 0) {
    console.log("[backfill-sponsor-bioguide] nothing to do — exiting");
    await prisma.$disconnect();
    return;
  }

  console.log(
    `[backfill-sponsor-bioguide] processing ${bills.length} bills (throttle=${throttleMs}ms)`,
  );

  let ok = 0;
  let resolvedNull = 0;
  let parseFailed = 0;
  let fetchFailed = 0;
  const start = Date.now();

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i];
    const cycleStart = Date.now();

    const { congress, apiBillType, billNumber } = parseBillId(bill.billId);
    if (!congress || !apiBillType || !billNumber) {
      parseFailed++;
      continue;
    }

    try {
      const bioguideId = await fetchBillSponsorBioguideId(
        congress,
        apiBillType,
        billNumber,
      );
      if (bioguideId) {
        await prisma.bill.update({
          where: { id: bill.id },
          data: { sponsorBioguideId: bioguideId },
        });
        ok++;
      } else {
        // Sponsor exists in our DB as text but Congress.gov doesn't
        // return a bioguideId for them (rare — usually older bills
        // or pre-Congress.gov-API records). Leave the column null;
        // re-running won't help and would just hammer the API.
        resolvedNull++;
      }
    } catch (e) {
      fetchFailed++;
      console.warn(
        `[backfill-sponsor-bioguide] ${bill.billId} failed:`,
        (e as Error).message,
      );
    }

    if (i > 0 && i % 25 === 0) {
      const elapsed = (Date.now() - start) / 1000;
      const rate = ((i + 1) / elapsed).toFixed(2);
      const remaining = bills.length - (i + 1);
      const eta = Math.round(remaining / parseFloat(rate));
      console.log(
        `[backfill-sponsor-bioguide] ${i + 1}/${bills.length} — ok=${ok} null=${resolvedNull} fail=${fetchFailed} (${rate}/s, ETA ${eta}s)`,
      );
    }

    // Sleep so the NEXT request starts at least throttleMs after
    // this one started, even if the request itself was fast.
    const cycleElapsed = Date.now() - cycleStart;
    const sleepMs = throttleMs - cycleElapsed;
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  }

  const total = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[backfill-sponsor-bioguide] done in ${total}s — ok=${ok}, sponsor-without-bioguide=${resolvedNull}, parse-failed=${parseFailed}, fetch-failed=${fetchFailed}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

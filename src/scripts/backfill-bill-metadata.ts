/**
 * Backfill sponsor / cosponsor / latest-action / CRS summary onto existing Bill rows.
 *
 * Idempotent — only touches rows missing either `sponsor` OR `shortText`, so it
 * re-runs safely and fills in summaries for previously-backfilled bills too.
 * Safe to interrupt and resume.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-bill-metadata.ts                  # all empty rows
 *   npx tsx src/scripts/backfill-bill-metadata.ts --limit 100      # batch
 *   npx tsx src/scripts/backfill-bill-metadata.ts --concurrency 4  # parallel
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { fetchBillMetadata } from "../lib/congress-api";
import { parseBillId } from "../lib/parse-bill-id";

interface Args {
  limit: number;
  concurrency: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback: number) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? parseInt(argv[i + 1] || `${fallback}`, 10) : fallback;
  };
  return {
    limit: get("--limit", 100000),
    concurrency: get("--concurrency", 3),
  };
}

async function backfillOne(billRow: { id: number; billId: string }) {
  const { congress, apiBillType, billNumber } = parseBillId(billRow.billId);
  if (!congress || !apiBillType || !billNumber) return "skipped (parse)";

  const meta = await fetchBillMetadata(congress, apiBillType, billNumber);
  if (!meta) return "no metadata";

  await prisma.bill.update({
    where: { id: billRow.id },
    data: {
      sponsor: meta.sponsor,
      sponsorBioguideId: meta.sponsorBioguideId,
      cosponsorCount: meta.cosponsorCount,
      cosponsorPartySplit: meta.cosponsorPartySplit,
      policyArea: meta.policyArea,
      latestActionText: meta.latestActionText,
      latestActionDate: meta.latestActionDate
        ? new Date(meta.latestActionDate)
        : null,
      shortText: meta.shortText,
    },
  });
  return meta.sponsor || "(no sponsor)";
}

async function main() {
  const { limit, concurrency } = parseArgs();

  // Re-process bills missing sponsor, sponsorBioguideId, or shortText.
  // Picking up bills with sponsor text but no bioguideId lets us
  // populate the new column for existing rows without re-fetching
  // bills that already have everything.
  const bills = await prisma.bill.findMany({
    where: {
      OR: [
        { sponsor: null },
        { AND: [{ sponsor: { not: null } }, { sponsorBioguideId: null }] },
        { shortText: null },
      ],
    },
    select: { id: true, billId: true },
    orderBy: { introducedDate: "desc" },
    take: limit,
  });

  console.log(
    `Backfilling metadata for ${bills.length} bills (concurrency=${concurrency})…`,
  );

  let done = 0;
  let ok = 0;
  let failed = 0;
  const start = Date.now();

  // Simple worker pool
  const queue = [...bills];
  async function worker(id: number) {
    while (queue.length > 0) {
      const bill = queue.shift();
      if (!bill) return;
      try {
        const result = await backfillOne(bill);
        ok++;
        if (done % 25 === 0 || done < 5) {
          const elapsed = (Date.now() - start) / 1000;
          const rate = (done / elapsed).toFixed(1);
          console.log(
            `[w${id}] ${bill.billId} → ${result}  (${++done}/${bills.length}, ${rate}/s)`,
          );
        } else {
          done++;
        }
      } catch (e) {
        failed++;
        done++;
        console.warn(`[w${id}] ${bill.billId} failed:`, (e as Error).message);
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => worker(i + 1)),
  );

  const total = (Date.now() - start) / 1000;
  console.log(
    `\nDone in ${total.toFixed(1)}s — ${ok} ok, ${failed} failed, ${(done / total).toFixed(1)} bills/s`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

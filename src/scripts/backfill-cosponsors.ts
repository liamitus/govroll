import "dotenv/config";
import { fetchBillCosponsors } from "../lib/congress-api";
import { parseBillId } from "../lib/parse-bill-id";
import { createStandalonePrisma } from "../lib/prisma-standalone";

const prisma = createStandalonePrisma();

/**
 * Backfill the BillCosponsor table from Congress.gov. Cosponsors are a
 * strong signal that a representative supported a bill — especially for
 * bills that passed without a recorded roll call. We already fetch the
 * cosponsor list for aggregate counts in fetchBillMetadata but discard
 * the individual records; this script persists them.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-cosponsors.ts                # all bills
 *   npx tsx src/scripts/backfill-cosponsors.ts billId1 billId2
 */
export async function backfillCosponsors(
  targetBillIds?: string[],
  options?: { limit?: number; onlyMissing?: boolean; signal?: AbortSignal },
) {
  const limit = options?.limit ?? 500;
  const onlyMissing = options?.onlyMissing ?? true;
  const signal = options?.signal;

  const bills = targetBillIds?.length
    ? await prisma.bill.findMany({ where: { billId: { in: targetBillIds } } })
    : await prisma.bill.findMany({
        where: onlyMissing
          ? {
              // Only bills we haven't already backfilled (have a cosponsor count
              // but no BillCosponsor rows yet).
              cosponsorCount: { gt: 0 },
              cosponsors: { none: {} },
            }
          : {},
        orderBy: { currentStatusDate: "desc" },
        take: limit,
      });

  console.log(`Backfilling cosponsors for ${bills.length} bills.`);

  let totalInserted = 0;
  let billsSkipped = 0;

  for (const bill of bills) {
    try {
      const { congress, apiBillType, billNumber } = parseBillId(bill.billId);
      if (!congress || !apiBillType || !billNumber) {
        billsSkipped++;
        continue;
      }

      const cosponsors = await fetchBillCosponsors(
        congress,
        apiBillType,
        billNumber,
        signal,
      );

      if (cosponsors.length === 0) {
        console.log(`  ${bill.billId}: no cosponsors returned`);
        continue;
      }

      // Resolve bioguide IDs to local Representative rows in one query.
      const bioguideIds = cosponsors.map((c) => c.bioguideId);
      const reps = await prisma.representative.findMany({
        where: { bioguideId: { in: bioguideIds } },
        select: { id: true, bioguideId: true },
      });
      const repByBioguide = new Map(reps.map((r) => [r.bioguideId, r.id]));

      let inserted = 0;
      for (const c of cosponsors) {
        const representativeId = repByBioguide.get(c.bioguideId);
        if (!representativeId) continue; // historical member we don't track

        await prisma.billCosponsor.upsert({
          where: {
            billId_representativeId: {
              billId: bill.id,
              representativeId,
            },
          },
          update: {
            sponsoredAt: c.sponsorshipDate ? new Date(c.sponsorshipDate) : null,
            withdrawnAt: c.sponsorshipWithdrawnDate
              ? new Date(c.sponsorshipWithdrawnDate)
              : null,
            isOriginal: c.isOriginalCosponsor,
          },
          create: {
            billId: bill.id,
            representativeId,
            sponsoredAt: c.sponsorshipDate ? new Date(c.sponsorshipDate) : null,
            withdrawnAt: c.sponsorshipWithdrawnDate
              ? new Date(c.sponsorshipWithdrawnDate)
              : null,
            isOriginal: c.isOriginalCosponsor,
          },
        });
        inserted++;
      }

      totalInserted += inserted;
      console.log(
        `  ${bill.billId}: ${inserted} cosponsors persisted (of ${cosponsors.length} fetched)`,
      );

      // Congress.gov allows ~1 req/sec with a key
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error: unknown) {
      console.error(
        `Error processing ${bill.billId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(
    `Done. Inserted ${totalInserted} cosponsor rows across ${bills.length - billsSkipped} bills.`,
  );
}

if (require.main === module) {
  const args = process.argv.slice(2);
  backfillCosponsors(args.length > 0 ? args : undefined).finally(() =>
    prisma.$disconnect(),
  );
}

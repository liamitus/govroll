import "dotenv/config";
import { fetchBillMetadata } from "../lib/congress-api";
import { parseBillId } from "../lib/parse-bill-id";
import { createStandalonePrisma } from "../lib/prisma-standalone";

const prisma = createStandalonePrisma();

/**
 * Fast metadata-only refresh. Unlike fetch-bill-text.ts this does NOT download
 * bill XML — it only calls Congress.gov's metadata + summaries endpoints, so
 * each bill takes ~2-3s instead of 5-15s. Safe to run from the cron with a
 * larger batch than fetch-bill-text can sustain.
 *
 * Selection mirrors the other backfill crons (backfill-bill-text,
 * backfill-bill-actions): pick bills that still have a metadata gap — no
 * sponsor, no sponsorBioguideId (older rows have sponsor text but predate the
 * column), or no CRS summary (shortText) — and process the least-recently-
 * refreshed first via `lastMetadataRefreshAt ASC NULLS FIRST`. The
 * `introducedDate DESC` tiebreak surfaces recent legislation first among the
 * never-refreshed bills so the listing page enriches new bills promptly.
 *
 * CRITICAL: every successful Congress.gov call stamps `lastMetadataRefreshAt`,
 * even when the CRS summary is still unpublished. That timestamp is the cursor
 * the NULLS-FIRST ordering rotates on — a processed bill drops to the back of
 * the queue so the cron advances through the whole corpus. A previous version
 * stamped only when a summary arrived; combined with an `ORDER BY sponsor ASC
 * NULLS FIRST` that was dead (zero bills have a null sponsor — ingest fills it
 * at creation), that collapsed to alphabetical-by-sponsor and pinned the cron
 * on the same handful of summary-less territorial-delegate bills every run. It
 * stamped nothing and never advanced, leaving 96% of the corpus permanently
 * unrefreshed. Freshly-introduced bills whose summary is still being drafted
 * are NOT locked out by always stamping: they keep matching the
 * `shortText IS NULL` gap and get retried on a later tick, once the
 * never-refreshed backlog ahead of them has cleared.
 */
export async function refreshBillMetadataFunction(limit = 25) {
  const bills = await prisma.bill.findMany({
    where: {
      OR: [
        { sponsor: null },
        // Older rows have sponsor *text* but predate the sponsorBioguideId
        // column. Refetch fills in the id so the rep card can match the
        // sponsor to the user's reps.
        { sponsorBioguideId: null },
        // Missing CRS summary — keep it eligible until the summary publishes.
        // No cooldown branch is needed: always-stamping + the NULLS-FIRST
        // cursor below rotate a just-fetched bill to the back of the queue.
        { shortText: null },
      ],
    },
    select: { id: true, billId: true },
    orderBy: [
      { lastMetadataRefreshAt: { sort: "asc", nulls: "first" } },
      { introducedDate: "desc" },
    ],
    take: limit,
  });

  if (bills.length === 0) {
    console.log("[refresh-metadata] no bills need refreshing");
    return;
  }

  console.log(`[refresh-metadata] refreshing ${bills.length} bills`);
  let ok = 0;
  let failed = 0;

  for (const bill of bills) {
    const { congress, apiBillType, billNumber } = parseBillId(bill.billId);
    if (!congress || !apiBillType || !billNumber) {
      failed++;
      continue;
    }
    try {
      const meta = await fetchBillMetadata(congress, apiBillType, billNumber);
      if (!meta) {
        failed++;
        continue;
      }
      await prisma.bill.update({
        where: { id: bill.id },
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
          popularTitle: meta.popularTitle,
          displayTitle: meta.displayTitle,
          shortTitle: meta.shortTitle,
          // Always stamp — see the CRITICAL note on the function above. This is
          // the cursor the NULLS-FIRST ordering rotates on, so a bill that
          // fetched OK but still lacks a summary moves to the back of the queue
          // instead of re-running every tick. It stays eligible (shortText is
          // still null) and gets retried once the backlog ahead of it clears.
          lastMetadataRefreshAt: new Date(),
        },
      });
      ok++;
    } catch (e) {
      failed++;
      console.warn(
        `[refresh-metadata] ${bill.billId} failed:`,
        (e as Error).message,
      );
    }
  }

  console.log(`[refresh-metadata] done — ${ok} ok, ${failed} failed`);
}

// CLI invocation
if (require.main === module) {
  const limit = parseInt(process.argv[2] || "25", 10);
  refreshBillMetadataFunction(limit)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

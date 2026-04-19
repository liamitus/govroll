import "dotenv/config";

import { Prisma } from "../generated/prisma/client";
import { generateSectionCaptions } from "../lib/section-caption";
import { assertAiEnabled, AiDisabledError } from "../lib/ai-gate";
import { createStandalonePrisma } from "../lib/prisma-standalone";

const prisma = createStandalonePrisma();

/**
 * Warm AI section captions for bills that don't yet have them. Mirrors
 * the change-summaries cron pattern:
 *
 *   - Budget gate at the top (graceful skip on AiDisabledError so a
 *     paused month doesn't error the GH Actions run).
 *   - Slow cadence (every 6h) + small per-run cap so spend stays
 *     predictable.
 *   - Idempotent: skips versions whose captions are already populated.
 *
 * Selection criteria (when no explicit billId is passed):
 *   - Latest text-bearing version per bill that lacks `sectionCaptions`.
 *   - Bill momentum tier in {ACTIVE, ADVANCING, ENACTED} — the tiers
 *     where readers are most likely to land. We do NOT pre-warm dead /
 *     dormant bills speculatively (catalog is ~12k; that'd burn the
 *     whole monthly budget once and recur on every new version).
 *
 * Lazy generation via `after()` from the reader page handles cold
 * traffic to other tiers; this cron just makes sure hot bills are
 * captioned by the time anyone visits.
 */
export async function generateSectionCaptionsFunction(
  targetBillId?: number,
  limit = 8,
) {
  console.log(
    "Generating section captions for:",
    targetBillId
      ? `bill ${targetBillId}`
      : `up to ${limit} hot bills with missing captions`,
  );

  try {
    await assertAiEnabled("section_caption");
  } catch (e) {
    if (e instanceof AiDisabledError) {
      console.log("[section-captions] AI disabled, skipping:", e.reason);
      return;
    }
    throw e;
  }

  try {
    // Find candidate versions: latest text-bearing version per
    // matching bill that doesn't have captions yet.
    //
    // We query BillTextVersion directly (not Bill -> include) so
    // ordering by versionDate is straightforward. The momentum tier
    // filter joins through `bill`. JSON null check is via Prisma's
    // `Prisma.DbNull` sentinel.
    const candidates = await prisma.billTextVersion.findMany({
      where: {
        sectionCaptions: { equals: Prisma.DbNull },
        fullText: { not: null },
        ...(targetBillId
          ? { billId: targetBillId }
          : {
              bill: {
                momentumTier: { in: ["ACTIVE", "ADVANCING", "ENACTED"] },
              },
            }),
      },
      orderBy: [{ billId: "asc" }, { versionDate: "desc" }],
      take: targetBillId ? undefined : limit * 4,
      select: {
        id: true,
        billId: true,
        versionCode: true,
        versionType: true,
        bill: { select: { title: true, momentumTier: true } },
      },
    });

    // Dedupe to one (latest) version per bill so we don't burn budget
    // captioning multiple historical versions of the same bill — the
    // reader only displays the latest.
    const seen = new Set<number>();
    const versionsToProcess: typeof candidates = [];
    for (const v of candidates) {
      if (seen.has(v.billId)) continue;
      seen.add(v.billId);
      versionsToProcess.push(v);
      if (!targetBillId && versionsToProcess.length >= limit) break;
    }

    console.log(
      `Found ${versionsToProcess.length} version(s) needing captions.`,
    );

    let succeeded = 0;
    let totalCostCents = 0;
    let totalSections = 0;

    for (const version of versionsToProcess) {
      const tag = `${version.bill.title.slice(0, 60)} [${version.versionCode}]`;
      try {
        console.log(`\n${tag} — generating…`);
        const result = await generateSectionCaptions(version.id);
        if (result.cached) {
          // Race: another concurrent caller (cron + after() from a
          // reader visit) populated captions before us. Fine, no spend
          // recorded by us, just move on.
          console.log(`  ${tag} — already captioned (raced).`);
          continue;
        }
        succeeded++;
        totalCostCents += result.costCents;
        totalSections += result.captions.length;
        console.log(
          `  ${tag} — ${result.captions.length} captions ($${(result.costCents / 100).toFixed(3)}).`,
        );
      } catch (err) {
        if (err instanceof AiDisabledError) {
          console.log(
            "[section-captions] AI flipped off mid-run, stopping:",
            err.reason,
          );
          break;
        }
        console.error(
          `  ${tag} — failed:`,
          err instanceof Error ? err.message : err,
        );
      }

      // Light rate limit between calls. Each call is one Haiku turn
      // (~1-2s) for typical bills, several for omnibus. 2s of slack
      // keeps the function under the 60s wall while leaving room for
      // 5-10 bills per run.
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(
      `\nDone. Captioned ${succeeded} version(s), ${totalSections} sections, ` +
        `$${(totalCostCents / 100).toFixed(2)} spend.`,
    );
  } catch (err) {
    console.error(
      "Error in generateSectionCaptions:",
      err instanceof Error ? err.message : err,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const billId = process.argv[2] ? parseInt(process.argv[2]) : undefined;
  generateSectionCaptionsFunction(billId);
}

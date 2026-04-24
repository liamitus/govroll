import "dotenv/config";
import { generateChangeSummary } from "../lib/ai";
import { recordSpend } from "../lib/budget";
import { assertAiEnabled, AiDisabledError } from "../lib/ai-gate";
import { createStandalonePrisma } from "../lib/prisma-standalone";
import dayjs from "dayjs";

const prisma = createStandalonePrisma();

/**
 * Generate AI-powered change summaries for bill text versions that don't have one yet.
 * Compares each version to its predecessor and stores a plain-language summary.
 *
 * @param targetBillId   If provided, summarize every version of this one bill
 *                       (manual backfill path). Ignores `sinceDays`.
 * @param limit          Max bills to process in one run (unused when targetBillId
 *                       is set — that path processes a single bill end-to-end).
 * @param sinceDays      When set (no targetBillId), only consider versions with
 *                       `versionDate` within the last N days. This is how the
 *                       cron avoids draining the 20k-version historical backlog;
 *                       older versions get generated on-demand instead.
 */
export async function generateChangeSummariesFunction(
  targetBillId?: number,
  limit = 100,
  sinceDays?: number,
) {
  console.log(
    "Generating change summaries for:",
    targetBillId
      ? `bill ${targetBillId}`
      : sinceDays
        ? `up to ${limit} bills with versions from the last ${sinceDays} days`
        : `up to ${limit} bills with missing summaries`,
  );

  // Gate on budget — AI features can be paused when funding runs low.
  try {
    await assertAiEnabled("bill_summary");
  } catch (e) {
    if (e instanceof AiDisabledError) {
      console.log("[change-summaries] AI disabled, skipping:", e.reason);
      return;
    }
    throw e;
  }

  try {
    // Find bills that have versions without summaries, optionally scoped to a
    // recent window. The `some` filter with nested `versionDate` keeps the set
    // small — matches only bills where at least one unsummarized version falls
    // inside the window — then the in-loop check below ensures we only actually
    // generate for versions in that window.
    const versionFilter: {
      changeSummary: null;
      versionDate?: { gte: Date };
    } = { changeSummary: null };
    if (!targetBillId && sinceDays !== undefined) {
      versionFilter.versionDate = {
        gte: dayjs().subtract(sinceDays, "day").toDate(),
      };
    }

    const billFilter = targetBillId ? { id: targetBillId } : {};
    const bills = await prisma.bill.findMany({
      where: {
        ...billFilter,
        textVersions: {
          some: versionFilter,
        },
      },
      select: {
        id: true,
        title: true,
        textVersions: {
          orderBy: { versionDate: "asc" },
          select: {
            id: true,
            versionCode: true,
            versionType: true,
            versionDate: true,
            fullText: true,
            changeSummary: true,
            isSubstantive: true,
          },
        },
      },
      take: targetBillId ? undefined : limit,
    });

    console.log(`Found ${bills.length} bills with missing summaries.`);

    let generated = 0;
    let totalCostCents = 0;
    const windowCutoff =
      !targetBillId && sinceDays !== undefined
        ? dayjs().subtract(sinceDays, "day").toDate()
        : null;

    for (const bill of bills) {
      console.log(`\n${bill.title.slice(0, 60)}...`);

      for (let i = 0; i < bill.textVersions.length; i++) {
        const version = bill.textVersions[i];

        // Skip if already has a summary
        if (version.changeSummary) continue;

        // When scoped to a recent window, don't walk back into old versions
        // just because this bill also has one fresh unsummarized version.
        // Historical versions are served on-demand from the bill page.
        if (windowCutoff && version.versionDate < windowCutoff) continue;

        // First version — set baseline summary, no AI needed
        if (i === 0) {
          await prisma.billTextVersion.update({
            where: { id: version.id },
            data: {
              changeSummary: "Initial version of the bill as introduced.",
            },
          });
          console.log(
            `  ${version.versionCode.toUpperCase()} — baseline (no AI)`,
          );
          continue;
        }

        const previous = bill.textVersions[i - 1];

        // Need text from both versions to generate a meaningful summary
        if (!previous.fullText || !version.fullText) {
          const msg =
            "Text comparison unavailable — one or both versions are missing full text.";
          await prisma.billTextVersion.update({
            where: { id: version.id },
            data: { changeSummary: msg },
          });
          console.log(
            `  ${version.versionCode.toUpperCase()} — no text available`,
          );
          continue;
        }

        // Generate AI summary
        try {
          console.log(
            `  ${version.versionCode.toUpperCase()} (${previous.versionCode} → ${version.versionCode}) — generating...`,
          );

          const summaryResult = await generateChangeSummary(
            bill.title,
            previous.fullText,
            version.fullText,
            previous.versionType,
            version.versionType,
          );

          await prisma.billTextVersion.update({
            where: { id: version.id },
            data: { changeSummary: summaryResult.content },
          });

          // Record spend against the monthly AI budget so this run is visible
          // on the funding page and the evaluate-budget cron disables AI if
          // we're about to run out.
          for (const u of summaryResult.usage) {
            const costCents = await recordSpend({
              feature: "bill_summary",
              model: u.model,
              inputTokens: u.inputTokens,
              outputTokens: u.outputTokens,
            });
            totalCostCents += costCents;
          }

          console.log(`    "${summaryResult.content.slice(0, 100)}..."`);
          generated++;
        } catch (error: unknown) {
          console.error(
            `  ${version.versionCode.toUpperCase()} — AI error:`,
            error instanceof Error ? error.message : error,
          );
        }

        // Rate limit: ~1 AI call per 2 seconds
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log(
      `\nDone. Generated ${generated} change summaries ($${(totalCostCents / 100).toFixed(2)} spend).`,
    );
  } catch (error: unknown) {
    console.error(
      "Error in generateChangeSummaries:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const billId = process.argv[2] ? parseInt(process.argv[2]) : undefined;
  generateChangeSummariesFunction(billId);
}

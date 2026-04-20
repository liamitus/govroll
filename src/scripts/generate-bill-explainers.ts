import "dotenv/config";
import { generateBillExplainer } from "../lib/ai";
import { recordSpend } from "../lib/budget";
import { assertAiEnabled, AiDisabledError } from "../lib/ai-gate";
import { createStandalonePrisma } from "../lib/prisma-standalone";
import {
  getBillTypeInfo,
  getEffectiveStatus,
  getStatusExplanation,
} from "../lib/bill-helpers";

const prisma = createStandalonePrisma();

/**
 * Backfill (or refresh) the AI-generated plain-language explainer shown at
 * the top of each bill detail page. Picks bills where the explainer is
 * missing OR where a newer substantive text version has landed since the
 * explainer was last generated.
 *
 * Cost-governed by the same budget ledger as the other AI features — exits
 * early if AI is currently disabled.
 */
export async function generateBillExplainersFunction(
  targetBillId?: number,
  limit = 100,
) {
  console.log(
    "Generating bill explainers for:",
    targetBillId
      ? `bill ${targetBillId}`
      : `up to ${limit} bills needing generation or refresh`,
  );

  try {
    await assertAiEnabled("bill_summary");
  } catch (e) {
    if (e instanceof AiDisabledError) {
      console.log("[bill-explainers] AI disabled, skipping:", e.reason);
      return;
    }
    throw e;
  }

  try {
    const billFilter = targetBillId ? { id: targetBillId } : {};

    // Grab a batch of candidates. We'll decide in-memory whether each one
    // actually needs (re)generation by comparing aiSummaryVersionId to the
    // latest substantive version.
    const bills = await prisma.bill.findMany({
      where: billFilter,
      select: {
        id: true,
        title: true,
        billType: true,
        shortText: true,
        currentStatus: true,
        aiShortDescription: true,
        aiSummaryVersionId: true,
        actions: {
          orderBy: { actionDate: "asc" },
          select: {
            actionDate: true,
            chamber: true,
            text: true,
            actionType: true,
          },
        },
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
      take: targetBillId ? undefined : limit * 4,
    });

    type Candidate = {
      bill: (typeof bills)[number];
      latestSubstantiveVersionId: number | null;
    };

    const candidates: Candidate[] = [];
    for (const bill of bills) {
      const latestSubstantive = [...bill.textVersions]
        .filter((v) => v.isSubstantive)
        .at(-1);
      const latestId = latestSubstantive?.id ?? null;
      const needsGen =
        bill.aiShortDescription === null ||
        (latestId !== null && bill.aiSummaryVersionId !== latestId) ||
        // No text version tracked yet — generate from CRS summary if we
        // haven't already.
        (latestId === null && bill.aiShortDescription === null);

      if (needsGen)
        candidates.push({ bill, latestSubstantiveVersionId: latestId });
      if (candidates.length >= limit) break;
    }

    console.log(
      `Found ${candidates.length} bills needing explainer generation.`,
    );

    let generated = 0;
    let totalCostCents = 0;

    for (const { bill, latestSubstantiveVersionId } of candidates) {
      console.log(`\n${bill.title.slice(0, 70)}…`);

      const latestSubstantive = bill.textVersions.find(
        (v) => v.id === latestSubstantiveVersionId,
      );
      const billText = latestSubstantive?.fullText ?? null;
      const versionType = latestSubstantive?.versionType ?? null;

      if (!billText && !bill.shortText) {
        console.log("  no text or CRS summary — skipping");
        continue;
      }

      const typeInfo = getBillTypeInfo(bill.billType);
      const effectiveStatus = getEffectiveStatus(
        bill.billType,
        bill.currentStatus,
        bill.actions.map((a) => ({
          actionDate: a.actionDate,
          chamber: a.chamber ?? null,
          text: a.text,
          actionType: a.actionType ?? null,
        })),
        bill.textVersions,
      );
      const statusExplanation = getStatusExplanation(
        bill.billType,
        effectiveStatus,
      );

      try {
        const result = await generateBillExplainer({
          billTitle: bill.title,
          billText,
          versionType,
          crsSummary: bill.shortText,
          billTypeLabel: typeInfo.label,
          statusHeadline: statusExplanation.headline,
        });

        await prisma.bill.update({
          where: { id: bill.id },
          data: {
            aiShortDescription: result.explainer.shortDescription,
            aiKeyPoints: result.explainer.keyPoints,
            aiSummaryModel: result.usage.model,
            aiSummaryCreatedAt: new Date(),
            aiSummaryVersionId: latestSubstantiveVersionId,
          },
        });

        const costCents = await recordSpend({
          feature: "bill_summary",
          model: result.usage.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        });
        totalCostCents += costCents;
        generated++;

        console.log(
          `  ✓ "${result.explainer.shortDescription.slice(0, 80)}…" + ${result.explainer.keyPoints.length} points`,
        );
      } catch (error: unknown) {
        console.error(
          "  AI error:",
          error instanceof Error ? error.message : error,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    console.log(
      `\nDone. Generated ${generated} explainers ($${(totalCostCents / 100).toFixed(2)} spend).`,
    );
  } catch (error: unknown) {
    console.error(
      "Error in generateBillExplainers:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const billId = process.argv[2] ? parseInt(process.argv[2]) : undefined;
  generateBillExplainersFunction(billId);
}

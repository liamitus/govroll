import "dotenv/config";
import { fetchBillActions } from "../lib/congress-api";
import { parseBillId } from "../lib/parse-bill-id";
import { createStandalonePrisma } from "../lib/prisma-standalone";
import { reconcileStatus } from "../lib/reconcile-bill-status";

const prisma = createStandalonePrisma();

/**
 * Fetch actions from congress.gov for bills that might have stale statuses,
 * store the actions, and reconcile the bill's currentStatus if needed.
 */
export async function fetchBillActionsFunction(
  targetBillIds?: string[],
  limit = 100,
) {
  console.log(
    "Fetching bill actions for:",
    targetBillIds?.join(", ") ||
      `up to ${limit} active bills with non-terminal statuses`,
  );

  try {
    // Fetch bills that aren't in a terminal state (enacted) — those might
    // have stale statuses. If specific IDs given, use those.
    const bills = targetBillIds?.length
      ? await prisma.bill.findMany({
          where: { billId: { in: targetBillIds } },
        })
      : await prisma.bill.findMany({
          where: {
            currentStatus: {
              not: { startsWith: "enacted_" },
            },
            // Only check bills from recent congresses
            introducedDate: { gte: new Date("2023-01-01") },
          },
          orderBy: { currentStatusDate: "desc" },
          take: limit,
        });

    console.log(`Found ${bills.length} bills to check.`);

    let actionsStored = 0;
    let statusesFixed = 0;

    for (const bill of bills) {
      try {
        const { congress, apiBillType, billNumber } = parseBillId(bill.billId);
        if (!congress || !apiBillType || !billNumber) {
          console.warn(`Skipping ${bill.billId} — invalid parse.`);
          continue;
        }

        const actions = await fetchBillActions(
          congress,
          apiBillType,
          billNumber,
        );
        if (!actions || actions.length === 0) {
          console.warn(`No actions found for ${bill.billId}.`);
          continue;
        }

        // Store actions (upsert to avoid duplicates)
        for (const action of actions) {
          if (!action.actionDate || !action.text) continue;

          await prisma.billAction.upsert({
            where: {
              billId_actionDate_text: {
                billId: bill.id,
                actionDate: new Date(action.actionDate),
                text: action.text,
              },
            },
            update: {},
            create: {
              billId: bill.id,
              actionDate: new Date(action.actionDate),
              chamber: action.chamber,
              text: action.text,
              actionType: action.type,
            },
          });
        }
        actionsStored += actions.length;

        // Reconcile status
        const correctedStatus = reconcileStatus(
          bill.currentStatus,
          bill.billType,
          actions,
        );

        if (correctedStatus && correctedStatus !== bill.currentStatus) {
          console.log(
            `STATUS FIX: ${bill.billId} "${bill.title.slice(0, 60)}" — ` +
              `${bill.currentStatus} → ${correctedStatus}`,
          );

          // Find the date of the latest action for the corrected status date
          const latestAction = actions.reduce((latest, a) =>
            new Date(a.actionDate) > new Date(latest.actionDate) ? a : latest,
          );

          await prisma.bill.update({
            where: { id: bill.id },
            data: {
              currentStatus: correctedStatus,
              currentStatusDate: new Date(latestAction.actionDate),
            },
          });
          statusesFixed++;
        } else {
          console.log(
            `OK: ${bill.billId} — ${bill.currentStatus} (${actions.length} actions)`,
          );
        }
      } catch (error: unknown) {
        console.error(
          `Error processing ${bill.billId}:`,
          error instanceof Error ? error.message : error,
        );
      }

      // Rate limit: congress.gov allows ~1 req/sec with a registered key
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(
      `Done. Stored actions for ${bills.length} bills (${actionsStored} actions total). Fixed ${statusesFixed} statuses.`,
    );
  } catch (error: unknown) {
    console.error(
      "Error in fetchBillActions:",
      error instanceof Error ? error.message : error,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const billIds = process.argv.slice(2);
  fetchBillActionsFunction(billIds.length > 0 ? billIds : undefined);
}

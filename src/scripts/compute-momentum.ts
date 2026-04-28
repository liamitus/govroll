import "dotenv/config";
import { createStandalonePrisma } from "../lib/prisma-standalone";
import {
  computeMomentum,
  getCurrentCongress,
  isImminentFloorAction,
  isMajorAction,
  type MomentumTier,
} from "../lib/momentum";

const prisma = createStandalonePrisma();

const DAY_MS = 86_400_000;

/**
 * Recomputes the momentum signal on Bill. Pulls only the fields needed, so a
 * full sweep over ~15k bills stays cheap.
 *
 * Run modes:
 *   - Default: incremental. Processes bills whose momentum is stale (>20h old)
 *     or never computed, plus all bills that had any activity in the last 7d.
 *   - `full`: recomputes every bill. Use after deploying a scoring change.
 */
export async function computeMomentumFunction(
  limit = 2000,
  mode: "incremental" | "full" = "incremental",
): Promise<{ ok: number; failed: number }> {
  const now = new Date();
  const currentCongress = getCurrentCongress(now);

  const staleCutoff = new Date(now.getTime() - 20 * 3600_000);
  const recentActivityCutoff = new Date(now.getTime() - 7 * DAY_MS);
  const sevenDaysAgo = recentActivityCutoff;
  const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS);
  const oneYearAgo = new Date(now.getTime() - 365 * DAY_MS);

  const where =
    mode === "full"
      ? {}
      : {
          OR: [
            { momentumComputedAt: null },
            { momentumComputedAt: { lt: staleCutoff } },
            { latestActionDate: { gte: recentActivityCutoff } },
          ],
        };

  const bills = await prisma.bill.findMany({
    where,
    select: {
      id: true,
      billId: true,
      currentStatus: true,
      currentStatusDate: true,
      latestActionDate: true,
      congressNumber: true,
      cosponsorCount: true,
      cosponsorPartySplit: true,
      _count: {
        select: {
          votes: true,
          publicVotes: true,
          comments: true,
          textVersions: true,
        },
      },
      textVersions: {
        where: { isSubstantive: true },
        select: { id: true },
      },
    },
    // Prioritize never-computed bills, then oldest-first so recently-touched
    // bills get recomputed before the stale pile.
    orderBy: [
      { momentumComputedAt: { sort: "asc", nulls: "first" } },
      { latestActionDate: { sort: "desc", nulls: "last" } },
    ],
    take: limit,
  });

  if (bills.length === 0) {
    console.log("[momentum] nothing to compute");
    return { ok: 0, failed: 0 };
  }

  const billDbIds = bills.map((b) => b.id);

  // Bulk-fetch action history for the batch. We classify each row in JS so
  // the rules stay in one place (momentum.ts) instead of being duplicated as
  // SQL ILIKE patterns. 365d window matches the LONG_SILENCE override —
  // anything older won't matter to a live bill.
  const actions = await prisma.billAction.findMany({
    where: {
      billId: { in: billDbIds },
      actionDate: { gte: oneYearAgo },
    },
    select: {
      billId: true,
      actionDate: true,
      text: true,
      actionType: true,
    },
  });

  const latestMajorByBill = new Map<number, Date>();
  const imminentBills = new Set<number>();
  for (const a of actions) {
    if (isMajorAction(a.text, a.actionType)) {
      const prev = latestMajorByBill.get(a.billId);
      if (!prev || prev < a.actionDate) {
        latestMajorByBill.set(a.billId, a.actionDate);
      }
    }
    if (
      a.actionDate >= fourteenDaysAgo &&
      isImminentFloorAction(a.text, a.actionType)
    ) {
      imminentBills.add(a.billId);
    }
  }

  // 7-day civic engagement velocity: publicVotes + comments only. Excludes
  // representative roll-call votes since those happen on Congress's
  // schedule and would muddle "user attention just spiked."
  const [recentVoteRows, recentCommentRows] = await Promise.all([
    prisma.vote.groupBy({
      by: ["billId"],
      where: { billId: { in: billDbIds }, votedAt: { gte: sevenDaysAgo } },
      _count: { _all: true },
    }),
    prisma.comment.groupBy({
      by: ["billId"],
      where: { billId: { in: billDbIds }, date: { gte: sevenDaysAgo } },
      _count: { _all: true },
    }),
  ]);
  const recentEngagementByBill = new Map<number, number>();
  for (const v of recentVoteRows) {
    recentEngagementByBill.set(
      v.billId,
      (recentEngagementByBill.get(v.billId) ?? 0) + v._count._all,
    );
  }
  for (const c of recentCommentRows) {
    recentEngagementByBill.set(
      c.billId,
      (recentEngagementByBill.get(c.billId) ?? 0) + c._count._all,
    );
  }

  console.log(
    `[momentum] computing ${bills.length} bills (mode=${mode}, congress=${currentCongress}, ${actions.length} actions, ${imminentBills.size} imminent)`,
  );

  // Batch the updates. Prisma doesn't offer a typed bulk-update with per-row
  // values, so we issue them in parallel-ish chunks.
  const CHUNK = 50;
  let ok = 0;
  let failed = 0;
  const tierCounts = new Map<MomentumTier | "ENACTED", number>();

  for (let i = 0; i < bills.length; i += CHUNK) {
    const chunk = bills.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      chunk.map(async (bill) => {
        const latestMajor = latestMajorByBill.get(bill.id) ?? null;
        const hasImminent = imminentBills.has(bill.id);
        const recentCivic = recentEngagementByBill.get(bill.id) ?? 0;

        const result = computeMomentum(
          {
            billId: bill.billId,
            currentStatus: bill.currentStatus,
            congressNumber: bill.congressNumber,
            latestActionDate: bill.latestActionDate,
            latestMajorActionDate: latestMajor,
            currentStatusDate: bill.currentStatusDate,
            cosponsorCount: bill.cosponsorCount,
            cosponsorPartySplit: bill.cosponsorPartySplit,
            substantiveVersions: bill.textVersions.length,
            engagementCount:
              bill._count.votes +
              bill._count.publicVotes +
              bill._count.comments,
            recentCivicEngagementCount: recentCivic,
            hasImminentFloorAction: hasImminent,
          },
          currentCongress,
          now,
        );

        tierCounts.set(result.tier, (tierCounts.get(result.tier) ?? 0) + 1);

        await prisma.bill.update({
          where: { id: bill.id },
          data: {
            momentumScore: result.score,
            momentumTier: result.tier,
            daysSinceLastAction: result.daysSinceLastAction,
            deathReason: result.deathReason,
            momentumComputedAt: now,
            latestMajorActionDate: latestMajor,
            hasImminentFloorAction: hasImminent,
          },
        });
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") ok++;
      else {
        failed++;
        console.warn("[momentum] update failed:", r.reason);
      }
    }
  }

  const tierSummary = Array.from(tierCounts.entries())
    .map(([t, c]) => `${t}=${c}`)
    .join(" ");
  console.log(`[momentum] done — ${ok} ok, ${failed} failed [${tierSummary}]`);
  return { ok, failed };
}

if (require.main === module) {
  const mode = (process.argv[2] === "full" ? "full" : "incremental") as
    | "incremental"
    | "full";
  const limit = parseInt(process.argv[3] || "2000", 10);
  computeMomentumFunction(limit, mode)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

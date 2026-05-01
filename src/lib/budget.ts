import { prisma } from "@/lib/prisma";
import { computeCostCents, type CacheTokenBreakdown } from "@/lib/ai-pricing";

/**
 * Govroll runs on reader contributions. AI features are the largest variable
 * cost, so we track monthly income vs. spend in a simple ledger and flip
 * `aiEnabled` off when the remaining budget drops below zero.
 *
 * Each period (YYYY-MM in UTC) gets its own row, but unspent donations roll
 * forward via `carryoverCents` so a generous April keeps May's AI funded
 * across the month boundary instead of resetting to $0. The progress bar
 * treats `carryover + income` as a single "raised" total.
 *
 * All amounts are integer cents.
 */

export type BudgetSnapshot = {
  period: string;
  carryoverCents: number;
  incomeCents: number;
  spendCents: number;
  reserveCents: number;
  availableCents: number;
  aiEnabled: boolean;
  aiDisabledReason: string | null;
  lastEvaluated: Date;
};

/** Default reserve held back before AI is considered "affordable."
 *  $0 means the first dollar donated activates AI immediately. Set higher
 *  if you want a safety buffer before AI runs. */
const DEFAULT_RESERVE_CENTS = 0;

export function currentPeriod(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function previousPeriod(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return currentPeriod(d);
}

/** Period immediately before the given YYYY-MM string. Used during ledger
 *  bootstrap to find the row whose surplus should be carried forward. */
export function previousPeriodOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  // m is 1-indexed in YYYY-MM; (m - 2) is the previous month 0-indexed for
  // Date.UTC, which also handles year wrap (e.g. m=1 → -1 → previous Dec).
  const d = new Date(Date.UTC(y, m - 2, 1));
  return currentPeriod(d);
}

/** AI spend from the previous month, or 0 if no ledger row exists. */
export async function previousMonthSpendCents(): Promise<number> {
  const row = await prisma.budgetLedger.findUnique({
    where: { period: previousPeriod() },
    select: { spendCents: true },
  });
  return row?.spendCents ?? 0;
}

/**
 * Read (or bootstrap) the ledger row for the given period. On first creation,
 * seeds `carryoverCents` with any unspent surplus from the previous period so
 * donations roll forward across the month boundary. `aiEnabled` starts true;
 * the cron flips it off later if cumulative spend overshoots.
 */
export async function getOrCreateLedger(period = currentPeriod()) {
  const existing = await prisma.budgetLedger.findUnique({ where: { period } });
  if (existing) return existing;

  const prev = await prisma.budgetLedger.findUnique({
    where: { period: previousPeriodOf(period) },
    select: {
      carryoverCents: true,
      incomeCents: true,
      spendCents: true,
      reserveCents: true,
    },
  });
  const carryoverCents = prev
    ? Math.max(
        0,
        prev.carryoverCents +
          prev.incomeCents -
          prev.spendCents -
          prev.reserveCents,
      )
    : 0;

  // Upsert (not create) so two concurrent first-of-month requests can't both
  // race past the unique-constraint check; whoever wins keeps their carryover.
  return prisma.budgetLedger.upsert({
    where: { period },
    create: {
      period,
      carryoverCents,
      reserveCents: DEFAULT_RESERVE_CENTS,
      aiEnabled: true,
      aiDisabledReason: "bootstrap",
    },
    update: {},
  });
}

export async function getBudgetSnapshot(
  period = currentPeriod(),
): Promise<BudgetSnapshot> {
  const ledger = await getOrCreateLedger(period);
  const availableCents =
    ledger.carryoverCents +
    ledger.incomeCents -
    ledger.spendCents -
    ledger.reserveCents;
  return {
    period: ledger.period,
    carryoverCents: ledger.carryoverCents,
    incomeCents: ledger.incomeCents,
    spendCents: ledger.spendCents,
    reserveCents: ledger.reserveCents,
    availableCents,
    aiEnabled: ledger.aiEnabled,
    aiDisabledReason: ledger.aiDisabledReason,
    lastEvaluated: ledger.lastEvaluated,
  };
}

/**
 * Record income from a successful Stripe charge. Called from the webhook.
 * Idempotent at the caller level — the webhook must dedupe on payment id.
 */
export async function recordIncome(cents: number, period = currentPeriod()) {
  await getOrCreateLedger(period);
  return prisma.budgetLedger.update({
    where: { period },
    data: { incomeCents: { increment: cents } },
  });
}

export type UsageInput = {
  userId?: string | null;
  feature: string;
  model: string;
  /** Total input tokens reported by the provider, including any cache reads
   *  and writes. The cache breakdown (when present) lets the cost math bill
   *  cached tokens at Anthropic's discounted/premium rates. */
  inputTokens: number;
  outputTokens: number;
  cache?: CacheTokenBreakdown;
};

/**
 * Log an AI call, compute its cost, and atomically add it to the current
 * period's spend. This is the single write path for AI cost accounting.
 */
export async function recordSpend(event: UsageInput) {
  const costCents = computeCostCents(
    event.model,
    event.inputTokens,
    event.outputTokens,
    event.cache,
  );
  const period = currentPeriod();
  await getOrCreateLedger(period);

  await prisma.$transaction([
    prisma.aiUsageEvent.create({
      data: {
        userId: event.userId ?? null,
        feature: event.feature,
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        costCents,
      },
    }),
    prisma.budgetLedger.update({
      where: { period },
      data: { spendCents: { increment: costCents } },
    }),
  ]);

  return costCents;
}

/**
 * Recompute `aiEnabled` for the current period. Called by the hourly cron and
 * after significant events (a large spend burst, a webhook income tick).
 */
export async function evaluateAiEnabled(period = currentPeriod()) {
  const snapshot = await getBudgetSnapshot(period);
  const shouldEnable = snapshot.availableCents >= 0;
  if (shouldEnable === snapshot.aiEnabled) {
    await prisma.budgetLedger.update({
      where: { period },
      data: { lastEvaluated: new Date() },
    });
    return snapshot;
  }
  await prisma.budgetLedger.update({
    where: { period },
    data: {
      aiEnabled: shouldEnable,
      aiDisabledReason: shouldEnable ? null : "budget",
      lastEvaluated: new Date(),
    },
  });
  return { ...snapshot, aiEnabled: shouldEnable };
}

/**
 * The "typical" donation figure shown on the donate page. Uses median, hides
 * the value entirely below the sample-size floor so tiny samples can't
 * embarrass us or anchor donors downward.
 */
export async function getTypicalDonationCents(opts?: {
  days?: number;
  minSample?: number;
}): Promise<number | null> {
  const days = opts?.days ?? 30;
  const minSample = opts?.minSample ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.donation.findMany({
    where: {
      createdAt: { gte: since },
      moderationStatus: { in: ["APPROVED", "PENDING"] },
    },
    select: { amountCents: true },
    orderBy: { amountCents: "asc" },
  });
  if (rows.length < minSample) return null;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2
    ? rows[mid].amountCents
    : Math.round((rows[mid - 1].amountCents + rows[mid].amountCents) / 2);
}

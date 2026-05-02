/**
 * Fixed monthly costs to run Govroll.
 *
 * These are real line items — update them when bills change.
 * This file is intentionally simple so anyone can read the source
 * and verify the numbers: /src/lib/site-costs.ts
 *
 * AI costs (variable) are tracked separately in the budget ledger.
 */

export type CostLineItem = {
  name: string;
  monthlyCents: number;
  note: string;
};

export const FIXED_MONTHLY_COSTS: CostLineItem[] = [
  {
    name: "Hosting (Vercel)",
    monthlyCents: 0,
    note: "Free tier for now — scales with traffic",
  },
  {
    name: "Database (Supabase Pro)",
    monthlyCents: 2500,
    note: "Pro plan — daily backups, no project pause",
  },
  {
    name: "Domains",
    monthlyCents: 200,
    note: "govroll.com + govroll.org, amortized monthly",
  },
];

/** Buffer added on top of the AI estimate so we don't run dry mid-month. */
export const AI_BUFFER_CENTS = 500; // $5

/**
 * Manual override for the trailing-average AI forecast. When > 0, the public
 * estimate uses this value instead of the trailing window — for periods when
 * recent ledger spend doesn't reflect normal usage (one-off backfills, etc.).
 *
 * Set to 0 once we have ~3 months of clean post-backfill history so the
 * trailing average can take over.
 *
 * Current value ($35) reflects expected steady-state usage as of May 2026,
 * after April 2026's spend was inflated by content backfills.
 */
export const AI_ESTIMATE_OVERRIDE_CENTS = 3500;

/** How many months of prior spend to average when forecasting AI cost. */
export const TRAILING_WINDOW_MONTHS = 3;

/** Total fixed costs in cents per month. */
export const FIXED_TOTAL_CENTS = FIXED_MONTHLY_COSTS.reduce(
  (sum, item) => sum + item.monthlyCents,
  0,
);

/**
 * Estimated AI cost for this month.
 *
 *   sample = override > 0 ? override : trailing-window average
 *   estimate = max(sample, this-month-so-far) + buffer
 *
 * The trailing window smooths month-to-month noise once we have enough clean
 * history. The override lets us bypass it when recent data is known to be
 * unrepresentative. The this-month-so-far term ensures we never undershoot
 * once spend has already happened. Spike months are absorbed by the donation
 * carry-forward (see budget ledger), so this estimate doesn't need to be
 * worst-case.
 */
export function estimatedAiCostCents(
  thisMonthSpendCents: number,
  trailingMonthSpendsCents: readonly number[],
): number {
  const trailingAvg =
    trailingMonthSpendsCents.length > 0
      ? trailingMonthSpendsCents.reduce((s, n) => s + n, 0) /
        trailingMonthSpendsCents.length
      : 0;
  const sample =
    AI_ESTIMATE_OVERRIDE_CENTS > 0 ? AI_ESTIMATE_OVERRIDE_CENTS : trailingAvg;
  const best = Math.max(sample, thisMonthSpendCents);
  return Math.round(best) + AI_BUFFER_CENTS;
}

/**
 * Total monthly cost = fixed infrastructure + estimated AI spend.
 * This is the real number it costs to keep Govroll online.
 */
export function totalMonthlyCostCents(
  thisMonthSpendCents: number,
  trailingMonthSpendsCents: readonly number[],
): number {
  return (
    FIXED_TOTAL_CENTS +
    estimatedAiCostCents(thisMonthSpendCents, trailingMonthSpendsCents)
  );
}

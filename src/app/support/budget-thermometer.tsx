"use client";

import {
  FIXED_MONTHLY_COSTS,
  estimatedAiCostCents,
  totalMonthlyCostCents,
} from "@/lib/site-costs";

/**
 * Budget thermometer — shows how much of the total monthly running costs
 * have been covered by citizen contributions. Carried-forward surplus from
 * prior months is treated the same as fresh income for the bar and the
 * funded/needs-support state, but is broken out in a subline so donors can
 * see exactly where the money came from.
 */

export function BudgetThermometer({
  carryoverCents,
  incomeCents,
  spendCents,
  trailingSpendsCents,
  aiEnabled,
  period,
}: {
  carryoverCents: number;
  incomeCents: number;
  spendCents: number;
  /** AI spend for the most recent N months that have ledger rows, ordered
   *  most-recent → oldest. Drives the trailing-average forecast. */
  trailingSpendsCents: readonly number[];
  aiEnabled: boolean;
  period: string;
}) {
  const aiCostCents = estimatedAiCostCents(spendCents, trailingSpendsCents);
  const totalCostCents = totalMonthlyCostCents(spendCents, trailingSpendsCents);
  const totalDollars = (totalCostCents / 100).toFixed(0);
  const raisedCents = carryoverCents + incomeCents;
  const raisedDollars = (raisedCents / 100).toFixed(0);
  const carryoverDollars = (carryoverCents / 100).toFixed(0);
  const target = Math.max(totalCostCents, 1);
  const pct = Math.min(Math.round((raisedCents / target) * 100), 100);
  const funded = raisedCents >= totalCostCents;

  // Three-tier status: Funded > Needs Support > AI Paused
  const status = !aiEnabled
    ? { label: "AI Paused", bg: "bg-red-100 text-red-800" }
    : funded
      ? { label: "Funded", bg: "bg-green-100 text-green-800" }
      : { label: "Needs Support", bg: "bg-amber-100 text-amber-800" };

  // Format period: "2026-04" → "April 2026"
  const [year, month] = period.split("-");
  const monthName = new Date(Number(year), Number(month) - 1).toLocaleString(
    "en-US",
    { month: "long" },
  );
  // Same trick for the previous month name in the carryover sub-line.
  const prevMonthName = new Date(
    Number(year),
    Number(month) - 2,
  ).toLocaleString("en-US", { month: "long" });

  // Card style follows status
  const cardBg = !aiEnabled
    ? "bg-red-50 border-red-200"
    : funded
      ? "bg-card"
      : "bg-amber-50 border-amber-200";

  return (
    <div className={`space-y-5 rounded-xl border p-8 ${cardBg}`}>
      <div className="flex items-center justify-between text-lg">
        <span className="font-semibold">
          {monthName} {year} Running Costs
        </span>
        <span
          className={`rounded-full px-3 py-1 text-base font-semibold ${status.bg}`}
        >
          {status.label}
        </span>
      </div>

      {/* Bar */}
      <div className="bg-muted h-5 w-full overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            !aiEnabled ? "bg-red-500" : funded ? "bg-navy" : "bg-amber-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="text-muted-foreground flex justify-between text-base">
        <span>${raisedDollars} raised</span>
        <span>${totalDollars} to run this month</span>
      </div>

      {carryoverCents > 0 && (
        <p className="text-muted-foreground/80 -mt-3 text-sm">
          Includes ${carryoverDollars} carried from {prevMonthName} —
          contributions roll forward, they don&apos;t reset.
        </p>
      )}

      {/* Cost breakdown */}
      <details className="text-muted-foreground text-base">
        <summary className="hover:text-foreground cursor-pointer transition-colors">
          What does this cover?
        </summary>
        <ul className="mt-4 space-y-2 pl-4">
          {FIXED_MONTHLY_COSTS.filter((item) => item.monthlyCents > 0).map(
            (item) => (
              <li key={item.name} className="flex justify-between">
                <span>
                  {item.name}{" "}
                  <span className="text-muted-foreground/60">
                    — {item.note}
                  </span>
                </span>
                <span className="font-mono">
                  ${(item.monthlyCents / 100).toFixed(0)}
                </span>
              </li>
            ),
          )}
          <li className="flex justify-between">
            <span>
              AI APIs{" "}
              <span className="text-muted-foreground/60">
                — summaries, chat, analysis
              </span>
            </span>
            <span className="font-mono">${(aiCostCents / 100).toFixed(0)}</span>
          </li>
          <li className="text-foreground flex justify-between border-t pt-2 font-medium">
            <span>Total</span>
            <span className="font-mono">${totalDollars}</span>
          </li>
        </ul>
        <p className="text-muted-foreground/60 mt-4">
          Hosting and database are free for now — these costs will grow with
          traffic.{" "}
          <a
            href="https://github.com/liamitus/govroll/blob/main/src/lib/site-costs.ts"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground underline underline-offset-2"
          >
            See the source code for these numbers
          </a>
        </p>
      </details>

      {!aiEnabled && raisedCents === 0 && (
        <p className="text-base font-medium text-red-700">
          AI features are paused until a few citizens chip in. ${totalDollars}{" "}
          covers a full month — be the first to unlock them for everyone.
        </p>
      )}

      {!aiEnabled && raisedCents > 0 && (
        <p className="text-base font-medium text-red-700">
          AI features are paused — contributions so far haven&apos;t quite
          covered the month. About $
          {Math.max(1, Math.ceil((totalCostCents - raisedCents) / 100))} more to
          bring them back online.
        </p>
      )}

      {aiEnabled && !funded && (
        <p className="text-base font-medium text-amber-800">
          AI is active but not yet funded this month. Contributions keep it
          running for everyone.
        </p>
      )}
    </div>
  );
}

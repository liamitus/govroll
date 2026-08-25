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

  // Three-tier status chip. Colour follows the encoding law: gold = pending
  // attention (paused), sapphire-deep = cleared (funded), hollow outline =
  // still in progress. Never red — a shortfall is not an alarm.
  const status = !aiEnabled
    ? { label: "AI Paused", chip: "bg-gold text-ink" }
    : funded
      ? { label: "Funded", chip: "bg-sapphire-deep text-paper" }
      : { label: "Needs Support", chip: "border-hollow text-ink-muted border" };

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

  // At most one gold element on the card: the paused chip when AI is off,
  // otherwise the current-position node on the bar while unfunded.
  const showGoldMarker = aiEnabled && !funded;

  return (
    <div className="border-rule bg-paper space-y-5 border p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3 text-lg">
        <span className="font-semibold">
          {`${monthName} ${year} Running Costs`}
        </span>
        <span
          className={`px-2.5 py-1 text-[11px] font-bold tracking-[0.1em] uppercase ${status.chip}`}
        >
          {status.label}
        </span>
      </div>

      {/* Bar — sapphire fill over a rule track; the gold node marks the
          current position while the month is still unfunded. */}
      <div className="bg-rule relative h-3 w-full">
        <div
          className="bg-sapphire h-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
        {showGoldMarker && (
          <span
            className="bg-gold absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full"
            style={{
              left: `clamp(0px, calc(${pct}% - 7px), calc(100% - 14px))`,
            }}
            aria-hidden="true"
          />
        )}
      </div>

      <div className="text-ink-muted flex justify-between text-base tabular-nums">
        <span>{`$${raisedDollars} raised`}</span>
        <span>{`$${totalDollars} to run this month`}</span>
      </div>

      {carryoverCents > 0 && (
        <p className="text-ink-muted -mt-3 text-sm">
          {`Includes $${carryoverDollars} carried from ${prevMonthName} — contributions roll forward, they don’t reset.`}
        </p>
      )}

      {/* Cost breakdown */}
      <details className="text-ink-muted text-base">
        <summary className="hover:text-ink cursor-pointer transition-colors">
          What does this cover?
        </summary>
        <ul className="mt-4 space-y-2 pl-4">
          {FIXED_MONTHLY_COSTS.filter((item) => item.monthlyCents > 0).map(
            (item) => (
              <li key={item.name} className="flex justify-between">
                <span>
                  {item.name}{" "}
                  <span className="text-ink-muted/70">— {item.note}</span>
                </span>
                <span className="tabular-nums">
                  ${(item.monthlyCents / 100).toFixed(0)}
                </span>
              </li>
            ),
          )}
          <li className="flex justify-between">
            <span>
              AI APIs{" "}
              <span className="text-ink-muted/70">
                — summaries, chat, analysis
              </span>
            </span>
            <span className="tabular-nums">
              ${(aiCostCents / 100).toFixed(0)}
            </span>
          </li>
          <li className="text-ink border-rule flex justify-between border-t pt-2 font-medium">
            <span>Total</span>
            <span className="tabular-nums">${totalDollars}</span>
          </li>
        </ul>
        <p className="text-ink-muted/70 mt-4">
          Hosting and database are free for now — these costs will grow with
          traffic.{" "}
          <a
            href="https://github.com/howellandgibbs/govroll/blob/main/src/lib/site-costs.ts"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink underline underline-offset-2"
          >
            See the source code for these numbers
          </a>
        </p>
      </details>

      {!aiEnabled && raisedCents === 0 && (
        <p className="text-ink text-base font-medium">
          {`AI features are paused until a few citizens chip in. $${totalDollars} covers a full month — be the first to unlock them for everyone.`}
        </p>
      )}

      {!aiEnabled && raisedCents > 0 && (
        <p className="text-ink text-base font-medium">
          {`AI features are paused — contributions so far haven’t quite covered the month. About $${Math.max(1, Math.ceil((totalCostCents - raisedCents) / 100))} more to bring them back online.`}
        </p>
      )}

      {aiEnabled && !funded && (
        <p className="text-ink text-base font-medium">
          AI is active but not yet funded this month. Contributions keep it
          running for everyone.
        </p>
      )}
    </div>
  );
}

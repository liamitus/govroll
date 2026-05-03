import Link from "next/link";

/**
 * Rendered in place of AI features when the budget is exhausted.
 * Compact enough to drop into the chat panel, bill summary area, etc.
 */
export function AiPausedPanel({
  incomeCents,
  spendCents,
  className = "",
}: {
  incomeCents?: number;
  spendCents?: number;
  className?: string;
}) {
  const hasNumbers =
    typeof incomeCents === "number" && typeof spendCents === "number";

  return (
    <div
      className={`space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-center ${className}`}
    >
      <p className="text-base font-medium text-red-800">
        AI features are paused this month
      </p>
      <p className="text-sm text-red-700/80">
        {hasNumbers
          ? `Govroll’s AI summaries and chat are funded entirely by citizens. This month: $${(incomeCents / 100).toFixed(0)} raised / $${(spendCents / 100).toFixed(0)} spent. When enough people chip in, they come back online for everyone.`
          : "Govroll’s AI summaries and chat are funded entirely by citizens. When enough people chip in, they come back online for everyone."}
      </p>
      <Link
        href="/support"
        className="bg-navy hover:bg-navy-light inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold tracking-wide text-white transition-colors"
      >
        Help bring them back
      </Link>
    </div>
  );
}

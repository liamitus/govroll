import Link from "next/link";

/**
 * Rendered in place of AI features when the budget is exhausted.
 * Compact enough to drop into the chat panel, bill summary area, etc.
 * Gold border = pending attention (never red — a funding pause is not
 * an error).
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
      className={`border-gold bg-paper space-y-3 border p-4 text-center ${className}`}
    >
      <p className="text-ink text-base font-medium">
        AI features are paused this month
      </p>
      <p className="text-ink-muted text-sm">
        {hasNumbers
          ? `Govroll’s AI summaries and chat are funded entirely by citizens. This month: $${(incomeCents / 100).toFixed(0)} raised / $${(spendCents / 100).toFixed(0)} spent. When enough people chip in, they come back online for everyone.`
          : "Govroll’s AI summaries and chat are funded entirely by citizens. When enough people chip in, they come back online for everyone."}
      </p>
      <Link
        href="/support"
        className="bg-sapphire-deep hover:bg-ink text-paper inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold tracking-wide transition-colors"
      >
        Help bring them back
      </Link>
    </div>
  );
}

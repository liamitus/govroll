import { BillJourney } from "./bill-journey";
import type { JourneyStep } from "@/lib/bill-helpers";

/**
 * Always-visible legislative-stage section. Pairs the journey stepper with
 * a one-paragraph status caption — replaces the old "More detail" expand
 * that buried the spine of the legislative process behind a toggle.
 */
export function BillStageSection({
  steps,
  statusHeadline,
  statusDetail,
}: {
  steps: JourneyStep[];
  statusHeadline: string;
  statusDetail: string;
}) {
  return (
    <section
      aria-label="Legislative stage"
      className="bg-card space-y-3 rounded-xl border px-5 py-4"
    >
      <BillJourney steps={steps} compact />
      <div className="border-l-civic-gold bg-civic-cream/50 dark:bg-accent/30 space-y-1 rounded-md border-l-4 px-3.5 py-2">
        <p className="text-sm leading-snug font-medium">{statusHeadline}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {statusDetail}
        </p>
      </div>
    </section>
  );
}

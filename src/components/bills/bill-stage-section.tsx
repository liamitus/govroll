import { BillJourney } from "./bill-journey";
import type { JourneyStep } from "@/lib/bill-helpers";

/**
 * Always-visible legislative-stage section. Pairs the journey stepper with
 * a single-line status detail — the status name is already shown as a
 * badge in the hero and as the active step in the stepper, so we don't
 * repeat it as a heading here.
 */
export function BillStageSection({
  steps,
  statusDetail,
}: {
  steps: JourneyStep[];
  statusDetail: string;
}) {
  return (
    <section
      aria-label="Legislative stage"
      className="bg-card space-y-3 rounded-xl border px-5 py-4"
    >
      <BillJourney steps={steps} compact />
      <p className="border-l-civic-gold bg-civic-cream/50 dark:bg-accent/30 text-foreground/85 rounded-md border-l-4 px-3.5 py-2 text-xs leading-relaxed">
        {statusDetail}
      </p>
    </section>
  );
}

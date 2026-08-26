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
      className="bg-paper border-rule space-y-3 border px-5 py-4"
    >
      <BillJourney steps={steps} compact />
      {/* Gold marks "here, now" — the left rule ties this note to the
          route's current position without adding another saturated fill. */}
      <p className="border-l-gold bg-sand text-ink/85 border-l-4 px-3.5 py-2 text-xs leading-relaxed">
        {statusDetail}
      </p>
    </section>
  );
}

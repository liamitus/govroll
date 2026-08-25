import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { formatJourneyDate, type JourneyStep } from "@/lib/bill-helpers";

// Above this length we treat `step.detail` as a long-form (likely AI-generated
// markdown) summary and collapse it behind a `<details>` toggle on mobile.
// Static stage descriptions from getJourneySteps() are all well under this.
const LONG_DETAIL_THRESHOLD = 200;

const detailMarkdownComponents = {
  h1: ({ children }: { children?: ReactNode }) => (
    <p className="text-ink mb-1.5 font-semibold">{children}</p>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <p className="text-ink mb-1.5 font-semibold">{children}</p>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <p className="text-ink mb-1.5 font-semibold">{children}</p>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-1.5 leading-relaxed last:mb-0">{children}</p>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="text-ink font-semibold">{children}</strong>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
};

/**
 * The route grammar (docs/design/roll-call.md): node fill encodes stage.
 *
 * - cleared  → solid sapphire (~14px), date below
 * - current  → solid gold, enlarged (~20px) — exactly one per route,
 *              sitting on the last completed stage
 * - ahead    → hollow circle, 2px hollow stroke — not a prediction
 * - dead     → hollow at 45% opacity; the route ended here, no red
 */
function nodeClass(status: JourneyStep["status"]): string {
  switch (status) {
    case "completed":
      return "h-3.5 w-3.5 bg-sapphire";
    case "current":
      return "h-5 w-5 bg-gold";
    case "failed":
      return "h-3.5 w-3.5 border-2 border-hollow bg-transparent opacity-45";
    case "upcoming":
      return "h-3.5 w-3.5 border-2 border-hollow bg-transparent";
  }
}

function labelClass(status: JourneyStep["status"]): string {
  switch (status) {
    case "completed":
      return "text-ink";
    case "current":
      return "text-ink font-semibold";
    case "failed":
      return "text-ink-muted";
    case "upcoming":
      return "text-ink-muted";
  }
}

/**
 * Track segment leading INTO the given (next) stop. The track behind
 * cleared nodes is solid sapphire (~5px); the track ahead is a hairline
 * in hollow. A dead route just fades — never red. The track never bends,
 * branches, or animates.
 */
function trackClass(next: JourneyStep["status"]): string {
  switch (next) {
    case "completed":
    case "current":
      return "h-[5px] bg-sapphire";
    case "failed":
      return "h-[1.5px] bg-hollow opacity-45";
    case "upcoming":
      return "h-[1.5px] bg-hollow";
  }
}

function verticalTrackClass(next: JourneyStep["status"]): string {
  switch (next) {
    case "completed":
    case "current":
      return "w-[5px] bg-sapphire";
    case "failed":
      return "w-px bg-hollow opacity-45";
    case "upcoming":
      return "w-px bg-hollow";
  }
}

export function BillJourney({
  steps,
  compact = false,
}: {
  steps: JourneyStep[];
  /** Tighter labels + spacing. Used as the page-level spine where
   *  the journey is always visible, vs expanded card contexts. */
  compact?: boolean;
}) {
  const labelText = compact ? "text-[11px]" : "text-xs";
  const labelMargin = compact ? "mt-1.5" : "mt-2";

  return (
    <div className="w-full">
      {/* Desktop: the horizontal route. Nodes sit on a single straight
          track; every node is vertically centered in a fixed-height row
          so the 20px current node and 14px stops share a centerline. */}
      <div className="hidden items-start sm:flex">
        {steps.map((step, i) => (
          <div
            key={`${step.label}-${i}`}
            className="flex flex-1 items-start last:flex-none"
          >
            {/* Node + label stop */}
            <div className="group relative flex flex-col items-center">
              <div className="flex h-5 items-center">
                <div
                  className={`shrink-0 rounded-full ${nodeClass(step.status)}`}
                />
              </div>
              <span
                className={`${labelMargin} max-w-[6.5rem] text-center ${labelText} leading-tight font-medium ${labelClass(step.status)}`}
              >
                {step.label}
              </span>
              {step.date ? (
                <span className="text-ink-muted mt-0.5 text-[11px] tabular-nums">
                  {formatJourneyDate(step.date, "short")}
                </span>
              ) : step.status === "current" ? (
                <span className="text-ink-muted mt-0.5 text-[11px]">Now</span>
              ) : null}
              {/* Tooltip for detail on desktop */}
              {step.detail && (
                <div className="bg-paper text-ink-muted border-rule pointer-events-none absolute top-full left-1/2 z-10 mt-8 w-56 -translate-x-1/2 border p-2.5 text-xs leading-relaxed opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                  {step.detail}
                </div>
              )}
            </div>

            {/* Track segment to the next stop */}
            {i < steps.length - 1 && (
              <div className="flex h-5 flex-1 items-center">
                <div className={`w-full ${trackClass(steps[i + 1].status)}`} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Below 640px: the route runs vertically — stacked stops, track on
          the left. The ONLY place the route is vertical. */}
      <div className="space-y-0 sm:hidden">
        {steps.map((step, i) => (
          <div key={`${step.label}-${i}`} className="flex gap-3">
            {/* Track + node */}
            <div className="flex w-5 flex-col items-center">
              <div className="flex h-5 shrink-0 items-center">
                <div
                  className={`shrink-0 rounded-full ${nodeClass(step.status)}`}
                />
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`min-h-4 flex-1 ${verticalTrackClass(steps[i + 1].status)}`}
                />
              )}
            </div>

            {/* Label + date + detail */}
            <div className="min-w-0 pb-4">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-sm font-medium ${labelClass(step.status)}`}
                >
                  {step.label}
                </span>
                {step.date ? (
                  <span className="text-ink-muted shrink-0 text-xs tabular-nums">
                    {formatJourneyDate(step.date, "long")}
                  </span>
                ) : step.status === "current" ? (
                  <span className="text-ink-muted shrink-0 text-xs">Now</span>
                ) : null}
              </div>
              {(step.status === "current" || step.status === "failed") && (
                <p className="text-ink-muted mt-0.5 text-sm">
                  {step.description}
                </p>
              )}
              {step.detail &&
                (step.detail.length <= LONG_DETAIL_THRESHOLD ? (
                  <p className="text-ink-muted border-rule mt-1 border-l-2 pl-3 text-sm leading-relaxed">
                    {step.detail}
                  </p>
                ) : (
                  <details className="group mt-1.5">
                    <summary className="text-sapphire-deep inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium hover:underline [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">
                        Show change summary
                      </span>
                      <span className="hidden group-open:inline">
                        Hide change summary
                      </span>
                      <span
                        aria-hidden
                        className="transition-transform group-open:rotate-180"
                      >
                        ▾
                      </span>
                    </summary>
                    <div className="border-rule text-ink-muted mt-1.5 border-l-2 pl-3 text-sm leading-relaxed">
                      <ReactMarkdown components={detailMarkdownComponents}>
                        {step.detail}
                      </ReactMarkdown>
                    </div>
                  </details>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

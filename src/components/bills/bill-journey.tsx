import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { formatJourneyDate, type JourneyStep } from "@/lib/bill-helpers";

// Above this length we treat `step.detail` as a long-form (likely AI-generated
// markdown) summary and collapse it behind a `<details>` toggle on mobile.
// Static stage descriptions from getJourneySteps() are all well under this.
const LONG_DETAIL_THRESHOLD = 200;

const detailMarkdownComponents = {
  h1: ({ children }: { children?: ReactNode }) => (
    <p className="text-foreground/90 mb-1.5 font-semibold">{children}</p>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <p className="text-foreground/90 mb-1.5 font-semibold">{children}</p>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <p className="text-foreground/90 mb-1.5 font-semibold">{children}</p>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-1.5 leading-relaxed last:mb-0">{children}</p>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="text-foreground font-semibold">{children}</strong>
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

function circleClass(status: JourneyStep["status"]): string {
  switch (status) {
    case "completed":
      return "bg-navy text-white";
    case "current":
      return "bg-civic-gold text-white ring-4 ring-civic-gold/20";
    case "failed":
      return "bg-failed text-white ring-4 ring-failed/20";
    case "upcoming":
      return "bg-muted text-muted-foreground";
  }
}

function labelClass(status: JourneyStep["status"]): string {
  switch (status) {
    case "completed":
      return "text-foreground/70";
    case "current":
      return "text-foreground font-semibold";
    case "failed":
      return "text-failed font-semibold";
    case "upcoming":
      return "text-muted-foreground";
  }
}

function connectorClass(status: JourneyStep["status"]): string {
  switch (status) {
    case "completed":
      return "bg-navy";
    case "current":
      return "bg-gradient-to-r from-civic-gold to-border";
    case "failed":
      return "bg-gradient-to-r from-failed to-border";
    case "upcoming":
      return "bg-border";
  }
}

function StepIcon({
  status,
  index,
  size,
}: {
  status: JourneyStep["status"];
  index: number;
  size: "sm" | "md" | "lg";
}) {
  const iconClass =
    size === "lg" ? "h-5 w-5" : size === "md" ? "h-3.5 w-3.5" : "h-4 w-4";

  if (status === "completed") {
    return (
      <svg
        className={iconClass}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  if (status === "failed") {
    return (
      <svg
        className={iconClass}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    );
  }

  return <span>{index + 1}</span>;
}

export function BillJourney({
  steps,
  compact = false,
}: {
  steps: JourneyStep[];
  /** Smaller circles + tighter spacing. Used as the page-level spine where
   *  the journey is always visible, vs the original chunkier treatment in
   *  expanded card contexts. */
  compact?: boolean;
}) {
  const desktopCircle = compact ? "h-7 w-7" : "h-10 w-10";
  const desktopText = compact ? "text-[11px]" : "text-sm";
  const labelText = compact ? "text-xs" : "text-sm";
  const labelMargin = compact ? "mt-1.5" : "mt-2";
  const connectorOffset = compact ? "mt-3.5" : "mt-5";

  return (
    <div className="w-full">
      {/* Desktop: horizontal stepper */}
      <div className="hidden items-start sm:flex">
        {steps.map((step, i) => (
          <div
            key={`${step.label}-${i}`}
            className="flex flex-1 items-start last:flex-none"
          >
            {/* Step circle + label */}
            <div className="group relative flex flex-col items-center">
              <div
                className={`relative flex ${desktopCircle} shrink-0 items-center justify-center rounded-full ${desktopText} font-bold transition-all ${circleClass(step.status)} `}
              >
                <StepIcon
                  status={step.status}
                  index={i}
                  size={compact ? "md" : "lg"}
                />
              </div>
              <span
                className={`${labelMargin} max-w-[6rem] text-center ${labelText} leading-tight font-medium ${labelClass(step.status)}`}
              >
                {step.label}
              </span>
              {step.date && (
                <span className="text-muted-foreground mt-0.5 text-xs">
                  {formatJourneyDate(step.date, "short")}
                </span>
              )}
              {/* Tooltip for detail on desktop */}
              {step.detail && (
                <div className="bg-popover text-muted-foreground pointer-events-none absolute top-full left-1/2 z-10 mt-8 w-56 -translate-x-1/2 rounded-lg border p-2.5 text-xs leading-relaxed opacity-0 shadow-md transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                  {step.detail}
                </div>
              )}
            </div>

            {/* Connector line */}
            {i < steps.length - 1 && (
              <div
                className={`${connectorOffset} flex flex-1 items-center px-1`}
              >
                <div
                  className={`h-0.5 w-full rounded-full ${connectorClass(step.status)}`}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Mobile: vertical stepper */}
      <div className="space-y-0 sm:hidden">
        {steps.map((step, i) => (
          <div key={`${step.label}-${i}`} className="flex gap-3">
            {/* Vertical line + circle */}
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${circleClass(step.status)} `}
              >
                <StepIcon status={step.status} index={i} size="sm" />
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`min-h-4 w-0.5 flex-1 ${
                    step.status === "completed"
                      ? "bg-navy"
                      : step.status === "failed"
                        ? "bg-failed"
                        : "bg-border"
                  }`}
                />
              )}
            </div>

            {/* Label + date + detail */}
            <div className="min-w-0 pt-1 pb-4">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-sm font-medium ${labelClass(step.status)}`}
                >
                  {step.label}
                </span>
                {step.date && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {formatJourneyDate(step.date, "long")}
                  </span>
                )}
              </div>
              {(step.status === "current" || step.status === "failed") && (
                <p className="text-muted-foreground mt-0.5 text-sm">
                  {step.description}
                </p>
              )}
              {step.detail &&
                (step.detail.length <= LONG_DETAIL_THRESHOLD ? (
                  <p className="text-muted-foreground border-civic-gold/30 mt-1 border-l-2 pl-3 text-sm leading-relaxed">
                    {step.detail}
                  </p>
                ) : (
                  <details className="group mt-1.5">
                    <summary className="text-civic-gold/90 hover:text-civic-gold inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium [&::-webkit-details-marker]:hidden">
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
                    <div className="border-civic-gold/30 text-muted-foreground mt-1.5 border-l-2 pl-3 text-sm leading-relaxed">
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

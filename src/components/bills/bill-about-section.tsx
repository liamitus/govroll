"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { BillJourney } from "@/components/bills/bill-journey";
import type { JourneyStep } from "@/lib/bill-helpers";
import type { MomentumTier, DeathReason } from "@/types";

interface BillAboutProps {
  title: string;
  /** AI-generated 2–3 sentence plain-language description. Preferred over
   *  `shortText` as the lead summary — written at a grade 8–10 level and
   *  derived from the current bill text, not the introduced version. */
  aiShortDescription: string | null;
  /** AI-generated specific-provision bullets. Empty when no explainer has
   *  been generated yet; the lead falls back to `shortText` in that case. */
  aiKeyPoints: string[];
  /** Original CRS summary of the introduced bill. Moved into the "More
   *  detail" disclosure unless there's no AI explainer yet, in which case
   *  we fall back to it up top. */
  shortText: string | null;
  introducedDate: string;
  lastActionDate: string | null;
  link: string | null;
  /** Internal reader href. Null when we have no text version to link to. */
  readerHref: string | null;
  typeLabel: string;
  typeDescription: string;
  statusHeadline: string;
  statusDetail: string;
  statusStyle: string;
  chamberStyle: string;
  journeySteps: JourneyStep[];
  momentumTier: MomentumTier | null;
  daysSinceLastAction: number | null;
  deathReason: DeathReason | null;
}

function formatSilence(days: number): string {
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  const years = Math.floor(days / 365);
  const remMonths = Math.round((days - years * 365) / 30);
  return remMonths === 0
    ? `${years} year${years > 1 ? "s" : ""}`
    : `${years} year${years > 1 ? "s" : ""}, ${remMonths} month${remMonths > 1 ? "s" : ""}`;
}

interface MomentumBanner {
  title: string;
  body: string;
  tone: "dead" | "dormant" | "stalled" | "advancing" | "enacted";
}

function momentumBanner(
  tier: MomentumTier | null,
  days: number | null,
  reason: DeathReason | null,
): MomentumBanner | null {
  if (!tier) return null;
  const silence = days != null ? formatSilence(days) : null;

  switch (tier) {
    case "DEAD": {
      if (reason === "CONGRESS_ENDED")
        return {
          title: "This bill died when its Congress ended.",
          body: "Bills don't carry over between Congresses. Without re-introduction in a new session, it cannot advance.",
          tone: "dead",
        };
      if (reason === "FAILED_VOTE")
        return {
          title: "This bill failed on a recorded vote.",
          body: "A chamber voted it down. It cannot advance in this form.",
          tone: "dead",
        };
      if (reason === "VETOED")
        return {
          title: "This bill was vetoed and not overridden.",
          body: "The President vetoed this bill and Congress did not override. It cannot become law.",
          tone: "dead",
        };
      return {
        title: "This bill appears to be dead.",
        body: silence
          ? `No action has been recorded in ${silence}. The structural status shown below reflects an earlier milestone, not current activity.`
          : "No recent activity has been recorded. The structural status shown below reflects an earlier milestone.",
        tone: "dead",
      };
    }
    case "DORMANT":
      return {
        title: "This bill has gone quiet.",
        body: silence
          ? `No action in ${silence}. It hasn't officially died, but bills this inactive rarely revive.`
          : "No recent activity. Bills this inactive rarely revive.",
        tone: "dormant",
      };
    case "STALLED":
      return {
        title: "This bill is stalled.",
        body: silence
          ? `No action in ${silence}. It may still move, but has lost momentum.`
          : "No recent activity. It may still move, but has lost momentum.",
        tone: "stalled",
      };
    case "ADVANCING":
      return {
        title: "This bill is moving.",
        body: "It has cleared at least one chamber and is structurally advancing through Congress.",
        tone: "advancing",
      };
    case "ENACTED":
      return {
        title: "This bill became law.",
        body: "It has been enacted. The journey below shows how it got there.",
        tone: "enacted",
      };
    case "ACTIVE":
    default:
      return null;
  }
}

const BANNER_STYLES: Record<MomentumBanner["tone"], string> = {
  dead: "border-border/60 bg-muted/60 text-foreground/75",
  dormant: "border-border/60 bg-muted/40 text-foreground/80",
  stalled:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
  advancing:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200",
  enacted:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200",
};

export function BillAboutSection({
  title,
  aiShortDescription,
  aiKeyPoints,
  shortText,
  introducedDate,
  lastActionDate,
  link,
  readerHref,
  typeLabel,
  typeDescription,
  statusHeadline,
  statusDetail,
  statusStyle,
  chamberStyle,
  journeySteps,
  momentumTier,
  daysSinceLastAction,
  deathReason,
}: BillAboutProps) {
  const [open, setOpen] = useState(false);
  const [crsExpanded, setCrsExpanded] = useState(false);
  const banner = momentumBanner(momentumTier, daysSinceLastAction, deathReason);
  const isInactive =
    momentumTier === "DEAD" ||
    momentumTier === "DORMANT" ||
    momentumTier === "STALLED";

  // Prefer the AI explainer as the lead. When it's missing (pre-backfill or
  // text unavailable) we fall back to the CRS summary so the page still
  // says something, but we skip the legalese label and the amendment
  // warning — the warning was a symptom of leading with CRS in the first
  // place, not a signal we want to preserve.
  const hasExplainer = Boolean(
    aiShortDescription && aiShortDescription.trim().length > 0,
  );
  const fallbackShortText = !hasExplainer ? shortText : null;

  return (
    <header className="space-y-3">
      {/* Badges — status first (more important signal). When the bill is
          inactive we desaturate the structural status chip so the rosy
          "Passed" green doesn't contradict the dead/dormant banner below. */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={`${
            isInactive ? "bg-muted text-foreground/60 border-0" : statusStyle
          } px-2.5 py-0.5 text-xs font-semibold`}
        >
          {statusHeadline}
        </Badge>
        <Badge variant="outline" className={`${chamberStyle} text-xs`}>
          {typeLabel}
        </Badge>
        {momentumTier === "DEAD" && (
          <Badge className="bg-foreground/80 text-background border-0 text-xs">
            Dead
          </Badge>
        )}
        {momentumTier === "DORMANT" && (
          <Badge className="bg-muted-foreground/80 text-background border-0 text-xs">
            Dormant
          </Badge>
        )}
        {momentumTier === "STALLED" && (
          <Badge className="border-0 bg-amber-500/80 text-xs text-white">
            Stalled
          </Badge>
        )}
      </div>

      {/* Title */}
      <h1
        className={`text-2xl leading-tight font-bold ${isInactive ? "text-foreground/75" : ""}`}
      >
        {title}
      </h1>

      {/* Momentum banner — the highest-priority signal on this page when a
          bill is inactive. Tells the user what to actually believe about
          this bill's chances, regardless of structural status. */}
      {banner &&
        (banner.tone === "dead" ||
          banner.tone === "dormant" ||
          banner.tone === "stalled") && (
          <div
            className={`rounded-lg border px-4 py-3 ${BANNER_STYLES[banner.tone]}`}
          >
            <p className="text-base leading-tight font-semibold">
              {banner.title}
            </p>
            <p className="mt-1 text-sm leading-relaxed opacity-90">
              {banner.body}
            </p>
          </div>
        )}

      {/* Lead: plain-language description + key points. Shown above the
          fold so every persona — casual voter, activist, researcher — has
          the gist without digging. */}
      {hasExplainer ? (
        <div className="space-y-3">
          <p className="text-foreground text-base leading-relaxed">
            {aiShortDescription}
          </p>
          {aiKeyPoints.length > 0 && (
            <ul className="space-y-1.5">
              {aiKeyPoints.map((point, i) => (
                <li
                  key={i}
                  className="text-foreground/90 flex gap-2 text-sm leading-relaxed"
                >
                  <span
                    className="text-civic-gold mt-[0.55em] h-1 w-1 flex-none rounded-full bg-current"
                    aria-hidden
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : fallbackShortText ? (
        // No AI explainer yet — show the CRS summary without the old
        // "SUMMARY · CRS" legalese label or the amendment warning. Trimmed
        // to ~4 lines, click to expand inline.
        <div>
          <p
            className={`text-foreground/90 text-base leading-relaxed ${crsExpanded ? "" : "line-clamp-4"}`}
          >
            {fallbackShortText}
          </p>
          {fallbackShortText.length > 320 && (
            <button
              onClick={() => setCrsExpanded((v) => !v)}
              className="text-navy/70 hover:text-navy mt-1.5 cursor-pointer text-xs font-medium transition-colors"
            >
              {crsExpanded ? "Show less" : "Show full summary"}
            </button>
          )}
        </div>
      ) : null}

      {/* Primary actions row — one clear CTA for the full text, plus the
          external authoritative link. */}
      {(readerHref || link) && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {readerHref && (
            <a
              href={readerHref}
              className="border-civic-gold/50 bg-civic-cream/50 text-foreground hover:bg-civic-cream focus-visible:ring-civic-gold/40 dark:bg-card dark:hover:bg-accent/30 inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2"
            >
              <svg
                className="text-civic-gold h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
              Read full text
              <svg
                className="h-3.5 w-3.5 opacity-60"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                />
              </svg>
            </a>
          )}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
            >
              GovTrack
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          )}
        </div>
      )}

      {/* Meta row — dates only, with GovTrack pulled up into the action row
          above. Kept small and tertiary. */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>Introduced {introducedDate}</span>
        {lastActionDate && <span>Last action {lastActionDate}</span>}
      </div>

      {/* Learn more toggle — only shown when collapsed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="text-primary inline-flex cursor-pointer items-center gap-1 text-sm font-medium hover:underline"
        >
          More detail
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      )}

      {/* Expanded content */}
      {open && (
        <div className="bg-card animate-fade-slide-up space-y-5 rounded-xl border p-5">
          {/* Journey stepper */}
          <div>
            <p className="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
              Legislative Journey
            </p>
            <BillJourney steps={journeySteps} />
          </div>

          {/* Status explainer */}
          <div className="border-l-civic-gold bg-civic-cream/50 dark:bg-accent/30 space-y-1.5 rounded-lg border-l-4 px-4 py-3">
            <p className="text-base font-medium">{statusHeadline}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {statusDetail}
            </p>
          </div>

          {/* CRS summary — lives here now, available to readers who want
              the full nonpartisan government wording. Kept clearly
              labeled so its provenance is transparent. */}
          {hasExplainer && shortText && (
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                Summary · Congressional Research Service (nonpartisan)
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {shortText}
              </p>
            </div>
          )}

          {/* Bill type */}
          <div className="text-muted-foreground text-sm leading-relaxed">
            <span className="text-foreground font-medium">
              What is a {typeLabel.toLowerCase()}?
            </span>{" "}
            {typeDescription}
          </div>

          {/* Hide details — at the bottom of expanded content */}
          <button
            onClick={() => setOpen(false)}
            className="text-primary inline-flex cursor-pointer items-center gap-1 text-sm font-medium hover:underline"
          >
            Hide details
            <svg
              className="h-3 w-3 rotate-180"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>
      )}
    </header>
  );
}

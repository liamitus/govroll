"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AiSummaryFeedback } from "@/components/bills/ai-summary-feedback";
import { pickBillHeadline } from "@/lib/bill-headline";
import { formatBillNumber } from "@/lib/bill-grouping";
import { formatOrdinal } from "@/lib/parse-bill-citation";
import { BillStatusBanner } from "./bill-status-banner";
import type { MomentumTier, DeathReason } from "@/types";

interface BillHeroProps {
  billDbId: number;
  title: string;
  popularTitle: string | null;
  shortTitle: string | null;
  displayTitle: string | null;
  /** AI-generated 2–3 sentence plain-language description. */
  aiShortDescription: string | null;
  /** AI-generated specific-provision bullets. */
  aiKeyPoints: string[];
  /** CRS summary — used as the lead when the AI explainer is missing. */
  shortText: string | null;
  billType: string;
  billId: string;
  congressNumber: number | null;
  link: string | null;
  readerHref: string | null;
  introducedDate: string;
  lastActionDate: string | null;
  typeLabel: string;
  statusHeadline: string;
  statusStyle: string;
  momentumTier: MomentumTier | null;
  daysSinceLastAction: number | null;
  deathReason: DeathReason | null;
}

export function BillHero(props: BillHeroProps) {
  const [crsExpanded, setCrsExpanded] = useState(false);

  const isInactive =
    props.momentumTier === "DEAD" ||
    props.momentumTier === "DORMANT" ||
    props.momentumTier === "STALLED";

  const { headline, officialTitle } = pickBillHeadline({
    title: props.title,
    popularTitle: props.popularTitle,
    shortTitle: props.shortTitle,
    displayTitle: props.displayTitle,
    shortText: props.shortText,
    aiShortDescription: props.aiShortDescription,
  });

  const billNumber = formatBillNumber(props.billType, props.billId);
  const congressLabel = props.congressNumber
    ? `${formatOrdinal(props.congressNumber)} Congress`
    : null;

  const hasExplainer = Boolean(
    props.aiShortDescription && props.aiShortDescription.trim().length > 0,
  );
  // Show the CRS summary as fallback only when no AI explainer exists, so
  // we don't double up on plain-language summaries.
  const fallbackShortText = !hasExplainer ? props.shortText : null;
  const fallbackIsLong = (fallbackShortText?.length ?? 0) > 320;

  return (
    <header className="space-y-3">
      {/* Citation row — bill number + Congress + chamber. Replaces the
          procedural long title as the page's primary identifier so the
          headline can be a real headline instead of "To amend the FISA…". */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
        <span className="text-foreground/80">{billNumber}</span>
        {congressLabel && (
          <>
            <span aria-hidden className="opacity-50">
              ·
            </span>
            <span>{congressLabel}</span>
          </>
        )}
        <span aria-hidden className="opacity-50">
          ·
        </span>
        <span>{props.typeLabel}</span>
      </div>

      {/* Headline — smart fallback chain (popular → short → display →
          summary-extract → title). */}
      <h1
        className={`text-xl leading-snug font-bold text-balance sm:text-2xl ${
          isInactive ? "text-foreground/75" : ""
        }`}
      >
        {headline}
      </h1>

      {/* Demoted official title — only shown when the smart headline came
          from somewhere other than the official title. Keeps the bill
          citable / SEO-searchable without making the long procedural
          title the visual hero. */}
      {officialTitle && (
        <p className="text-muted-foreground text-xs leading-snug italic">
          Official title: {officialTitle}
        </p>
      )}

      {/* Status badges */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={`${
            isInactive
              ? "bg-muted text-foreground/60 border-0"
              : props.statusStyle
          } px-2.5 py-0.5 text-xs font-semibold`}
        >
          {props.statusHeadline}
        </Badge>
        {props.momentumTier === "DEAD" && (
          <Badge className="bg-foreground/80 text-background border-0 text-xs">
            Dead
          </Badge>
        )}
        {props.momentumTier === "DORMANT" && (
          <Badge className="bg-muted-foreground/80 text-background border-0 text-xs">
            Dormant
          </Badge>
        )}
        {props.momentumTier === "STALLED" && (
          <Badge className="border-0 bg-amber-500/80 text-xs text-white">
            Stalled
          </Badge>
        )}
      </div>

      <BillStatusBanner
        tier={props.momentumTier}
        days={props.daysSinceLastAction}
        reason={props.deathReason}
      />

      {/* Lead — AI explainer (paragraph + key points) if we have one,
          otherwise fall back to the CRS summary. Both are plain-language
          so we don't dump the legalese label on the user's first read. */}
      {hasExplainer ? (
        <div className="space-y-3">
          <p className="text-foreground text-base leading-relaxed">
            {props.aiShortDescription}
          </p>
          {props.aiKeyPoints.length > 0 && (
            <ul className="space-y-1.5">
              {props.aiKeyPoints.map((point, i) => (
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
          <AiSummaryFeedback billId={props.billDbId} surface="explainer" />
        </div>
      ) : fallbackShortText ? (
        <div>
          <p
            className={`text-foreground/90 text-base leading-relaxed ${crsExpanded ? "" : "line-clamp-4"}`}
          >
            {fallbackShortText}
          </p>
          {fallbackIsLong && (
            <button
              onClick={() => setCrsExpanded((v) => !v)}
              className="text-navy/70 hover:text-navy mt-1.5 cursor-pointer text-xs font-medium transition-colors"
            >
              {crsExpanded ? "Show less" : "Show full summary"}
            </button>
          )}
        </div>
      ) : null}

      {/* Primary actions row — read full text + GovTrack */}
      {(props.readerHref || props.link) && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {props.readerHref && (
            <a
              href={props.readerHref}
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
          {props.link && (
            <a
              href={props.link}
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

      {/* Meta row — dates only. */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>Introduced {props.introducedDate}</span>
        {props.lastActionDate && (
          <span>Last action {props.lastActionDate}</span>
        )}
      </div>
    </header>
  );
}

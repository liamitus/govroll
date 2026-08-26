"use client";

import Link, { useLinkStatus } from "next/link";
import { useState } from "react";
import type { BillSummary, VoteType } from "@/types";
import { getTopicForPolicyArea } from "@/lib/topic-mapping";
import { formatBillNumber } from "@/lib/bill-grouping";
import { billHref } from "@/lib/bills/url";
import { pickBillHeadline } from "@/lib/bill-headline";
import { formatJourneyDate } from "@/lib/bill-helpers";
import { MiniRoute, voteChipStyle } from "./bill-card";

// Swaps the chevron for a spinner while this specific sub-row's Link is
// resolving the next route. Only renders when *this* Link is pending —
// Next 15.3+ scopes useLinkStatus() to the nearest ancestor Link.
function SubRowNavIndicator() {
  const { pending } = useLinkStatus();
  if (pending) {
    return (
      <span
        aria-busy="true"
        aria-label="Loading"
        className="border-ink/20 border-t-ink/70 h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2"
      />
    );
  }
  return (
    <svg
      className="text-ink-muted/70 group-hover:text-ink h-3.5 w-3.5 shrink-0 transition-colors"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function statusLabel(status: string): string {
  if (status.startsWith("enacted_")) return "Enacted";
  if (
    status === "passed_bill" ||
    status.startsWith("conference_") ||
    status === "passed_simpleres" ||
    status === "passed_concurrentres"
  )
    return "Passed";
  if (status.startsWith("pass_over_") || status.startsWith("pass_back_"))
    return "In Progress";
  if (status.startsWith("prov_kill_") && status !== "prov_kill_veto")
    return "Stalled";
  if (
    status.startsWith("fail_") ||
    status.startsWith("vetoed_") ||
    status === "prov_kill_veto"
  )
    return "Failed";
  if (status === "reported") return "In Committee";
  return "Introduced";
}

export function BillGroupCard({
  bills,
  userVotes,
}: {
  bills: BillSummary[];
  userVotes: Map<number, VoteType>;
}) {
  const [expanded, setExpanded] = useState(false);
  const lead = bills[0];
  const topic = getTopicForPolicyArea(lead.policyArea);
  const stage = statusLabel(lead.currentStatus);
  const displayDate = lead.latestActionDate || lead.introducedDate;
  const votedCount = bills.filter((b) => userVotes.has(b.id)).length;
  const allVoted = votedCount === bills.length;
  // If every bill in the group was voted the same way, we can use the
  // direction-tinted chip. Mixed directions fall back to a neutral "Voted"
  // chip so we don't lie about which way the user voted.
  const unanimousDirection: VoteType | null = allVoted
    ? (() => {
        const first = userVotes.get(bills[0].id);
        if (!first) return null;
        return bills.every((b) => userVotes.get(b.id) === first) ? first : null;
      })()
    : null;
  const leadChip = unanimousDirection
    ? voteChipStyle(unanimousDirection)
    : null;
  const headline = pickBillHeadline(lead);

  const metaParts = [
    formatBillNumber(lead.billType, lead.billId),
    topic?.label ?? null,
    lead.sponsor,
    displayDate
      ? `last action ${formatJourneyDate(displayDate, "short")}`
      : null,
  ].filter((p): p is string => Boolean(p));

  return (
    <div className="border-rule bg-paper hover:border-ink/40 relative border transition-colors">
      {/* Topic line — the line palette's only home: a 5px bar in the
          left margin. Topics beyond the eleven hues get no bar. */}
      {topic?.line && (
        <div
          className={`absolute top-0 bottom-0 left-0 w-[5px] ${topic.line}`}
        />
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="focus-visible:ring-gold w-full px-5 py-4 text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <div className="pl-3">
          <div className="flex items-start justify-between gap-3">
            <h3
              className={`line-clamp-2 flex-1 font-sans text-base leading-snug font-semibold tracking-normal ${
                allVoted ? "text-ink/50" : "text-ink"
              }`}
            >
              {headline.headline}
            </h3>
            {allVoted && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 text-[10.5px] font-bold tracking-[0.08em] uppercase ${
                  leadChip?.className ?? "border-rule text-ink-muted"
                }`}
              >
                <svg
                  className="h-2.5 w-2.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {leadChip?.label ?? "Voted"}
              </span>
            )}
            <svg
              className={`text-ink-muted/70 mt-0.5 h-4 w-4 shrink-0 transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          {headline.officialTitle && (
            <p
              className="text-ink-muted/80 mt-1 line-clamp-1 text-xs italic"
              title={headline.officialTitle}
            >
              Official title: {headline.officialTitle}
            </p>
          )}

          <div className="text-ink-muted mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] tabular-nums">
            <span className="min-w-0">{metaParts.join(" · ")}</span>
            <span className="border-rule inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10.5px] font-bold tracking-[0.08em] uppercase">
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              {`${bills.length} related`}
              {!allVoted && votedCount > 0 && (
                <span className="text-ink-muted/80 normal-case">
                  {` · ${votedCount}/${bills.length} voted`}
                </span>
              )}
            </span>
            {/* Stage label over the row-scale route, far right — the same
                grammar as single rows. */}
            <span className="ml-auto flex flex-col items-end gap-1">
              <span className="text-ink-muted text-[10px] font-semibold tracking-[0.14em] uppercase">
                {stage}
              </span>
              <MiniRoute
                billType={lead.billType}
                currentStatus={lead.currentStatus}
              />
            </span>
          </div>
        </div>
      </button>

      {expanded &&
        (() => {
          // When all sub-rows would show the same boilerplate summary (or all
          // null), repeating it in every row adds noise without information.
          // This is the common case for legally-identical-template resolutions
          // like arms-sale disapprovals, where the CRS summary is identical
          // across siblings. Hide the secondary line in that case.
          const summaries = bills.map(
            (b) => b.shortText ?? b.latestActionText ?? null,
          );
          const firstSummary = summaries[0];
          const allSame = summaries.every((s) => s === firstSummary);
          const showPerRowSummary = !allSame;
          return (
            <div className="border-rule bg-sand/60 animate-fade-slide-up border-t pt-2 pr-3 pb-1.5 pl-6">
              <p className="text-ink-muted px-2 pb-1.5 text-xs leading-relaxed">
                Related bills filed together — tap any to see details.
              </p>
              <ul className="divide-rule/60 divide-y">
                {bills.map((b) => {
                  const subVote = userVotes.get(b.id) ?? null;
                  const subChip = subVote ? voteChipStyle(subVote) : null;
                  const detail = b.shortText || b.latestActionText;
                  return (
                    <li key={b.id}>
                      <Link
                        href={billHref(b)}
                        className="group hover:bg-paper flex items-center gap-3 px-2 py-2.5 transition-colors"
                      >
                        <span
                          className={`w-24 shrink-0 text-xs font-semibold tabular-nums ${
                            subVote ? "text-ink/50" : "text-ink"
                          }`}
                        >
                          {formatBillNumber(b.billType, b.billId)}
                        </span>
                        {showPerRowSummary && (
                          <span className="text-ink-muted line-clamp-1 flex-1 text-xs">
                            {detail ?? "No summary available yet."}
                          </span>
                        )}
                        {!showPerRowSummary && <span className="flex-1" />}
                        {subChip && (
                          <span
                            className={`inline-flex shrink-0 items-center border px-1.5 py-0.5 text-[10px] font-bold tracking-[0.08em] uppercase ${subChip.className}`}
                          >
                            {subChip.label}
                          </span>
                        )}
                        <SubRowNavIndicator />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()}
    </div>
  );
}

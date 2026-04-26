"use client";

import Link, { useLinkStatus } from "next/link";
import { useState } from "react";
import dayjs from "dayjs";
import type { BillSummary, VoteType } from "@/types";
import { getTopicForPolicyArea } from "@/lib/topic-mapping";
import { formatBillNumber } from "@/lib/bill-grouping";
import { billHref } from "@/lib/bills/url";
import { pickBillHeadline } from "@/lib/bill-headline";
import { voteChipStyle } from "./bill-card";

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
        className="border-navy/20 border-t-navy/70 h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2"
      />
    );
  }
  return (
    <svg
      className="text-muted-foreground/60 group-hover:text-navy h-3.5 w-3.5 shrink-0 transition-colors"
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

function statusStyle(status: string): { label: string; className: string } {
  if (status.startsWith("enacted_"))
    return { label: "Enacted", className: "bg-enacted-soft text-enacted" };
  if (
    status === "passed_bill" ||
    status.startsWith("conference_") ||
    status === "passed_simpleres" ||
    status === "passed_concurrentres"
  )
    return { label: "Passed", className: "bg-passed-soft text-passed" };
  if (status.startsWith("pass_over_") || status.startsWith("pass_back_"))
    return { label: "In Progress", className: "bg-passed-soft text-passed" };
  if (status.startsWith("prov_kill_") && status !== "prov_kill_veto")
    return { label: "Stalled", className: "bg-muted text-foreground/60" };
  if (
    status.startsWith("fail_") ||
    status.startsWith("vetoed_") ||
    status === "prov_kill_veto"
  )
    return { label: "Failed", className: "bg-failed-soft text-failed" };
  if (status === "reported")
    return { label: "In Committee", className: "bg-muted text-foreground/70" };
  return { label: "Introduced", className: "bg-muted text-foreground/70" };
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
  const chamberIsHouse = lead.billType.startsWith("house");
  const status = statusStyle(lead.currentStatus);
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

  return (
    <div className="border-border/50 hover:border-navy/25 relative rounded-lg border bg-white transition-all hover:shadow-[0_2px_12px_rgba(10,31,68,0.1)]">
      <div
        className={`absolute top-0 bottom-0 left-0 w-1 rounded-l-lg ${
          chamberIsHouse ? "bg-house/70" : "bg-senate/70"
        }`}
      />

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="focus-visible:ring-navy/40 w-full rounded-lg px-5 py-4 text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <div className="pl-3">
          <div className="flex items-start justify-between gap-3">
            <h3
              className={`line-clamp-2 flex-1 text-base leading-snug font-semibold ${
                allVoted ? "text-navy/55" : "text-navy"
              }`}
            >
              {headline.headline}
            </h3>
            {allVoted && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-semibold tracking-wider uppercase ${
                  leadChip?.className ?? "bg-navy/8 text-navy/80 border-navy/10"
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
              className={`text-muted-foreground/60 mt-0.5 h-4 w-4 shrink-0 transition-transform ${
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
              className="text-muted-foreground/70 mt-1 line-clamp-1 text-xs italic"
              title={headline.officialTitle}
            >
              Official title: {headline.officialTitle}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span
              className={`text-xs font-bold tracking-wider uppercase ${
                chamberIsHouse ? "text-house" : "text-senate"
              }`}
            >
              {chamberIsHouse ? "House" : "Senate"}
            </span>
            <span className="text-foreground/70 font-mono text-xs font-medium">
              {formatBillNumber(lead.billType, lead.billId)}
            </span>
            {topic && (
              <span
                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${topic.color}`}
              >
                {topic.label}
              </span>
            )}
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${status.className}`}
            >
              {status.label}
            </span>
            <span className="bg-navy/8 text-navy/80 border-navy/10 inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium">
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
              {bills.length} related
              {!allVoted && votedCount > 0 && (
                <span className="text-muted-foreground/80">
                  · {votedCount}/{bills.length} voted
                </span>
              )}
            </span>
            {lead.sponsor && (
              <span className="text-muted-foreground text-xs">
                {lead.sponsor}
              </span>
            )}
            <span className="text-muted-foreground text-xs">
              {dayjs(displayDate).format("MMM D, YYYY")}
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
            <div className="border-border/40 bg-muted/20 animate-fade-slide-up rounded-b-lg border-t pt-2 pr-3 pb-1.5 pl-6">
              <p className="text-muted-foreground/80 px-2 pb-1.5 text-xs leading-relaxed">
                Related bills filed together — tap any to see details.
              </p>
              <ul className="divide-border/30 divide-y">
                {bills.map((b) => {
                  const subVote = userVotes.get(b.id) ?? null;
                  const subChip = subVote ? voteChipStyle(subVote) : null;
                  const detail = b.shortText || b.latestActionText;
                  return (
                    <li key={b.id}>
                      <Link
                        href={billHref(b)}
                        className="group flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-white"
                      >
                        <span
                          className={`w-24 shrink-0 font-mono text-xs font-semibold ${
                            subVote ? "text-navy/55" : "text-navy"
                          }`}
                        >
                          {formatBillNumber(b.billType, b.billId)}
                        </span>
                        {showPerRowSummary && (
                          <span className="text-muted-foreground line-clamp-1 flex-1 text-xs">
                            {detail ?? "No summary available yet."}
                          </span>
                        )}
                        {!showPerRowSummary && <span className="flex-1" />}
                        {subChip && (
                          <span
                            className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${subChip.className}`}
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

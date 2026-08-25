"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { RepVoteRecord } from "@/types";
import { billHref } from "@/lib/bills/url";
import { ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import {
  isYesVote,
  isNoVote,
  normalizeRepVote,
  voteCategoryLabel,
  isPassageCategory,
} from "@/lib/votes";
import { groupVotesByBill, type BillVoteGroup } from "@/lib/vote-grouping";

interface VoteComparisonFeedProps {
  votingRecord: RepVoteRecord[];
  userVotes: Record<number, string> | null;
}

type Filter = "all" | "matches" | "mismatches";

/**
 * Vote chips carry the word — maya and flame differ only in hue, so the
 * fill alone is never the message. Ink text on both fills; a non-position
 * (Present / Not Voting / no record) is a dashed hollow frame, not a fill.
 */
const CHIP_BASE =
  "inline-flex flex-shrink-0 items-center justify-center px-2 py-1 text-[10.5px] font-bold uppercase tracking-[0.08em]";
const CHIP_DASHED = `${CHIP_BASE} border-[1.5px] border-dashed border-hollow text-ink-muted`;

function repVoteChipClass(vote: string): string {
  if (isYesVote(vote)) return `${CHIP_BASE} bg-maya text-ink`;
  if (isNoVote(vote)) return `${CHIP_BASE} bg-flame text-ink`;
  return CHIP_DASHED;
}

function repVoteWord(vote: string): string {
  const normalized = normalizeRepVote(vote);
  return normalized === "Unknown" ? "No record" : normalized;
}

function userVoteChipClass(vote: string): string {
  switch (vote) {
    case "For":
      return `${CHIP_BASE} bg-maya text-ink`;
    case "Against":
      return `${CHIP_BASE} bg-flame text-ink`;
    default:
      return CHIP_DASHED;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function rowDateIso(group: BillVoteGroup): string {
  return group.primary.votedAt ?? group.primary.date;
}

function VoteHistoryRow({ vote }: { vote: RepVoteRecord }) {
  const dateIso = vote.votedAt ?? vote.date;
  return (
    <li className="border-rule flex items-center justify-between gap-3 border-t py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="text-ink truncate font-medium">
          {voteCategoryLabel(vote.category)}
        </p>
        <p className="text-ink-muted text-xs tabular-nums">
          {formatDate(dateIso)}
        </p>
      </div>
      <span className={repVoteChipClass(vote.repVote)}>
        {repVoteWord(vote.repVote)}
      </span>
    </li>
  );
}

function BillRow({ group }: { group: BillVoteGroup }) {
  const [expanded, setExpanded] = useState(false);
  const { primary, votes, alignment, hasMixedStances, userVote } = group;
  const hasMore = votes.length > 1;

  const primaryIsPassage = isPassageCategory(primary.category);

  return (
    <div className="border-rule bg-paper border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <Link
            href={billHref({ billId: group.billSlug, title: group.title })}
            className="text-ink line-clamp-2 text-base leading-snug font-semibold hover:underline"
          >
            {group.title}
          </Link>
          <div className="text-ink-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="tabular-nums">
              {formatDate(rowDateIso(group))}
            </span>
            {!primaryIsPassage && (
              <>
                <span aria-hidden>·</span>
                <span className="italic">
                  {voteCategoryLabel(primary.category).toLowerCase()} vote
                </span>
              </>
            )}
            {hasMixedStances && (
              <>
                <span aria-hidden>·</span>
                <span title="Voted on opposite sides across stages of this bill (e.g. yes on cloture, no on passage)">
                  voted both ways across stages
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-3">
          <div className="text-center">
            <p className="text-ink-muted mb-1 text-[10px] font-semibold tracking-[0.1em] uppercase">
              Rep
            </p>
            <span className={repVoteChipClass(primary.repVote)}>
              {repVoteWord(primary.repVote)}
            </span>
          </div>

          <div className="text-center">
            <p className="text-ink-muted mb-1 text-[10px] font-semibold tracking-[0.1em] uppercase">
              You
            </p>
            {userVote ? (
              <span className={userVoteChipClass(userVote)}>{userVote}</span>
            ) : (
              <span className="text-ink-muted text-xs">—</span>
            )}
          </div>

          {/* Agreement is stated in words, in ink — never a green check
              or red cross. */}
          <div className="text-ink w-16 text-center text-[11px] leading-tight font-semibold">
            {alignment === "match" && "Same position"}
            {alignment === "mismatch" && "Different position"}
          </div>
        </div>
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-ink-muted hover:text-ink mt-3 inline-flex items-center gap-1 text-xs transition-colors"
          aria-expanded={expanded}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          {expanded
            ? "Hide vote history"
            : `${votes.length} votes on this bill`}
        </button>
      )}

      {expanded && hasMore && (
        <ul className="mt-2 ml-1">
          {votes.map((v) => (
            <VoteHistoryRow
              key={`${v.billId}-${v.rollCallNumber ?? v.votedAt ?? v.date}`}
              vote={v}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function VoteComparisonFeed({
  votingRecord,
  userVotes,
}: VoteComparisonFeedProps) {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(
    () => groupVotesByBill(votingRecord, userVotes),
    [votingRecord, userVotes],
  );

  const matchCount = groups.filter((g) => g.alignment === "match").length;
  const mismatchCount = groups.filter((g) => g.alignment === "mismatch").length;

  const filtered = groups.filter((g) => {
    if (filter === "all") return true;
    if (filter === "matches") return g.alignment === "match";
    if (filter === "mismatches") return g.alignment === "mismatch";
    return true;
  });

  const displayItems = showAll ? filtered : filtered.slice(0, 5);
  const hasMore = filtered.length > 5;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-ink-muted text-[11px] font-bold tracking-[0.18em] uppercase">
          Full Voting Record
        </h2>
        {userVotes && groups.length > 0 && (
          <div className="flex gap-1">
            {(
              [
                ["all", `All (${groups.length})`],
                ["matches", `Matches (${matchCount})`],
                ["mismatches", `Mismatches (${mismatchCount})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`border px-3 py-1 text-xs tabular-nums transition-colors ${
                  filter === key
                    ? "border-ink bg-ink text-paper"
                    : "border-rule bg-paper text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-ink-muted py-4 text-center text-base">
          No votes to display.
        </p>
      ) : (
        <div className="space-y-2">
          {displayItems.map((g) => (
            <BillRow key={g.billId} group={g} />
          ))}
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-ink-muted hover:text-ink mx-auto flex items-center gap-1.5 py-2 text-sm transition-colors"
        >
          {showAll ? (
            <>
              Show less <ChevronUp className="h-4 w-4" />
            </>
          ) : (
            <>
              {`Show all ${filtered.length} bills `}
              <ChevronDown className="h-4 w-4" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

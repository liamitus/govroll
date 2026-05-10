"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { RepVoteRecord } from "@/types";
import { billHref } from "@/lib/bills/url";
import { ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import {
  isYesVote,
  isNoVote,
  voteCategoryLabel,
  isPassageCategory,
} from "@/lib/votes";
import { groupVotesByBill, type BillVoteGroup } from "@/lib/vote-grouping";

interface VoteComparisonFeedProps {
  votingRecord: RepVoteRecord[];
  userVotes: Record<number, string> | null;
}

type Filter = "all" | "matches" | "mismatches";

function repVoteBadgeClass(vote: string): string {
  if (isYesVote(vote)) return "bg-vote-yea text-white";
  if (isNoVote(vote)) return "bg-vote-nay text-white";
  if (vote === "Present") return "bg-vote-present text-white";
  return "bg-gray-300 text-gray-700";
}

function userVoteBadgeClass(vote: string): string {
  switch (vote) {
    case "For":
      return "bg-vote-yea text-white";
    case "Against":
      return "bg-vote-nay text-white";
    default:
      return "bg-gray-300 text-gray-700";
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
    <li className="border-border/40 flex items-center justify-between gap-3 border-t py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="text-navy/80 truncate font-medium">
          {voteCategoryLabel(vote.category)}
        </p>
        <p className="text-muted-foreground text-xs">{formatDate(dateIso)}</p>
      </div>
      <Badge className={`${repVoteBadgeClass(vote.repVote)} flex-shrink-0`}>
        {vote.repVote}
      </Badge>
    </li>
  );
}

function BillRow({ group }: { group: BillVoteGroup }) {
  const [expanded, setExpanded] = useState(false);
  const { primary, votes, alignment, hasMixedStances, userVote } = group;
  const hasMore = votes.length > 1;

  const rowBg =
    alignment === "match"
      ? "bg-vote-yea/5 border-vote-yea/20"
      : alignment === "mismatch"
        ? "bg-vote-nay/5 border-vote-nay/20"
        : "bg-white border-border/60";

  const primaryIsPassage = isPassageCategory(primary.category);

  return (
    <div className={`rounded-lg border p-4 ${rowBg} transition-colors`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <Link
            href={billHref({ billId: group.billSlug, title: group.title })}
            className="text-navy line-clamp-2 text-base leading-snug font-semibold hover:underline"
          >
            {group.title}
          </Link>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span>{formatDate(rowDateIso(group))}</span>
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
                <span
                  className="text-vote-present"
                  title="Voted on opposite sides across stages of this bill (e.g. yes on cloture, no on passage)"
                >
                  voted both ways across stages
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-3">
          <div className="text-center">
            <p className="text-muted-foreground mb-1 text-xs tracking-wider uppercase">
              Rep
            </p>
            <Badge className={repVoteBadgeClass(primary.repVote)}>
              {primary.repVote}
            </Badge>
          </div>

          <div className="text-center">
            <p className="text-muted-foreground mb-1 text-xs tracking-wider uppercase">
              You
            </p>
            {userVote ? (
              <Badge className={userVoteBadgeClass(userVote)}>{userVote}</Badge>
            ) : (
              <span className="text-muted-foreground text-xs">—</span>
            )}
          </div>

          <div className="w-6 text-center">
            {alignment === "match" && (
              <span className="text-vote-yea text-lg" aria-label="Aligned">
                &#10003;
              </span>
            )}
            {alignment === "mismatch" && (
              <span className="text-vote-nay text-lg" aria-label="Not aligned">
                &#10007;
              </span>
            )}
          </div>
        </div>
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-navy/70 hover:text-navy mt-3 inline-flex items-center gap-1 text-xs transition-colors"
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
        <h2 className="text-navy/70 text-sm font-semibold tracking-[0.15em] uppercase">
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
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  filter === key
                    ? "bg-navy text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-base">
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
          className="text-navy/70 hover:text-navy mx-auto flex items-center gap-1.5 py-2 text-sm transition-colors"
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

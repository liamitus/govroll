"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { RepVoteRecord } from "@/types";
import { billHref } from "@/lib/bills/url";
import { ChevronDown, ChevronUp } from "lucide-react";

interface VoteComparisonFeedProps {
  votingRecord: RepVoteRecord[];
  userVotes: Record<number, string> | null;
}

type Filter = "all" | "matches" | "mismatches";

function getMatchStatus(
  repVote: string,
  userVote: string | undefined,
): "match" | "mismatch" | "none" {
  if (!userVote || userVote === "Abstain") return "none";
  if (repVote === "Present" || repVote === "Not Voting") return "none";

  if (
    (userVote === "For" && repVote === "Yea") ||
    (userVote === "Against" && repVote === "Nay")
  ) {
    return "match";
  }
  return "mismatch";
}

function repVoteBadgeClass(vote: string): string {
  switch (vote) {
    case "Yea":
      return "bg-vote-yea text-white";
    case "Nay":
      return "bg-vote-nay text-white";
    case "Present":
      return "bg-vote-present text-white";
    default:
      return "bg-gray-300 text-gray-700";
  }
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

export function VoteComparisonFeed({
  votingRecord,
  userVotes,
}: VoteComparisonFeedProps) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = votingRecord.filter((bill) => {
    if (filter === "all") return true;
    const status = getMatchStatus(bill.repVote, userVotes?.[bill.billId]);
    if (filter === "matches") return status === "match";
    if (filter === "mismatches") return status === "mismatch";
    return true;
  });

  const matchCount = votingRecord.filter(
    (b) => getMatchStatus(b.repVote, userVotes?.[b.billId]) === "match",
  ).length;
  const mismatchCount = votingRecord.filter(
    (b) => getMatchStatus(b.repVote, userVotes?.[b.billId]) === "mismatch",
  ).length;

  const displayItems = expanded ? filtered : filtered.slice(0, 5);
  const hasMore = filtered.length > 5;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-navy/70 text-sm font-semibold tracking-[0.15em] uppercase">
          Full Voting Record
        </h2>
        {userVotes && (
          <div className="flex gap-1">
            {(
              [
                ["all", `All (${votingRecord.length})`],
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
          {displayItems.map((bill) => {
            const userVote = userVotes?.[bill.billId];
            const status = getMatchStatus(bill.repVote, userVote);
            const rowBg =
              status === "match"
                ? "bg-vote-yea/5 border-vote-yea/20"
                : status === "mismatch"
                  ? "bg-vote-nay/5 border-vote-nay/20"
                  : "bg-white border-border/60";

            return (
              <div
                key={bill.billId}
                className={`rounded-lg border p-4 ${rowBg} transition-colors`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={billHref({
                        billId: bill.billSlug,
                        title: bill.title,
                      })}
                      className="text-navy line-clamp-2 text-base leading-snug font-semibold hover:underline"
                    >
                      {bill.title}
                    </Link>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {new Date(bill.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-3">
                    <div className="text-center">
                      <p className="text-muted-foreground mb-1 text-xs tracking-wider uppercase">
                        Rep
                      </p>
                      <Badge className={repVoteBadgeClass(bill.repVote)}>
                        {bill.repVote}
                      </Badge>
                    </div>

                    {userVotes && (
                      <>
                        <div className="text-center">
                          <p className="text-muted-foreground mb-1 text-xs tracking-wider uppercase">
                            You
                          </p>
                          {userVote ? (
                            <Badge className={userVoteBadgeClass(userVote)}>
                              {userVote}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
                          )}
                        </div>

                        <div className="w-6 text-center">
                          {status === "match" && (
                            <span className="text-vote-yea text-lg">
                              &#10003;
                            </span>
                          )}
                          {status === "mismatch" && (
                            <span className="text-vote-nay text-lg">
                              &#10007;
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-navy/70 hover:text-navy mx-auto flex items-center gap-1.5 py-2 text-sm transition-colors"
        >
          {expanded ? (
            <>
              Show less <ChevronUp className="h-4 w-4" />
            </>
          ) : (
            <>
              Show all {filtered.length} votes{" "}
              <ChevronDown className="h-4 w-4" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

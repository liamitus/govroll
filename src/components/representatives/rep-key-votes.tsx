"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { RepVoteRecord } from "@/types";
import { billHref } from "@/lib/bills/url";

interface RepKeyVotesProps {
  keyVotes: RepVoteRecord[];
  repFirstName: string;
}

export function RepKeyVotes({ keyVotes, repFirstName }: RepKeyVotesProps) {
  if (keyVotes.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-navy/70 text-sm font-semibold tracking-[0.15em] uppercase">
        Key Votes
      </h2>
      <p className="text-muted-foreground -mt-1 text-sm">
        How {repFirstName} voted on final passage of bills
      </p>

      <div className="space-y-2">
        {keyVotes.map((vote) => (
          <div
            key={`${vote.billId}-${vote.date}`}
            className="border-border/60 flex items-center gap-3 rounded-lg border bg-white p-3 sm:p-4"
          >
            <Badge
              className={
                vote.repVote === "Yea"
                  ? "bg-vote-yea flex-shrink-0 text-white"
                  : "bg-vote-nay flex-shrink-0 text-white"
              }
            >
              {vote.repVote === "Yea" ? "YES" : "NO"}
            </Badge>

            <div className="min-w-0 flex-1">
              <Link
                href={billHref({ billId: vote.billSlug, title: vote.title })}
                className="text-navy line-clamp-2 text-base leading-snug font-semibold hover:underline"
              >
                {vote.title}
              </Link>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {new Date(vote.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

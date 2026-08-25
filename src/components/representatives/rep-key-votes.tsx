"use client";

import Link from "next/link";
import type { RepVoteRecord } from "@/types";
import { billHref } from "@/lib/bills/url";
import { isYesVote } from "@/lib/votes";

interface RepKeyVotesProps {
  keyVotes: RepVoteRecord[];
  repFirstName: string;
}

/**
 * Vote chip base — the word is mandatory (maya/flame differ only in hue),
 * ink text on both fills, square corners, uppercase Public Sans.
 */
const CHIP_BASE =
  "inline-flex flex-shrink-0 items-center justify-center px-2 py-1 text-[10.5px] font-bold uppercase tracking-[0.08em]";

function formatVoteDate(record: RepVoteRecord): string {
  // Prefer the actual roll-call date; fall back to bill.date for legacy
  // rows that don't have votedAt populated.
  const iso = record.votedAt ?? record.date;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function RepKeyVotes({ keyVotes, repFirstName }: RepKeyVotesProps) {
  if (keyVotes.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-ink-muted text-[11px] font-bold tracking-[0.18em] uppercase">
        Key Votes
      </h2>
      <p className="text-ink-muted -mt-1 text-sm">
        {`How ${repFirstName} voted on final passage of bills`}
      </p>

      <div className="space-y-2">
        {keyVotes.map((vote) => {
          const yes = isYesVote(vote.repVote);
          return (
            <div
              key={`${vote.billId}-${vote.rollCallNumber ?? "x"}`}
              className="border-rule bg-paper flex items-center gap-3 border p-3 sm:p-4"
            >
              <span
                className={`${CHIP_BASE} ${yes ? "bg-maya" : "bg-flame"} text-ink`}
              >
                {yes ? "Yes" : "No"}
              </span>

              <div className="min-w-0 flex-1">
                <Link
                  href={billHref({ billId: vote.billSlug, title: vote.title })}
                  className="text-ink line-clamp-2 text-base leading-snug font-semibold hover:underline"
                >
                  {vote.title}
                </Link>
                <p className="text-ink-muted mt-0.5 text-sm tabular-nums">
                  {formatVoteDate(vote)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

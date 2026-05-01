"use client";

import { useState } from "react";
import type { RepVoteRecord } from "@/types";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/auth/auth-modal";

interface AlignmentScoreProps {
  votingRecord: RepVoteRecord[];
  userVotes: Record<number, string> | null;
  repName: string;
}

function computeAlignment(
  votingRecord: RepVoteRecord[],
  userVotes: Record<number, string> | null,
) {
  if (!userVotes) return { aligned: 0, comparable: 0, pct: null };

  let comparable = 0;
  let aligned = 0;

  for (const bill of votingRecord) {
    const userVote = userVotes[bill.billId];
    if (!userVote || userVote === "Abstain") continue;
    if (bill.repVote === "Present" || bill.repVote === "Not Voting") continue;

    comparable++;
    if (
      (userVote === "For" && bill.repVote === "Yea") ||
      (userVote === "Against" && bill.repVote === "Nay")
    ) {
      aligned++;
    }
  }

  return {
    aligned,
    comparable,
    pct: comparable > 0 ? Math.round((aligned / comparable) * 100) : null,
  };
}

function EmptyDonut() {
  return (
    <div className="relative flex-shrink-0">
      <div
        className="flex h-36 w-36 items-center justify-center rounded-full"
        style={{
          background: "conic-gradient(#E5E7EB 0deg 360deg)",
        }}
      >
        <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white">
          <span className="text-2xl font-bold text-gray-300">—</span>
        </div>
      </div>
    </div>
  );
}

export function AlignmentScore({
  votingRecord,
  userVotes,
  repName,
}: AlignmentScoreProps) {
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const { aligned, comparable, pct } = computeAlignment(
    votingRecord,
    userVotes,
  );

  // Not logged in — show preview donut + sign in CTA
  if (!user) {
    return (
      <>
        <div className="border-border/60 rounded-xl border bg-white p-8">
          <div className="flex flex-col items-center gap-8 sm:flex-row">
            <EmptyDonut />

            <div className="text-center sm:text-left">
              <p className="text-navy/50 mb-2 text-sm font-semibold tracking-[0.15em] uppercase">
                Alignment Score
              </p>
              <p className="text-navy mb-1 text-xl font-bold">
                How well does {repName} represent you?
              </p>
              <p className="text-muted-foreground mb-4 max-w-sm text-base">
                Sign in and vote on bills to see a personalized alignment score
                comparing your positions with this representative&apos;s voting
                record.
              </p>
              <button
                onClick={() => setAuthOpen(true)}
                className="bg-navy hover:bg-navy-light inline-flex h-10 items-center rounded-md px-5 text-base font-medium text-white transition-colors"
              >
                Sign in to see your score
              </button>
            </div>
          </div>
        </div>

        <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      </>
    );
  }

  // Logged in but no overlapping votes
  if (pct === null) {
    return (
      <div className="border-border/60 rounded-xl border bg-white p-8">
        <div className="flex flex-col items-center gap-8 sm:flex-row">
          <EmptyDonut />

          <div className="text-center sm:text-left">
            <p className="text-navy/50 mb-2 text-sm font-semibold tracking-[0.15em] uppercase">
              Alignment Score
            </p>
            <p className="text-navy mb-1 text-xl font-bold">
              No alignment data yet
            </p>
            <p className="text-muted-foreground mb-4 max-w-sm text-base">
              Vote on bills to see how your positions compare with {repName}
              &apos;s voting record. The more bills you vote on, the more
              accurate your score.
            </p>
            <Link
              href="/bills"
              className="bg-navy hover:bg-navy-light inline-flex h-10 items-center rounded-md px-5 text-base font-medium text-white transition-colors"
            >
              Browse bills to vote on
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Has alignment data
  const alignedDeg = (pct / 100) * 360;
  const color =
    pct >= 60
      ? "var(--color-vote-yea)"
      : pct >= 40
        ? "var(--color-vote-present)"
        : "var(--color-vote-nay)";

  return (
    <div className="border-border/60 rounded-xl border bg-white p-8">
      <div className="flex flex-col items-center gap-8 sm:flex-row">
        {/* Donut */}
        <div className="relative flex-shrink-0">
          <div
            className="flex h-36 w-36 items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(${color} 0deg ${alignedDeg}deg, #E5E7EB ${alignedDeg}deg 360deg)`,
            }}
          >
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white">
              <span className="text-3xl font-bold" style={{ color }}>
                {pct}%
              </span>
            </div>
          </div>
        </div>

        {/* Text */}
        <div>
          <p className="text-navy/50 mb-2 text-sm font-semibold tracking-[0.15em] uppercase">
            Alignment Score
          </p>
          <p className="text-navy mb-1 text-2xl font-bold">{pct}% Aligned</p>
          <p className="text-muted-foreground text-base">
            {`Out of ${comparable} bill${comparable !== 1 ? "s" : ""} you've both voted on, you agreed on ${aligned}.`}
          </p>
        </div>
      </div>
    </div>
  );
}

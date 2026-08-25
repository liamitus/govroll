"use client";

import { useMemo, useState } from "react";
import type { RepVoteRecord } from "@/types";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/auth/auth-modal";
import { computeBillAlignment } from "@/lib/vote-grouping";

interface AlignmentScoreProps {
  votingRecord: RepVoteRecord[];
  userVotes: Record<number, string> | null;
  repName: string;
}

// The score is a fact, not a verdict: the arc is always sapphire on a
// rule-coloured track, and the number is ink. No red/green thresholds.
const TRACK = "#D3CCBE"; // rule
const ARC = "#4164FF"; // sapphire

const CTA_CLASSES =
  "bg-sapphire-deep text-paper hover:bg-sapphire inline-flex h-10 items-center px-5 text-base font-semibold transition-colors";

function EmptyDonut() {
  return (
    <div className="relative flex-shrink-0">
      <div
        className="flex h-36 w-36 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(${TRACK} 0deg 360deg)`,
        }}
      >
        <div className="bg-paper flex h-28 w-28 items-center justify-center rounded-full">
          <span className="text-hollow text-2xl font-bold">—</span>
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
  const { aligned, comparable, pct } = useMemo(
    () => computeBillAlignment(votingRecord, userVotes),
    [votingRecord, userVotes],
  );

  // Not logged in — show preview donut + sign in CTA
  if (!user) {
    return (
      <>
        <div className="border-rule bg-paper border p-8">
          <div className="flex flex-col items-center gap-8 sm:flex-row">
            <EmptyDonut />

            <div className="text-center sm:text-left">
              <p className="text-ink-muted mb-2 text-[11px] font-bold tracking-[0.18em] uppercase">
                Alignment Score
              </p>
              <p className="text-ink mb-1 text-xl font-bold">
                {`How well does ${repName} represent you?`}
              </p>
              <p className="text-ink-muted mb-4 max-w-sm text-base">
                Sign in and vote on bills to see a personalized alignment score
                comparing your positions with this representative&apos;s voting
                record.
              </p>
              <button onClick={() => setAuthOpen(true)} className={CTA_CLASSES}>
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
      <div className="border-rule bg-paper border p-8">
        <div className="flex flex-col items-center gap-8 sm:flex-row">
          <EmptyDonut />

          <div className="text-center sm:text-left">
            <p className="text-ink-muted mb-2 text-[11px] font-bold tracking-[0.18em] uppercase">
              Alignment Score
            </p>
            <p className="text-ink mb-1 text-xl font-bold">
              No alignment data yet
            </p>
            <p className="text-ink-muted mb-4 max-w-sm text-base">
              Vote on bills to see how your positions compare with {repName}
              &apos;s voting record. The more bills you vote on, the more
              accurate your score.
            </p>
            <Link href="/bills" className={CTA_CLASSES}>
              Browse bills to vote on
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Has alignment data
  const alignedDeg = (pct / 100) * 360;

  return (
    <div className="border-rule bg-paper border p-8">
      <div className="flex flex-col items-center gap-8 sm:flex-row">
        {/* Donut */}
        <div className="relative flex-shrink-0">
          <div
            className="flex h-36 w-36 items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(${ARC} 0deg ${alignedDeg}deg, ${TRACK} ${alignedDeg}deg 360deg)`,
            }}
          >
            <div className="bg-paper flex h-28 w-28 items-center justify-center rounded-full">
              <span className="text-ink text-3xl font-bold tabular-nums">
                {pct}%
              </span>
            </div>
          </div>
        </div>

        {/* Text */}
        <div>
          <p className="text-ink-muted mb-2 text-[11px] font-bold tracking-[0.18em] uppercase">
            Alignment Score
          </p>
          <p className="text-ink mb-1 text-2xl font-bold">{pct}% Aligned</p>
          <p className="text-ink-muted text-base">
            {`Out of ${comparable} bill${comparable !== 1 ? "s" : ""} you've both voted on, you agreed on ${aligned}.`}
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";

import dayjs from "dayjs";
import type { VoteType } from "@/types";

interface StaleVoteBannerProps {
  currentVote: VoteType;
  votedOnVersion: {
    versionCode: string;
    versionType: string;
    versionDate: string;
  } | null;
  currentVersion: {
    versionCode: string;
    versionType: string;
    versionDate: string;
  };
  changeSummary: string | null;
  onReVote: (voteType: VoteType) => void;
  onConfirm: () => void;
  submitting: boolean;
}

const VOTE_OPTIONS: VoteType[] = ["For", "Against", "Abstain"];

export function StaleVoteBanner({
  currentVote,
  votedOnVersion,
  currentVersion,
  changeSummary,
  onReVote,
  onConfirm,
  submitting,
}: StaleVoteBannerProps) {
  const otherOptions = VOTE_OPTIONS.filter((v) => v !== currentVote);

  return (
    // Informational notice — ink dashed frame on paper. Flame/red never
    // appears here: flame means "against", and this is not an alarm.
    <div className="border-ink bg-paper space-y-3 border border-dashed p-4">
      <div className="flex items-start gap-2">
        <svg
          className="text-ink mt-0.5 h-5 w-5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div className="min-w-0 space-y-2">
          <p className="text-foreground text-base font-semibold">
            This bill has been updated since your vote
          </p>

          <p className="text-muted-foreground text-sm">
            You voted{" "}
            <span className="text-foreground font-semibold">{currentVote}</span>
            {votedOnVersion ? (
              <>
                {" "}
                on the &ldquo;{votedOnVersion.versionType}&rdquo; version (
                {dayjs(votedOnVersion.versionDate).format("MMM D, YYYY")})
              </>
            ) : (
              <> before version tracking was available</>
            )}
            . The bill is now in its &ldquo;{currentVersion.versionType}&rdquo;
            version ({dayjs(currentVersion.versionDate).format("MMM D, YYYY")}).
          </p>

          {changeSummary ? (
            <div className="text-muted-foreground border-rule border-l-2 pl-3 text-sm">
              <span className="text-foreground/80 font-medium">
                What changed:{" "}
              </span>
              {changeSummary}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm italic">
              A summary of changes is being prepared.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={onConfirm}
          disabled={submitting}
          className="bg-sapphire-deep text-paper hover:bg-sapphire-deep/90 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
        >
          Keep My Vote: {currentVote}
        </button>
        {otherOptions.map((option) => (
          <button
            key={option}
            onClick={() => onReVote(option)}
            disabled={submitting}
            className="border-rule text-muted-foreground hover:text-foreground hover:border-ink border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Change to {option}
          </button>
        ))}
      </div>
    </div>
  );
}

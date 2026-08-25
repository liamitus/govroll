"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { StaleVoteBanner } from "./stale-vote-banner";
import { VoteHistorySection } from "./vote-history";
import type { VoteType, RollCallVote } from "@/types";
import {
  billVotesQueryKey,
  fetchBillVotes,
  fetchUserVote,
  submitVote as submitVoteApi,
  userVoteQueryKey,
} from "@/lib/queries/votes-client";
import {
  tallyRollCall,
  rollCallOutcome,
  voteCategoryLabel,
  type RollCallOutcome,
} from "@/lib/votes";

/**
 * Proportional stacked tally bar: maya | flame | blank, framed by a 1px
 * ink border with 1px ink separators between segments. Absences (present
 * / not voting / abstain) render as transparent segments occupying their
 * true width — an absence is part of the record. Every bar is paired
 * with a key of counts + words by its caller.
 */
function VoteBar({
  segments,
  total,
}: {
  segments: { label: string; count: number; color: string }[];
  total: number;
}) {
  if (total === 0) {
    return <div className="border-ink h-3 w-full border" />;
  }

  return (
    <div className="border-ink divide-ink flex h-3 w-full divide-x overflow-hidden border">
      {segments.map(
        (seg) =>
          seg.count > 0 && (
            <div
              key={seg.label}
              className={`h-full ${seg.color}`}
              style={{ width: `${(seg.count / total) * 100}%` }}
            />
          ),
      )}
    </div>
  );
}

/** Key swatch matching a bar segment — filled for maya/flame, a hollow
 *  ink-bordered square for the blank (absence) segments. */
function KeySwatch({ color }: { color: string }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 ${
        color === "bg-transparent" ? "border-ink border" : color
      }`}
      aria-hidden
    />
  );
}

function inferChamber(rollCall: RollCallVote): string {
  if (rollCall.chamber === "house") return "House";
  if (rollCall.chamber === "senate") return "Senate";
  // Infer from vote totals: Senate has 100 members, House has 435
  const total = rollCall.votes.reduce((sum, v) => sum + v.count, 0);
  return total > 200 ? "House" : "Senate";
}

/**
 * How the result line reads. We only assert Passed/Failed when the motion's
 * threshold is known (see {@link rollCallOutcome}); for cloture and 2/3
 * motions we name the motion so the verdict reads against the right bar, and
 * for ambiguous/procedural votes we show the bare tally with whatever context
 * the category gives — never a guessed verdict.
 */
function outcomeLine(
  category: string | null,
  outcome: RollCallOutcome,
  yea: number,
  nay: number,
): string {
  const tally = `${yea}-${nay}`;

  if (outcome.kind === "raw") {
    const label = category ? voteCategoryLabel(category) : null;
    return label && label !== "Vote" ? `${label} · ${tally}` : tally;
  }

  const qualifier =
    category === "cloture"
      ? "Cloture"
      : category === "passage_suspension"
        ? "Suspension"
        : category === "veto_override"
          ? "Veto override"
          : null;

  return qualifier
    ? `${qualifier} ${outcome.result.toLowerCase()} · ${tally}`
    : `${outcome.result} ${tally}`;
}

export function RollCallCard({ rollCall }: { rollCall: RollCallVote }) {
  // Normalize Yea/Aye and Nay/No through the votes source of truth.
  const tally = tallyRollCall(rollCall.votes);
  const { yea, nay, present, notVoting } = tally;
  const total = yea + nay + present + notVoting;

  // Threshold-aware: a 55-45 cloture or 250-180 suspension FAILS even though
  // yea > nay, so the verdict comes from the motion's category, not a guess.
  const outcome = rollCallOutcome(rollCall.category, tally);

  const dateStr = rollCall.votedAt
    ? new Date(rollCall.votedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-foreground text-base font-semibold">
          {`${inferChamber(rollCall)} Vote`}
        </h4>
        {dateStr && (
          <span className="text-muted-foreground text-sm tabular-nums">
            {dateStr}
          </span>
        )}
      </div>

      <VoteBar
        segments={[
          { label: "Yes", count: yea, color: "bg-vote-yea" },
          { label: "No", count: nay, color: "bg-vote-nay" },
          // Absences occupy their true width as blank track — part of
          // the record, never dropped from the bar.
          { label: "Present", count: present, color: "bg-transparent" },
          { label: "Not Voting", count: notVoting, color: "bg-transparent" },
        ]}
        total={total}
      />

      <div className="flex flex-wrap gap-3 text-sm tabular-nums">
        {yea > 0 && (
          <span className="flex items-center gap-1.5">
            <KeySwatch color="bg-vote-yea" />
            Yes: {yea}
          </span>
        )}
        {nay > 0 && (
          <span className="flex items-center gap-1.5">
            <KeySwatch color="bg-vote-nay" />
            No: {nay}
          </span>
        )}
        {present > 0 && (
          <span className="flex items-center gap-1.5">
            <KeySwatch color="bg-transparent" />
            Present: {present}
          </span>
        )}
        {notVoting > 0 && (
          <span className="flex items-center gap-1.5">
            <KeySwatch color="bg-transparent" />
            Not voting: {notVoting}
          </span>
        )}
      </div>

      {/* Verdict — plain ink, states the position without adjectives.
          A failed roll call is never red. */}
      {total > 0 && (
        <p className="text-foreground text-sm tabular-nums">
          {outcomeLine(rollCall.category, outcome, yea, nay)}
        </p>
      )}
    </div>
  );
}

export function VoteOnBill({
  billId,
  onSignUp,
}: {
  billId: number;
  onSignUp?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: votes = null } = useQuery({
    queryKey: billVotesQueryKey(billId),
    queryFn: ({ signal }) => fetchBillVotes(billId, signal),
    staleTime: 15_000,
  });

  const { data: userVoteStatus = null } = useQuery({
    queryKey: userVoteQueryKey(billId, user?.id ?? null),
    queryFn: ({ signal }) => fetchUserVote(billId, signal),
    enabled: !!user,
    staleTime: 30_000,
  });
  const userVote = userVoteStatus?.vote?.voteType ?? null;

  const mutation = useMutation({
    mutationFn: (voteType: VoteType) => submitVoteApi(billId, voteType),
    // Optimistic flip: stamp the user's choice into both caches before
    // the server responds so the UI reflects intent immediately.
    onMutate: async (voteType) => {
      const userKey = userVoteQueryKey(billId, user?.id ?? null);
      await queryClient.cancelQueries({ queryKey: userKey });
      const previous = queryClient.getQueryData(userKey);
      queryClient.setQueryData(userKey, (old: unknown) => {
        const prev = old as typeof userVoteStatus;
        return {
          ...(prev ?? { isStale: false, staleInfo: null, vote: null }),
          isStale: false,
          staleInfo: null,
          vote: {
            ...(prev?.vote ?? {}),
            voteType,
          },
        };
      });
      return { previous, userKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.userKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: billVotesQueryKey(billId) });
      queryClient.invalidateQueries({
        queryKey: userVoteQueryKey(billId, user?.id ?? null),
      });
    },
  });
  const submitting = mutation.isPending;

  const submitVote = (voteType: VoteType) => {
    if (!user) return;
    mutation.mutate(voteType);
  };

  const getCount = (type: string) =>
    votes?.publicVotes.find((v) => v.voteType === type)?.count || 0;

  const publicTotal =
    getCount("For") + getCount("Against") + getCount("Abstain");

  // Show only the latest vote per chamber
  const latestRollCalls = (() => {
    if (!votes?.rollCalls?.length) return [];
    const byChamber = new Map<string, RollCallVote>();
    for (const rc of votes.rollCalls) {
      const chamber = inferChamber(rc);
      const existing = byChamber.get(chamber);
      if (
        !existing ||
        (rc.votedAt && (!existing.votedAt || rc.votedAt > existing.votedAt))
      ) {
        byChamber.set(chamber, rc);
      }
    }
    return Array.from(byChamber.values());
  })();

  const hasRollCalls = latestRollCalls.length > 0;

  // Fallback: if no rollCalls but has legacy congressionalVotes
  const hasLegacyCongressional =
    !hasRollCalls &&
    votes &&
    votes.congressionalVotes.length > 0 &&
    votes.congressionalVotes.reduce((sum, v) => sum + v.count, 0) > 0;

  return (
    <div className="space-y-4">
      {/* Stale vote banner */}
      {userVoteStatus?.isStale && userVoteStatus.staleInfo && userVote && (
        <StaleVoteBanner
          currentVote={userVote}
          votedOnVersion={userVoteStatus.staleInfo.votedOnVersion}
          currentVersion={userVoteStatus.staleInfo.currentVersion}
          changeSummary={userVoteStatus.staleInfo.changeSummary}
          onReVote={submitVote}
          onConfirm={() => submitVote(userVote)}
          submitting={submitting}
        />
      )}

      <div
        className={`grid gap-6 ${hasRollCalls || hasLegacyCongressional ? "sm:grid-cols-2" : ""}`}
      >
        {/* Public vote */}
        <div className="space-y-4">
          {/* Kicker in Public Sans — the global h3 rule sets Archivo,
              which never renders below 18px. */}
          <h3 className="text-ink-muted font-sans text-[11px] font-bold tracking-[0.18em] uppercase">
            Public Opinion
          </h3>

          {publicTotal > 0 ? (
            <>
              <VoteBar
                segments={[
                  {
                    label: "For",
                    count: getCount("For"),
                    color: "bg-vote-for",
                  },
                  {
                    label: "Against",
                    count: getCount("Against"),
                    color: "bg-vote-against",
                  },
                  {
                    label: "Abstain",
                    count: getCount("Abstain"),
                    color: "bg-transparent",
                  },
                ]}
                total={publicTotal}
              />
              <div className="flex gap-4 text-sm tabular-nums">
                <span className="flex items-center gap-1.5">
                  <KeySwatch color="bg-vote-for" />
                  For: {getCount("For")}
                </span>
                <span className="flex items-center gap-1.5">
                  <KeySwatch color="bg-vote-against" />
                  Against: {getCount("Against")}
                </span>
                <span className="flex items-center gap-1.5">
                  <KeySwatch color="bg-transparent" />
                  Abstain: {getCount("Abstain")}
                </span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground py-1 text-base">
              No votes yet — be the first to weigh in.
            </p>
          )}

          {/* Vote buttons — same maya/flame + mandatory-word grammar as
              the member chips: selected For = maya fill + ink text,
              selected Against = flame fill + ink text, selected Abstain
              = dashed ink frame (an abstention is a stated absence).
              Unselected = quiet outline. Maya/flame are never text. */}
          <div className="flex gap-2">
            {(["For", "Against", "Abstain"] as VoteType[]).map((type) => {
              const isActive = userVote === type;
              const styles = {
                For: isActive
                  ? "bg-vote-for text-ink border-ink"
                  : "border-rule text-ink hover:bg-vote-for-soft hover:border-ink",
                Against: isActive
                  ? "bg-vote-against text-ink border-ink"
                  : "border-rule text-ink hover:bg-vote-against-soft hover:border-ink",
                Abstain: isActive
                  ? "border-ink text-ink border-dashed bg-transparent"
                  : "border-rule text-ink hover:border-ink hover:border-dashed",
              };
              return (
                <Button
                  key={type}
                  variant="outline"
                  disabled={submitting || !user}
                  onClick={() => submitVote(type)}
                  className={`h-10 flex-1 text-base font-semibold transition-all ${styles[type]}`}
                >
                  {type}
                </Button>
              );
            })}
          </div>

          {!user && (
            <div className="bg-muted/50 rounded-lg border border-dashed px-4 py-3 text-center">
              <p className="text-foreground text-base font-medium">
                <button
                  type="button"
                  onClick={onSignUp}
                  className="hover:text-primary underline underline-offset-2 transition-colors"
                >
                  Sign up
                </button>{" "}
                to cast your vote
              </p>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Your voice matters — let representatives know where you stand.
              </p>
            </div>
          )}

          {/* Vote history */}
          {userVoteStatus?.voteHistory && (
            <VoteHistorySection history={userVoteStatus.voteHistory} />
          )}
        </div>

        {/* Congressional votes — grouped by roll call */}
        {hasRollCalls && (
          <div className="space-y-6">
            <h3 className="text-ink-muted font-sans text-[11px] font-bold tracking-[0.18em] uppercase">
              Official Votes
            </h3>
            {latestRollCalls.map((rc, i) => (
              <RollCallCard key={rc.rollCallNumber ?? i} rollCall={rc} />
            ))}
          </div>
        )}

        {/* Legacy fallback for old data without roll call info */}
        {hasLegacyCongressional && (
          <div className="space-y-4">
            {(() => {
              const legacyRollCall = {
                rollCallNumber: null,
                chamber: null,
                votedAt: null,
                // Legacy flat tally carries no category, so the card shows
                // the raw numbers without asserting a pass/fail verdict.
                category: null,
                votes: votes!.congressionalVotes,
              } as RollCallVote;
              return (
                <>
                  <h3 className="text-ink-muted font-sans text-[11px] font-bold tracking-[0.18em] uppercase">
                    {`${inferChamber(legacyRollCall)} Vote`}
                  </h3>
                  <RollCallCard rollCall={legacyRollCall} />
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

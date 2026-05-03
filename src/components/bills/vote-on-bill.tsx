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

function VoteBar({
  segments,
  total,
}: {
  segments: { label: string; count: number; color: string }[];
  total: number;
}) {
  if (total === 0) {
    return (
      <div className="bg-muted h-3 w-full overflow-hidden rounded-full">
        <div className="bg-muted h-full w-full" />
      </div>
    );
  }

  return (
    <div className="bg-muted flex h-3 w-full overflow-hidden rounded-full">
      {segments.map(
        (seg) =>
          seg.count > 0 && (
            <div
              key={seg.label}
              className={`h-full ${seg.color} transition-all duration-500`}
              style={{ width: `${(seg.count / total) * 100}%` }}
            />
          ),
      )}
    </div>
  );
}

function inferChamber(rollCall: RollCallVote): string {
  if (rollCall.chamber === "house") return "House";
  if (rollCall.chamber === "senate") return "Senate";
  // Infer from vote totals: Senate has 100 members, House has 435
  const total = rollCall.votes.reduce((sum, v) => sum + v.count, 0);
  return total > 200 ? "House" : "Senate";
}

function RollCallCard({ rollCall }: { rollCall: RollCallVote }) {
  const getCount = (vote: string) =>
    rollCall.votes.find((v) => v.vote === vote)?.count || 0;

  // GovTrack uses "Yea"/"Nay" for Senate, "Aye"/"No" for House
  const yea = getCount("Yea") + getCount("Aye");
  const nay = getCount("Nay") + getCount("No");

  const total = yea + nay + getCount("Present") + getCount("Not Voting");

  const result = yea > nay ? "Passed" : nay > yea ? "Failed" : "Tied";

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
          <span className="text-muted-foreground text-sm">{dateStr}</span>
        )}
      </div>

      <VoteBar
        segments={[
          { label: "Yes", count: yea, color: "bg-vote-yea" },
          { label: "No", count: nay, color: "bg-vote-nay" },
          {
            label: "Present",
            count: getCount("Present"),
            color: "bg-vote-present",
          },
          {
            label: "Not Voting",
            count: getCount("Not Voting"),
            color: "bg-vote-notvoting",
          },
        ]}
        total={total}
      />

      <div className="flex flex-wrap gap-3 text-sm">
        {yea > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="bg-vote-yea inline-block h-2.5 w-2.5 rounded-full" />
            Yes: {yea}
          </span>
        )}
        {nay > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="bg-vote-nay inline-block h-2.5 w-2.5 rounded-full" />
            No: {nay}
          </span>
        )}
        {getCount("Present") > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="bg-vote-present inline-block h-2.5 w-2.5 rounded-full" />
            Present: {getCount("Present")}
          </span>
        )}
        {getCount("Not Voting") > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="bg-vote-notvoting inline-block h-2.5 w-2.5 rounded-full" />
            Not Voting: {getCount("Not Voting")}
          </span>
        )}
      </div>

      {total > 0 && (
        <p className="text-muted-foreground text-sm">
          {result} {yea}-{nay}
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
          <h3 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
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
                    color: "bg-vote-abstain",
                  },
                ]}
                total={publicTotal}
              />
              <div className="flex gap-4 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="bg-vote-for inline-block h-2.5 w-2.5 rounded-full" />
                  For: {getCount("For")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="bg-vote-against inline-block h-2.5 w-2.5 rounded-full" />
                  Against: {getCount("Against")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="bg-vote-abstain inline-block h-2.5 w-2.5 rounded-full" />
                  Abstain: {getCount("Abstain")}
                </span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground py-1 text-base">
              No votes yet — be the first to weigh in.
            </p>
          )}

          {/* Vote buttons — styled as poll CTA */}
          <div className="flex gap-2">
            {(["For", "Against", "Abstain"] as VoteType[]).map((type) => {
              const isActive = userVote === type;
              const styles = {
                For: isActive
                  ? "bg-vote-for text-white border-vote-for shadow-sm"
                  : "border-vote-for/50 text-vote-for hover:bg-vote-for-soft hover:border-vote-for",
                Against: isActive
                  ? "bg-vote-against text-white border-vote-against shadow-sm"
                  : "border-vote-against/50 text-vote-against hover:bg-vote-against-soft hover:border-vote-against",
                Abstain: isActive
                  ? "bg-vote-abstain text-white border-vote-abstain shadow-sm"
                  : "border-vote-abstain/50 text-vote-abstain hover:bg-vote-abstain-soft hover:border-vote-abstain",
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
            <h3 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
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
                votes: votes!.congressionalVotes,
              } as RollCallVote;
              return (
                <>
                  <h3 className="text-muted-foreground text-sm font-semibold tracking-wider uppercase">
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

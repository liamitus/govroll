"use client";

import Link from "next/link";
import { Phone, ExternalLink } from "lucide-react";
import type { RepresentativeWithVote } from "@/types";
import { partyColor } from "@/lib/representative-utils";
import { RepPhoto } from "@/components/representatives/rep-photo";

const NO_VOTE_SENTINEL = "No vote recorded";

function normalizeVote(vote: string): string {
  if (vote === "Yea" || vote === "Aye") return "Yes";
  if (vote === "Nay" || vote === "No") return "No";
  return vote;
}

function voteBadgeClass(vote: string): string {
  const v = normalizeVote(vote);
  if (v === "Yes") return "text-vote-yea bg-vote-yea-soft";
  if (v === "No") return "text-vote-nay bg-vote-nay-soft";
  if (v === "Present") return "text-vote-present bg-vote-present-soft";
  return "text-muted-foreground bg-muted";
}

interface RepActionCardProps {
  /** The rep the question was about — promoted to top with a "why-vote" framing. */
  promoted: RepresentativeWithVote | null;
  /** All of the user's reps for this bill (House + Senate). */
  userReps: RepresentativeWithVote[];
  /** True when the user's question included "why did/does X vote" language —
   *  switches the framing from generic "contact your reps" to "ask them why". */
  isWhyIntent: boolean;
}

/**
 * Rendered as a footer below an AI assistant message when we can connect the
 * user's question to a real representative they can contact.
 *
 * Two rendering modes:
 *  1. Promoted rep is the user's own rep — single rich card with a "Call to
 *     ask why" CTA. The action is unambiguous.
 *  2. Promoted rep is NOT the user's rep (e.g. the user asked about AOC but
 *     lives outside NY-14) — show the promoted rep's contact, then nudge the
 *     user toward their own reps with a softer "Or contact your own
 *     representatives" affordance.
 *
 * When `promoted` is null but `userReps` is set, falls back to a generic
 * "Contact your representatives" footer. When neither, renders nothing.
 */
export function RepActionCard({
  promoted,
  userReps,
  isWhyIntent,
}: RepActionCardProps) {
  const promotedIsUserRep =
    promoted != null &&
    userReps.some((r) => r.bioguideId === promoted.bioguideId);

  if (!promoted && userReps.length === 0) return null;

  return (
    <div className="border-civic-gold/30 bg-civic-cream/40 dark:bg-accent/10 mt-3 space-y-3 rounded-lg border p-3">
      {promoted ? (
        <PromotedRep
          rep={promoted}
          isUserRep={promotedIsUserRep}
          isWhyIntent={isWhyIntent}
        />
      ) : (
        <p className="text-foreground text-sm font-medium">
          Want to share your view? Contact your representatives:
        </p>
      )}

      {!promotedIsUserRep && userReps.length > 0 ? (
        <div className="space-y-1.5">
          {promoted ? (
            <p className="text-muted-foreground text-xs">
              Or contact your own representatives:
            </p>
          ) : null}
          <div className="grid gap-1.5 sm:grid-cols-2">
            {userReps.map((rep) => (
              <CompactRepRow key={rep.bioguideId} rep={rep} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PromotedRep({
  rep,
  isUserRep,
  isWhyIntent,
}: {
  rep: RepresentativeWithVote;
  isUserRep: boolean;
  isWhyIntent: boolean;
}) {
  const colors = partyColor(rep.party);
  const hasVote = rep.vote !== NO_VOTE_SENTINEL;
  const voteLabel = hasVote ? normalizeVote(rep.vote) : null;
  const repHref = `/representatives/${rep.slug || rep.bioguideId}`;

  const ctaCopy = (() => {
    if (isWhyIntent && hasVote) {
      return isUserRep
        ? `Call ${rep.lastName}'s office to ask why they voted ${voteLabel}`
        : `${rep.firstName} ${rep.lastName} hasn't publicly explained this vote — call their office to ask`;
    }
    return isUserRep
      ? `Tell ${rep.lastName} how you want them to vote`
      : `Contact ${rep.firstName} ${rep.lastName}`;
  })();

  return (
    <div className="space-y-2">
      <p className="text-foreground text-sm leading-snug">{ctaCopy}</p>
      <div
        className={`bg-card flex items-center gap-3 rounded-lg border p-2.5 ${colors.bar}`}
      >
        <Link
          href={repHref}
          className="flex min-w-0 flex-1 items-center gap-3 transition-opacity hover:opacity-80"
        >
          <div className="bg-muted relative h-11 w-9 flex-shrink-0 overflow-hidden rounded-md">
            <RepPhoto
              bioguideId={rep.bioguideId ?? null}
              firstName={rep.firstName}
              lastName={rep.lastName}
              imgClassName="object-[center_20%]"
              fallbackClassName="text-xs font-semibold"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground truncate text-sm font-semibold">
              {rep.firstName} {rep.lastName}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {rep.party.replace("Democratic", "Democrat")} · {rep.state}
              {rep.district ? `-${rep.district}` : ""}
              {voteLabel ? ` · Voted ${voteLabel}` : ""}
            </p>
          </div>
        </Link>
        <RepActions rep={rep} />
      </div>
    </div>
  );
}

function CompactRepRow({ rep }: { rep: RepresentativeWithVote }) {
  const repHref = `/representatives/${rep.slug || rep.bioguideId}`;
  const hasVote = rep.vote !== NO_VOTE_SENTINEL;
  const voteLabel = hasVote ? normalizeVote(rep.vote) : null;

  return (
    <div className="bg-card flex items-center gap-2 rounded-md border p-2 text-xs">
      <Link
        href={repHref}
        className="min-w-0 flex-1 truncate transition-opacity hover:opacity-80"
      >
        <span className="text-foreground font-medium">
          {rep.firstName[0]}. {rep.lastName}
        </span>
        {voteLabel ? (
          <span
            className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${voteBadgeClass(rep.vote)}`}
          >
            {voteLabel}
          </span>
        ) : null}
      </Link>
      <RepActions rep={rep} compact />
    </div>
  );
}

function RepActions({
  rep,
  compact = false,
}: {
  rep: RepresentativeWithVote;
  compact?: boolean;
}) {
  const iconClass = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      {rep.phone ? (
        <a
          href={`tel:${rep.phone}`}
          aria-label={`Call ${rep.firstName} ${rep.lastName} at ${rep.phone}`}
          title={rep.phone}
          className="text-muted-foreground hover:text-civic-gold hover:bg-civic-gold/10 inline-flex items-center justify-center rounded-md p-1.5 transition-colors"
        >
          <Phone className={iconClass} />
        </a>
      ) : null}
      {rep.link ? (
        <a
          href={rep.link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${rep.firstName} ${rep.lastName} on Congress.gov`}
          title="Open profile on Congress.gov"
          className="text-muted-foreground hover:text-civic-gold hover:bg-civic-gold/10 inline-flex items-center justify-center rounded-md p-1.5 transition-colors"
        >
          <ExternalLink className={iconClass} />
        </a>
      ) : null}
    </div>
  );
}

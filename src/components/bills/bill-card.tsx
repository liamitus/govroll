"use client";

import Link, { useLinkStatus } from "next/link";
import dayjs from "dayjs";
import type { BillSummary, MomentumTier, DeathReason, VoteType } from "@/types";
import { getTopicForPolicyArea } from "@/lib/topic-mapping";
import { billHref } from "@/lib/bills/url";

// Reddit's visited-link cue, translated to our palette: a muted title + a
// vote-tinted chip that tells you *how* you voted at a glance.
export function voteChipStyle(voteType: VoteType): {
  label: string;
  className: string;
} {
  if (voteType === "For")
    return {
      label: "Voted For",
      className: "bg-vote-for-soft text-vote-for border-vote-for/25",
    };
  if (voteType === "Against")
    return {
      label: "Voted Against",
      className:
        "bg-vote-against-soft text-vote-against border-vote-against/25",
    };
  return {
    label: "Abstained",
    className: "bg-vote-abstain-soft text-vote-abstain border-vote-abstain/30",
  };
}

// Navigation indicator: only renders when this specific Link has been clicked
// and the app is resolving the next route. Next.js 15.3+.
function CardNavIndicator() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <div
      aria-busy="true"
      className="ring-navy/40 pointer-events-none absolute inset-0 rounded-lg ring-2"
    >
      <div className="border-navy/20 border-t-navy/70 absolute top-3 right-4 h-3.5 w-3.5 animate-spin rounded-full border-2" />
    </div>
  );
}

function statusStyle(status: string): { label: string; className: string } {
  if (status.startsWith("enacted_"))
    return { label: "Enacted", className: "bg-enacted-soft text-enacted" };
  if (
    status === "passed_bill" ||
    status.startsWith("conference_") ||
    status === "passed_simpleres" ||
    status === "passed_concurrentres"
  )
    return { label: "Passed", className: "bg-passed-soft text-passed" };
  if (status.startsWith("pass_over_") || status.startsWith("pass_back_"))
    return { label: "In Progress", className: "bg-passed-soft text-passed" };
  if (status.startsWith("prov_kill_") && status !== "prov_kill_veto")
    return { label: "Stalled", className: "bg-muted text-foreground/60" };
  if (
    status.startsWith("fail_") ||
    status.startsWith("vetoed_") ||
    status === "prov_kill_veto"
  )
    return { label: "Failed", className: "bg-failed-soft text-failed" };
  if (status === "reported")
    return { label: "In Committee", className: "bg-muted text-foreground/70" };
  return { label: "Introduced", className: "bg-muted text-foreground/70" };
}

function chamberTag(
  billType: string,
): { label: string; className: string } | null {
  if (billType.startsWith("house"))
    return { label: "House", className: "text-house" };
  if (billType.startsWith("senate"))
    return { label: "Senate", className: "text-senate" };
  return null;
}

function formatSilence(days: number): string {
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

function deathLabel(reason: DeathReason | null): string {
  switch (reason) {
    case "CONGRESS_ENDED":
      return "Congress ended";
    case "FAILED_VOTE":
      return "Failed vote";
    case "VETOED":
      return "Vetoed";
    case "LONG_SILENCE":
      return "No action >1yr";
    default:
      return "Died";
  }
}

interface TierTreatment {
  // Applied to the card wrapper. Only the tier-specific tone.
  cardClass: string;
  // Optional chip shown next to the status chip.
  momentumChip?: { label: string; className: string };
  // Optional short microcopy about activity, shown on the meta row.
  silenceNote?: string;
}

function tierTreatment(
  tier: MomentumTier | null,
  daysSinceLastAction: number | null,
  deathReason: DeathReason | null,
): TierTreatment {
  const silence =
    daysSinceLastAction != null && daysSinceLastAction > 30
      ? `No action in ${formatSilence(daysSinceLastAction)}`
      : undefined;

  switch (tier) {
    case "DEAD":
      return {
        cardClass: "opacity-60 grayscale-[30%]",
        momentumChip: {
          label: deathLabel(deathReason),
          className: "bg-muted/70 text-foreground/60 border border-border/60",
        },
        silenceNote: silence,
      };
    case "DORMANT":
      return {
        cardClass: "opacity-75",
        momentumChip: {
          label: "Dormant",
          className: "bg-muted text-foreground/60",
        },
        silenceNote: silence,
      };
    case "STALLED":
      return {
        cardClass: "",
        momentumChip: {
          label: "Stalled",
          className: "bg-muted text-foreground/60",
        },
        silenceNote: silence,
      };
    case "ADVANCING":
      return {
        cardClass: "",
        momentumChip: {
          label: "Advancing",
          className: "bg-passed-soft text-passed",
        },
      };
    case "ENACTED":
    case "ACTIVE":
    case null:
    default:
      return { cardClass: "" };
  }
}

export function BillCard({
  bill,
  userVote = null,
}: {
  bill: BillSummary;
  userVote?: VoteType | null;
}) {
  const status = statusStyle(bill.currentStatus);
  const chamber = chamberTag(bill.billType);
  const topic = getTopicForPolicyArea(bill.policyArea);
  const displayDate = bill.latestActionDate || bill.introducedDate;
  const treatment = tierTreatment(
    bill.momentumTier,
    bill.daysSinceLastAction,
    bill.deathReason,
  );
  const voteChip = userVote ? voteChipStyle(userVote) : null;

  const href = billHref(bill);

  return (
    <Link
      href={href}
      className="group focus-visible:ring-navy/40 block rounded-lg transition-transform focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.997]"
    >
      <div
        className={`border-border/50 hover:border-navy/25 relative rounded-lg border bg-white px-5 py-4 transition-all duration-200 hover:shadow-[0_2px_12px_rgba(10,31,68,0.1)] ${treatment.cardClass}`}
      >
        <CardNavIndicator />
        {/* Chamber indicator line */}
        <div
          className={`absolute top-0 bottom-0 left-0 w-1 rounded-l-lg ${
            bill.billType.startsWith("house")
              ? "bg-house/70"
              : bill.billType.startsWith("senate")
                ? "bg-senate/70"
                : "bg-muted"
          }`}
        />

        <div className="pl-3">
          <div className="flex items-start justify-between gap-3">
            <h3
              className={`line-clamp-2 flex-1 text-base leading-snug font-semibold transition-colors ${
                voteChip
                  ? "text-navy/55 group-hover:text-navy/75"
                  : "text-navy group-hover:text-navy-light"
              }`}
            >
              {bill.title}
            </h3>
            {voteChip && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-semibold tracking-wider uppercase ${voteChip.className}`}
                title={`You voted ${userVote?.toLowerCase()} on this bill`}
              >
                <svg
                  className="h-2.5 w-2.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {voteChip.label}
              </span>
            )}
          </div>

          {bill.shortText && (
            <p className="text-muted-foreground mt-1 line-clamp-1 text-sm leading-relaxed">
              {bill.shortText}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {chamber && (
              <span
                className={`text-xs font-bold tracking-wider uppercase ${chamber.className}`}
              >
                {chamber.label}
              </span>
            )}
            {topic && (
              <span
                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${topic.color}`}
              >
                {topic.label}
              </span>
            )}
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${status.className}`}
            >
              {status.label}
            </span>
            {treatment.momentumChip && (
              <span
                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${treatment.momentumChip.className}`}
              >
                {treatment.momentumChip.label}
              </span>
            )}
            {bill.sponsor && (
              <span className="text-muted-foreground text-xs">
                {bill.sponsor}
              </span>
            )}
            <span className="text-muted-foreground text-xs">
              {dayjs(displayDate).format("MMM D, YYYY")}
            </span>
            {treatment.silenceNote && (
              <span className="text-muted-foreground/70 text-xs italic">
                {treatment.silenceNote}
              </span>
            )}
          </div>

          {/* Engagement signals — shown only when there's actual activity */}
          {(bill.commentCount != null && bill.commentCount > 0) ||
          (bill.publicVoteCount != null && bill.publicVoteCount > 0) ? (
            <div className="text-muted-foreground mt-2 flex items-center gap-3 text-xs">
              {bill.publicVoteCount != null && bill.publicVoteCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 10v12" />
                    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L15 2a3.13 3.13 0 0 1 3 3.88Z" />
                  </svg>
                  {bill.publicVoteCount.toLocaleString()}{" "}
                  {bill.publicVoteCount === 1 ? "vote" : "votes"}
                </span>
              )}
              {bill.commentCount != null && bill.commentCount > 0 && (
                // Span with role=button so React doesn't error on nested <a>.
                // Native click bubbles up to the outer Link; we intercept to
                // navigate to #discussion instead.
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = `${href}#discussion`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      window.location.href = `${href}#discussion`;
                    }
                  }}
                  className="hover:text-navy inline-flex cursor-pointer items-center gap-1 underline-offset-2 transition-colors hover:underline"
                >
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {bill.commentCount.toLocaleString()}{" "}
                  {bill.commentCount === 1 ? "comment" : "comments"}
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

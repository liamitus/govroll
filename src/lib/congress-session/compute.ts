import { PrismaClient } from "@/generated/prisma/client";
import { getHouseClerkSignal } from "./clerk-xml";
import { getSenatePailSignal } from "./senate-pail";
import { getVoteRecencySignal } from "./vote-recency";
import {
  getRecessToday,
  getNextRecess,
  nextInSessionDate,
  type CalendarWindow,
} from "./calendar";
import type { Chamber, ChamberStatus, Signal } from "./types";

/**
 * Waterfall that merges four signals into a single ChamberStatus:
 *
 *   1. Live scraper   — clerk_xml (House) / senate_pail (Senate)
 *   2. Vote recency   — last roll-call timestamp from our own DB
 *   3. Calendar       — is today inside a published recess window?
 *   4. Weekend rule   — Sat/Sun with no other positive signal → recess
 *
 * Rules:
 *   - Any signal reporting `voting` (i.e. vote in the last 2h) wins and
 *     outranks everything else: roll-call recency is the most unambiguous
 *     proof the chamber is on the floor.
 *   - If calendar says we're inside a recess AND no live/vote signal says
 *     in_session/voting, status is `recess`. (Emergency sessions during a
 *     scheduled recess — rare but real — should be caught by either the
 *     live scraper or a vote signal; if both are absent, publishing
 *     "Recess" matches the published schedule and is the correct answer.)
 *   - If live scraper says in_session/pro_forma and we're not in a
 *     calendar recess, that wins over nothing.
 *   - Weekend fallback only kicks in when all other signals are silent,
 *     protecting against the common case of Saturday/Sunday with no votes
 *     and no scraper match.
 *
 * Returned status always includes `lastCheckedAt = now`; the caller
 * persists it to CongressChamberStatus.
 */
export async function computeChamberStatus(
  prisma: PrismaClient,
  chamber: Chamber,
  now: Date = new Date(),
): Promise<ChamberStatus> {
  const [liveSignal, voteSignal, recessToday, nextRecess, nextSession] =
    await Promise.all([
      chamber === "house" ? getHouseClerkSignal(now) : getSenatePailSignal(now),
      getVoteRecencySignal(prisma, chamber, now),
      getRecessToday(prisma, chamber, now),
      getNextRecess(prisma, chamber, now),
      nextInSessionDate(prisma, chamber, now),
    ]);

  // ── 1. Voting rule — any signal with `voting` status wins outright ─────
  const votingSignal = pickVoting(liveSignal, voteSignal);
  if (votingSignal) {
    return shape({
      chamber,
      status: "voting",
      detail: votingSignal.detail,
      source: votingSignal.source,
      lastActionAt: votingSignal.observedAt,
      nextRecess,
      now,
    });
  }

  // ── 2. Live scraper wins over calendar when it reports positive state ──
  if (liveSignal && liveSignal.status === "in_session") {
    return shape({
      chamber,
      status: "in_session",
      detail: liveSignal.detail,
      source: liveSignal.source,
      lastActionAt: liveSignal.observedAt,
      nextRecess,
      now,
    });
  }
  if (liveSignal && liveSignal.status === "pro_forma") {
    return shape({
      chamber,
      status: "pro_forma",
      detail: liveSignal.detail,
      source: liveSignal.source,
      lastActionAt: liveSignal.observedAt,
      nextRecess,
      now,
    });
  }
  // Chamber gaveled in earlier today and is done for the day. The most useful
  // transition is "when do they convene next?" — same shape as recess, not
  // "next recess" — so pass `nextSession` instead of `nextRecess`.
  if (liveSignal && liveSignal.status === "adjourned_today") {
    return shape({
      chamber,
      status: "adjourned_today",
      detail: liveSignal.detail,
      source: liveSignal.source,
      lastActionAt: liveSignal.observedAt,
      nextSession,
      now,
    });
  }

  // ── 3. Vote recency standing alone ─────────────────────────────────────
  // No live signal; recent vote within 8h means they were/are in session.
  // If we're also in a calendar recess, the vote is authoritative — but
  // this branch only triggers outside recess, since the live scraper's
  // recess verdict didn't block us here.
  if (voteSignal && voteSignal.status === "in_session" && !recessToday) {
    return shape({
      chamber,
      status: "in_session",
      detail: voteSignal.detail,
      source: voteSignal.source,
      lastActionAt: voteSignal.observedAt,
      nextRecess,
      now,
    });
  }

  // ── 4. Calendar recess ────────────────────────────────────────────────
  if (recessToday) {
    return shape({
      chamber,
      status: "recess",
      detail: recessToday.label,
      source: "calendar",
      lastActionAt: null,
      nextSession,
      now,
    });
  }

  // ── 5. Weekend ────────────────────────────────────────────────────────
  // Prefer the plain-English weekend message over the scraper's 404 branch
  // ("No floor proceedings published today") when we can tell it's a Sat/Sun
  // from the wall clock. Citizens recognise "Weekend" without having to know
  // what a floor proceeding is. Named weekend-spanning recesses have already
  // been caught by step 4, so this only fires on between-week weekends.
  if (isWeekendInEt(now)) {
    return shape({
      chamber,
      status: "recess",
      detail: "Weekend — chamber not in session",
      source: "calendar",
      lastActionAt: null,
      nextSession,
      now,
    });
  }

  // ── 6. Live scraper said "recess" on a weekday ────────────────────────
  if (liveSignal && liveSignal.status === "recess") {
    return shape({
      chamber,
      status: "recess",
      detail: liveSignal.detail,
      source: liveSignal.source,
      lastActionAt: null,
      nextSession,
      now,
    });
  }

  // ── 7. Give up honestly rather than lie ───────────────────────────────
  return shape({
    chamber,
    status: "unknown",
    detail: null,
    source: "none",
    lastActionAt: null,
    nextRecess,
    now,
  });
}

function pickVoting(...signals: (Signal | null)[]): Signal | null {
  for (const s of signals) {
    if (s && s.status === "voting") return s;
  }
  return null;
}

interface ShapeArgs {
  chamber: Chamber;
  status: ChamberStatus["status"];
  detail: string | null;
  source: ChamberStatus["source"];
  lastActionAt: Date | null;
  nextRecess?: CalendarWindow | null;
  nextSession?: Date | null;
  now: Date;
}

function shape(args: ShapeArgs): ChamberStatus {
  // When the chamber is currently between sessions ("in recess" or "done for
  // the day"), the useful transition is "when do they next convene" — not
  // "when's the next recess," which reads as a contradiction ("in recess …
  // next recess tomorrow?"). For in-session / voting states, surface the
  // upcoming recess instead.
  let nextTransitionAt: Date | null = null;
  let nextTransitionLabel: string | null = null;

  const isBetweenSessions =
    args.status === "recess" || args.status === "adjourned_today";
  if (isBetweenSessions && args.nextSession) {
    nextTransitionAt = args.nextSession;
    nextTransitionLabel = `Returns ${formatReturns(args.nextSession, true)}`;
  } else if (args.nextRecess) {
    nextTransitionAt = args.nextRecess.startDate;
    nextTransitionLabel = `Next recess ${formatReturns(args.nextRecess.startDate)} — ${args.nextRecess.label}`;
  }

  return {
    chamber: args.chamber,
    status: args.status,
    detail: args.detail,
    source: args.source,
    lastActionAt: args.lastActionAt,
    nextTransitionAt,
    nextTransitionLabel,
    lastCheckedAt: args.now,
  };
}

function formatReturns(d: Date, withWeekday = false): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...(withWeekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
  }).format(d);
}

function isWeekendInEt(now: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  return weekday === "Sat" || weekday === "Sun";
}

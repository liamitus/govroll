import type { Chamber, StatusCode } from "@/lib/congress-session/types";
import type {
  ChamberStatusPayload,
  CongressStatusResponse,
} from "@/app/api/congress/status/route";

/**
 * Pure resolver for the CongressStatus pill — picks one overall status from
 * the per-chamber rows and decides which chamber's `nextTransitionLabel` to
 * display next to it.
 *
 * Lives in its own module (separate from the React component) so it can be
 * unit-tested in node without pulling in React Query.
 */

// How long a chamber's last successful check is treated as "current". The
// compute-congress-status cron targets every 10 min, but GitHub Actions
// routinely drops/delays high-frequency scheduled runs, so the real cadence is
// closer to 20-30 min and can gap past an hour. Past this window we keep
// showing the last-known status, just marked stale ("as of Xm ago") rather
// than collapsing to "Status unavailable" — that blunt downgrade is reserved
// for genuinely missing data. See freshness() / effectiveStatus().
export const STALENESS_CEILING_MS = 90 * 60 * 1000; // 90 min

export interface Resolved {
  status: StatusCode;
  primaryChamber: Chamber | null;
  nextTransitionLabel: string | null;
  /** Winner's data is older than the ceiling — render it visibly stale. */
  stale: boolean;
  /** Winner's last-checked ISO timestamp, for an "as of Xm ago" label. */
  lastCheckedAt: string | null;
}

export type Freshness = "fresh" | "stale" | "missing";

const PRIORITY: StatusCode[] = [
  "voting",
  "in_session",
  "pro_forma",
  "pre_session",
  "adjourned_today",
  "adjourned_sine_die",
  "recess",
  // `no_session` ranks below `recess`: it's a low-confidence "couldn't
  // confirm a session today" read (a quiet weekday, or the floor log hasn't
  // published). When chambers disagree we'd rather headline the other one's
  // confident named recess than this. It still outranks `unknown` — knowing a
  // chamber has no session today beats knowing nothing.
  "no_session",
  "unknown",
];

/**
 * How much to trust a chamber row right now:
 *   - missing: no payload (cron never populated it) → render as unknown
 *   - stale:   older than the ceiling → show last-known status, marked stale
 *   - fresh:   within the ceiling → show normally
 * An unparseable timestamp is treated as fresh: we can't age it, and the row
 * data is real, so don't punish it.
 */
export function freshness(
  p: ChamberStatusPayload | null | undefined,
  nowMs: number = Date.now(),
): Freshness {
  if (!p) return "missing";
  const last = Date.parse(p.lastCheckedAt);
  if (!Number.isFinite(last)) return "fresh";
  return nowMs - last > STALENESS_CEILING_MS ? "stale" : "fresh";
}

/**
 * The status to display for a chamber. We surface the last-known status even
 * when it's stale (the UI marks staleness separately via freshness()) and only
 * fall back to `unknown` when there's genuinely no data — an honest
 * "Recess · as of 1h ago" beats a blunt "Status unavailable" on data we have.
 */
export function effectiveStatus(
  p: ChamberStatusPayload | null | undefined,
): StatusCode {
  return p ? p.status : "unknown";
}

/**
 * Pick an overall "Congress" state from the per-chamber rows. Priority:
 *   voting > in_session > pro_forma > pre_session > adjourned_today
 *   > adjourned_sine_die > recess > no_session > unknown
 *
 * When chambers tie at the same priority, prefer the one whose
 * `nextTransitionAt` is sooner. For two recessed chambers that's "who
 * comes back first" — important when one chamber is in a multi-week
 * District Work Period and the other is just out for the weekend, since
 * the pill should surface the imminent return rather than the distant one.
 * For two in-session chambers it's "who breaks first," which is similarly
 * the more actionable secondary signal.
 */
export function resolveOverall(
  data: CongressStatusResponse | undefined,
  nowMs: number = Date.now(),
): Resolved {
  const NONE: Resolved = {
    status: "unknown",
    primaryChamber: null,
    nextTransitionLabel: null,
    stale: false,
    lastCheckedAt: null,
  };
  if (!data) return NONE;

  const house = data.chambers.house;
  const senate = data.chambers.senate;

  // A confidently-fresh read outranks a stale one regardless of status, so a
  // stale "voting" can't outshout a fresh "recess". Within the same freshness,
  // higher-priority status wins; the sooner next transition breaks final ties.
  const freshnessRank = (p: ChamberStatusPayload | null): number => {
    const f = freshness(p, nowMs);
    return f === "fresh" ? 0 : f === "stale" ? 1 : 2;
  };
  const statusRank = (p: ChamberStatusPayload | null): number =>
    p ? PRIORITY.indexOf(effectiveStatus(p)) : PRIORITY.length;

  const better = (
    a: ChamberStatusPayload | null,
    b: ChamberStatusPayload | null,
  ): ChamberStatusPayload | null => {
    if (!a) return b;
    if (!b) return a;
    if (freshnessRank(a) !== freshnessRank(b))
      return freshnessRank(a) < freshnessRank(b) ? a : b;
    if (statusRank(a) !== statusRank(b))
      return statusRank(a) < statusRank(b) ? a : b;
    return parseTime(a.nextTransitionAt) <= parseTime(b.nextTransitionAt)
      ? a
      : b;
  };

  const winner = better(house, senate);
  if (!winner) return NONE;

  return {
    status: effectiveStatus(winner),
    primaryChamber: winner.chamber,
    nextTransitionLabel: winner.nextTransitionLabel,
    stale: freshness(winner, nowMs) === "stale",
    lastCheckedAt: winner.lastCheckedAt,
  };
}

export function labelFor(status: StatusCode): string {
  switch (status) {
    case "voting":
      return "Voting";
    case "in_session":
      return "In Session";
    case "pro_forma":
      return "Pro Forma";
    case "pre_session":
      return "Opening soon";
    case "adjourned_today":
      return "Adjourned";
    case "recess":
      return "Recess";
    case "no_session":
      return "No session";
    case "adjourned_sine_die":
      return "Adjourned";
    case "unknown":
      return "Status unavailable";
    default:
      // Unreachable per types, but defends against API/client version skew —
      // when the server starts returning a new status code (e.g. `pre_session`
      // shipped in #66), browsers running a pre-deploy bundle have no case
      // for it and would otherwise return undefined here, crashing the
      // ariaLabelFor `.toLowerCase()` call site (which is rendered in the
      // global NavBar — every page goes down).
      return "Status unavailable";
  }
}

export function chamberHintFor(r: Resolved): string | null {
  if (r.status === "unknown") return null;
  // recess / no_session are "not on the floor today" states the chambers
  // usually share at the headline level; the popover breaks down the per-
  // chamber nuance, so don't crowd the pill with a single-chamber qualifier.
  if (r.status === "recess" || r.status === "no_session") return null;
  if (!r.primaryChamber) return null;
  return r.primaryChamber === "house" ? "House" : "Senate";
}

function parseTime(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

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

// GH Actions cron routinely drifts 20-30 min under load, so the old 30 min
// ceiling fired false "Status unavailable" downgrades. The pill downgrades to
// `unknown` only when data is older than 3× this — see effectiveStatus().
export const STALE_THRESHOLD_MS = 20 * 60 * 1000;

export interface Resolved {
  status: StatusCode;
  primaryChamber: Chamber | null;
  nextTransitionLabel: string | null;
}

const PRIORITY: StatusCode[] = [
  "voting",
  "in_session",
  "pro_forma",
  "adjourned_today",
  "adjourned_sine_die",
  "recess",
  "unknown",
];

/**
 * Downgrade to `unknown` when the stored status is older than our staleness
 * threshold. Matches the research recommendation: never lie green on stale
 * data; always prefer honest "Unknown" over confident-but-wrong.
 */
export function effectiveStatus(
  p: ChamberStatusPayload | null | undefined,
  nowMs: number = Date.now(),
): StatusCode {
  if (!p) return "unknown";
  const last = Date.parse(p.lastCheckedAt);
  if (!Number.isFinite(last)) return p.status;
  const age = nowMs - last;
  if (age > STALE_THRESHOLD_MS * 3) return "unknown"; // 60 min ceiling
  return p.status;
}

/**
 * Pick an overall "Congress" state from the per-chamber rows. Priority:
 *   voting > in_session > pro_forma > adjourned_today > adjourned_sine_die
 *   > recess > unknown
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
  if (!data) {
    return {
      status: "unknown",
      primaryChamber: null,
      nextTransitionLabel: null,
    };
  }
  const house = data.chambers.house;
  const senate = data.chambers.senate;

  const score = (p: ChamberStatusPayload | null) =>
    p ? PRIORITY.indexOf(effectiveStatus(p, nowMs)) : PRIORITY.length;

  const hScore = score(house);
  const sScore = score(senate);

  let winner: ChamberStatusPayload | null;
  if (hScore !== sScore) {
    winner = hScore < sScore ? house : senate;
  } else {
    const hNext = parseTime(house?.nextTransitionAt);
    const sNext = parseTime(senate?.nextTransitionAt);
    winner = hNext <= sNext ? (house ?? senate) : (senate ?? house);
  }

  if (!winner) {
    return {
      status: "unknown",
      primaryChamber: null,
      nextTransitionLabel: null,
    };
  }
  return {
    status: effectiveStatus(winner, nowMs),
    primaryChamber: winner.chamber,
    nextTransitionLabel: winner.nextTransitionLabel,
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
    case "adjourned_today":
      return "Adjourned";
    case "recess":
      return "Recess";
    case "adjourned_sine_die":
      return "Adjourned";
    case "unknown":
      return "Status unavailable";
  }
}

export function chamberHintFor(r: Resolved): string | null {
  if (r.status === "unknown") return null;
  if (r.status === "recess") return null; // both chambers usually recess together at this level
  if (!r.primaryChamber) return null;
  return r.primaryChamber === "house" ? "House" : "Senate";
}

function parseTime(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

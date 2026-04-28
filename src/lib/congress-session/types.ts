/**
 * Shared types for the "Is Congress working right now?" status waterfall.
 *
 * The pipeline is:
 *   signal modules  (clerk-xml, senate-pail, vote-recency, calendar)
 *     → each returns a `Signal | null` for a chamber
 *   compute.ts combines them into a `ChamberStatus` that gets persisted to
 *   CongressChamberStatus and read by the CongressStatus pill.
 */

export type Chamber = "house" | "senate";

export type StatusCode =
  | "voting" // chamber floor active AND recent roll call
  | "in_session" // chamber gaveled in, on floor, no recent vote
  | "pro_forma" // brief procedural meeting with no legislative business
  | "adjourned_today" // chamber gaveled in earlier today, then gaveled out for the day
  | "recess" // scheduled non-session period
  | "adjourned_sine_die" // formal end of Congress (between sessions)
  | "unknown"; // no signal resolved

export type SignalSource =
  | "clerk_xml"
  | "senate_pail"
  | "vote_recency"
  | "calendar"
  | "none";

/**
 * One observation about a chamber's state from a single source. The compute
 * module merges these in waterfall order (live scrapers > vote recency >
 * calendar) into a final `ChamberStatus`.
 *
 * Not every source can produce every status. Calendar can only produce
 * `recess` or null. Vote recency can produce `voting` or `in_session` or
 * null. Scrapers can produce any of the live states.
 */
export interface Signal {
  status: StatusCode;
  /** When the observation's underlying event occurred (not when we fetched). */
  observedAt: Date | null;
  /** Short human-readable detail — e.g. "Roll call vote 18 min ago". */
  detail: string | null;
  source: SignalSource;
}

/**
 * The final resolved state for a chamber, persisted to the DB and served to
 * the frontend.
 */
export interface ChamberStatus {
  chamber: Chamber;
  status: StatusCode;
  detail: string | null;
  source: SignalSource;
  lastActionAt: Date | null;
  nextTransitionAt: Date | null;
  nextTransitionLabel: string | null;
  lastCheckedAt: Date;
}

export const CHAMBERS: readonly Chamber[] = ["house", "senate"] as const;

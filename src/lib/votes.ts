/**
 * GovTrack stores Senate votes as "Yea"/"Nay" and House votes as
 * "Aye"/"No". This module is the single source of truth for treating
 * those equivalently, so a House "No" doesn't accidentally compare as
 * a different position from a Senate "Nay" (or get mis-styled).
 *
 * Anywhere you see a string vote value flowing from `RepresentativeVote.vote`
 * through to a comparison, label, or color, route it through this module.
 *
 * It also owns the GovTrack vote-category vocabulary — what counts as a
 * substantive "passage" vote vs. a procedural step — since that vocabulary
 * shows up in alignment math, in UI labels, and in the AI prompt builder.
 */

export type NormalizedRepVote =
  | "Yes"
  | "No"
  | "Present"
  | "Not Voting"
  | "Unknown";

export type AlignmentStatus = "match" | "mismatch" | "incomparable";

const YES_VALUES = new Set(["Yea", "Aye"]);
const NO_VALUES = new Set(["Nay", "No"]);

export function isYesVote(vote: string | null | undefined): boolean {
  return typeof vote === "string" && YES_VALUES.has(vote);
}

export function isNoVote(vote: string | null | undefined): boolean {
  return typeof vote === "string" && NO_VALUES.has(vote);
}

export function isAbsentVote(vote: string | null | undefined): boolean {
  return vote === "Present" || vote === "Not Voting";
}

/** Map a raw GovTrack rep vote value to a plain-English label. */
export function normalizeRepVote(
  vote: string | null | undefined,
): NormalizedRepVote {
  if (isYesVote(vote)) return "Yes";
  if (isNoVote(vote)) return "No";
  if (vote === "Present") return "Present";
  if (vote === "Not Voting") return "Not Voting";
  return "Unknown";
}

/**
 * Compare a representative's vote (raw GovTrack value: "Yea"/"Nay"/"Aye"/"No"/
 * "Present"/"Not Voting") against a user's vote ("For"/"Against"/"Abstain").
 *
 * Returns "incomparable" when either side has no opinion to compare —
 * the user abstained, or the rep was Present/Not Voting.
 */
export function repAlignsWithUser(
  repVote: string | null | undefined,
  userVote: string | null | undefined,
): AlignmentStatus {
  if (!userVote || userVote === "Abstain") return "incomparable";
  if (isAbsentVote(repVote)) return "incomparable";
  const repYes = isYesVote(repVote);
  const repNo = isNoVote(repVote);
  if (!repYes && !repNo) return "incomparable";
  if (userVote === "For" && repYes) return "match";
  if (userVote === "Against" && repNo) return "match";
  return "mismatch";
}

/**
 * GovTrack vote categories that represent a substantive yea/nay on the
 * bill itself — final passage, passage under suspension of the rules,
 * or a veto override. These are the votes the alignment score weighs;
 * cloture and procedural motions don't count, since a member can vote
 * yes on cloture and no on passage (or vice versa) and the substantive
 * position is the passage vote.
 */
export const PASSAGE_CATEGORIES: ReadonlySet<string> = new Set([
  "passage",
  "passage_suspension",
  "veto_override",
]);

export function isPassageCategory(
  category: string | null | undefined,
): boolean {
  return typeof category === "string" && PASSAGE_CATEGORIES.has(category);
}

/**
 * Short, plain-English label for a GovTrack vote category. Used as the
 * row identity when distinguishing multiple roll calls on the same bill
 * — e.g. a budget bill with a passage vote, a cloture vote, and three
 * amendment votes all show up under the same bill title.
 */
export function voteCategoryLabel(category: string | null | undefined): string {
  switch (category) {
    case "passage":
      return "Final passage";
    case "passage_suspension":
      return "Passage (suspension)";
    case "veto_override":
      return "Veto override";
    case "cloture":
      return "Cloture";
    case "amendment":
      return "Amendment";
    case "procedural":
      return "Procedural";
    case "nomination":
      return "Nomination";
    default:
      return "Vote";
  }
}

export interface RollCallTally {
  yea: number;
  nay: number;
  present: number;
  notVoting: number;
}

/**
 * Bucket a roll call's raw GovTrack vote entries into yea / nay / present /
 * not-voting counts, normalizing the Senate "Yea/Nay" and House "Aye/No"
 * vocabularies through {@link isYesVote}/{@link isNoVote}. Centralizing this
 * here keeps the Aye≡Yea equivalence in one place rather than re-deriving
 * `getCount("Yea") + getCount("Aye")` at every call site.
 */
export function tallyRollCall(
  votes: { vote: string; count: number }[],
): RollCallTally {
  const tally: RollCallTally = { yea: 0, nay: 0, present: 0, notVoting: 0 };
  for (const { vote, count } of votes) {
    if (isYesVote(vote)) tally.yea += count;
    else if (isNoVote(vote)) tally.nay += count;
    else if (vote === "Present") tally.present += count;
    else if (vote === "Not Voting") tally.notVoting += count;
  }
  return tally;
}

/**
 * A resolved verdict means we know the motion's threshold and can say
 * whether it carried. `raw` means we deliberately decline to: the bar is
 * ambiguous or the vote isn't a verdict on the bill, so the UI should show
 * the bare tally instead of risking a wrong "Passed"/"Failed".
 */
export type RollCallOutcome =
  | { kind: "verdict"; result: "Passed" | "Failed" | "Tied" }
  | { kind: "raw" };

/**
 * Decide how to describe a roll call's outcome from its GovTrack category
 * and tally. Different motions clear at different bars, so the bare
 * `yea > nay` heuristic the vote card used mislabels a 55-45 failed cloture
 * (needs 60) or a 250-180 failed suspension (needs 2/3) as "Passed":
 *
 * - `passage`: simple majority of those voting (yea > nay), with ties noted.
 * - `passage_suspension`, `veto_override`: two-thirds of those voting —
 *   yea must be at least twice the nays.
 * - `cloture`: three-fifths of the chamber's sworn membership (Senate Rule
 *   XXII — a fixed ~60 in a full Senate, not 3/5 of turnout). We approximate
 *   the sworn membership as every recorded position (yea/nay/present/not
 *   voting), so 3/5 of that total lands at ~60.
 *
 * Everything else — amendments, procedural motions, nominations, or an
 * unknown/missing category (e.g. a not-yet-backfilled roll call) — returns
 * `{ kind: "raw" }`. GovTrack gives no motion text and the threshold can't
 * be assumed, so claiming pass/fail would overclaim.
 */
export function rollCallOutcome(
  category: string | null | undefined,
  tally: RollCallTally,
): RollCallOutcome {
  const { yea, nay, present, notVoting } = tally;

  switch (category) {
    case "passage": {
      if (yea > nay) return { kind: "verdict", result: "Passed" };
      if (nay > yea) return { kind: "verdict", result: "Failed" };
      return { kind: "verdict", result: "Tied" };
    }
    case "passage_suspension":
    case "veto_override": {
      // Two-thirds of those voting: yea/(yea+nay) >= 2/3  ⟺  yea >= 2*nay.
      const passed = yea > 0 && yea >= 2 * nay;
      return { kind: "verdict", result: passed ? "Passed" : "Failed" };
    }
    case "cloture": {
      // Three-fifths of all recorded positions ≈ 3/5 of the sworn chamber.
      const chamber = yea + nay + present + notVoting;
      const passed = chamber > 0 && yea * 5 >= chamber * 3;
      return { kind: "verdict", result: passed ? "Passed" : "Failed" };
    }
    default:
      return { kind: "raw" };
  }
}

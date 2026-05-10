/**
 * GovTrack stores Senate votes as "Yea"/"Nay" and House votes as
 * "Aye"/"No". This module is the single source of truth for treating
 * those equivalently, so a House "No" doesn't accidentally compare as
 * a different position from a Senate "Nay" (or get mis-styled).
 *
 * Anywhere you see a string vote value flowing from `RepresentativeVote.vote`
 * through to a comparison, label, or color, route it through this module.
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

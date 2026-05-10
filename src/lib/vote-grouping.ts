/**
 * Group a representative's flat list of roll-call votes by bill, and
 * pick a single "primary" vote per bill — the one that best represents
 * the rep's substantive position. Same bill produces multiple roll calls
 * (motion to proceed, cloture, amendments, final passage); rendering each
 * as its own row creates the "10 duplicate-titled rows for one budget bill"
 * problem, and naive alignment math overweights bills with many roll calls.
 *
 * Precedence for primary-vote selection:
 *   1. A passage-category vote (passage / passage_suspension / veto_override)
 *      with a Yes-equivalent or No-equivalent value. This is the substantive
 *      position on the bill itself.
 *   2. The most recent passage-category vote regardless of value
 *      (covers Present / Not Voting on final passage).
 *   3. The most recent vote in any category — fallback when the bill has
 *      only seen procedural roll calls so far.
 *
 * This module is the single source of truth for "what does the rep think
 * about this bill" so the alignment score and the voting-record feed
 * agree on the answer.
 */

import type { RepVoteRecord } from "@/types";
import {
  isPassageCategory,
  isYesVote,
  isNoVote,
  repAlignsWithUser,
  type AlignmentStatus,
} from "@/lib/votes";

export interface BillVoteGroup {
  /** First record's bill metadata — same across the group. */
  billId: number;
  billSlug: string;
  title: string;
  link: string;
  billStatus: string | undefined;
  /** All roll calls the rep cast on this bill, sorted by votedAt desc.
   *  Falls back to bill.date for legacy rows without votedAt. */
  votes: RepVoteRecord[];
  /** Vote that best represents the rep's substantive position. */
  primary: RepVoteRecord;
  /** True when the rep cast votes on opposite sides across stages of
   *  the same bill (e.g. yes on cloture, no on passage). Worth surfacing
   *  in the UI because it usually signals a deliberate procedural stance. */
  hasMixedStances: boolean;
  /** Alignment of the user's bill-level vote against the primary vote. */
  alignment: AlignmentStatus;
  /** The user's vote on this bill (For/Against/Abstain), if any. */
  userVote: string | undefined;
}

function compareByVotedAtDesc(a: RepVoteRecord, b: RepVoteRecord): number {
  const at = a.votedAt ?? a.date;
  const bt = b.votedAt ?? b.date;
  return bt.localeCompare(at);
}

export function pickPrimaryVote(votes: RepVoteRecord[]): RepVoteRecord {
  if (votes.length === 0) {
    throw new Error("pickPrimaryVote called with empty list");
  }
  const sorted = [...votes].sort(compareByVotedAtDesc);

  const passageWithStance = sorted.find(
    (v) =>
      isPassageCategory(v.category) &&
      (isYesVote(v.repVote) || isNoVote(v.repVote)),
  );
  if (passageWithStance) return passageWithStance;

  const anyPassage = sorted.find((v) => isPassageCategory(v.category));
  if (anyPassage) return anyPassage;

  return sorted[0];
}

function detectMixedStances(votes: RepVoteRecord[]): boolean {
  let sawYes = false;
  let sawNo = false;
  for (const v of votes) {
    if (isYesVote(v.repVote)) sawYes = true;
    else if (isNoVote(v.repVote)) sawNo = true;
    if (sawYes && sawNo) return true;
  }
  return false;
}

export function groupVotesByBill(
  records: RepVoteRecord[],
  userVotes: Record<number, string> | null | undefined,
): BillVoteGroup[] {
  const byBill = new Map<number, RepVoteRecord[]>();
  for (const r of records) {
    const bucket = byBill.get(r.billId);
    if (bucket) bucket.push(r);
    else byBill.set(r.billId, [r]);
  }

  const groups: BillVoteGroup[] = [];
  for (const [billId, votes] of byBill) {
    const sortedVotes = [...votes].sort(compareByVotedAtDesc);
    const primary = pickPrimaryVote(sortedVotes);
    const userVote = userVotes ? userVotes[billId] : undefined;
    groups.push({
      billId,
      billSlug: primary.billSlug,
      title: primary.title,
      link: primary.link,
      billStatus: primary.billStatus,
      votes: sortedVotes,
      primary,
      hasMixedStances: detectMixedStances(sortedVotes),
      alignment: repAlignsWithUser(primary.repVote, userVote),
      userVote,
    });
  }

  // Sort groups by their primary vote's date, most recent first.
  groups.sort((a, b) => compareByVotedAtDesc(a.primary, b.primary));
  return groups;
}

/**
 * Compute the user's alignment with the rep at the bill level: each
 * bill the user has voted on contributes one data point, regardless of
 * how many roll calls the rep took on that bill. This prevents a budget
 * bill with 8 procedural roll calls from outweighing a single landmark
 * passage vote in the score.
 */
export function computeBillAlignment(
  records: RepVoteRecord[],
  userVotes: Record<number, string> | null | undefined,
): { aligned: number; comparable: number; pct: number | null } {
  if (!userVotes) return { aligned: 0, comparable: 0, pct: null };
  const groups = groupVotesByBill(records, userVotes);
  let aligned = 0;
  let comparable = 0;
  for (const g of groups) {
    if (g.alignment === "incomparable") continue;
    comparable++;
    if (g.alignment === "match") aligned++;
  }
  return {
    aligned,
    comparable,
    pct: comparable > 0 ? Math.round((aligned / comparable) * 100) : null,
  };
}

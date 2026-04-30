/**
 * Per-chamber passage summary for a bill.
 *
 * Congress doesn't record individual votes for voice votes, unanimous
 * consent, or suspension-of-the-rules passages that are agreed to by voice.
 * The majority of enacted bills (naming bills, technical fixes, ceremonial
 * resolutions) pass this way — so "no votes from your reps" is usually a
 * procedural fact about Congress, not about the reps.
 *
 * We infer this signal from what's already in our DB: for each chamber we
 * know the bill reached, do we have any RepresentativeVote rows? If yes, a
 * roll call happened. If no, the chamber agreed by a method that didn't
 * produce individual records.
 *
 * A chamber can also be `rejected` — it voted on the bill (or on a key
 * procedural step like cloture or suspension of the rules) and the bill
 * didn't advance. That's distinct from `pending` (chamber hasn't acted)
 * and the UI needs the difference to avoid claiming "hasn't voted yet"
 * when reps are actually on record voting against the bill.
 */
export type ChamberName = "house" | "senate";

export type ChamberPassageStatus =
  | "passed_with_rollcall"
  | "passed_without_rollcall"
  | "rejected"
  | "pending";

/**
 * Why a chamber rejected the bill. The reasons map to materially
 * different parliamentary situations and the UI surfaces different
 * copy for each.
 *
 * - `passage`: chamber voted directly on the bill (or on suspension
 *   passing the bill — `passage_suspension` category) and a majority
 *   voted no.
 * - `cloture`: Senate only. Cloture motion to end debate failed to
 *   reach 60 votes; the bill is filibustered and stuck unless
 *   cloture succeeds in a later attempt.
 * - `suspension`: House only. Suspension of the rules (a fast-track
 *   procedure that requires 2/3) failed; the bill could come back
 *   under regular order.
 */
export type RejectionReason = "passage" | "cloture" | "suspension";

export interface ChamberPassage {
  chamber: ChamberName;
  status: ChamberPassageStatus;
  /** How many passage-type roll calls we have for this chamber. */
  passageRollCallCount: number;
  /** How many procedural/amendment/cloture roll calls we have. These
   * aren't passage, but serve as accountability signals when final
   * passage was by voice / UC. */
  proceduralRollCallCount: number;
  /** Only set when status === "rejected". Tells the UI which
   * parliamentary situation produced the rejection. */
  rejectionReason?: RejectionReason;
}

export interface BillStatusInput {
  billType: string;
  currentStatus: string;
}

export interface ChamberRollCalls {
  passage: number;
  procedural: number;
}

export interface RollCallCounts {
  house: ChamberRollCalls;
  senate: ChamberRollCalls;
}

const BOTH_CHAMBERS_PASSED_STATUSES = new Set([
  "passed_bill",
  "pass_back_house",
  "pass_back_senate",
  // Concurrent resolutions (sconres / hconres) require agreement in both
  // chambers. They don't go to the President, so they never reach
  // `enacted_*` — `passed_concurrentres` is the terminal "passed" state.
  "passed_concurrentres",
]);

function bothChambersPassed(currentStatus: string): boolean {
  return (
    currentStatus.startsWith("enacted_") ||
    currentStatus.startsWith("vetoed") ||
    currentStatus.startsWith("prov_kill_veto") ||
    currentStatus.startsWith("conference_") ||
    BOTH_CHAMBERS_PASSED_STATUSES.has(currentStatus)
  );
}

function originChamber(billType: string): ChamberName | null {
  if (billType.startsWith("house")) return "house";
  if (billType.startsWith("senate")) return "senate";
  return null;
}

/**
 * If `chamber` rejected the bill, return the reason. Otherwise null.
 *
 * Rejections we recognize:
 * - `fail_originating_house|senate`: chamber that introduced the bill
 *   voted on passage and lost. Only the named chamber rejected.
 * - `fail_second_house|senate`: bill cleared its origin chamber, then
 *   the second chamber voted on passage and lost. Only the named
 *   chamber rejected (origin already passed).
 * - `prov_kill_cloturefailed`: Senate cloture failed. Always Senate
 *   regardless of bill origin.
 * - `prov_kill_suspensionfailed`: House suspension-of-the-rules failed.
 *   Always House regardless of bill origin.
 *
 * Note: this function reports per-chamber rejection, not bill-level
 * disposition. A house_bill with cloture failed has the House passing
 * AND the Senate rejecting — both are real signals.
 */
function chamberRejection(
  chamber: ChamberName,
  bill: BillStatusInput,
): RejectionReason | null {
  switch (bill.currentStatus) {
    case "fail_originating_house":
    case "fail_second_house":
      return chamber === "house" ? "passage" : null;
    case "fail_originating_senate":
    case "fail_second_senate":
      return chamber === "senate" ? "passage" : null;
    case "prov_kill_cloturefailed":
      return chamber === "senate" ? "cloture" : null;
    case "prov_kill_suspensionfailed":
      return chamber === "house" ? "suspension" : null;
    default:
      return null;
  }
}

function chamberHasPassed(
  chamber: ChamberName,
  bill: BillStatusInput,
): boolean {
  if (bothChambersPassed(bill.currentStatus)) return true;

  const origin = originChamber(bill.billType);

  if (origin === chamber) {
    // Origin chamber passes before it can cross over.
    // `passed_simpleres` is the terminal state for simple resolutions
    // (sres / hres) — they're agreed to in the origin chamber and never
    // cross over to the other chamber.
    if (
      bill.currentStatus === "passed_house" ||
      bill.currentStatus === "pass_over_house" ||
      bill.currentStatus === "passed_senate" ||
      bill.currentStatus === "pass_over_senate" ||
      bill.currentStatus === "passed_simpleres"
    ) {
      return true;
    }
    // Bill cleared origin, then died in the second chamber. Origin
    // still passed and the user's reps in origin should see their
    // passage roll call.
    if (
      bill.currentStatus === "fail_second_house" ||
      bill.currentStatus === "fail_second_senate"
    ) {
      return true;
    }
    // Cross-chamber procedural kills: cloture is Senate-only and
    // suspension is House-only. If origin is the OTHER chamber, the
    // bill cleared origin first, then died in the procedure-owning
    // chamber — origin passed.
    if (bill.currentStatus === "prov_kill_cloturefailed" && chamber === "house")
      return true;
    if (
      bill.currentStatus === "prov_kill_suspensionfailed" &&
      chamber === "senate"
    )
      return true;
    return false;
  }

  // Non-origin chamber passes only if the bill crossed over and was
  // agreed there. Failure statuses (`fail_*`, `prov_kill_*`) are
  // handled by `chamberRejection`, not here.
  if (chamber === "senate") {
    return (
      bill.currentStatus === "passed_senate" ||
      bill.currentStatus === "pass_over_senate"
    );
  }
  if (chamber === "house") {
    return (
      bill.currentStatus === "passed_house" ||
      bill.currentStatus === "pass_over_house"
    );
  }
  return false;
}

/**
 * Whether this chamber is relevant to the bill at all — i.e. the bill
 * originates there, has reached it (via crossover or both-chamber
 * passage), or was rejected by it. Used to decide whether to surface
 * context notes / rep rows for senators when the bill is House-only
 * (for example).
 */
export function chamberIsRelevant(
  chamber: ChamberName,
  bill: BillStatusInput,
): boolean {
  const origin = originChamber(bill.billType);
  if (origin === chamber) return true;
  if (bothChambersPassed(bill.currentStatus)) return true;
  // Non-origin chamber that rejected the bill (failed second-chamber
  // passage, or owns the failed procedural step like Senate cloture or
  // House suspension) is still relevant — its reps voted on the bill.
  if (chamberRejection(chamber, bill) !== null) return true;
  // Non-origin chamber became relevant via crossover. The bill may be
  // pending there but its reps will have to act, so we surface the
  // chamber even before any vote.
  if (chamber === "senate") {
    return (
      bill.currentStatus === "passed_house" ||
      bill.currentStatus === "pass_over_house" ||
      bill.currentStatus === "passed_senate" ||
      bill.currentStatus === "pass_over_senate"
    );
  }
  if (chamber === "house") {
    return (
      bill.currentStatus === "passed_senate" ||
      bill.currentStatus === "pass_over_senate" ||
      bill.currentStatus === "passed_house" ||
      bill.currentStatus === "pass_over_house"
    );
  }
  return false;
}

/**
 * Compute per-chamber passage status. Returns only chambers that are
 * relevant to the bill (i.e. origin, reached, or rejected).
 *
 * Status precedence per chamber:
 *   passed_* > rejected > pending
 * A chamber can't simultaneously have passed and rejected the bill
 * for a given currentStatus, so the precedence is just defensive.
 */
export function summarizeChamberPassage(
  bill: BillStatusInput,
  rollCalls: RollCallCounts,
): ChamberPassage[] {
  const chambers: ChamberName[] = ["house", "senate"];
  const results: ChamberPassage[] = [];

  for (const chamber of chambers) {
    if (!chamberIsRelevant(chamber, bill)) continue;

    const { passage, procedural } = rollCalls[chamber];

    if (chamberHasPassed(chamber, bill)) {
      // Only a passage-category roll call proves the chamber recorded
      // names on final disposition. Procedural roll calls (motion to
      // suspend, motion to recommit, cloture) happen even when the
      // final disposition itself was by voice / unanimous consent.
      results.push({
        chamber,
        status:
          passage > 0 ? "passed_with_rollcall" : "passed_without_rollcall",
        passageRollCallCount: passage,
        proceduralRollCallCount: procedural,
      });
      continue;
    }

    const rejection = chamberRejection(chamber, bill);
    if (rejection !== null) {
      results.push({
        chamber,
        status: "rejected",
        passageRollCallCount: passage,
        proceduralRollCallCount: procedural,
        rejectionReason: rejection,
      });
      continue;
    }

    // Pending: chamber hasn't acted on passage yet. May still have
    // procedural roll calls (motion to discharge, motion to proceed,
    // etc.) that signal where reps stand.
    results.push({
      chamber,
      status: "pending",
      passageRollCallCount: 0,
      proceduralRollCallCount: procedural,
    });
  }

  return results;
}

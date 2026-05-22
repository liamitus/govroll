import type { CongressAction } from "./congress-api";

/**
 * Derive an accurate bill status from congress.gov actions.
 *
 * GovTrack sometimes reports stale or premature statuses:
 *   - `introduced` / `reported` long after a chamber actually passed
 *     the bill on the floor (the Farm Bill May 2026 case)
 *   - `passed_bill` prematurely when both chambers passed different
 *     text and the bill is in reconciliation
 *
 * Congress.gov actions reveal the actual state. Returns a corrected
 * status string when GovTrack's status is wrong, or null when it
 * looks fine.
 *
 * Extracted from src/scripts/fetch-bill-actions.ts so both the manual
 * script and the cron route can share the same logic — previously
 * only `/api/admin` could invoke this, which is how 24 bills with
 * recorded passage roll calls ended up stuck at `reported` in prod.
 */
export function reconcileStatus(
  govtrackStatus: string,
  billType: string,
  actions: CongressAction[],
): string | null {
  // Enacted bills are authoritative — congress.gov would show the signing.
  if (govtrackStatus.startsWith("enacted_")) return null;

  // Sort actions newest-first (congress.gov usually returns them this way,
  // but let's be safe).
  const sorted = [...actions].sort(
    (a, b) =>
      new Date(b.actionDate).getTime() - new Date(a.actionDate).getTime(),
  );

  const originIsHouse = billType.startsWith("house");
  const originChamber = originIsHouse ? "House" : "Senate";
  const otherChamber = originIsHouse ? "Senate" : "House";

  // Find key milestone actions.
  const passedOrigin = sorted.find(
    (a) =>
      a.chamber === originChamber &&
      /passed|agreed/i.test(a.text) &&
      a.type === "Floor",
  );
  const passedOther = sorted.find(
    (a) =>
      a.chamber === otherChamber &&
      /passed|agreed/i.test(a.text) &&
      a.type === "Floor",
  );
  const becameLaw = sorted.find((a) =>
    /became public law|signed by president/i.test(a.text),
  );
  const sentBack = sorted.find(
    (a) =>
      /message on (house|senate) action received/i.test(a.text) &&
      /amendment/i.test(a.text),
  );
  const latestAction = sorted[0];

  // If it became law, trust that.
  if (becameLaw) return null; // GovTrack's enacted status is fine.

  // GovTrack says passed_bill but there's evidence the bill was sent back
  // with amendments and the receiving chamber is still deliberating.
  if (govtrackStatus === "passed_bill" && sentBack) {
    const sentBackDate = new Date(sentBack.actionDate).getTime();
    const secondPassDate = passedOther
      ? new Date(passedOther.actionDate).getTime()
      : 0;

    if (sentBackDate >= secondPassDate) {
      // Bill sent back after the other chamber passed it with amendments.
      // Determine which chamber sent it back.
      if (/house action/i.test(sentBack.text)) {
        return "pass_back_house";
      }
      if (/senate action/i.test(sentBack.text)) {
        return "pass_back_senate";
      }
    }
  }

  // GovTrack says passed_bill but latest actions show ongoing deliberation
  // in one chamber (cloture motions, motions to table, etc.).
  if (govtrackStatus === "passed_bill" && latestAction) {
    const latestDate = new Date(latestAction.actionDate).getTime();
    const govtrackPassDate = passedOther
      ? new Date(passedOther.actionDate).getTime()
      : 0;

    if (latestDate > govtrackPassDate && latestAction.chamber) {
      const isDeliberation =
        /considered|cloture|motion to table|motion to refer|motion to concur/i.test(
          latestAction.text,
        );
      if (isDeliberation) {
        if (latestAction.chamber === "House") return "pass_back_house";
        if (latestAction.chamber === "Senate") return "pass_back_senate";
      }
    }
  }

  // GovTrack says introduced or reported but congress.gov shows the bill
  // passed a chamber. This is the most common staleness case (Farm Bill).
  if (govtrackStatus === "introduced" || govtrackStatus === "reported") {
    if (passedOrigin && passedOther) return "passed_bill";
    if (passedOrigin) {
      return originIsHouse ? "pass_over_house" : "pass_over_senate";
    }
  }

  // GovTrack says the bill cleared its origin chamber but congress.gov
  // shows the second chamber has also passed it. Lift to `passed_bill`
  // so the bill page surfaces both chambers as passed.
  if (
    (govtrackStatus === "pass_over_house" ||
      govtrackStatus === "pass_over_senate") &&
    passedOrigin &&
    passedOther
  ) {
    return "passed_bill";
  }

  return null; // GovTrack status looks fine.
}

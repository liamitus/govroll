import type { ChamberPassageInfo } from "@/types";

/**
 * Whether the two-chamber "Your Representatives" UI should collapse
 * its per-chamber voice-vote notices into a single shared notice.
 *
 * The status `passed_without_rollcall` only means *passage itself*
 * wasn't a recorded roll call — a chamber can still have procedural
 * roll calls (cloture, motion to recommit, motion to discharge, etc.).
 * If either chamber recorded any procedural votes, we keep per-chamber
 * notices: the procedural caveat needs to attach to the correct
 * chamber, and the rep cards underneath are themselves split per-
 * chamber. Collapsing in that case would print "Both chambers passed
 * without a recorded roll call" while displaying recorded votes right
 * below it — confusing and false on its face.
 */
export function shouldCombineVoiceVoteNotice(
  housePassage: ChamberPassageInfo | undefined,
  senatePassage: ChamberPassageInfo | undefined,
): boolean {
  if (!housePassage || !senatePassage) return false;
  if (
    housePassage.status !== "passed_without_rollcall" ||
    senatePassage.status !== "passed_without_rollcall"
  ) {
    return false;
  }
  return (
    housePassage.proceduralRollCallCount === 0 &&
    senatePassage.proceduralRollCallCount === 0
  );
}

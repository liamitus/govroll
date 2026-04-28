import { describe, it, expect } from "vitest";
import { shouldCombineVoiceVoteNotice } from "@/lib/representatives-display";
import type { ChamberPassageInfo } from "@/types";

const voiceVote = (
  chamber: "house" | "senate",
  proceduralRollCallCount = 0,
): ChamberPassageInfo => ({
  chamber,
  status: "passed_without_rollcall",
  passageRollCallCount: 0,
  proceduralRollCallCount,
});

const rollCallPassage = (chamber: "house" | "senate"): ChamberPassageInfo => ({
  chamber,
  status: "passed_with_rollcall",
  passageRollCallCount: 1,
  proceduralRollCallCount: 0,
});

const pending = (chamber: "house" | "senate"): ChamberPassageInfo => ({
  chamber,
  status: "pending",
  passageRollCallCount: 0,
  proceduralRollCallCount: 0,
});

describe("shouldCombineVoiceVoteNotice", () => {
  it("combines when both chambers passed by voice/UC with no procedural votes", () => {
    expect(
      shouldCombineVoiceVoteNotice(voiceVote("house"), voiceVote("senate")),
    ).toBe(true);
  });

  // Regression: a senate procedural roll call (e.g. Schumer/Gillibrand
  // voting "No on a procedural step") was triggering the combined "Both
  // chambers passed without a recorded roll call" notice. The senate
  // clearly DID record votes — just not on passage. Per-chamber notices
  // are needed so the procedural caveat ("Procedural votes during
  // consideration were recorded — those are shown below.") attaches to
  // the correct chamber and reads truthfully.
  it("does NOT combine when only the senate has procedural votes", () => {
    expect(
      shouldCombineVoiceVoteNotice(
        voiceVote("house", 0),
        voiceVote("senate", 1),
      ),
    ).toBe(false);
  });

  it("does NOT combine when only the house has procedural votes", () => {
    expect(
      shouldCombineVoiceVoteNotice(
        voiceVote("house", 1),
        voiceVote("senate", 0),
      ),
    ).toBe(false);
  });

  it("does NOT combine when both chambers have procedural votes (per-chamber rep cards diverge)", () => {
    expect(
      shouldCombineVoiceVoteNotice(
        voiceVote("house", 1),
        voiceVote("senate", 2),
      ),
    ).toBe(false);
  });

  it("does NOT combine when one chamber passed with a roll call", () => {
    expect(
      shouldCombineVoiceVoteNotice(
        rollCallPassage("house"),
        voiceVote("senate"),
      ),
    ).toBe(false);
    expect(
      shouldCombineVoiceVoteNotice(
        voiceVote("house"),
        rollCallPassage("senate"),
      ),
    ).toBe(false);
  });

  it("does NOT combine when either chamber is pending", () => {
    expect(
      shouldCombineVoiceVoteNotice(pending("house"), voiceVote("senate")),
    ).toBe(false);
    expect(
      shouldCombineVoiceVoteNotice(voiceVote("house"), pending("senate")),
    ).toBe(false);
  });

  it("does NOT combine when either chamber's passage info is missing", () => {
    expect(shouldCombineVoiceVoteNotice(undefined, voiceVote("senate"))).toBe(
      false,
    );
    expect(shouldCombineVoiceVoteNotice(voiceVote("house"), undefined)).toBe(
      false,
    );
    expect(shouldCombineVoiceVoteNotice(undefined, undefined)).toBe(false);
  });
});

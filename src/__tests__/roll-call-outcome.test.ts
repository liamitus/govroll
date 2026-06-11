/**
 * The roll-call vote card used to label any roll call where yea > nay as
 * "Passed". That's a factual error for motions that clear at a higher bar:
 * a 55-45 cloture (needs 60) or a 250-180 suspension (needs 2/3) both FAILED
 * but rendered as "Passed NN-NN". These tests pin the threshold logic that
 * fixes it — failed cloture/suspension must not read as Passed.
 */
import { describe, it, expect } from "vitest";
import { tallyRollCall, rollCallOutcome } from "@/lib/votes";

describe("tallyRollCall", () => {
  it("treats House Aye/No as equivalent to Senate Yea/Nay", () => {
    expect(
      tallyRollCall([
        { vote: "Aye", count: 230 },
        { vote: "No", count: 200 },
      ]),
    ).toEqual({ yea: 230, nay: 200, present: 0, notVoting: 0 });

    expect(
      tallyRollCall([
        { vote: "Yea", count: 55 },
        { vote: "Nay", count: 45 },
      ]),
    ).toEqual({ yea: 55, nay: 45, present: 0, notVoting: 0 });
  });

  it("buckets Present and Not Voting separately", () => {
    expect(
      tallyRollCall([
        { vote: "Yea", count: 52 },
        { vote: "Nay", count: 44 },
        { vote: "Present", count: 1 },
        { vote: "Not Voting", count: 3 },
      ]),
    ).toEqual({ yea: 52, nay: 44, present: 1, notVoting: 3 });
  });
});

describe("rollCallOutcome", () => {
  const tally = (yea: number, nay: number, present = 0, notVoting = 0) => ({
    yea,
    nay,
    present,
    notVoting,
  });

  describe("cloture (three-fifths of the chamber, ~60)", () => {
    it("a 55-45 cloture FAILED — must not read as Passed", () => {
      const outcome = rollCallOutcome("cloture", tally(55, 45));
      expect(outcome).toEqual({ kind: "verdict", result: "Failed" });
      expect(outcome).not.toEqual({ kind: "verdict", result: "Passed" });
    });

    it("a 59-41 cloture still FAILED (one short of 60)", () => {
      expect(rollCallOutcome("cloture", tally(59, 41))).toEqual({
        kind: "verdict",
        result: "Failed",
      });
    });

    it("a 60-40 cloture cleared the 3/5 bar", () => {
      expect(rollCallOutcome("cloture", tally(60, 40))).toEqual({
        kind: "verdict",
        result: "Passed",
      });
    });

    it("counts present/not-voting toward the sworn-membership denominator", () => {
      // 55 yea out of 100 recorded positions is still short of 60, even
      // though only 90 cast a yea/nay.
      expect(rollCallOutcome("cloture", tally(55, 35, 2, 8))).toEqual({
        kind: "verdict",
        result: "Failed",
      });
    });
  });

  describe("suspension / veto override (two-thirds of those voting)", () => {
    it("a 250-180 suspension FAILED — must not read as Passed", () => {
      const outcome = rollCallOutcome("passage_suspension", tally(250, 180));
      expect(outcome).toEqual({ kind: "verdict", result: "Failed" });
      expect(outcome).not.toEqual({ kind: "verdict", result: "Passed" });
    });

    it("a 290-140 suspension cleared two-thirds", () => {
      expect(rollCallOutcome("passage_suspension", tally(290, 140))).toEqual({
        kind: "verdict",
        result: "Passed",
      });
    });

    it("exactly two-thirds passes (286-143)", () => {
      expect(rollCallOutcome("passage_suspension", tally(286, 143))).toEqual({
        kind: "verdict",
        result: "Passed",
      });
    });

    it("a veto override uses the same two-thirds bar", () => {
      expect(rollCallOutcome("veto_override", tally(250, 180))).toEqual({
        kind: "verdict",
        result: "Failed",
      });
      expect(rollCallOutcome("veto_override", tally(290, 140))).toEqual({
        kind: "verdict",
        result: "Passed",
      });
    });
  });

  describe("ordinary passage (simple majority)", () => {
    it("yea > nay passes", () => {
      expect(rollCallOutcome("passage", tally(220, 210))).toEqual({
        kind: "verdict",
        result: "Passed",
      });
    });

    it("nay > yea fails", () => {
      expect(rollCallOutcome("passage", tally(210, 220))).toEqual({
        kind: "verdict",
        result: "Failed",
      });
    });

    it("a tie is reported as Tied, not Passed", () => {
      expect(rollCallOutcome("passage", tally(215, 215))).toEqual({
        kind: "verdict",
        result: "Tied",
      });
    });
  });

  describe("ambiguous / non-passage motions are not given a verdict", () => {
    it.each(["amendment", "procedural", "nomination", null, undefined])(
      "category %s suppresses any pass/fail claim",
      (category) => {
        expect(rollCallOutcome(category, tally(230, 200))).toEqual({
          kind: "raw",
        });
      },
    );
  });
});

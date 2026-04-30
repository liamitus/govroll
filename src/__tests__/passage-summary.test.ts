import { describe, it, expect } from "vitest";
import {
  summarizeChamberPassage,
  chamberIsRelevant,
} from "@/lib/passage-summary";

const zero = {
  house: { passage: 0, procedural: 0 },
  senate: { passage: 0, procedural: 0 },
};

describe("summarizeChamberPassage", () => {
  it("enacted bill with no roll calls in either chamber = voice/UC both sides", () => {
    const out = summarizeChamberPassage(
      { billType: "house_bill", currentStatus: "enacted_signed" },
      zero,
    );
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.chamber === "house")?.status).toBe(
      "passed_without_rollcall",
    );
    expect(out.find((c) => c.chamber === "senate")?.status).toBe(
      "passed_without_rollcall",
    );
  });

  it("enacted bill with House passage roll call only = Senate passed by voice/UC", () => {
    const out = summarizeChamberPassage(
      { billType: "house_bill", currentStatus: "enacted_signed" },
      {
        house: { passage: 1, procedural: 0 },
        senate: { passage: 0, procedural: 0 },
      },
    );
    expect(out.find((c) => c.chamber === "house")?.status).toBe(
      "passed_with_rollcall",
    );
    expect(out.find((c) => c.chamber === "senate")?.status).toBe(
      "passed_without_rollcall",
    );
  });

  it("procedural-only roll calls do NOT classify a chamber as passed_with_rollcall", () => {
    // Motion to recommit was a recorded vote, but passage itself was voice.
    const out = summarizeChamberPassage(
      { billType: "house_bill", currentStatus: "enacted_signed" },
      {
        house: { passage: 0, procedural: 1 },
        senate: { passage: 0, procedural: 0 },
      },
    );
    const house = out.find((c) => c.chamber === "house");
    expect(house?.status).toBe("passed_without_rollcall");
    expect(house?.proceduralRollCallCount).toBe(1);
  });

  it("bill passed House only, Senate pending", () => {
    const out = summarizeChamberPassage(
      { billType: "house_bill", currentStatus: "pass_over_house" },
      {
        house: { passage: 1, procedural: 0 },
        senate: { passage: 0, procedural: 0 },
      },
    );
    expect(out.find((c) => c.chamber === "house")?.status).toBe(
      "passed_with_rollcall",
    );
    expect(out.find((c) => c.chamber === "senate")?.status).toBe("pending");
  });

  it("vetoed bill — both chambers passed", () => {
    const out = summarizeChamberPassage(
      { billType: "house_bill", currentStatus: "vetoed_pocket" },
      {
        house: { passage: 1, procedural: 0 },
        senate: { passage: 1, procedural: 0 },
      },
    );
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.status === "passed_with_rollcall")).toBe(true);
  });

  it("conference-committee status still surfaces both chambers", () => {
    const out = summarizeChamberPassage(
      { billType: "senate_bill", currentStatus: "conference_sent" },
      {
        house: { passage: 0, procedural: 0 },
        senate: { passage: 1, procedural: 0 },
      },
    );
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.chamber === "house")?.status).toBe(
      "passed_without_rollcall",
    );
  });

  it("pending chamber preserves procedural roll call count", () => {
    // S.J.Res. 32 style: still "introduced" but a motion to discharge
    // has already been voted on. The procedural count must not be
    // zeroed out — the UI uses it to surface per-rep procedural votes.
    const out = summarizeChamberPassage(
      { billType: "senate_joint_resolution", currentStatus: "introduced" },
      {
        house: { passage: 0, procedural: 0 },
        senate: { passage: 0, procedural: 1 },
      },
    );
    const senate = out.find((c) => c.chamber === "senate");
    expect(senate?.status).toBe("pending");
    expect(senate?.proceduralRollCallCount).toBe(1);
    expect(senate?.passageRollCallCount).toBe(0);
  });

  it("introduced bill — origin chamber relevant but pending", () => {
    const out = summarizeChamberPassage(
      { billType: "house_bill", currentStatus: "introduced" },
      zero,
    );
    expect(out.find((c) => c.chamber === "house")?.status).toBe("pending");
    // Senate is not relevant yet
    expect(out.find((c) => c.chamber === "senate")).toBeUndefined();
  });

  it("Senate bill that only passed Senate — House not yet relevant", () => {
    const out = summarizeChamberPassage(
      { billType: "senate_bill", currentStatus: "reported" },
      zero,
    );
    expect(out.find((c) => c.chamber === "senate")?.status).toBe("pending");
    expect(out.find((c) => c.chamber === "house")).toBeUndefined();
  });

  it("simple Senate resolution agreed by UC — origin passed without rollcall, House not relevant", () => {
    // sres/686 case: Senate Resolution agreed to by Unanimous Consent.
    // Simple resolutions (sres/hres) live and die in their origin chamber.
    const out = summarizeChamberPassage(
      { billType: "senate_resolution", currentStatus: "passed_simpleres" },
      zero,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.chamber).toBe("senate");
    expect(out[0]?.status).toBe("passed_without_rollcall");
  });

  it("simple House resolution with recorded passage roll call", () => {
    const out = summarizeChamberPassage(
      { billType: "house_resolution", currentStatus: "passed_simpleres" },
      {
        house: { passage: 1, procedural: 0 },
        senate: { passage: 0, procedural: 0 },
      },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.chamber).toBe("house");
    expect(out[0]?.status).toBe("passed_with_rollcall");
  });

  it("concurrent resolution passed by both chambers — both surfaced", () => {
    const out = summarizeChamberPassage(
      {
        billType: "senate_concurrent_resolution",
        currentStatus: "passed_concurrentres",
      },
      {
        house: { passage: 1, procedural: 0 },
        senate: { passage: 0, procedural: 0 },
      },
    );
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.chamber === "senate")?.status).toBe(
      "passed_without_rollcall",
    );
    expect(out.find((c) => c.chamber === "house")?.status).toBe(
      "passed_with_rollcall",
    );
  });

  it("fail_originating_house — origin House rejected on passage, Senate not relevant", () => {
    const out = summarizeChamberPassage(
      { billType: "house_bill", currentStatus: "fail_originating_house" },
      {
        house: { passage: 1, procedural: 0 },
        senate: { passage: 0, procedural: 0 },
      },
    );
    expect(out).toHaveLength(1);
    const house = out.find((c) => c.chamber === "house");
    expect(house?.status).toBe("rejected");
    expect(house?.rejectionReason).toBe("passage");
    expect(house?.passageRollCallCount).toBe(1);
    expect(out.find((c) => c.chamber === "senate")).toBeUndefined();
  });

  it("fail_originating_senate — origin Senate rejected, House not relevant", () => {
    const out = summarizeChamberPassage(
      { billType: "senate_bill", currentStatus: "fail_originating_senate" },
      {
        house: { passage: 0, procedural: 0 },
        senate: { passage: 1, procedural: 0 },
      },
    );
    expect(out).toHaveLength(1);
    const senate = out.find((c) => c.chamber === "senate");
    expect(senate?.status).toBe("rejected");
    expect(senate?.rejectionReason).toBe("passage");
  });

  it("fail_second_house — Senate-origin bill cleared Senate, then House rejected it", () => {
    const out = summarizeChamberPassage(
      { billType: "senate_bill", currentStatus: "fail_second_house" },
      {
        house: { passage: 1, procedural: 0 },
        senate: { passage: 1, procedural: 0 },
      },
    );
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.chamber === "senate")?.status).toBe(
      "passed_with_rollcall",
    );
    const house = out.find((c) => c.chamber === "house");
    expect(house?.status).toBe("rejected");
    expect(house?.rejectionReason).toBe("passage");
  });

  it("prov_kill_cloturefailed on a House bill — House passed, Senate rejected on cloture", () => {
    const out = summarizeChamberPassage(
      { billType: "house_bill", currentStatus: "prov_kill_cloturefailed" },
      {
        house: { passage: 1, procedural: 0 },
        senate: { passage: 0, procedural: 1 },
      },
    );
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.chamber === "house")?.status).toBe(
      "passed_with_rollcall",
    );
    const senate = out.find((c) => c.chamber === "senate");
    expect(senate?.status).toBe("rejected");
    expect(senate?.rejectionReason).toBe("cloture");
    expect(senate?.proceduralRollCallCount).toBe(1);
  });

  it("prov_kill_cloturefailed on a Senate bill — cloture failed before Senate could pass; House not relevant", () => {
    const out = summarizeChamberPassage(
      { billType: "senate_bill", currentStatus: "prov_kill_cloturefailed" },
      {
        house: { passage: 0, procedural: 0 },
        senate: { passage: 0, procedural: 1 },
      },
    );
    expect(out).toHaveLength(1);
    const senate = out.find((c) => c.chamber === "senate");
    expect(senate?.status).toBe("rejected");
    expect(senate?.rejectionReason).toBe("cloture");
    expect(out.find((c) => c.chamber === "house")).toBeUndefined();
  });

  it("prov_kill_suspensionfailed on a Senate bill — Senate passed, then House suspension failed", () => {
    const out = summarizeChamberPassage(
      { billType: "senate_bill", currentStatus: "prov_kill_suspensionfailed" },
      {
        house: { passage: 1, procedural: 0 },
        senate: { passage: 1, procedural: 0 },
      },
    );
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.chamber === "senate")?.status).toBe(
      "passed_with_rollcall",
    );
    const house = out.find((c) => c.chamber === "house");
    expect(house?.status).toBe("rejected");
    expect(house?.rejectionReason).toBe("suspension");
  });

  it("prov_kill_suspensionfailed on a House bill — suspension failed in origin House; Senate not relevant", () => {
    const out = summarizeChamberPassage(
      { billType: "house_bill", currentStatus: "prov_kill_suspensionfailed" },
      {
        house: { passage: 1, procedural: 0 },
        senate: { passage: 0, procedural: 0 },
      },
    );
    expect(out).toHaveLength(1);
    const house = out.find((c) => c.chamber === "house");
    expect(house?.status).toBe("rejected");
    expect(house?.rejectionReason).toBe("suspension");
    expect(out.find((c) => c.chamber === "senate")).toBeUndefined();
  });
});

describe("chamberIsRelevant", () => {
  it("non-origin chamber becomes relevant after crossover", () => {
    expect(
      chamberIsRelevant("senate", {
        billType: "house_bill",
        currentStatus: "pass_over_house",
      }),
    ).toBe(true);
  });

  it("non-origin chamber not relevant while bill is pre-passage", () => {
    expect(
      chamberIsRelevant("senate", {
        billType: "house_bill",
        currentStatus: "introduced",
      }),
    ).toBe(false);
  });
});

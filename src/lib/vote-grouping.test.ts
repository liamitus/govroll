import { describe, it, expect } from "vitest";
import type { RepVoteRecord } from "@/types";
import {
  pickPrimaryVote,
  groupVotesByBill,
  computeBillAlignment,
} from "./vote-grouping";

function rec(partial: Partial<RepVoteRecord>): RepVoteRecord {
  return {
    billId: 1,
    billSlug: "hr-1-119",
    title: "Test bill",
    date: "2026-01-01T00:00:00.000Z",
    repVote: "Yea",
    link: "https://example.com",
    category: "passage",
    billStatus: "introduced",
    rollCallNumber: 1,
    chamber: "senate",
    votedAt: "2026-04-01T00:00:00.000Z",
    ...partial,
  };
}

describe("pickPrimaryVote", () => {
  it("prefers a passage vote with a Yes/No stance over earlier procedural votes", () => {
    const passage = rec({
      rollCallNumber: 4,
      category: "passage",
      repVote: "Yea",
      votedAt: "2026-04-15T00:00:00.000Z",
    });
    const cloture = rec({
      rollCallNumber: 3,
      category: "cloture",
      repVote: "Yea",
      votedAt: "2026-04-14T00:00:00.000Z",
    });
    const motion = rec({
      rollCallNumber: 2,
      category: "procedural",
      repVote: "Yea",
      votedAt: "2026-04-13T00:00:00.000Z",
    });
    expect(pickPrimaryVote([cloture, motion, passage])).toBe(passage);
  });

  it("prefers passage_suspension and veto_override the same as passage", () => {
    const suspension = rec({
      category: "passage_suspension",
      repVote: "Aye",
      votedAt: "2026-04-15T00:00:00.000Z",
    });
    const cloture = rec({
      category: "cloture",
      repVote: "Yea",
      votedAt: "2026-04-16T00:00:00.000Z",
    });
    expect(pickPrimaryVote([cloture, suspension])).toBe(suspension);
  });

  it("falls back to most recent passage vote when stance is Present", () => {
    const passagePresent = rec({
      category: "passage",
      repVote: "Present",
      votedAt: "2026-04-15T00:00:00.000Z",
    });
    const cloture = rec({
      category: "cloture",
      repVote: "Yea",
      votedAt: "2026-04-14T00:00:00.000Z",
    });
    expect(pickPrimaryVote([cloture, passagePresent])).toBe(passagePresent);
  });

  it("falls back to most recent vote when no passage vote exists", () => {
    const cloture = rec({
      category: "cloture",
      votedAt: "2026-04-15T00:00:00.000Z",
    });
    const procedural = rec({
      category: "procedural",
      votedAt: "2026-04-14T00:00:00.000Z",
    });
    expect(pickPrimaryVote([procedural, cloture])).toBe(cloture);
  });
});

describe("groupVotesByBill", () => {
  it("collapses N roll calls on the same bill into one group", () => {
    const records = [
      rec({ billId: 1, rollCallNumber: 1, category: "procedural" }),
      rec({ billId: 1, rollCallNumber: 2, category: "amendment" }),
      rec({ billId: 1, rollCallNumber: 3, category: "passage" }),
      rec({ billId: 2, rollCallNumber: 4, category: "passage" }),
    ];
    const groups = groupVotesByBill(records, null);
    expect(groups).toHaveLength(2);
    expect(groups[0].votes).toHaveLength(3);
    expect(groups[0].primary.rollCallNumber).toBe(3);
  });

  it("flags bills where the rep voted on opposite sides across stages", () => {
    const records = [
      rec({
        rollCallNumber: 1,
        category: "cloture",
        repVote: "Yea",
        votedAt: "2026-04-10T00:00:00.000Z",
      }),
      rec({
        rollCallNumber: 2,
        category: "passage",
        repVote: "Nay",
        votedAt: "2026-04-15T00:00:00.000Z",
      }),
    ];
    const groups = groupVotesByBill(records, null);
    expect(groups).toHaveLength(1);
    expect(groups[0].hasMixedStances).toBe(true);
  });

  it("does not flag mixed stances when all votes lean the same way", () => {
    const records = [
      rec({ rollCallNumber: 1, category: "cloture", repVote: "Yea" }),
      rec({ rollCallNumber: 2, category: "passage", repVote: "Yea" }),
    ];
    expect(groupVotesByBill(records, null)[0].hasMixedStances).toBe(false);
  });

  it("attaches the user's vote and bill-level alignment status", () => {
    const records = [
      rec({ billId: 7, rollCallNumber: 1, category: "passage", repVote: "No" }),
    ];
    const groups = groupVotesByBill(records, { 7: "Against" });
    expect(groups[0].userVote).toBe("Against");
    expect(groups[0].alignment).toBe("match");
  });

  it("orders groups by primary-vote date, most recent first", () => {
    const records = [
      rec({
        billId: 1,
        rollCallNumber: 1,
        category: "passage",
        votedAt: "2026-03-01T00:00:00.000Z",
      }),
      rec({
        billId: 2,
        rollCallNumber: 2,
        category: "passage",
        votedAt: "2026-04-01T00:00:00.000Z",
      }),
    ];
    const groups = groupVotesByBill(records, null);
    expect(groups[0].billId).toBe(2);
    expect(groups[1].billId).toBe(1);
  });
});

describe("computeBillAlignment", () => {
  it("counts each bill once even when the rep took many roll calls on it", () => {
    // Bill 1: rep voted yes on cloture, then no on passage. User voted Against.
    // Without bill-level grouping, this would inflate to 1 match (Nay on passage)
    // + 1 mismatch (Yea on cloture) = 50%. With grouping, the passage vote
    // is the primary and the user matches → 100%.
    const records = [
      rec({
        billId: 1,
        rollCallNumber: 1,
        category: "cloture",
        repVote: "Yea",
        votedAt: "2026-04-10T00:00:00.000Z",
      }),
      rec({
        billId: 1,
        rollCallNumber: 2,
        category: "passage",
        repVote: "Nay",
        votedAt: "2026-04-15T00:00:00.000Z",
      }),
    ];
    const result = computeBillAlignment(records, { 1: "Against" });
    expect(result).toEqual({ aligned: 1, comparable: 1, pct: 100 });
  });

  it("excludes bills whose primary vote is Present/Not Voting from the denominator", () => {
    const records = [
      rec({
        billId: 1,
        category: "passage",
        repVote: "Present",
      }),
      rec({
        billId: 2,
        category: "passage",
        repVote: "Yea",
      }),
    ];
    const result = computeBillAlignment(records, { 1: "For", 2: "For" });
    expect(result).toEqual({ aligned: 1, comparable: 1, pct: 100 });
  });

  it("returns null pct when no comparable votes exist", () => {
    const result = computeBillAlignment([], { 1: "For" });
    expect(result.pct).toBe(null);
  });
});

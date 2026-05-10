import { describe, it, expect } from "vitest";
import {
  isYesVote,
  isNoVote,
  isAbsentVote,
  normalizeRepVote,
  repAlignsWithUser,
} from "./votes";

describe("isYesVote / isNoVote", () => {
  it("treats Senate Yea and House Aye as yes", () => {
    expect(isYesVote("Yea")).toBe(true);
    expect(isYesVote("Aye")).toBe(true);
    expect(isYesVote("Nay")).toBe(false);
    expect(isYesVote("No")).toBe(false);
  });

  it("treats Senate Nay and House No as no", () => {
    expect(isNoVote("Nay")).toBe(true);
    expect(isNoVote("No")).toBe(true);
    expect(isNoVote("Yea")).toBe(false);
    expect(isNoVote("Aye")).toBe(false);
  });

  it("rejects null, undefined, and unrelated strings", () => {
    expect(isYesVote(null)).toBe(false);
    expect(isYesVote(undefined)).toBe(false);
    expect(isYesVote("Present")).toBe(false);
    expect(isNoVote("")).toBe(false);
  });
});

describe("isAbsentVote", () => {
  it("matches Present and Not Voting", () => {
    expect(isAbsentVote("Present")).toBe(true);
    expect(isAbsentVote("Not Voting")).toBe(true);
    expect(isAbsentVote("Yea")).toBe(false);
    expect(isAbsentVote(null)).toBe(false);
  });
});

describe("normalizeRepVote", () => {
  it("collapses chamber-specific values to plain English", () => {
    expect(normalizeRepVote("Yea")).toBe("Yes");
    expect(normalizeRepVote("Aye")).toBe("Yes");
    expect(normalizeRepVote("Nay")).toBe("No");
    expect(normalizeRepVote("No")).toBe("No");
    expect(normalizeRepVote("Present")).toBe("Present");
    expect(normalizeRepVote("Not Voting")).toBe("Not Voting");
  });

  it("returns Unknown for missing or unrecognized input", () => {
    expect(normalizeRepVote(null)).toBe("Unknown");
    expect(normalizeRepVote(undefined)).toBe("Unknown");
    expect(normalizeRepVote("Maybe")).toBe("Unknown");
  });
});

describe("repAlignsWithUser", () => {
  it("matches user For with rep Yea or Aye", () => {
    expect(repAlignsWithUser("Yea", "For")).toBe("match");
    expect(repAlignsWithUser("Aye", "For")).toBe("match");
  });

  it("matches user Against with rep Nay or No", () => {
    expect(repAlignsWithUser("Nay", "Against")).toBe("match");
    expect(repAlignsWithUser("No", "Against")).toBe("match");
  });

  it("flags chamber-mixed disagreement as mismatch", () => {
    // The original bug: House "No" + user "Against" was being scored as a mismatch.
    expect(repAlignsWithUser("No", "Against")).toBe("match");
    expect(repAlignsWithUser("Aye", "Against")).toBe("mismatch");
    expect(repAlignsWithUser("No", "For")).toBe("mismatch");
  });

  it("returns incomparable when the user abstained", () => {
    expect(repAlignsWithUser("Yea", "Abstain")).toBe("incomparable");
    expect(repAlignsWithUser("Nay", null)).toBe("incomparable");
    expect(repAlignsWithUser("Nay", undefined)).toBe("incomparable");
  });

  it("returns incomparable when the rep was Present or Not Voting", () => {
    expect(repAlignsWithUser("Present", "For")).toBe("incomparable");
    expect(repAlignsWithUser("Not Voting", "Against")).toBe("incomparable");
  });

  it("returns incomparable when the rep vote is missing or unrecognized", () => {
    expect(repAlignsWithUser(null, "For")).toBe("incomparable");
    expect(repAlignsWithUser("", "Against")).toBe("incomparable");
    expect(repAlignsWithUser("Maybe", "For")).toBe("incomparable");
  });
});

import { describe, it, expect } from "vitest";
import { detectRepMention } from "./rep-mention";

const aoc = {
  bioguideId: "O000172",
  firstName: "Alexandria",
  lastName: "Ocasio-Cortez",
};
const sanders = {
  bioguideId: "S000033",
  firstName: "Bernie",
  lastName: "Sanders",
};
const kelly = { bioguideId: "K000376", firstName: "Mike", lastName: "Kelly" };

describe("detectRepMention", () => {
  it("returns null when no candidate matches", () => {
    expect(
      detectRepMention("What does this bill do?", [aoc, sanders, kelly]),
    ).toBeNull();
  });

  it("returns null when candidates list is empty", () => {
    expect(detectRepMention("Why did Sanders vote no?", [])).toBeNull();
  });

  it("matches by last name", () => {
    const m = detectRepMention("Why did Sanders vote no?", [aoc, sanders]);
    expect(m).toEqual({ bioguideId: "S000033", isWhyIntent: true });
  });

  it("flags isWhyIntent on rationale-seeking phrasing", () => {
    expect(
      detectRepMention("Explain Kelly's reasoning here", [kelly])?.isWhyIntent,
    ).toBe(true);
    expect(
      detectRepMention("Why does Kelly support this?", [kelly])?.isWhyIntent,
    ).toBe(true);
    expect(
      detectRepMention("Kelly voted yes on this bill, right?", [kelly])
        ?.isWhyIntent,
    ).toBe(true);
  });

  it("falls back to !isWhyIntent for bare-name mentions", () => {
    expect(detectRepMention("Tell me about Kelly", [kelly])?.isWhyIntent).toBe(
      false,
    );
  });

  it("handles AOC nickname when no last-name match", () => {
    const m = detectRepMention("Why did AOC vote nay?", [aoc, sanders]);
    expect(m).toEqual({ bioguideId: "O000172", isWhyIntent: true });
  });

  it("prefers the first-occurring rep on multi-hit", () => {
    const m = detectRepMention("Why did Sanders vote no but Kelly voted yes?", [
      aoc,
      sanders,
      kelly,
    ]);
    expect(m?.bioguideId).toBe("S000033");
  });

  it("is case-insensitive", () => {
    const m = detectRepMention("why did SANDERS vote nay", [sanders]);
    expect(m?.bioguideId).toBe("S000033");
  });

  it("respects word boundaries (no substring match)", () => {
    const noisy = {
      bioguideId: "X000001",
      firstName: "Rob",
      lastName: "Le",
    };
    expect(detectRepMention("ple complete the form", [noisy])).toBeNull();
  });
});

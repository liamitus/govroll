import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextElection, nextElectionYear } from "./representative-utils";

// Term-end dates are Jan 3 of an odd year (regular terms) or an election day
// in November (appointments). "now" is pinned so the relative phrasing and the
// lame-duck advance are deterministic regardless of the machine timezone.
describe("nextElectionYear / nextElection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives a state's two senators different election years (the bug)", () => {
    // NY — both Democrats, but different election classes. The old code added a
    // flat +4 to every senator and showed both as "in about 4 years".
    const schumer = nextElectionYear("2029-01-03", "senator"); // class III
    const gillibrand = nextElectionYear("2031-01-03", "senator"); // class I
    expect(schumer).toBe(2028);
    expect(gillibrand).toBe(2030);
    expect(schumer).not.toBe(gillibrand);
  });

  it("renders the NY senators with distinct countdowns", () => {
    expect(nextElection("2029-01-03", "senator")).toBe("in about 2 years");
    expect(nextElection("2031-01-03", "senator")).toBe("in about 4 years");
  });

  it("puts a House member up the next even year", () => {
    expect(nextElectionYear("2027-01-03", "representative")).toBe(2026);
    expect(nextElection("2027-01-03", "representative")).toMatch(/months?/);
  });

  it("puts a Class II senator up the same year as the House", () => {
    // Class II terms end Jan 3 2027, same as the current House — both up Nov 2026.
    expect(nextElectionYear("2027-01-03", "senator")).toBe(2026);
  });

  it("treats an ISO string and a Date identically", () => {
    expect(nextElectionYear(new Date("2029-01-03"), "senator")).toBe(
      nextElectionYear("2029-01-03", "senator"),
    );
  });

  it("handles an appointment ending on a November election day", () => {
    // Appointed senators serve until the next general election; that same
    // election fills the seat, so the year is the term-end year, not year - 1.
    expect(nextElectionYear("2026-11-03", "senator")).toBe(2026);
  });

  it("falls back to the next even year when term end is missing", () => {
    expect(nextElectionYear(null, "representative")).toBe(2026);
    expect(nextElectionYear(undefined, "senator")).toBe(2026);
    expect(() => nextElection(null, "senator")).not.toThrow();
  });

  it("skips an election that has already passed (lame-duck window)", () => {
    // Early Dec 2028: the Nov 2028 election is over but terms still run to Jan 3
    // 2029. The next contest is one full cycle on — 2 years for the House, 6 for
    // the Senate.
    vi.setSystemTime(new Date("2028-12-01T12:00:00Z"));
    expect(nextElectionYear("2029-01-03", "representative")).toBe(2030);
    expect(nextElectionYear("2029-01-03", "senator")).toBe(2034);
  });
});

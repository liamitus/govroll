import { describe, expect, it } from "vitest";
import { shouldFilterSections, buildBillChatSystemPrompt } from "./ai";
import type { BillSection } from "./bill-sections";

function section(heading: string, content: string, ref = heading): BillSection {
  return { heading, content, sectionRef: ref };
}

describe("shouldFilterSections", () => {
  it("keeps a mid-size bill under the filter threshold", () => {
    // 90K chars — smaller than typical NDAA, bigger than a short bill.
    // Pre-fix threshold was 100K; post-fix is 400K so this must fall below.
    const sections = [section("Section 1", "x".repeat(90_000))];
    expect(shouldFilterSections(sections)).toBe(false);
  });

  it("still filters bills big enough to crowd the context window", () => {
    const sections = [section("Section 1", "x".repeat(500_000))];
    expect(shouldFilterSections(sections)).toBe(true);
  });
});

describe("buildBillChatSystemPrompt", () => {
  it("includes every section the caller passes in (no silent truncation)", () => {
    const sections = Array.from({ length: 50 }, (_, i) =>
      section(
        `Section ${i + 1}. Heading ${i + 1}`,
        `Content of section ${i + 1}.`,
      ),
    );
    const prompt = buildBillChatSystemPrompt("Test Bill", sections, null);

    // All 50 section headings must appear verbatim in the prompt — callers
    // that pass more sections than the old 15-cap must still get them all.
    for (let i = 1; i <= 50; i++) {
      expect(prompt).toContain(`Section ${i}. Heading ${i}`);
      expect(prompt).toContain(`Content of section ${i}.`);
    }
  });

  it("emits a CRS-summary-only prompt when no sections are available", () => {
    const prompt = buildBillChatSystemPrompt("Test Bill", null, {
      sponsor: "Sen. X",
      cosponsorCount: 0,
      cosponsorPartySplit: null,
      policyArea: "Taxation",
      latestActionDate: "2026-04-01",
      latestActionText: "Referred.",
      shortText: "This bill does something specific.",
      popularTitle: null,
      displayTitle: null,
      shortTitle: null,
    });
    expect(prompt).toContain("This bill does something specific");
    expect(prompt).toContain("Congressional Research Service summary");
  });

  it("falls back to a title-only prompt when summary and sections are both missing", () => {
    const prompt = buildBillChatSystemPrompt("Test Bill", null, null);
    expect(prompt).toContain("Full bill text");
    expect(prompt).toContain("not yet available");
    expect(prompt).toContain("Test Bill");
  });

  it("packs extended metadata (type, chamber, dates, status, actions, cosponsors) into the title-only prompt", () => {
    // Tier-3 bills rely entirely on metadata — this test pins the fact that
    // the prompt builder actually surfaces every field we bother to collect.
    const prompt = buildBillChatSystemPrompt("Test Bill", null, {
      sponsor: "Sen. X (D-NY)",
      cosponsorCount: 3,
      cosponsorPartySplit: "2 D, 1 R",
      policyArea: "Health",
      latestActionDate: "2026-04-10",
      latestActionText: "Referred.",
      shortText: null,
      popularTitle: null,
      displayTitle: null,
      shortTitle: null,
      billType: "HR",
      chamber: "House",
      introducedDate: "2026-03-01",
      currentStatus: "Introduced",
      actions: [
        { date: "2026-03-01", text: "Introduced in House." },
        { date: "2026-04-10", text: "Referred to committee." },
      ],
      cosponsors: [
        "Rep. Alpha (D-CA-12)",
        "Rep. Beta (R-TX-2)",
        "Rep. Gamma (D-NY-15)",
      ],
    });

    expect(prompt).toContain("HR");
    expect(prompt).toContain("House bill");
    expect(prompt).toContain("Introduced: 2026-03-01");
    expect(prompt).toContain("Current status: Introduced");
    expect(prompt).toContain("Action history");
    expect(prompt).toContain("2026-03-01: Introduced in House.");
    expect(prompt).toContain("2026-04-10: Referred to committee.");
    expect(prompt).toContain("Rep. Alpha (D-CA-12)");
    expect(prompt).toContain("authoritative");
  });

  it("appends a verified rep vote fact when repVoteContext is provided", () => {
    const prompt = buildBillChatSystemPrompt("HR 1", null, null, {
      repVoteContext: {
        displayName: "Rep. Alexandria Ocasio-Cortez (D-NY-14)",
        voteLabel: "No",
        voteDate: "2026-03-12",
        chamber: "House",
        rollCallNumber: 245,
        isWhyIntent: true,
      },
    });
    expect(prompt).toContain("Verified roll call fact");
    expect(prompt).toContain(
      "Rep. Alexandria Ocasio-Cortez (D-NY-14) voted No",
    );
    expect(prompt).toContain("roll call #245");
    // Why-intent block tells the model to acknowledge it can't read minds
    // and to suggest contacting the office, instead of inventing a reason.
    expect(prompt).toContain("call their office");
    expect(prompt).toContain("can't read their reasoning");
  });

  it("uses softer guidance when repVoteContext.isWhyIntent is false", () => {
    const prompt = buildBillChatSystemPrompt("HR 1", null, null, {
      repVoteContext: {
        displayName: "Sen. Bernie Sanders (I-VT)",
        voteLabel: "Yes",
        voteDate: "2026-03-12",
        chamber: "Senate",
        rollCallNumber: 88,
        isWhyIntent: false,
      },
    });
    expect(prompt).toContain("Sen. Bernie Sanders (I-VT) voted Yes");
    // The "you can't read their mind" block is gated on isWhyIntent — it
    // should NOT appear for bare name mentions.
    expect(prompt).not.toContain("call their office");
  });

  it("truncates the cosponsor list in the prompt for very long rosters", () => {
    const cosponsors = Array.from(
      { length: 40 },
      (_, i) => `Rep. Member${i + 1} (D-CA-${i + 1})`,
    );
    const prompt = buildBillChatSystemPrompt("Big Bill", null, {
      sponsor: null,
      cosponsorCount: 40,
      cosponsorPartySplit: null,
      policyArea: null,
      latestActionDate: null,
      latestActionText: null,
      shortText: null,
      popularTitle: null,
      displayTitle: null,
      shortTitle: null,
      cosponsors,
    });
    // First entries are included…
    expect(prompt).toContain("Rep. Member1 (D-CA-1)");
    // …but the tail beyond the in-prompt cap is omitted.
    expect(prompt).not.toContain("Rep. Member40 (D-CA-40)");
    // And the prompt says it's a partial list so the AI knows not to
    // claim the sample is exhaustive.
    expect(prompt).toMatch(/first \d+ of 40/);
  });
});

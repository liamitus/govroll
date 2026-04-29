import { describe, expect, it } from "vitest";
import {
  shouldFilterSections,
  buildBillChatSystemPrompt,
  packSectionsToBudget,
  packSectionsToBudgetWithDiagnostics,
  allocateChatBudget,
  truncateHistoryToBudget,
} from "./ai";
import type { BillSection } from "./bill-sections";
import type { ModelMessage } from "ai";

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

  it("permits brief background-knowledge answers in every prompt variant", () => {
    const tier3 = buildBillChatSystemPrompt(
      "Test Bill",
      [section("Section 1. Heading", "Body content.")],
      null,
    );
    const tier1 = buildBillChatSystemPrompt("Test Bill", null, {
      sponsor: null,
      cosponsorCount: null,
      cosponsorPartySplit: null,
      policyArea: null,
      latestActionDate: null,
      latestActionText: null,
      shortText: "Some CRS summary text.",
      popularTitle: null,
      displayTitle: null,
      shortTitle: null,
    });
    const tier2 = buildBillChatSystemPrompt("Test Bill", null, null);

    for (const prompt of [tier1, tier2, tier3]) {
      expect(prompt).toContain('"what is FISA?"');
      expect(prompt).toContain("background context");
    }
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

describe("packSectionsToBudget", () => {
  it("returns the input unchanged when packing isn't needed", () => {
    const sections = Array.from({ length: 30 }, (_, i) =>
      section(`Section ${i + 1}`, "x".repeat(1_000)),
    );
    const packed = packSectionsToBudget(sections);
    expect(packed).toBe(sections);
  });

  it("truncates a single mega-section that exceeds the per-section cap", () => {
    // 200K chars in one section is over the per-section cap (~90K chars
    // at 30K-token cap × 3 chars/token).
    const sections = [section("Section 1. Mega", "y".repeat(200_000))];
    const packed = packSectionsToBudget(sections);
    expect(packed).toHaveLength(1);
    expect(packed[0].content.length).toBeLessThan(200_000);
    expect(packed[0].content).toMatch(/section continues/);
  });

  it("stops adding sections once the total budget is exhausted", () => {
    // 60 sections × 30K chars each = 1.8M chars — far over the ~420K
    // section budget. The pack must drop later sections to fit. Reproduces
    // the HR 7567 (Farm/Food/Defense omnibus) overflow that motivated the
    // budget enforcement: 60 filtered sections stayed under the count cap
    // but blew the 200K-token window at 213K input tokens.
    const sections = Array.from({ length: 60 }, (_, i) =>
      section(
        `Section ${i + 1}. Heading ${i + 1}`,
        "z".repeat(30_000),
        `Section ${i + 1}`,
      ),
    );
    const packed = packSectionsToBudget(sections);
    expect(packed.length).toBeLessThan(sections.length);
    const totalChars = packed.reduce(
      (s, x) => s + x.heading.length + x.content.length,
      0,
    );
    expect(totalChars).toBeLessThan(140_000 * 3);
    expect(packed[0].sectionRef).toBe("Section 1");
  });

  it("preserves section ordering produced by the relevance filter", () => {
    const sections = [
      section("Section 5", "a".repeat(80_000), "Section 5"),
      section("Section 2", "b".repeat(80_000), "Section 2"),
      section("Section 9", "c".repeat(80_000), "Section 9"),
    ];
    const packed = packSectionsToBudget(sections);
    expect(packed.map((s) => s.sectionRef)).toEqual([
      "Section 5",
      "Section 2",
      "Section 9",
    ]);
  });

  it("respects an explicit budget tighter than the default", () => {
    // Caller passing in a 20K-token budget (chars = 60K) means only the
    // first ~3 small sections should fit. Confirms the budget arg threads
    // through correctly when streamBillChatResponse passes a reduced
    // budget because conversation history is competing for space.
    const sections = Array.from({ length: 30 }, (_, i) =>
      section(`Section ${i + 1}`, "x".repeat(20_000), `Section ${i + 1}`),
    );
    const packed = packSectionsToBudget(sections, 20_000);
    expect(packed.length).toBeLessThan(5);
    const totalChars = packed.reduce(
      (s, x) => s + x.heading.length + x.content.length,
      0,
    );
    expect(totalChars).toBeLessThan(20_000 * 3);
  });

  it("reports diagnostics when packing actually trims content", () => {
    const sections = [
      section("Section 1. Mega", "y".repeat(200_000)),
      section("Section 2", "z".repeat(50_000)),
    ];
    const result = packSectionsToBudgetWithDiagnostics(sections, 50_000);
    expect(result.truncated).toBe(true);
    // First section is over per-section cap → trimmed in place.
    expect(result.truncatedCount).toBeGreaterThan(0);
    expect(result.packedChars).toBeLessThan(result.originalChars);
  });

  it("reports zero truncation when packing isn't needed", () => {
    const sections = [section("Section 1", "x".repeat(1_000))];
    const result = packSectionsToBudgetWithDiagnostics(sections);
    expect(result.truncated).toBe(false);
    expect(result.droppedCount).toBe(0);
    expect(result.truncatedCount).toBe(0);
    expect(result.packedChars).toBe(result.originalChars);
  });
});

describe("allocateChatBudget", () => {
  function userMsg(text: string): ModelMessage {
    return { role: "user", content: text };
  }
  function aiMsg(text: string): ModelMessage {
    return { role: "assistant", content: text };
  }

  it("gives the bill text most of the budget on first turn", () => {
    const allocation = allocateChatBudget([
      userMsg("Tell me about this bill."),
    ]);
    // First turn: history is tiny, sections get most of the input budget
    // minus the overhead reserve (~15K tokens for instructions, citation
    // rules, and the metadata block).
    expect(allocation.sectionTokens).toBeGreaterThan(150_000);
    expect(allocation.historyTokens).toBeLessThan(50);
  });

  it("would have prevented the HR 7567 (213K-token) overflow", () => {
    // Regression: a fresh single-turn chat on the Farm/Food/Defense
    // omnibus overflowed the 200K window at 213K input tokens. The math
    // back then: 180K budget × 3 chars/token = 540K chars of section
    // content, plus a ~10K-token metadata block (CRS summary + cosponsor
    // sample + action timeline) that wasn't reserved against the budget.
    //
    // Working backwards from 213K observed: 540K chars + ~5K chars of
    // wrapper text ≈ 545K chars / 213K tokens = 2.56 chars/token actual
    // density on this bill. We pin the test at that observed density —
    // if the budget allocator + the section pack's chars/token estimate
    // ever drift back into a regime that overflowed HR 7567, this fails.
    const allocation = allocateChatBudget([userMsg("what about bayer?")]);
    const HR_7567_OBSERVED_DENSITY = 2.55;
    const HR_7567_OVERHEAD_TOKENS = 10_000;
    const sectionBudgetChars = allocation.sectionTokens * 2.5;
    const sectionRealTokens = sectionBudgetChars / HR_7567_OBSERVED_DENSITY;
    const totalTokens =
      sectionRealTokens + HR_7567_OVERHEAD_TOKENS + allocation.historyTokens;
    expect(totalTokens).toBeLessThan(200_000);
  });

  it("cedes budget to history as the conversation grows", () => {
    // Simulate 20 turns of back-and-forth, each ~1500 chars.
    const longHistory: ModelMessage[] = [];
    for (let i = 0; i < 20; i++) {
      longHistory.push(userMsg("a".repeat(1_500)));
      longHistory.push(aiMsg("b".repeat(1_500)));
    }
    const allocation = allocateChatBudget(longHistory);
    expect(allocation.historyTokens).toBeGreaterThan(10_000);
    // Sections still get the floor at minimum.
    expect(allocation.sectionTokens).toBeGreaterThanOrEqual(50_000);
  });

  it("never lets the section budget drop below the floor", () => {
    // An adversarially long history would otherwise crowd out the bill.
    // Cap on history protects sections at MIN_SECTION_TOKENS.
    const adversarial: ModelMessage[] = Array.from({ length: 200 }, () =>
      userMsg("x".repeat(2_000)),
    );
    const allocation = allocateChatBudget(adversarial);
    expect(allocation.sectionTokens).toBeGreaterThanOrEqual(50_000);
  });
});

describe("truncateHistoryToBudget", () => {
  function userMsg(text: string): ModelMessage {
    return { role: "user", content: text };
  }
  function aiMsg(text: string): ModelMessage {
    return { role: "assistant", content: text };
  }

  it("returns short transcripts untouched", () => {
    const messages: ModelMessage[] = [
      userMsg("hi"),
      aiMsg("hello"),
      userMsg("question?"),
    ];
    const result = truncateHistoryToBudget(messages, 100_000);
    expect(result.messages).toHaveLength(3);
    expect(result.droppedCount).toBe(0);
  });

  it("always preserves the final user message", () => {
    const messages: ModelMessage[] = [
      userMsg("a".repeat(10_000)),
      aiMsg("b".repeat(10_000)),
      userMsg("current question"),
    ];
    const result = truncateHistoryToBudget(messages, 200);
    expect(result.messages.at(-1)?.content).toBe("current question");
  });

  it("never leaves the kept transcript starting with an assistant turn", () => {
    // Anthropic rejects assistant-first conversations. Even when budget
    // would only fit [assistant, user], we must drop the lead assistant.
    const messages: ModelMessage[] = [
      userMsg("a".repeat(20_000)),
      aiMsg("b".repeat(20_000)),
      userMsg("current"),
    ];
    // Budget for current + one neighbor only — the neighbor is the
    // assistant turn, which must be dropped.
    const result = truncateHistoryToBudget(messages, 5_010);
    expect(result.messages[0].role).toBe("user");
  });

  it("drops the oldest turns first", () => {
    const messages: ModelMessage[] = [
      userMsg("oldest"),
      aiMsg("oldest reply"),
      userMsg("middle"),
      aiMsg("middle reply"),
      userMsg("newest"),
    ];
    // ~6-7 tokens per short message after framing overhead; budget 20
    // tokens fits ~3 messages from the end.
    const result = truncateHistoryToBudget(messages, 20);
    const texts = result.messages.map((m) => m.content);
    expect(texts).not.toContain("oldest");
    expect(texts).toContain("newest");
  });
});

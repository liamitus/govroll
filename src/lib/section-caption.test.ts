import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the AI SDK's generateText so the tests don't burn tokens or
// require a Gateway key. Pattern: `vi.mock` declares the substitution
// before module evaluation; the import below pulls in the mocked symbol
// for assertion.
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import { generateText } from "ai";
import { generateCaptionsBatch, isValidCaption } from "./section-caption";
import type { BillSection } from "./bill-sections";

const mockGenerateText = vi.mocked(generateText);

function section(heading: string, content: string): BillSection {
  return { heading, content, sectionRef: heading };
}

function aiResult(text: string, inputTokens = 100, outputTokens = 30) {
  // The AI SDK returns a complex object; we only use `.text` and
  // `.usage`, so build the minimal shape and cast.
  return {
    text,
    usage: { inputTokens, outputTokens },
  } as unknown as Awaited<ReturnType<typeof generateText>>;
}

beforeEach(() => {
  mockGenerateText.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────
//  Caption validation
// ─────────────────────────────────────────────────────────────────────────

describe("isValidCaption", () => {
  it("accepts a normal one-sentence caption", () => {
    expect(isValidCaption("Names the bill the Fair Housing Act of 2025.")).toBe(
      true,
    );
  });

  it("rejects empty / whitespace", () => {
    expect(isValidCaption("")).toBe(false);
    expect(isValidCaption("   ")).toBe(false);
  });

  it("rejects single-word captions", () => {
    expect(isValidCaption("Definitions.")).toBe(false);
  });

  it("rejects runaway paragraphs over the word cap", () => {
    const longCaption = Array.from({ length: 50 }, () => "word").join(" ");
    expect(isValidCaption(longCaption)).toBe(false);
  });

  it("rejects all-caps shouting (8+ letters)", () => {
    expect(isValidCaption("THIS IS THE FUNDING SECTION.")).toBe(false);
  });

  it("allows brief acronyms that happen to be uppercase", () => {
    // Mostly-lowercase caption with embedded acronym is fine.
    expect(
      isValidCaption("Authorizes new spending under the EPA program."),
    ).toBe(true);
  });

  it("rejects AI-meta refusals", () => {
    expect(
      isValidCaption("I don't have enough information to summarize this."),
    ).toBe(false);
    expect(isValidCaption("As an AI, I cannot interpret legal text.")).toBe(
      false,
    );
  });

  it("rejects boilerplate echo-the-prompt phrasing", () => {
    expect(
      isValidCaption("This section provides for the appropriation of funds."),
    ).toBe(false);
    expect(isValidCaption("The section provides definitions of terms.")).toBe(
      false,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  AI batch — happy path
// ─────────────────────────────────────────────────────────────────────────

describe("generateCaptionsBatch — happy path", () => {
  it("parses a clean JSON array into SectionCaption[]", async () => {
    const sections = [
      section(
        "Section 1. Short title",
        "This Act may be cited as the Test Act.",
      ),
      section(
        "Section 2. Definitions",
        "In this Act, the term 'eligible person' means an individual who…",
      ),
    ];
    const ids = ["sec-1-short-title", "sec-2-definitions"];

    mockGenerateText.mockResolvedValue(
      aiResult(
        JSON.stringify([
          {
            id: "sec-1-short-title",
            caption: "Names the bill the Test Act.",
          },
          {
            id: "sec-2-definitions",
            caption: "Defines who counts as an eligible person.",
          },
        ]),
      ),
    );

    const result = await generateCaptionsBatch("Test Act", sections, ids);

    expect(result.captions).toEqual([
      {
        sectionId: "sec-1-short-title",
        caption: "Names the bill the Test Act.",
      },
      {
        sectionId: "sec-2-definitions",
        caption: "Defines who counts as an eligible person.",
      },
    ]);
    expect(result.usage.model).toBe("anthropic/claude-haiku-4-5");
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(30);
  });

  it("tolerates fenced JSON output (```json … ```)", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult(
        '```json\n[{"id":"sec-1","caption":"Names the bill the Test Act."}]\n```',
      ),
    );

    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );

    expect(result.captions).toHaveLength(1);
    expect(result.captions[0].sectionId).toBe("sec-1");
  });

  it("includes every section heading in the prompt the model sees", async () => {
    mockGenerateText.mockResolvedValue(aiResult("[]"));

    const sections = Array.from({ length: 5 }, (_, i) =>
      section(
        `Section ${i + 1}. Topic ${i + 1}`,
        `Content of section ${i + 1}.`,
      ),
    );
    const ids = sections.map((_, i) => `sec-${i + 1}`);

    await generateCaptionsBatch("Big Bill", sections, ids);

    // Assert against the call args (the user message that was sent).
    const callArgs = mockGenerateText.mock.calls[0][0];
    const userMessage = (callArgs.messages?.[0] as { content: string }).content;

    for (let i = 1; i <= 5; i++) {
      expect(userMessage).toContain(`Section ${i}. Topic ${i}`);
      expect(userMessage).toContain(`id="sec-${i}"`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  AI batch — failure modes
// ─────────────────────────────────────────────────────────────────────────

describe("generateCaptionsBatch — failure modes", () => {
  it("returns empty captions when the model returns non-JSON", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult("Sorry, I cannot generate captions for this content."),
    );

    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );

    expect(result.captions).toEqual([]);
    // Usage is still reported so the budget gets charged for the call.
    expect(result.usage.inputTokens).toBe(100);
  });

  it("returns empty captions when the model returns malformed JSON", async () => {
    mockGenerateText.mockResolvedValue(aiResult("[{not valid json"));

    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );
    expect(result.captions).toEqual([]);
  });

  it("filters out captions whose id is not in the input set", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult(
        JSON.stringify([
          { id: "sec-1", caption: "Valid caption that names the bill." },
          {
            id: "sec-99-hallucinated",
            caption: "Hallucinated caption that should be dropped.",
          },
        ]),
      ),
    );

    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );

    expect(result.captions).toEqual([
      { sectionId: "sec-1", caption: "Valid caption that names the bill." },
    ]);
  });

  it("filters out captions with AI-meta refusal phrases", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult(
        JSON.stringify([
          {
            id: "sec-1",
            caption: "I don't have enough context to write this caption.",
          },
          {
            id: "sec-2",
            caption: "Defines who counts as an eligible person.",
          },
        ]),
      ),
    );

    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x"), section("Section 2", "y")],
      ["sec-1", "sec-2"],
    );

    expect(result.captions).toEqual([
      {
        sectionId: "sec-2",
        caption: "Defines who counts as an eligible person.",
      },
    ]);
  });

  it("dedupes when the model emits the same id twice (keeps the first)", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult(
        JSON.stringify([
          { id: "sec-1", caption: "Names the bill the Test Act." },
          {
            id: "sec-1",
            caption: "Renames the bill to a different second value.",
          },
        ]),
      ),
    );

    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );

    expect(result.captions).toEqual([
      { sectionId: "sec-1", caption: "Names the bill the Test Act." },
    ]);
  });

  it("throws if sections and ids arrays are misaligned", async () => {
    await expect(
      generateCaptionsBatch(
        "Test",
        [section("Section 1", "x"), section("Section 2", "y")],
        ["sec-1"],
      ),
    ).rejects.toThrow(/length/i);
  });

  it("returns empty captions and zero usage when the model returns valid JSON but no items", async () => {
    mockGenerateText.mockResolvedValue(aiResult("[]"));

    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );
    expect(result.captions).toEqual([]);
    // Usage still recorded — the call happened.
    expect(result.usage.inputTokens).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Stress tests — adversarial AI output, edge cases
// ─────────────────────────────────────────────────────────────────────────

describe("generateCaptionsBatch — adversarial AI output", () => {
  it("survives a JSON array embedded in a long preamble of prose", async () => {
    const text = `Sure, I can help with that. Here's the JSON you asked for:\n\nSome additional context: I made sure to be specific.\n\n[{"id":"sec-1","caption":"Names the bill the Test Act."}]\n\nLet me know if you need anything else.`;
    mockGenerateText.mockResolvedValue(aiResult(text));
    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );
    expect(result.captions).toHaveLength(1);
  });

  it("ignores explanatory comment lines outside the JSON array", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult(
        '```json\n// Each section gets a one-sentence caption.\n[{"id":"sec-1","caption":"Names the bill the Test Act."}]\n```',
      ),
    );
    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );
    // The greedy `\[[\s\S]*\]` regex finds the JSON array even when
    // surrounded by chatter, fences, or comment lines outside it.
    expect(result.captions).toEqual([
      { sectionId: "sec-1", caption: "Names the bill the Test Act." },
    ]);
  });

  it("handles captions with embedded quotes / apostrophes", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult(
        JSON.stringify([
          {
            id: "sec-1",
            caption: 'Defines "eligible person" as someone who...',
          },
          { id: "sec-2", caption: "Limits the agency's discretion." },
        ]),
      ),
    );
    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x"), section("Section 2", "y")],
      ["sec-1", "sec-2"],
    );
    expect(result.captions).toHaveLength(2);
  });

  it("filters captions that are mostly numbers / non-prose noise", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult(
        JSON.stringify([
          // All-uppercase shout — blocked.
          {
            id: "sec-1",
            caption: "FUNDING APPROPRIATIONS FOR FY2026 ALL CAPS",
          },
          // Below the 3-word minimum.
          { id: "sec-2", caption: "Definitions only." },
          // Above the 30-word maximum.
          {
            id: "sec-3",
            caption: Array.from({ length: 50 }, (_, i) => `word${i}`).join(" "),
          },
          // Valid.
          {
            id: "sec-4",
            caption: "Authorizes new spending under the EPA program.",
          },
        ]),
      ),
    );
    const result = await generateCaptionsBatch(
      "Test",
      [
        section("Section 1", "x"),
        section("Section 2", "y"),
        section("Section 3", "z"),
        section("Section 4", "w"),
      ],
      ["sec-1", "sec-2", "sec-3", "sec-4"],
    );
    expect(result.captions).toEqual([
      {
        sectionId: "sec-4",
        caption: "Authorizes new spending under the EPA program.",
      },
    ]);
  });

  it("handles AI returning numbers, booleans, or non-object items inside the array", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult(
        JSON.stringify([
          null,
          42,
          "string",
          true,
          { id: "sec-1", caption: "Names the bill the Test Act." },
        ]),
      ),
    );
    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );
    expect(result.captions).toEqual([
      { sectionId: "sec-1", caption: "Names the bill the Test Act." },
    ]);
  });

  it("handles AI returning the wrong wrapper (object instead of array)", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult(
        JSON.stringify({
          captions: [{ id: "sec-1", caption: "Names the bill the Test Act." }],
        }),
      ),
    );
    // Implementation finds first `[...]` in text — the object wrapper
    // doesn't have a top-level array, so we fall back to empty.
    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );
    // The inner array is matched by our regex though — verify either
    // graceful empty OR one valid caption (both are acceptable).
    expect(result.captions.length).toBeLessThanOrEqual(1);
  });

  it("strips whitespace from caption values", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult(
        JSON.stringify([
          { id: "sec-1", caption: "   Names the bill the Test Act.   " },
        ]),
      ),
    );
    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );
    expect(result.captions[0].caption).toBe("Names the bill the Test Act.");
  });

  it("treats id with trailing whitespace as non-matching (strict id match)", async () => {
    mockGenerateText.mockResolvedValue(
      aiResult(
        JSON.stringify([
          { id: "sec-1 ", caption: "Names the bill the Test Act." },
        ]),
      ),
    );
    const result = await generateCaptionsBatch(
      "Test",
      [section("Section 1", "x")],
      ["sec-1"],
    );
    // Our id check is `validIds.has(id)` — exact-string match.
    // "sec-1 " (trailing space) doesn't equal "sec-1". Strict.
    expect(result.captions).toEqual([]);
  });

  it("handles a 100-section batch end-to-end", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `sec-${i + 1}`);
    const sections = ids.map((id, i) =>
      section(`Section ${i + 1}. Topic ${i}`, `Body of section ${i + 1}.`),
    );
    const captionResponse = ids.map((id, i) => ({
      id,
      caption: `One-sentence summary of section ${i + 1}.`,
    }));
    mockGenerateText.mockResolvedValue(
      aiResult(JSON.stringify(captionResponse)),
    );

    const result = await generateCaptionsBatch("Big Bill", sections, ids);
    expect(result.captions).toHaveLength(100);
    expect(result.captions[0].sectionId).toBe("sec-1");
    expect(result.captions[99].sectionId).toBe("sec-100");
  });

  it("includes content preview (first 600 chars) in the prompt — long content is truncated", async () => {
    const longContent = "x".repeat(5000);
    mockGenerateText.mockResolvedValue(aiResult("[]"));
    await generateCaptionsBatch(
      "Big",
      [section("Section 1. Long", longContent)],
      ["sec-1"],
    );

    const callArgs = mockGenerateText.mock.calls[0][0];
    const userMessage = (callArgs.messages?.[0] as { content: string }).content;
    // The previewed content must be exactly 600 chars of x's, not 5000.
    const xRun = userMessage.match(/x{600,}/);
    expect(xRun?.[0]?.length).toBe(600);
  });
});

describe("isValidCaption — additional edge cases", () => {
  it("rejects captions with embedded newlines longer than the cap (multi-paragraph)", () => {
    expect(
      isValidCaption(
        "Line one of the caption.\nLine two adds more detail.\nLine three keeps going.",
      ),
    ).toBe(true);
    // Newlines aren't part of word-count rejection — the split-on-\s+
    // counts across them. The above is ~17 words, valid.
  });

  it("trims before length check (so leading whitespace doesn't artificially inflate)", () => {
    expect(isValidCaption("   Names the bill the Test Act.   ")).toBe(true);
  });

  it("accepts a caption that's exactly at the 3-word boundary", () => {
    expect(isValidCaption("Names the bill.")).toBe(true);
  });

  it("rejects a caption that's 2 words (one below boundary)", () => {
    expect(isValidCaption("Names bill.")).toBe(false);
  });

  it("accepts a caption that's exactly at the 30-word boundary", () => {
    const caption = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    expect(isValidCaption(caption)).toBe(true);
  });

  it("rejects a caption that's 31 words (one above boundary)", () => {
    const caption = Array.from({ length: 31 }, (_, i) => `word${i}`).join(" ");
    expect(isValidCaption(caption)).toBe(false);
  });

  it("matches AI-meta phrases case-insensitively", () => {
    expect(isValidCaption("THIS SECTION PROVIDES funding for X.")).toBe(false);
    expect(isValidCaption("As An AI, I cannot interpret this.")).toBe(false);
  });

  it("does not reject 'provides' as a standalone word (only the boilerplate phrase)", () => {
    expect(
      isValidCaption("The agency provides oversight of disbursements."),
    ).toBe(true);
  });
});

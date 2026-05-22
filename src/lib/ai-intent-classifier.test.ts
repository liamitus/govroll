import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the AI SDK boundary so tests don't burn tokens or require
// ANTHROPIC_API_KEY. Same pattern as section-caption.test.ts.
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (modelId: string) => modelId,
}));

import { generateObject } from "ai";
import {
  CHAT_INTENTS,
  CLASSIFIER_SYSTEM_PROMPT,
  classifyChatIntent,
  type ChatIntent,
  type ChatIntentClassification,
} from "./ai-intent-classifier";

const mockGenerateObject = vi.mocked(generateObject);

function objResult(
  classification: ChatIntentClassification,
  inputTokens = 450,
  outputTokens = 30,
) {
  // AI SDK returns a complex object; we use `.object` and `.usage`.
  return {
    object: classification,
    usage: { inputTokens, outputTokens },
  } as unknown as Awaited<ReturnType<typeof generateObject>>;
}

beforeEach(() => {
  mockGenerateObject.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────
//  Schema sanity
// ─────────────────────────────────────────────────────────────────────────

describe("CHAT_INTENTS", () => {
  it("exposes every intent the spec describes", () => {
    // If you add a new intent, update the prompt's category list AND
    // the spec doc AND this test. Failing this test on a sloppy add is
    // the whole point.
    expect(CHAT_INTENTS).toEqual([
      "direct",
      "definitional",
      "rep_vote",
      "cross_bill",
      "cross_version",
      "multi_bill",
      "off_topic",
    ]);
  });
});

describe("CLASSIFIER_SYSTEM_PROMPT", () => {
  it("documents every intent category in the prompt", () => {
    // The prompt explicitly enumerates the categories the model can
    // pick. If a code-level intent isn't in the prompt, the model
    // can't know to choose it — silent drift bug. Catch it here.
    for (const intent of CHAT_INTENTS) {
      expect(CLASSIFIER_SYSTEM_PROMPT).toContain(`- ${intent}:`);
    }
  });

  it("instructs the model on cross_bill verbatim-name extraction", () => {
    // The route's cross-bill block depends on namedBill being a usable
    // verbatim reference, so the prompt must spell out that contract.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/namedBill/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/verbatim/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Happy paths — one assertion per intent
// ─────────────────────────────────────────────────────────────────────────

describe("classifyChatIntent — routes representative inputs", () => {
  const cases: Array<{
    label: string;
    message: string;
    intent: ChatIntent;
    namedBill: string | null;
  }> = [
    {
      label: "direct provision lookup",
      message: "What does section 4 say about agricultural subsidies?",
      intent: "direct",
      namedBill: null,
    },
    {
      label: "definitional acronym question",
      message: "What is FISA?",
      intent: "definitional",
      namedBill: null,
    },
    {
      label: "rep vote question",
      message: "Why did Sanders vote no on this bill?",
      intent: "rep_vote",
      namedBill: null,
    },
    {
      label: "cross-bill comparison (the Save Our Bacon failure mode)",
      message:
        "Does this bill contain the same language as the Save Our Bacon Act?",
      intent: "cross_bill",
      namedBill: "Save Our Bacon Act",
    },
    {
      label: "cross-bill comparison via bill number",
      message: "Is H.R. 4673 folded into this?",
      intent: "cross_bill",
      namedBill: "H.R. 4673",
    },
    {
      label: "cross-version question",
      message: "What changed between the introduced and engrossed versions?",
      intent: "cross_version",
      namedBill: null,
    },
    {
      label: "multi-bill question without a named bill",
      message: "What other bills cover this topic?",
      intent: "multi_bill",
      namedBill: null,
    },
    {
      label: "off-topic chat",
      message: "What's the weather in San Francisco?",
      intent: "off_topic",
      namedBill: null,
    },
  ];

  for (const c of cases) {
    it(`routes ${c.label}`, async () => {
      mockGenerateObject.mockResolvedValue(
        objResult({
          intent: c.intent,
          namedBill: c.namedBill,
          reasoning: "test fixture",
        }),
      );

      const result = await classifyChatIntent(c.message);

      expect(result.fallback).toBe(false);
      expect(result.classification.intent).toBe(c.intent);
      expect(result.classification.namedBill).toBe(c.namedBill);
      expect(result.usage.model).toBe("claude-haiku-4-5");
      expect(result.usage.inputTokens).toBeGreaterThan(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
//  Failure modes — the classifier must NEVER block the chat
// ─────────────────────────────────────────────────────────────────────────

describe("classifyChatIntent — fallback behavior", () => {
  it("returns intent: direct on empty input without calling the model", async () => {
    const result = await classifyChatIntent("");

    expect(result.fallback).toBe(true);
    expect(result.classification.intent).toBe("direct");
    expect(result.classification.namedBill).toBeNull();
    expect(mockGenerateObject).not.toHaveBeenCalled();
    // No real tokens — spend recorder will skip on zero-token usage.
    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
    expect(result.usage.model).toMatch(/:fallback$/);
  });

  it("returns intent: direct on whitespace-only input", async () => {
    const result = await classifyChatIntent("   \n  \t  ");

    expect(result.fallback).toBe(true);
    expect(result.classification.intent).toBe("direct");
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("returns intent: direct when the AI SDK throws", async () => {
    mockGenerateObject.mockRejectedValue(new Error("anthropic timeout"));

    const result = await classifyChatIntent("anything that should classify");

    expect(result.fallback).toBe(true);
    expect(result.classification.intent).toBe("direct");
    expect(result.classification.namedBill).toBeNull();
    expect(result.usage.model).toMatch(/:fallback$/);
  });

  it("clips overlong input before sending to the model", async () => {
    mockGenerateObject.mockResolvedValue(
      objResult({
        intent: "direct",
        namedBill: null,
        reasoning: "test",
      }),
    );
    const oversize = "x".repeat(10_000);

    await classifyChatIntent(oversize);

    // We don't assert the exact char count (that's an internal detail
    // tied to MAX_INPUT_CHARS) — just that the route did NOT forward
    // the full 10KB blob downstream.
    const callArgs = mockGenerateObject.mock.calls[0][0];
    const userMessage = (callArgs.messages?.[1] as { content: string }).content;
    expect(userMessage.length).toBeLessThan(oversize.length);
    expect(userMessage.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Prompt cache wiring
// ─────────────────────────────────────────────────────────────────────────

describe("classifyChatIntent — prompt caching", () => {
  it("marks the system message with ephemeral cacheControl", async () => {
    mockGenerateObject.mockResolvedValue(
      objResult({
        intent: "direct",
        namedBill: null,
        reasoning: "test",
      }),
    );

    await classifyChatIntent("hello");

    // Multi-turn sessions on the same bill share an identical system
    // prompt — without ephemeral caching turn 2+ pays full Haiku input
    // rates on the same ~400 tokens. The cost story in the spec doc
    // depends on this being on, so guard it.
    const callArgs = mockGenerateObject.mock.calls[0][0];
    const systemMsg = callArgs.messages?.[0] as {
      role: string;
      providerOptions?: { anthropic?: { cacheControl?: { type: string } } };
    };
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.providerOptions?.anthropic?.cacheControl?.type).toBe(
      "ephemeral",
    );
  });
});

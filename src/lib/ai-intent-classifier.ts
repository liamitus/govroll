/**
 * Intent classifier for the bill chat (Layer 1 of the intent router).
 *
 * Every POST /api/ai/chat turn runs this tiny Haiku call before the main
 * Sonnet stream. Its job is to label what *kind* of question the user is
 * asking so the route can pick the right retrieval shape:
 *
 *   - direct          → existing single-bill path (no change)
 *   - definitional    → existing background-knowledge clause (no change)
 *   - rep_vote        → existing repVoteContext path (no change)
 *   - cross_bill      → NEW: inject a comparison-acknowledgment block so
 *                       Sonnet uses general knowledge about the named bill
 *                       AND identifies topically-matching sections here,
 *                       instead of doing a literal-string lookup and
 *                       giving up
 *   - cross_version   → logged for demand signal; honest acknowledgment
 *   - multi_bill      → logged for demand signal; honest acknowledgment
 *   - off_topic       → existing path; the model already redirects
 *
 * Cost envelope: ~$0.0006 uncached / ~$0.00015 cached per call. Negligible.
 *
 * Failure mode: on any error (timeout, malformed output, API down) the
 * classifier returns `intent: "direct"` so the existing single-bill path
 * runs unchanged. This is the entire reason classification is additive —
 * if the new layer breaks, the old chat keeps working.
 *
 * See docs/ai-chat-intent-router.md for the full spec.
 */

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

import type { AiUsageRecord } from "./ai";

/** Haiku 4.5 is the right tier — bounded classification over ≤2000 char
 *  input, no reasoning chain needed. We could go to Sonnet for marginal
 *  recall but the cost delta isn't justified for this task. */
const CLASSIFIER_MODEL = "claude-haiku-4-5";

/** Hard timeout. Classifier latency p95 is ~300ms; 3s lets a slow leg
 *  finish but never stalls the streamed answer. Fallback on timeout is
 *  `intent: "direct"`, so a slow classifier never breaks the chat — only
 *  loses the routing benefit for that one turn. */
const CLASSIFIER_TIMEOUT_MS = 3000;

/** Cap on the user message length we forward to the classifier. The route
 *  already enforces 2000 chars on the persisted message; this is belt-and-
 *  suspenders so a future route change can't accidentally blow up the
 *  classifier's input budget. */
const MAX_INPUT_CHARS = 2200;

export const CHAT_INTENTS = [
  "direct",
  "definitional",
  "rep_vote",
  "cross_bill",
  "cross_version",
  "multi_bill",
  "off_topic",
] as const;

export type ChatIntent = (typeof CHAT_INTENTS)[number];

const ChatIntentSchema = z.object({
  intent: z.enum(CHAT_INTENTS),
  /** When intent === "cross_bill", the verbatim user reference to the
   *  other piece of legislation. e.g. "Save Our Bacon Act", "H.R. 4673",
   *  "the EATS Act". Null for every other intent. */
  namedBill: z.string().nullable(),
  /** ≤15-word reasoning string. For telemetry only — never surfaced to
   *  the end user. Kept short so it doesn't bloat output tokens. */
  reasoning: z.string().max(200),
});

export type ChatIntentClassification = z.infer<typeof ChatIntentSchema>;

/** Exported so tests can assert against the exact prompt and so the
 *  spec doc stays in sync with the live prompt. If you edit this,
 *  update the prompt section in docs/ai-chat-intent-router.md. */
export const CLASSIFIER_SYSTEM_PROMPT = `You are a triage classifier for a U.S. legislation Q&A assistant.

You see ONE user message. The user is asking about a specific bill that has been loaded into the assistant's context. Your job is to identify the user's intent so the assistant can route appropriately.

Categories:
- direct: Asking about provisions, sections, sponsors, status, or any substantive fact of THIS bill.
- definitional: Asking what a term, agency, or prior law means in general (e.g., "what is FISA?", "what does the EPA do?"). Background-knowledge style.
- rep_vote: Asking how a specific named representative voted on this bill, or why they voted that way.
- cross_bill: Mentions ANOTHER named piece of legislation by short title or bill number and wants comparison or wants to know if it's incorporated. Examples: "does this contain the Save Our Bacon Act?", "is H.R. 4673 in here?", "how does this compare to the EATS Act?". The user is naming a SPECIFIC other bill.
- cross_version: Asks about changes between versions of THIS bill (e.g., "what was added since introduction?", "what's different in the engrossed version?").
- multi_bill: Asks generically about OTHER bills in the corpus, without naming a specific one (e.g., "what other bills cover this?", "are there similar bills?").
- off_topic: Not about U.S. legislation at all.

Disambiguation:
- "Compare this to the Affordable Care Act" → cross_bill (named another law).
- "What other bills like this exist?" → multi_bill (no specific bill named).
- "What is the ACA?" → definitional (asking what something is, not comparing).
- "How did Sanders vote?" → rep_vote.
- "How did Sanders vote on the EATS Act?" → rep_vote (still primarily about the rep's vote; the EATS Act is incidental context).

When intent is cross_bill, copy the user's verbatim reference into namedBill ("Save Our Bacon Act", "H.R. 4673", "the EATS Act"). Otherwise namedBill is null.

reasoning: ≤15 words, plain prose. For internal telemetry.

Output JSON only.`;

export interface ClassifyResult {
  classification: ChatIntentClassification;
  usage: AiUsageRecord;
  /** True when the classifier failed (timeout, parse error, API error) and
   *  we fell back to the safe default. The route uses this to skip
   *  intent-specific prompt blocks and just run the existing path. */
  fallback: boolean;
}

const FALLBACK_CLASSIFICATION: ChatIntentClassification = {
  intent: "direct",
  namedBill: null,
  reasoning: "classifier_fallback",
};

const FALLBACK_USAGE: AiUsageRecord = {
  model: `${CLASSIFIER_MODEL}:fallback`,
  inputTokens: 0,
  outputTokens: 0,
};

/**
 * Classify the user's chat turn.
 *
 * Always resolves — never throws. On any failure (timeout, malformed
 * output, API down) returns `intent: "direct"` so the chat route can
 * keep its existing behavior. The `fallback: true` flag lets the route
 * skip cross-bill prompt injection (so we don't show acknowledgment
 * blocks the classifier didn't actually request).
 */
export async function classifyChatIntent(
  userMessage: string,
): Promise<ClassifyResult> {
  const trimmed = userMessage.trim().slice(0, MAX_INPUT_CHARS);
  if (trimmed.length === 0) {
    return {
      classification: FALLBACK_CLASSIFICATION,
      usage: FALLBACK_USAGE,
      fallback: true,
    };
  }

  try {
    const result = await Promise.race([
      generateObject({
        model: anthropic(CLASSIFIER_MODEL),
        schema: ChatIntentSchema,
        // System message via the messages array (not the top-level
        // `system` field) so we can attach Anthropic cacheControl —
        // multi-turn sessions share an identical system prompt, so
        // turns 2+ pay ~10% of input tokens on the system block.
        messages: [
          {
            role: "system",
            content: CLASSIFIER_SYSTEM_PROMPT,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" as const } },
            },
          },
          { role: "user", content: trimmed },
        ],
        maxOutputTokens: 200,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new ClassifierTimeoutError()),
          CLASSIFIER_TIMEOUT_MS,
        ),
      ),
    ]);

    return {
      classification: result.object,
      usage: {
        model: CLASSIFIER_MODEL,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      },
      fallback: false,
    };
  } catch (err) {
    // Log so we can see classifier health in Vercel; never bubble.
    // Structured so it's filterable in log search alongside the route's
    // own structured event names.
    console.warn(
      JSON.stringify({
        event: "intent_classify_failed",
        error: err instanceof Error ? err.message : String(err),
        timedOut: err instanceof ClassifierTimeoutError,
      }),
    );
    return {
      classification: FALLBACK_CLASSIFICATION,
      usage: FALLBACK_USAGE,
      fallback: true,
    };
  }
}

class ClassifierTimeoutError extends Error {
  constructor() {
    super(`Intent classifier exceeded ${CLASSIFIER_TIMEOUT_MS}ms`);
    this.name = "ClassifierTimeoutError";
  }
}

/**
 * Per-model pricing in USD cents per million tokens.
 * Source of truth for cost estimation. Update when providers change prices.
 *
 * Values are stored as integer cents-per-million-tokens to avoid floating point.
 * e.g. Claude Sonnet 4 input @ $3/Mtok → 300 cents/Mtok.
 *
 * Keys MUST match the exact strings recorded by `recordSpend({ model })` —
 * the lookup is a literal `Record` access. Mismatched keys silently fall
 * back to `UNKNOWN_MODEL_FALLBACK` (Opus pricing — overestimates so the
 * budget gate trips early rather than late).
 */

type ModelPricing = {
  /** cents per million input tokens */
  inputCentsPerMtok: number;
  /** cents per million output tokens */
  outputCentsPerMtok: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude Sonnet 4 — main bill chat (src/lib/ai.ts SONNET_MODEL).
  // $3/Mtok input, $15/Mtok output.
  "claude-sonnet-4-20250514": {
    inputCentsPerMtok: 300,
    outputCentsPerMtok: 1500,
  },

  // Claude Haiku 4.5 — section filter, explain-passage, change summaries,
  // bill explainer, section captions (src/lib/ai.ts + section-caption.ts
  // HAIKU_MODEL). $1/Mtok input, $5/Mtok output.
  "claude-haiku-4-5": { inputCentsPerMtok: 100, outputCentsPerMtok: 500 },

  // Sentinel for "we called a moderation endpoint that is free"
  // (src/lib/moderation/layer2.ts uses OpenAI's /moderations).
  "openai-moderation": { inputCentsPerMtok: 0, outputCentsPerMtok: 0 },
};

/** Conservative overestimate (Claude Opus pricing) for unrecognized model
 *  IDs — better to trip the budget gate early than to under-bill ourselves. */
const UNKNOWN_MODEL_FALLBACK: ModelPricing = {
  inputCentsPerMtok: 1500,
  outputCentsPerMtok: 7500,
};

/**
 * Compute the cost of a single AI call in integer cents, rounded up so we never
 * undercount the budget. Unknown models fall back to the most expensive tier.
 */
export function computeCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model] ?? UNKNOWN_MODEL_FALLBACK;
  const inputCost = (inputTokens * pricing.inputCentsPerMtok) / 1_000_000;
  const outputCost = (outputTokens * pricing.outputCentsPerMtok) / 1_000_000;
  return Math.ceil(inputCost + outputCost);
}

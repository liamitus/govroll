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

/** Anthropic prompt-cache pricing multipliers, applied against the model's
 *  base input rate.
 *
 *  - 5-minute ephemeral cache writes: 1.25× base input rate
 *  - 1-hour ephemeral cache writes: 2× base input rate
 *  - Cache reads (any TTL): 0.1× base input rate
 *
 *  We default to the 5-minute tier in the chat builder; the 1-hour multiplier
 *  is exposed so we can flip it later without touching the cost math. */
const CACHE_WRITE_MULT_5M = 1.25;
const CACHE_WRITE_MULT_1H = 2;
const CACHE_READ_MULT = 0.1;

export interface CacheTokenBreakdown {
  /** Tokens written to the cache this turn (1.25× input rate). */
  cacheWriteTokens?: number;
  /** Tokens read from a previous cache write (0.1× input rate). */
  cacheReadTokens?: number;
  /** Whether the write used the 1h TTL tier. Defaults to 5m (1.25×). */
  cacheTtl?: "5m" | "1h";
}

/**
 * Compute the cost of a single AI call in integer cents, rounded up so we never
 * undercount the budget. Unknown models fall back to the most expensive tier.
 *
 * When `cache` is provided, the cached token counts are billed at Anthropic's
 * tiered rates (cheaper reads, slightly pricier writes); the remaining
 * `inputTokens` are billed at the standard rate. The provider gives us the
 * full `inputTokens` count *plus* a breakdown — passing both keeps the
 * standalone-cost shape compatible with non-Anthropic models that don't have
 * the breakdown.
 */
export function computeCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cache?: CacheTokenBreakdown,
): number {
  const pricing = MODEL_PRICING[model] ?? UNKNOWN_MODEL_FALLBACK;
  const cacheReadTokens = cache?.cacheReadTokens ?? 0;
  const cacheWriteTokens = cache?.cacheWriteTokens ?? 0;
  const writeMult =
    cache?.cacheTtl === "1h" ? CACHE_WRITE_MULT_1H : CACHE_WRITE_MULT_5M;
  // Provider reports the breakdown alongside total inputTokens; subtract so
  // the same token isn't billed twice.
  const noCacheTokens = Math.max(
    0,
    inputTokens - cacheReadTokens - cacheWriteTokens,
  );

  const noCacheCost = (noCacheTokens * pricing.inputCentsPerMtok) / 1_000_000;
  const cacheReadCost =
    (cacheReadTokens * pricing.inputCentsPerMtok * CACHE_READ_MULT) / 1_000_000;
  const cacheWriteCost =
    (cacheWriteTokens * pricing.inputCentsPerMtok * writeMult) / 1_000_000;
  const outputCost = (outputTokens * pricing.outputCentsPerMtok) / 1_000_000;

  return Math.ceil(noCacheCost + cacheReadCost + cacheWriteCost + outputCost);
}

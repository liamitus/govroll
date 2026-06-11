/**
 * Pins the pricing-table invariants that the budget ledger relies on.
 * Cost accuracy here is load-bearing: the AI gate flips off when spend
 * overshoots income, so a mispriced model either over-disables AI
 * (under-bills the donors' goodwill) or lets spend run past budget.
 */
import { describe, expect, it } from "vitest";

import { computeCostCents, MODEL_PRICING } from "./ai-pricing";
import { VOYAGE_EMBED_MODEL } from "./voyage";

describe("MODEL_PRICING — Voyage embeddings", () => {
  it("has an entry keyed to VOYAGE_EMBED_MODEL", () => {
    // The chat route records the RAG query-embedding spend with
    // model=VOYAGE_EMBED_MODEL, and the embed pipeline prices its Voyage
    // cost the same way. If the key drifts from the constant, recordSpend
    // silently falls through to the Opus fallback again.
    expect(MODEL_PRICING[VOYAGE_EMBED_MODEL]).toBeDefined();
  });

  it("prices Voyage at $0.18/Mtok input, input-only", () => {
    const pricing = MODEL_PRICING[VOYAGE_EMBED_MODEL];
    expect(pricing.inputCentsPerMtok).toBe(18);
    expect(pricing.outputCentsPerMtok).toBe(0); // embeddings have no output
  });

  it("computes embedding cost from input tokens, rounding up", () => {
    // 1M input tokens @ 18 cents/Mtok = 18 cents.
    expect(computeCostCents(VOYAGE_EMBED_MODEL, 1_000_000, 0)).toBe(18);
    // Sub-cent usage still rounds up so we never undercount the budget.
    expect(computeCostCents(VOYAGE_EMBED_MODEL, 1, 0)).toBe(1);
  });

  it("no longer over-bills embeddings at the unknown-model (Opus) fallback", () => {
    // Regression guard for the bug this entry fixes: an unmapped model is
    // billed at Opus input rates (1500 cents/Mtok), ~80× the real Voyage
    // rate for the same token count.
    const correct = computeCostCents(VOYAGE_EMBED_MODEL, 2_000_000, 0);
    const fallback = computeCostCents("some-unmapped-model", 2_000_000, 0);
    expect(correct).toBe(36);
    expect(fallback).toBe(3000);
    expect(fallback).toBeGreaterThan(correct * 50);
  });
});

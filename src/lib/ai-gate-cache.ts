import type { BudgetSnapshot } from "@/lib/budget";

/**
 * In-process cache of the most recent budget snapshot, shared by the AI
 * gate's read path (`ai-gate.ts`) and the spend recorder's invalidation
 * path (`budget.ts`).
 *
 * It lives in its own leaf module so `budget.ts` can drop the cache the
 * instant a spend tips the period negative without importing `ai-gate.ts`
 * (which imports `budget.ts`) and forming a require cycle.
 *
 * The cache is per-serverless-instance: invalidation only clears the
 * instance that calls it. Other instances re-read within `AI_GATE_CACHE_TTL_MS`.
 */
export const AI_GATE_CACHE_TTL_MS = 60_000; // 1 minute

let entry: { snapshot: BudgetSnapshot; fetchedAt: number } | null = null;

/** Return the cached snapshot if it's still within the TTL, else null. */
export function readCachedSnapshot(now: number): BudgetSnapshot | null {
  if (entry && now - entry.fetchedAt < AI_GATE_CACHE_TTL_MS)
    return entry.snapshot;
  return null;
}

export function writeCachedSnapshot(
  snapshot: BudgetSnapshot,
  now: number,
): void {
  entry = { snapshot, fetchedAt: now };
}

/** Force the next gate read to hit the database. Call after a webhook income
 *  tick or a spend that tips the current period's available budget <= 0. */
export function invalidateAiGateCache(): void {
  entry = null;
}

import { getBudgetSnapshot, type BudgetSnapshot } from "@/lib/budget";
import {
  readCachedSnapshot,
  writeCachedSnapshot,
  invalidateAiGateCache,
} from "@/lib/ai-gate-cache";

// Re-export so existing call sites (Stripe webhook, evaluate-budget cron) keep
// importing the invalidator from the gate module even though the cache itself
// now lives in `ai-gate-cache` to avoid a cycle with `budget`.
export { invalidateAiGateCache };

/**
 * Thrown by `assertAiEnabled` when AI features are currently unavailable.
 * API routes should catch this and return a structured 503 so the frontend
 * can render the paused/degraded state.
 */
export class AiDisabledError extends Error {
  readonly reason: "budget" | "manual";
  readonly snapshot: BudgetSnapshot;
  readonly donateUrl = "/support";

  constructor(snapshot: BudgetSnapshot) {
    super(
      `AI features are currently paused (${snapshot.aiDisabledReason ?? "unknown"})`,
    );
    this.name = "AiDisabledError";
    this.reason = snapshot.aiDisabledReason === "manual" ? "manual" : "budget";
    this.snapshot = snapshot;
  }

  toJSON() {
    return {
      error: "ai_disabled",
      reason: this.reason,
      message:
        "Govroll's AI features are funded by citizens and are currently paused for this period.",
      donateUrl: this.donateUrl,
      budget: {
        incomeCents: this.snapshot.incomeCents,
        spendCents: this.snapshot.spendCents,
        reserveCents: this.snapshot.reserveCents,
        period: this.snapshot.period,
      },
    };
  }
}

/**
 * Reads the budget snapshot through the in-process cache (see
 * `ai-gate-cache`). The cron and `recordSpend` keep the underlying
 * `aiEnabled` flag fresh; this cache is a backstop so API routes don't hit
 * the DB on every AI call, and it's dropped immediately on income/spend
 * events so a paused gate flips within one request, not one TTL.
 */
async function readSnapshot(): Promise<BudgetSnapshot> {
  const now = Date.now();
  const cached = readCachedSnapshot(now);
  if (cached) return cached;
  const snapshot = await getBudgetSnapshot();
  writeCachedSnapshot(snapshot, now);
  return snapshot;
}

/**
 * Throws `AiDisabledError` if AI features are currently off. Call at the top
 * of any API route that spends tokens.
 */
export async function assertAiEnabled(
  _feature: string,
): Promise<BudgetSnapshot> {
  const snapshot = await readSnapshot();
  if (!snapshot.aiEnabled) throw new AiDisabledError(snapshot);
  return snapshot;
}

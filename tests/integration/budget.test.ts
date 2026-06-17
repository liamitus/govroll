import { describe, expect, it } from "vitest";
import { recordSpend, currentPeriod } from "@/lib/budget";
import { getTestPrisma } from "./db";

// Claude Sonnet 4.6 input is priced at $3 / 1M tokens (300 cents), so 1M input
// tokens is a clean, deterministic 300¢ spend.
const SONNET = "claude-sonnet-4-6";
const ONE_MTOK = 1_000_000;

function seedLedger(over: { incomeCents: number; aiEnabled?: boolean }) {
  return getTestPrisma().budgetLedger.create({
    data: {
      period: currentPeriod(),
      incomeCents: over.incomeCents,
      spendCents: 0,
      reserveCents: 0,
      carryoverCents: 0,
      aiEnabled: over.aiEnabled ?? true,
    },
  });
}

function ledger() {
  return getTestPrisma().budgetLedger.findUniqueOrThrow({
    where: { period: currentPeriod() },
  });
}

describe("recordSpend — budget gate", () => {
  it("flips aiEnabled off the moment spend crosses the budget", async () => {
    await seedLedger({ incomeCents: 100 }); // funded for 100¢

    const cost = await recordSpend({
      feature: "chat",
      model: SONNET,
      inputTokens: ONE_MTOK, // 300¢ — overshoots the 100¢ budget
      outputTokens: 0,
    });
    expect(cost).toBe(300);

    const row = await ledger();
    expect(row.spendCents).toBe(300);
    expect(row.aiEnabled).toBe(false);
    expect(row.aiDisabledReason).toBe("budget");
  });

  it("leaves aiEnabled on while spend stays within budget", async () => {
    await seedLedger({ incomeCents: 10_000 }); // plenty of headroom

    await recordSpend({
      feature: "chat",
      model: SONNET,
      inputTokens: ONE_MTOK, // 300¢ — well under 10,000¢
      outputTokens: 0,
    });

    const row = await ledger();
    expect(row.spendCents).toBe(300);
    expect(row.aiEnabled).toBe(true);
    expect(row.aiDisabledReason).toBeNull();
  });

  it("records the usage event alongside the ledger increment", async () => {
    await seedLedger({ incomeCents: 10_000 });

    await recordSpend({
      userId: null,
      feature: "chat",
      model: SONNET,
      inputTokens: ONE_MTOK,
      outputTokens: 0,
    });

    const events = await getTestPrisma().aiUsageEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0].costCents).toBe(300);
    expect(events[0].feature).toBe("chat");
  });
});

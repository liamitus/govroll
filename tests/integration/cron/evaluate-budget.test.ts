import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/evaluate-budget/route";
import { previousPeriod } from "@/lib/budget";
import { getTestPrisma } from "../db";
import { invokeCron } from "../invoke";

describe("GET /api/cron/evaluate-budget", () => {
  it("rejects missing auth", async () => {
    const res = await invokeCron(GET, { auth: null });
    expect(res.status).toBe(401);
  });

  it("bootstraps the ledger and reports a snapshot", async () => {
    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.period).toBe("string");
    expect(body.period).toMatch(/^\d{4}-\d{2}$/);
    expect(body.carryoverCents).toBe(0);
    expect(body.incomeCents).toBe(0);
    expect(body.spendCents).toBe(0);

    const ledger = await getTestPrisma().budgetLedger.findUnique({
      where: { period: body.period },
    });
    expect(ledger).not.toBeNull();
  });

  it("reflects existing ledger spend", async () => {
    const period = new Date().toISOString().slice(0, 7);
    await getTestPrisma().budgetLedger.create({
      data: {
        period,
        incomeCents: 5000,
        spendCents: 1200,
        reserveCents: 0,
        aiEnabled: true,
      },
    });

    const res = await invokeCron(GET);
    const body = await res.json();
    expect(body.incomeCents).toBe(5000);
    expect(body.spendCents).toBe(1200);
    expect(body.aiEnabled).toBe(true);
  });

  it("seeds carryoverCents from previous period's surplus on bootstrap", async () => {
    // Previous month had $150 in donations and spent $50 → $100 surplus that
    // should roll forward when the current month's row is first created.
    await getTestPrisma().budgetLedger.create({
      data: {
        period: previousPeriod(),
        incomeCents: 15000,
        spendCents: 5000,
        reserveCents: 0,
        aiEnabled: true,
      },
    });

    const res = await invokeCron(GET);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.carryoverCents).toBe(10000);
    expect(body.incomeCents).toBe(0);
    expect(body.availableCents).toBe(10000);
    // Carryover covers spend, so AI must remain enabled across the rollover.
    expect(body.aiEnabled).toBe(true);
  });

  it("does not recompute carryover for an existing ledger row", async () => {
    const period = new Date().toISOString().slice(0, 7);
    await getTestPrisma().budgetLedger.create({
      data: {
        period: previousPeriod(),
        incomeCents: 20000,
        spendCents: 0,
        reserveCents: 0,
      },
    });
    // The current row already exists with a different (older) carryover —
    // bootstrap must not overwrite it on subsequent reads.
    await getTestPrisma().budgetLedger.create({
      data: {
        period,
        carryoverCents: 500,
        incomeCents: 0,
        spendCents: 0,
        reserveCents: 0,
        aiEnabled: true,
      },
    });

    const res = await invokeCron(GET);
    const body = await res.json();
    expect(body.carryoverCents).toBe(500);
  });

  it("clamps carryover at zero when the previous period overspent", async () => {
    // Edge case: spend exceeded income last month. We don't propagate a
    // negative balance into the new month — that would be punitive and would
    // hand-pause AI on day 1 even after a fresh donation comes in.
    await getTestPrisma().budgetLedger.create({
      data: {
        period: previousPeriod(),
        incomeCents: 1000,
        spendCents: 5000,
        reserveCents: 0,
      },
    });

    const res = await invokeCron(GET);
    const body = await res.json();
    expect(body.carryoverCents).toBe(0);
  });
});

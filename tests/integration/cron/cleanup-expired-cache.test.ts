import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/cleanup-expired-cache/route";
import { getTestPrisma } from "../db";
import { seedBill } from "../fixtures";
import { invokeCron } from "../invoke";

describe("GET /api/cron/cleanup-expired-cache", () => {
  it("rejects missing auth", async () => {
    const res = await invokeCron(GET, { auth: null });
    expect(res.status).toBe(401);
  });

  it("deletes only expired rows and leaves live ones", async () => {
    const bill = await seedBill({ billId: "hr-cache-119" });
    const prisma = getTestPrisma();
    const now = Date.now();

    await prisma.aiResponseCache.createMany({
      data: [
        {
          billId: bill.id,
          promptHash: "expired-a",
          response: "stale",
          model: "test",
          expiresAt: new Date(now - 24 * 60 * 60 * 1000),
        },
        {
          billId: bill.id,
          promptHash: "expired-b",
          response: "stale",
          model: "test",
          expiresAt: new Date(now - 1000),
        },
        {
          billId: bill.id,
          promptHash: "fresh",
          response: "live",
          model: "test",
          expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        },
      ],
    });

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(2);

    const remaining = await prisma.aiResponseCache.findMany({
      where: { billId: bill.id },
    });
    expect(remaining.map((r) => r.promptHash)).toEqual(["fresh"]);
  });

  it("returns ok and deletes nothing when the cache is clean", async () => {
    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(0);
  });
});

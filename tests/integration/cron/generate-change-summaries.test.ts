import { describe, expect, it } from "vitest";
import dayjs from "dayjs";
import { GET } from "@/app/api/cron/generate-change-summaries/route";
import { getTestPrisma } from "../db";
import { seedBill } from "../fixtures";
import { invokeCron } from "../invoke";

// The cron scopes to versions introduced in the last 7 days by default.
// Tests use dates relative to "now" so they stay inside that window as time
// passes. Older-version behavior is exercised on-demand via the bill page
// summary endpoint, not this cron.
const recentDate = (offsetDays = 0) =>
  dayjs().subtract(offsetDays, "day").toDate();

describe("GET /api/cron/generate-change-summaries", () => {
  it("rejects missing auth", async () => {
    const res = await invokeCron(GET, { auth: null });
    expect(res.status).toBe(401);
  });

  it("returns ok with no bills needing summaries", async () => {
    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("marks the first version as baseline (no AI call required)", async () => {
    const bill = await seedBill({ billId: "house_bill-70-119" });
    await getTestPrisma().billTextVersion.create({
      data: {
        billId: bill.id,
        versionCode: "ih",
        versionType: "Introduced",
        versionDate: recentDate(2),
        fullText: "Version 1 text",
      },
    });

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);

    const version = await getTestPrisma().billTextVersion.findFirst({
      where: { billId: bill.id, versionCode: "ih" },
    });
    expect(version?.changeSummary).toBe(
      "Initial version of the bill as introduced.",
    );
  });

  it("falls back gracefully when the AI gateway errors", async () => {
    // Default MSW handlers 503 the AI gateway — exercises the per-version
    // error path in generate-change-summaries.ts. The baseline version (ih)
    // still gets its static "Initial version" summary because that branch
    // doesn't hit the AI. Non-baseline versions stay null.
    const bill = await seedBill({ billId: "house_bill-71-119" });
    await getTestPrisma().billTextVersion.createMany({
      data: [
        {
          billId: bill.id,
          versionCode: "ih",
          versionType: "Introduced",
          versionDate: recentDate(3),
          fullText: "Original",
        },
        {
          billId: bill.id,
          versionCode: "rh",
          versionType: "Reported",
          versionDate: recentDate(1),
          fullText: "Reported",
        },
      ],
    });

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);

    const baseline = await getTestPrisma().billTextVersion.findFirst({
      where: { billId: bill.id, versionCode: "ih" },
    });
    const reported = await getTestPrisma().billTextVersion.findFirst({
      where: { billId: bill.id, versionCode: "rh" },
    });

    expect(baseline?.changeSummary).toBe(
      "Initial version of the bill as introduced.",
    );
    expect(reported?.changeSummary).toBeNull();
  });
});

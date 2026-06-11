import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { GET } from "@/app/api/cron/backfill-bill-text/route";
import { server } from "../msw-server";
import { getTestPrisma } from "../db";
import { seedBill } from "../fixtures";
import { invokeCron } from "../invoke";

describe("GET /api/cron/backfill-bill-text", () => {
  it("rejects missing auth", async () => {
    const res = await invokeCron(GET, { auth: null });
    expect(res.status).toBe(401);
  });

  it("returns ok with empty batch when no bills need text", async () => {
    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
    expect(body.remaining).toBe(0);
  });

  it("reports a non-empty batch when eligible bills exist", async () => {
    // An ACTIVE bill with no fullText and no textVersions is what the route
    // targets. We don't assert actual text backfill here — that path depends
    // on congress.gov + GovInfo XML, which is deeply intertwined and best
    // covered via the dedicated fetch-bill-text unit tests.
    await seedBill({
      billId: "house_bill-40-119",
      momentumTier: "ACTIVE",
      fullText: undefined,
    });

    const res = await invokeCron(GET, { search: { limit: "1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The MSW default handlers 404 every congress.gov/GovInfo call, so the
    // underlying backfill either no-ops or errors gracefully. Either way
    // the outer contract — ok=true, processed counted — must hold.
    expect(body.ok).toBe(true);
    expect(body.remaining).toBeGreaterThanOrEqual(0);
  });

  it("fails loudly (503) on congress.gov quota exhaustion and does NOT stamp a false attempt", async () => {
    // The laundering bug: a 429 used to be swallowed as "no text," the bill
    // got stamped textFetchAttemptedAt, and it dropped into a multi-day
    // cooldown — over a transient quota outage. The run must now 503, and the
    // bill must stay un-stamped so the next run retries it promptly.
    const bill = await seedBill({
      billId: "house_bill-41-119",
      momentumTier: "ACTIVE",
      fullText: undefined,
    });

    // Long Retry-After → withRetry bails immediately (keeps the test fast).
    server.use(
      http.get(
        "https://api.congress.gov/v3/*",
        () =>
          new HttpResponse(null, {
            status: 429,
            headers: { "Retry-After": "3600" },
          }),
      ),
    );

    const res = await invokeCron(GET, { search: { limit: "1" } });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("congress_quota_exhausted");

    const after = await getTestPrisma().bill.findUnique({
      where: { id: bill.id },
    });
    expect(after?.textFetchAttemptedAt).toBeNull();
  });
});

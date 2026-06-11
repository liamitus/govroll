import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { GET } from "@/app/api/cron/backfill-cosponsors/route";
import { server } from "../msw-server";
import { getTestPrisma } from "../db";
import { seedBill, seedRepresentative } from "../fixtures";
import { invokeCron } from "../invoke";

describe("GET /api/cron/backfill-cosponsors", () => {
  it("rejects missing auth", async () => {
    const res = await invokeCron(GET, { auth: null });
    expect(res.status).toBe(401);
  });

  it("returns ok with nothing to process when no eligible bills exist", async () => {
    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
  });

  it("persists BillCosponsor rows for a matched representative", async () => {
    const rep = await seedRepresentative({
      bioguideId: "T000478",
      firstName: "Ritchie",
      lastName: "Torres",
    });
    const bill = await seedBill({
      billId: "house_bill-50-119",
      momentumTier: "ACTIVE",
      // The route requires aggregate cosponsorCount > 0 to bother fetching.
    });
    await getTestPrisma().bill.update({
      where: { id: bill.id },
      data: { cosponsorCount: 1 },
    });

    server.use(
      http.get("https://api.congress.gov/v3/bill/119/hr/50/cosponsors", () =>
        HttpResponse.json({
          cosponsors: [
            {
              bioguideId: rep.bioguideId,
              firstName: rep.firstName,
              lastName: rep.lastName,
              sponsorshipDate: "2026-02-14",
              isOriginalCosponsor: true,
            },
          ],
        }),
      ),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(1);

    const rows = await getTestPrisma().billCosponsor.findMany({
      where: { billId: bill.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].representativeId).toBe(rep.id);
    expect(rows[0].isOriginal).toBe(true);
  });

  it("re-processes a bill whose existing cosponsor rows fall short of cosponsorCount", async () => {
    // Pre-fix the cron used `cosponsors: { none: {} }` — once a bill had
    // even one cosponsor row, it was skipped forever. A bill that stalled
    // mid-pagination (e.g. 250/330 rows persisted) could never catch up.
    const repA = await seedRepresentative({ bioguideId: "A000001" });
    const repB = await seedRepresentative({ bioguideId: "B000001" });

    const bill = await seedBill({
      billId: "house_bill-77-119",
      momentumTier: "ACTIVE",
    });
    await getTestPrisma().bill.update({
      where: { id: bill.id },
      data: { cosponsorCount: 2 },
    });

    // Seed ONLY repA — simulates a prior partial backfill.
    await getTestPrisma().billCosponsor.create({
      data: {
        billId: bill.id,
        representativeId: repA.id,
        isOriginal: true,
        sponsoredAt: new Date("2026-02-01"),
      },
    });

    server.use(
      http.get("https://api.congress.gov/v3/bill/119/hr/77/cosponsors", () =>
        HttpResponse.json({
          cosponsors: [
            {
              bioguideId: repA.bioguideId,
              firstName: repA.firstName,
              lastName: repA.lastName,
              sponsorshipDate: "2026-02-01",
              isOriginalCosponsor: true,
            },
            {
              bioguideId: repB.bioguideId,
              firstName: repB.firstName,
              lastName: repB.lastName,
              sponsorshipDate: "2026-02-10",
              isOriginalCosponsor: false,
            },
          ],
        }),
      ),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(1);

    const rows = await getTestPrisma().billCosponsor.findMany({
      where: { billId: bill.id },
    });
    expect(rows).toHaveLength(2);
  });

  it("fails loudly (503) when congress.gov is rate-limiting cosponsor fetches", async () => {
    // A 429 used to be swallowed (logged, then continue), leaving cosponsors
    // un-backfilled while the run reported success. It must now surface a 503.
    const bill = await seedBill({
      billId: "house_bill-43-119",
      momentumTier: "ACTIVE",
    });
    await getTestPrisma().bill.update({
      where: { id: bill.id },
      data: { cosponsorCount: 5 },
    });

    server.use(
      http.get(
        "https://api.congress.gov/v3/bill/119/hr/43/cosponsors",
        () =>
          new HttpResponse(null, {
            status: 429,
            headers: { "Retry-After": "3600" },
          }),
      ),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("congress_quota_exhausted");
  });
});

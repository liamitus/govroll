import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { GET } from "@/app/api/cron/fetch-bills/route";
import { server } from "../msw-server";
import { getTestPrisma } from "../db";
import { invokeCron } from "../invoke";

describe("GET /api/cron/fetch-bills", () => {
  it("rejects missing auth", async () => {
    const res = await invokeCron(GET, { auth: null });
    expect(res.status).toBe(401);
  });

  it("rejects wrong bearer", async () => {
    const res = await invokeCron(GET, { auth: "Bearer wrong" });
    expect(res.status).toBe(401);
  });

  it("returns ok when Congress.gov has no new bills", async () => {
    // Default handlers return 404 for any Congress.gov path. Override the
    // list endpoint with an empty array so the route exits cleanly through
    // its happy path rather than throwing on the unhandled request.
    server.use(
      http.get("https://api.congress.gov/v3/bill", () =>
        HttpResponse.json({ bills: [], pagination: { count: 0 } }),
      ),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(await getTestPrisma().bill.count()).toBe(0);
  });

  it("creates a new bill from Congress.gov list + detail", async () => {
    const congressListBill = {
      congress: 119,
      number: "4242",
      type: "HR",
      originChamber: "House",
      originChamberCode: "H",
      title: "Test Transparency Act",
      updateDate: "2026-03-01",
      latestAction: {
        actionDate: "2026-03-01",
        text: "Referred to the Committee on Oversight.",
      },
      url: "https://api.congress.gov/v3/bill/119/hr/4242?format=json",
    };

    let listCalls = 0;
    server.use(
      http.get("https://api.congress.gov/v3/bill", () => {
        listCalls++;
        // First call returns one bill; subsequent windows are empty so the
        // cursor loop terminates within the integration test budget.
        if (listCalls === 1) {
          return HttpResponse.json({
            bills: [congressListBill],
            pagination: { count: 1 },
          });
        }
        return HttpResponse.json({
          bills: [],
          pagination: { count: 0 },
        });
      }),
      // Detail endpoint — supplies introducedDate, which the list endpoint omits.
      http.get("https://api.congress.gov/v3/bill/119/hr/4242", () =>
        HttpResponse.json({
          bill: {
            congress: 119,
            number: "4242",
            type: "HR",
            introducedDate: "2026-02-28",
            title: "Test Transparency Act",
            latestAction: {
              actionDate: "2026-03-01",
              text: "Referred to the Committee on Oversight.",
            },
            updateDate: "2026-03-01T00:00:00Z",
          },
        }),
      ),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);

    const stored = await getTestPrisma().bill.findUnique({
      where: { billId: "house_bill-4242-119" },
    });
    expect(stored).not.toBeNull();
    expect(stored?.title).toBe("Test Transparency Act");
    expect(stored?.billType).toBe("house_bill");
    expect(stored?.currentChamber).toBe("house");
    expect(stored?.currentStatus).toBe("introduced");
    expect(stored?.introducedDate.toISOString().slice(0, 10)).toBe(
      "2026-02-28",
    );
    expect(stored?.latestActionText).toBe(
      "Referred to the Committee on Oversight.",
    );
    expect(stored?.link).toBe(
      "https://www.congress.gov/bill/119th-congress/house-bill/4242",
    );
  });

  it("updates an existing bill without stomping enriched metadata", async () => {
    // Seed a bill with refresh-bill-metadata-style enrichment already in
    // place: sponsor, summary, advanced currentStatus. The cron walking the
    // updateDate feed must NOT overwrite these — only title and latest
    // action belong to the list endpoint.
    const db = getTestPrisma();
    await db.bill.create({
      data: {
        billId: "senate_bill-99-119",
        title: "Old Title",
        date: new Date("2026-01-15"),
        billType: "senate_bill",
        currentChamber: "senate",
        currentStatus: "pass_over_senate",
        currentStatusDate: new Date("2026-02-10"),
        introducedDate: new Date("2026-01-15"),
        link: "https://www.congress.gov/bill/119th-congress/senate-bill/99",
        sponsor: "Sen. Jane Doe (D-XX)",
        shortText: "A CRS summary that took weeks to write.",
        latestActionText: "Passed Senate.",
        latestActionDate: new Date("2026-02-10"),
        congressNumber: 119,
      },
    });

    let listCalls = 0;
    server.use(
      http.get("https://api.congress.gov/v3/bill", () => {
        listCalls++;
        if (listCalls === 1) {
          return HttpResponse.json({
            bills: [
              {
                congress: 119,
                number: "99",
                type: "S",
                originChamber: "Senate",
                originChamberCode: "S",
                title: "Refreshed Title",
                updateDate: "2026-02-20",
                latestAction: {
                  actionDate: "2026-02-19",
                  text: "Received in the House.",
                },
              },
            ],
            pagination: { count: 1 },
          });
        }
        return HttpResponse.json({ bills: [], pagination: { count: 0 } });
      }),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);

    const stored = await db.bill.findUnique({
      where: { billId: "senate_bill-99-119" },
    });
    expect(stored?.title).toBe("Refreshed Title");
    expect(stored?.latestActionText).toBe("Received in the House.");
    // Enriched fields preserved
    expect(stored?.currentStatus).toBe("pass_over_senate");
    expect(stored?.sponsor).toBe("Sen. Jane Doe (D-XX)");
    expect(stored?.shortText).toBe("A CRS summary that took weeks to write.");
  });
});

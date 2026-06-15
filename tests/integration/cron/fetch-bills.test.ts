import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { GET } from "@/app/api/cron/fetch-bills/route";
import { server } from "../msw-server";
import { getTestPrisma } from "../db";
import { invokeCron } from "../invoke";

// Mirrors toCongressIso() in fetch-bills.ts: Congress.gov's documented
// "YYYY-MM-DDTHH:mm:ssZ", milliseconds stripped.
const congressIso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

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

  it("skips the lookback rewind when the cursor is far behind (catch-up)", async () => {
    // After an outage the cursor can sit days behind. The 48h rewind plus a 50s
    // budget that only clears ~48h of dense in-session windows would livelock
    // the cursor in place — it re-walks the same 48h every run and never
    // advances. A badly-behind cursor must therefore start its first window AT
    // the cursor, with no rewind, guaranteeing forward progress.
    const cursorDate = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    await getTestPrisma().ingestCursor.create({
      data: { key: "fetch-bills", cursor: cursorDate },
    });

    const fromDateTimes: string[] = [];
    server.use(
      http.get("https://api.congress.gov/v3/bill", ({ request }) => {
        const from = new URL(request.url).searchParams.get("fromDateTime");
        if (from) fromDateTimes.push(from);
        return HttpResponse.json({ bills: [], pagination: { count: 0 } });
      }),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    // First window starts exactly at the cursor — no 48h rewind.
    expect(fromDateTimes[0]).toBe(congressIso(cursorDate));
  });

  it("applies the lookback rewind when the cursor is recent (steady state)", async () => {
    // Within the catch-up threshold the feed is sparse, so a run clears many
    // windows and reaches `now` regardless — here the 48h rewind is pure upside
    // (re-checks recent windows for late-arriving Congress.gov edits).
    const cursorDate = new Date(Date.now() - 6 * 60 * 60 * 1000);
    await getTestPrisma().ingestCursor.create({
      data: { key: "fetch-bills", cursor: cursorDate },
    });

    const fromDateTimes: string[] = [];
    server.use(
      http.get("https://api.congress.gov/v3/bill", ({ request }) => {
        const from = new URL(request.url).searchParams.get("fromDateTime");
        if (from) fromDateTimes.push(from);
        return HttpResponse.json({ bills: [], pagination: { count: 0 } });
      }),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    // First window starts 48h before the cursor — the rewind is in effect.
    const rewound = new Date(cursorDate.getTime() - 48 * 60 * 60 * 1000);
    expect(fromDateTimes[0]).toBe(congressIso(rewound));
  });

  it("stops cleanly (no 500/page) when the list call returns 429", async () => {
    // A Congress.gov 429 is the shared API key's hourly quota — transient
    // backpressure, not a failure. The run must return a green 200 with the
    // cursor preserved and resume next time, NOT a 500 that pages on every hit.
    const cursorDate = new Date(Date.now() - 6 * 60 * 60 * 1000);
    await getTestPrisma().ingestCursor.create({
      data: { key: "fetch-bills", cursor: cursorDate },
    });

    server.use(
      http.get("https://api.congress.gov/v3/bill", () =>
        HttpResponse.json({ error: "rate limited" }, { status: 429 }),
      ),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.quotaLimited).toBe(true);

    // Cursor untouched so the next run resumes from exactly the same place.
    const cursor = await getTestPrisma().ingestCursor.findUnique({
      where: { key: "fetch-bills" },
    });
    expect(cursor?.cursor.toISOString()).toBe(cursorDate.toISOString());
  });

  it("stops cleanly when the detail call 429s mid-create", async () => {
    // The CREATE path fetches introducedDate from the detail endpoint, which
    // re-throws a 429 (it must never launder a quota outage into a missing
    // date). That rejection surfaces out of the upsert chunk — it must be
    // caught as a clean quota stop, not propagate to a 500.
    const cursorDate = new Date(Date.now() - 6 * 60 * 60 * 1000);
    await getTestPrisma().ingestCursor.create({
      data: { key: "fetch-bills", cursor: cursorDate },
    });

    server.use(
      http.get("https://api.congress.gov/v3/bill", () =>
        HttpResponse.json({
          bills: [
            {
              congress: 119,
              number: "5000",
              type: "HR",
              originChamberCode: "H",
              title: "Quota Test Act",
              updateDate: "2026-05-01",
              latestAction: { actionDate: "2026-05-01", text: "Introduced" },
            },
          ],
          pagination: { count: 1 },
        }),
      ),
      http.get("https://api.congress.gov/v3/bill/119/hr/5000", () =>
        HttpResponse.json({ error: "rate limited" }, { status: 429 }),
      ),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quotaLimited).toBe(true);
    // We bailed on quota before persisting — the new bill was not created.
    expect(await getTestPrisma().bill.count()).toBe(0);
  });
});

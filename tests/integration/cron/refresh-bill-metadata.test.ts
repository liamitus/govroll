import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { GET } from "@/app/api/cron/refresh-bill-metadata/route";
import { server } from "../msw-server";
import { getTestPrisma } from "../db";
import { seedBill } from "../fixtures";
import { invokeCron } from "../invoke";

describe("GET /api/cron/refresh-bill-metadata", () => {
  it("rejects missing auth", async () => {
    const res = await invokeCron(GET, { auth: null });
    expect(res.status).toBe(401);
  });

  it("returns ok when nothing needs refreshing", async () => {
    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("populates sponsor + policyArea from Congress.gov", async () => {
    const bill = await seedBill({
      billId: "house_bill-60-119",
      // sponsor is NULL by default — makes the bill eligible.
    });

    server.use(
      http.get("https://api.congress.gov/v3/bill/119/hr/60", () =>
        HttpResponse.json({
          bill: {
            title: "Congress.gov Title",
            sponsors: [
              {
                fullName: "Rep. Doe, Jane [D-CA-12]",
                firstName: "Jane",
                lastName: "Doe",
              },
            ],
            policyArea: { name: "Health" },
            latestAction: {
              actionDate: "2026-04-01",
              text: "Referred to the Subcommittee on Health.",
            },
            cosponsors: { count: 7, countIncludingWithdrawnCosponsors: 7 },
          },
        }),
      ),
      http.get("https://api.congress.gov/v3/bill/119/hr/60/cosponsors", () =>
        HttpResponse.json({
          cosponsors: [
            { party: "D", bioguideId: "D000001" },
            { party: "D", bioguideId: "D000002" },
            { party: "R", bioguideId: "R000001" },
          ],
        }),
      ),
      http.get("https://api.congress.gov/v3/bill/119/hr/60/summaries", () =>
        HttpResponse.json({
          summaries: [
            {
              text: "<p>This bill does something useful.</p>",
              updateDate: "2026-04-02",
            },
          ],
        }),
      ),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);

    const refreshed = await getTestPrisma().bill.findUnique({
      where: { id: bill.id },
    });
    expect(refreshed?.sponsor).toBeTruthy();
    expect(refreshed?.policyArea).toBe("Health");
    expect(refreshed?.latestActionText).toBe(
      "Referred to the Subcommittee on Health.",
    );
    expect(refreshed?.shortText).toContain("does something useful");
    // Summary arrived, so stamp the cooldown.
    expect(refreshed?.lastMetadataRefreshAt).not.toBeNull();
  });

  it("stamps the refresh cursor even without a summary, and still completes the bill on a later run", async () => {
    // A bill can have sponsor + metadata but still lack a CRS summary — newly
    // introduced bills often spend weeks in that state. We stamp
    // lastMetadataRefreshAt anyway: it's the cursor the cron's
    // `lastMetadataRefreshAt ASC NULLS FIRST` ordering rotates on, so a
    // summary-less bill drops to the back of the queue instead of re-running
    // forever. (The old "stamp only when a summary arrives" pinned the cursor
    // on the first page of summary-less bills and stalled 96% of the corpus.)
    // The bill stays eligible via its `shortText IS NULL` gap and finishes
    // once CRS finally publishes.
    const bill = await seedBill({ billId: "house_bill-61-119" });

    server.use(
      http.get("https://api.congress.gov/v3/bill/119/hr/61", () =>
        HttpResponse.json({
          bill: {
            title: "Title",
            sponsors: [{ fullName: "Rep. X [D-CA-1]", bioguideId: "X000001" }],
            policyArea: { name: "Taxation" },
            latestAction: { actionDate: "2026-04-10", text: "Referred." },
            cosponsors: { count: 0 },
          },
        }),
      ),
      http.get("https://api.congress.gov/v3/bill/119/hr/61/cosponsors", () =>
        HttpResponse.json({ cosponsors: [] }),
      ),
      // First run: CRS summary is not published yet.
      http.get("https://api.congress.gov/v3/bill/119/hr/61/summaries", () =>
        HttpResponse.json({ summaries: [] }),
      ),
    );

    await invokeCron(GET);
    const afterFirst = await getTestPrisma().bill.findUnique({
      where: { id: bill.id },
    });
    expect(afterFirst?.sponsor).toBeTruthy();
    expect(afterFirst?.shortText).toBeNull();
    // Summary still missing, but the cursor IS stamped so the cron advances
    // past this bill instead of re-fetching it every tick.
    expect(afterFirst?.lastMetadataRefreshAt).not.toBeNull();

    // Second run: CRS has now published. The bill is still eligible (shortText
    // is null) despite the earlier stamp, so the cron picks it up and finishes.
    server.use(
      http.get("https://api.congress.gov/v3/bill/119/hr/61/summaries", () =>
        HttpResponse.json({
          summaries: [
            { text: "<p>Now summarized.</p>", updateDate: "2026-05-01" },
          ],
        }),
      ),
    );

    await invokeCron(GET);
    const afterSecond = await getTestPrisma().bill.findUnique({
      where: { id: bill.id },
    });
    expect(afterSecond?.shortText).toContain("Now summarized");
  });

  it("processes never-refreshed bills before already-refreshed ones (cursor rotates by refresh recency, not sponsor name)", async () => {
    // Regression guard: the cron used to order by `sponsor ASC NULLS FIRST`.
    // With zero null-sponsor bills in prod that collapsed to alphabetical-by-
    // sponsor, so the same bills were re-fetched every run while never-
    // refreshed bills further down the alphabet starved. The cursor is now
    // `lastMetadataRefreshAt ASC NULLS FIRST`, so a never-refreshed bill wins
    // over an already-refreshed one *even when its sponsor sorts later*.

    // Already-refreshed, sponsor sorts FIRST alphabetically. Still has a gap
    // (shortText null) so it remains eligible — but must not be picked first.
    const alreadyRefreshed = await seedBill({
      billId: "house_bill-80-119",
      sponsor: "AAA Sponsor [D-CA-1]",
      lastMetadataRefreshAt: new Date("2026-06-10T00:00:00Z"),
    });
    // Never-refreshed, sponsor sorts LAST alphabetically.
    const neverRefreshed = await seedBill({
      billId: "house_bill-81-119",
      sponsor: "ZZZ Sponsor [R-TX-2]",
    });

    // Mock BOTH bills so the assertion turns on ordering, not on which mock
    // exists: under the old ordering `alreadyRefreshed` would be picked.
    for (const n of [80, 81]) {
      server.use(
        http.get(`https://api.congress.gov/v3/bill/119/hr/${n}`, () =>
          HttpResponse.json({
            bill: {
              title: "Title",
              sponsors: [{ fullName: "Sponsor", bioguideId: "S000001" }],
              latestAction: { actionDate: "2026-04-10", text: "Referred." },
              cosponsors: { count: 0 },
            },
          }),
        ),
        http.get(
          `https://api.congress.gov/v3/bill/119/hr/${n}/cosponsors`,
          () => HttpResponse.json({ cosponsors: [] }),
        ),
        http.get(`https://api.congress.gov/v3/bill/119/hr/${n}/summaries`, () =>
          HttpResponse.json({
            summaries: [
              { text: "<p>Fetched summary.</p>", updateDate: "2026-05-01" },
            ],
          }),
        ),
      );
    }

    // Only one slot — the cursor decides who gets it.
    await invokeCron(GET, { search: { limit: 1 } });

    const db = getTestPrisma();
    const never = await db.bill.findUnique({
      where: { id: neverRefreshed.id },
    });
    const already = await db.bill.findUnique({
      where: { id: alreadyRefreshed.id },
    });

    // Never-refreshed bill won the slot.
    expect(never?.shortText).toContain("Fetched summary");
    // Already-refreshed bill was left untouched this run.
    expect(already?.shortText).toBeNull();
    expect(already?.lastMetadataRefreshAt?.toISOString()).toBe(
      "2026-06-10T00:00:00.000Z",
    );
  });
});

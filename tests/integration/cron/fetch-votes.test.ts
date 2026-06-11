import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { GET } from "@/app/api/cron/fetch-votes/route";
import { server } from "../msw-server";
import { getTestPrisma } from "../db";
import { seedBill, seedRepresentative } from "../fixtures";
import { invokeCron } from "../invoke";

type VoteVoter = {
  person: { bioguideid: string };
  option: { value: string };
  vote: {
    related_bill: number;
    number: number;
    chamber: string;
    created: string;
    category: string;
  };
};

type BillFixture = {
  govtrackId: number;
  bill_type: string;
  number: number;
  congress: number;
  introduced_date: string;
  current_chamber: string;
  current_status: string;
  current_status_date: string;
  link: string;
  title_without_number: string;
};

/**
 * Wire up MSW so GovTrack returns `voters` on the first vote_voter call and
 * empty on subsequent calls (the route walks ~2 days; we only want data
 * on the first pass). Bills resolve out of the supplied fixture map by
 * GovTrack id; anything else 404s.
 */
function mockGovTrack(voters: VoteVoter[], bills: BillFixture[]) {
  const byId = new Map(bills.map((b) => [b.govtrackId, b]));
  let voterCalls = 0;
  server.use(
    http.get("https://www.govtrack.us/api/v2/vote_voter", () => {
      voterCalls++;
      if (voterCalls > 1) {
        return HttpResponse.json({ objects: [], meta: { total_count: 0 } });
      }
      return HttpResponse.json({
        objects: voters,
        meta: { total_count: voters.length },
      });
    }),
    http.get("https://www.govtrack.us/api/v2/bill/:id", ({ params }) => {
      const id = Number(params.id);
      const bill = byId.get(id);
      if (!bill) return HttpResponse.json({}, { status: 404 });
      const { govtrackId: _govtrackId, ...payload } = bill;
      return HttpResponse.json(payload);
    }),
  );
}

function makeVoter(
  overrides: Partial<VoteVoter> & { bioguideId: string },
): VoteVoter {
  return {
    person: { bioguideid: overrides.bioguideId },
    option: overrides.option ?? { value: "Yea" },
    vote: overrides.vote ?? {
      related_bill: 99999,
      number: 321,
      chamber: "senate",
      created: "2026-04-10T19:00:00Z",
      category: "passage",
    },
  };
}

function makeBill(
  overrides: Partial<BillFixture> & { govtrackId: number },
): BillFixture {
  return {
    govtrackId: overrides.govtrackId,
    bill_type: overrides.bill_type ?? "s",
    number: overrides.number ?? 1234,
    congress: overrides.congress ?? 119,
    introduced_date: overrides.introduced_date ?? "2026-02-01",
    current_chamber: overrides.current_chamber ?? "senate",
    current_status: overrides.current_status ?? "passed_senate",
    current_status_date: overrides.current_status_date ?? "2026-04-10",
    link:
      overrides.link ??
      `https://www.govtrack.us/congress/bills/119/s${overrides.number ?? 1234}`,
    title_without_number:
      overrides.title_without_number ?? "Integration Vote Test Act",
  };
}

describe("GET /api/cron/fetch-votes", () => {
  it("rejects missing auth", async () => {
    const res = await invokeCron(GET, { auth: null });
    expect(res.status).toBe(401);
  });

  it("returns ok when GovTrack has no votes", async () => {
    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    expect(await getTestPrisma().representativeVote.count()).toBe(0);
  });

  it("upserts bill + representativeVote for a known representative", async () => {
    const rep = await seedRepresentative({
      bioguideId: "S000148",
      firstName: "Chuck",
      lastName: "Schumer",
      state: "NY",
      chamber: "senator",
    });

    mockGovTrack(
      [makeVoter({ bioguideId: rep.bioguideId })],
      [makeBill({ govtrackId: 99999 })],
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);

    const bill = await getTestPrisma().bill.findUnique({
      where: { billId: "s-1234-119" },
    });
    expect(bill).not.toBeNull();

    const votes = await getTestPrisma().representativeVote.findMany({
      where: { representativeId: rep.id },
    });
    expect(votes).toHaveLength(1);
    expect(votes[0].vote).toBe("Yea");
    expect(votes[0].rollCallNumber).toBe(321);
  });

  it("stores one bill row and N vote rows when many reps vote the same bill", async () => {
    const reps = await Promise.all([
      seedRepresentative({
        bioguideId: "S000001",
        state: "NY",
        chamber: "senator",
      }),
      seedRepresentative({
        bioguideId: "S000002",
        state: "CA",
        chamber: "senator",
      }),
      seedRepresentative({
        bioguideId: "S000003",
        state: "TX",
        chamber: "senator",
      }),
    ]);

    mockGovTrack(
      reps.map((r, i) =>
        makeVoter({
          bioguideId: r.bioguideId,
          option: { value: i === 0 ? "Nay" : "Yea" },
          vote: {
            related_bill: 42,
            number: 77,
            chamber: "senate",
            created: "2026-04-10T19:00:00Z",
            category: "passage",
          },
        }),
      ),
      [makeBill({ govtrackId: 42, number: 2222 })],
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);

    const billRows = await getTestPrisma().bill.findMany({
      where: { billId: "s-2222-119" },
    });
    expect(billRows).toHaveLength(1);

    const votes = await getTestPrisma().representativeVote.findMany({
      where: { billId: billRows[0].id },
      orderBy: { representativeId: "asc" },
    });
    expect(votes).toHaveLength(3);
    expect(votes.map((v) => v.rollCallNumber)).toEqual([77, 77, 77]);
    expect(new Set(votes.map((v) => v.vote))).toEqual(new Set(["Nay", "Yea"]));
  });

  it("creates one bill per distinct GovTrack id when voters span multiple bills", async () => {
    const rep1 = await seedRepresentative({
      bioguideId: "H000001",
      chamber: "house",
    });
    const rep2 = await seedRepresentative({
      bioguideId: "H000002",
      chamber: "house",
    });

    mockGovTrack(
      [
        makeVoter({
          bioguideId: rep1.bioguideId,
          vote: {
            related_bill: 101,
            number: 1,
            chamber: "house",
            created: "2026-04-10T19:00:00Z",
            category: "passage",
          },
        }),
        makeVoter({
          bioguideId: rep2.bioguideId,
          vote: {
            related_bill: 202,
            number: 2,
            chamber: "house",
            created: "2026-04-10T19:00:00Z",
            category: "passage",
          },
        }),
      ],
      [
        makeBill({
          govtrackId: 101,
          bill_type: "hr",
          number: 111,
          current_chamber: "house",
        }),
        makeBill({
          govtrackId: 202,
          bill_type: "hr",
          number: 222,
          current_chamber: "house",
        }),
      ],
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);

    const bills = await getTestPrisma().bill.findMany({
      where: { billId: { in: ["hr-111-119", "hr-222-119"] } },
      orderBy: { billId: "asc" },
    });
    expect(bills.map((b) => b.billId)).toEqual(["hr-111-119", "hr-222-119"]);
    expect(await getTestPrisma().representativeVote.count()).toBe(2);
  });

  it("is idempotent — running twice yields the same rows", async () => {
    const rep = await seedRepresentative({
      bioguideId: "S000042",
      chamber: "senator",
    });

    const setupHandlers = () =>
      mockGovTrack(
        [makeVoter({ bioguideId: rep.bioguideId })],
        [makeBill({ govtrackId: 99999 })],
      );

    setupHandlers();
    const first = await invokeCron(GET);
    expect(first.status).toBe(200);

    // Reset handlers for the second run; afterEach hasn't fired yet so the
    // DB state is the accumulated state from the first call.
    server.resetHandlers();
    setupHandlers();
    const second = await invokeCron(GET);
    expect(second.status).toBe(200);

    const votes = await getTestPrisma().representativeVote.findMany({
      where: { representativeId: rep.id },
    });
    expect(votes).toHaveLength(1);
    expect(
      await getTestPrisma().bill.count({ where: { billId: "s-1234-119" } }),
    ).toBe(1);
  });

  it("silently skips voters whose representative is not in our DB", async () => {
    const known = await seedRepresentative({
      bioguideId: "S000KNOWN",
      chamber: "senator",
    });

    mockGovTrack(
      [
        makeVoter({ bioguideId: "S000MISSING" }),
        makeVoter({ bioguideId: known.bioguideId }),
      ],
      [makeBill({ govtrackId: 99999 })],
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    expect(await getTestPrisma().representativeVote.count()).toBe(1);
    const [vote] = await getTestPrisma().representativeVote.findMany();
    expect(vote.representativeId).toBe(known.id);
  });

  it("skips voters whose bill lookup returns 404 without crashing", async () => {
    const rep = await seedRepresentative({
      bioguideId: "S000404",
      chamber: "senator",
    });

    // Voter references bill id 77777 — not in the fixture map, so the
    // default msw-handlers.ts 404 for /bill/:id applies.
    mockGovTrack(
      [
        makeVoter({
          bioguideId: rep.bioguideId,
          vote: {
            related_bill: 77777,
            number: 5,
            chamber: "senate",
            created: "2026-04-10T19:00:00Z",
            category: "passage",
          },
        }),
      ],
      [],
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    expect(await getTestPrisma().representativeVote.count()).toBe(0);
  });

  it("does not clobber existing bill metadata (that belongs to fetch-bills)", async () => {
    // Bill already exists in our DB with the authoritative title. A voter
    // arrives referencing the same canonical bill id but GovTrack returns
    // a stale/different title. fetch-votes should NOT overwrite title,
    // status, or other bill metadata — its job is votes, not bills.
    const rep = await seedRepresentative({
      bioguideId: "S000999",
      chamber: "senator",
    });
    const preexisting = await seedBill({
      billId: "s-5555-119",
      title: "Authoritative Title From Fetch-Bills",
      currentStatus: "enacted",
    });

    mockGovTrack(
      [
        makeVoter({
          bioguideId: rep.bioguideId,
          vote: {
            related_bill: 123,
            number: 99,
            chamber: "senate",
            created: "2026-04-10T19:00:00Z",
            category: "passage",
          },
        }),
      ],
      [
        makeBill({
          govtrackId: 123,
          number: 5555,
          title_without_number: "Stale Title From GovTrack",
          current_status: "introduced",
        }),
      ],
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);

    const bill = await getTestPrisma().bill.findUnique({
      where: { id: preexisting.id },
    });
    expect(bill?.title).toBe("Authoritative Title From Fetch-Bills");
    expect(bill?.currentStatus).toBe("enacted");

    const votes = await getTestPrisma().representativeVote.findMany({
      where: { billId: preexisting.id },
    });
    expect(votes).toHaveLength(1);
  });

  it("returns 500 when GovTrack is down (systemic failure is not laundered into ok)", async () => {
    // The core regression: a GovTrack/DB outage used to be swallowed and the
    // cron returned {ok:true}/200, so GH Actions went green over a broken run.
    // It must now surface as a 500 so the route fires reportError and the
    // Action fails red.
    server.use(
      http.get(
        "https://www.govtrack.us/api/v2/vote_voter",
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

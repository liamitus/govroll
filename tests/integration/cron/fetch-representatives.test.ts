import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { GET } from "@/app/api/cron/fetch-representatives/route";
import { server } from "../msw-server";
import { getTestPrisma } from "../db";
import { invokeCron } from "../invoke";

describe("GET /api/cron/fetch-representatives", () => {
  it("rejects missing auth", async () => {
    const res = await invokeCron(GET, { auth: null });
    expect(res.status).toBe(401);
  });

  it("returns ok with empty roster", async () => {
    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(await getTestPrisma().representative.count()).toBe(0);
  });

  it("upserts a representative from a GovTrack role", async () => {
    server.use(
      http.get("https://www.govtrack.us/api/v2/role", () =>
        HttpResponse.json({
          objects: [
            {
              state: "CA",
              district: 12,
              party: "Democrat",
              role_type_label: "Representative",
              person: {
                bioguideid: "P000197",
                firstname: "Nancy",
                lastname: "Pelosi",
                name: "Nancy Pelosi",
                link: "https://www.govtrack.us/congress/members/p000197",
              },
            },
          ],
          meta: { total_count: 1 },
        }),
      ),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);

    const rep = await getTestPrisma().representative.findUnique({
      where: { bioguideId: "P000197" },
    });
    expect(rep?.lastName).toBe("Pelosi");
    expect(rep?.party).toBe("Democrat");
    expect(rep?.chamber).toBe("representative");
    expect(rep?.state).toBe("CA");
  });

  it("returns 500 when GovTrack roles endpoint is down", async () => {
    server.use(
      http.get(
        "https://www.govtrack.us/api/v2/role",
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    const res = await invokeCron(GET);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("disambiguates slugs for two same-named members instead of aborting the sweep", async () => {
    // There really are two Rep. Mike Rogers (AL-03 and MI-08). On the create
    // path the second one collides on the unique `slug` — pre-fix that threw
    // and (being swallowed) silently aborted the entire weekly roster sweep.
    // Now each upsert is isolated and the slug is disambiguated by state.
    server.use(
      http.get("https://www.govtrack.us/api/v2/role", () =>
        HttpResponse.json({
          objects: [
            {
              state: "AL",
              district: 3,
              party: "Republican",
              role_type_label: "Representative",
              person: {
                bioguideid: "R000575",
                firstname: "Mike",
                lastname: "Rogers",
                name: "Mike Rogers",
                link: "https://www.govtrack.us/congress/members/r000575",
              },
            },
            {
              state: "MI",
              district: 8,
              party: "Republican",
              role_type_label: "Representative",
              person: {
                bioguideid: "R000585",
                firstname: "Mike",
                lastname: "Rogers",
                name: "Mike Rogers",
                link: "https://www.govtrack.us/congress/members/r000585",
              },
            },
          ],
          meta: { total_count: 2 },
        }),
      ),
    );

    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const reps = await getTestPrisma().representative.findMany({
      orderBy: { bioguideId: "asc" },
    });
    // BOTH members are stored — the collision did not abort the sweep.
    expect(reps).toHaveLength(2);
    const slugs = reps.map((r) => r.slug).sort();
    expect(slugs).toEqual(["mike-rogers", "mike-rogers-mi"]);
    // And the slugs are distinct (the unique constraint is satisfied).
    expect(new Set(slugs).size).toBe(2);
  });
});

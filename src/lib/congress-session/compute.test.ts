import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Signal } from "./types";

// The waterfall pulls its signals from four sibling modules (two scrapers,
// vote recency, calendar). Mock them so we can drive each branch deterministically
// without network or DB — compute.ts only reaches prisma *through* these.
vi.mock("./clerk-xml", () => ({ getHouseClerkSignal: vi.fn() }));
vi.mock("./senate-pail", () => ({ getSenatePailSignal: vi.fn() }));
vi.mock("./vote-recency", () => ({ getVoteRecencySignal: vi.fn() }));
vi.mock("./calendar", () => ({
  getRecessToday: vi.fn(),
  getNextRecess: vi.fn(),
  nextInSessionDate: vi.fn(),
}));

import { computeChamberStatus } from "./compute";
import { getHouseClerkSignal } from "./clerk-xml";
import { getSenatePailSignal } from "./senate-pail";
import { getVoteRecencySignal } from "./vote-recency";
import { getRecessToday, getNextRecess, nextInSessionDate } from "./calendar";

const houseClerk = vi.mocked(getHouseClerkSignal);
const senatePail = vi.mocked(getSenatePailSignal);
const voteRecency = vi.mocked(getVoteRecencySignal);
const recessToday = vi.mocked(getRecessToday);
const nextRecess = vi.mocked(getNextRecess);
const nextSession = vi.mocked(nextInSessionDate);

// computeChamberStatus only touches prisma through the (now mocked) calendar
// and vote-recency modules, so a bare object stands in for the client fine.
const prisma = {} as Parameters<typeof computeChamberStatus>[0];

// What both scrapers emit when the floor log has no entry for today — the
// signal at the heart of the recess-vs-no_session distinction.
const senateNotListed: Signal = {
  status: "recess",
  observedAt: null,
  detail: "Senate not listed on today's floor calendar",
  source: "senate_pail",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Silent defaults; each test overrides the signal(s) it cares about.
  houseClerk.mockResolvedValue(null);
  senatePail.mockResolvedValue(null);
  voteRecency.mockResolvedValue(null);
  recessToday.mockResolvedValue(null);
  nextRecess.mockResolvedValue(null);
  nextSession.mockResolvedValue(null);
});

describe("computeChamberStatus — no_session vs recess", () => {
  it("a quiet scheduled weekday (scraper not listed, no calendar recess) resolves to no_session, not recess", async () => {
    // Friday Jun 12 2026, ~noon ET. A weekday, NOT inside any recess window —
    // the published schedule says it's a session day, but the Senate isn't on
    // the floor log. That's "no session today," not a District Work Period.
    const now = new Date("2026-06-12T16:00:00Z");
    senatePail.mockResolvedValue(senateNotListed);
    nextSession.mockResolvedValue(new Date("2026-06-15T00:00:00Z")); // next weekday

    const status = await computeChamberStatus(prisma, "senate", now);

    expect(status.status).toBe("no_session");
    expect(status.source).toBe("senate_pail");
    expect(status.detail).toBe("Senate not listed on today's floor calendar");
    // "Next session …" — never the "Returns …" of a chamber away on a block.
    expect(status.nextTransitionLabel).toBe("Next session Mon, Jun 15");
  });

  it("inside a published recess window, the same not-listed scraper stays recess with the window's name (step 4 wins)", async () => {
    const now = new Date("2026-06-12T16:00:00Z");
    senatePail.mockResolvedValue(senateNotListed);
    recessToday.mockResolvedValue({
      startDate: new Date("2026-06-12T00:00:00Z"),
      endDate: new Date("2026-06-22T00:00:00Z"),
      label: "Juneteenth District Work Period",
    });
    nextSession.mockResolvedValue(new Date("2026-06-23T00:00:00Z"));

    const status = await computeChamberStatus(prisma, "senate", now);

    expect(status.status).toBe("recess");
    expect(status.source).toBe("calendar");
    expect(status.detail).toBe("Juneteenth District Work Period");
    expect(status.nextTransitionLabel).toBe("Returns Tue, Jun 23");
  });

  it("on a weekend, a not-listed scraper resolves to the weekend recess message (step 5), not no_session", async () => {
    const now = new Date("2026-06-13T16:00:00Z"); // Saturday, noon ET
    senatePail.mockResolvedValue(senateNotListed);
    nextSession.mockResolvedValue(new Date("2026-06-15T00:00:00Z"));

    const status = await computeChamberStatus(prisma, "senate", now);

    expect(status.status).toBe("recess");
    expect(status.detail).toBe("Weekend — chamber not in session");
  });

  it("applies symmetrically to the House — clerk reports no proceedings on a session weekday → no_session", async () => {
    const now = new Date("2026-06-12T16:00:00Z");
    houseClerk.mockResolvedValue({
      status: "recess",
      observedAt: null,
      detail: "No floor proceedings published today",
      source: "clerk_xml",
    });
    nextSession.mockResolvedValue(new Date("2026-06-15T00:00:00Z"));

    const status = await computeChamberStatus(prisma, "house", now);

    expect(status.status).toBe("no_session");
    expect(status.source).toBe("clerk_xml");
    expect(status.nextTransitionLabel).toBe("Next session Mon, Jun 15");
  });

  it("a live in_session scraper signal still wins outright — the waterfall above step 6 is unchanged", async () => {
    const now = new Date("2026-06-12T16:00:00Z");
    senatePail.mockResolvedValue({
      status: "in_session",
      observedAt: new Date("2026-06-12T15:30:00Z"),
      detail: "Senate convened — floor in session",
      source: "senate_pail",
    });
    nextRecess.mockResolvedValue({
      startDate: new Date("2026-06-19T00:00:00Z"),
      endDate: new Date("2026-06-19T00:00:00Z"),
      label: "Juneteenth",
    });

    const status = await computeChamberStatus(prisma, "senate", now);

    expect(status.status).toBe("in_session");
    expect(status.nextTransitionLabel).toBe("Next recess Jun 19 — Juneteenth");
  });
});

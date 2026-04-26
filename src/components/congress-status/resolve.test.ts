import { describe, it, expect } from "vitest";
import { resolveOverall, effectiveStatus, STALE_THRESHOLD_MS } from "./resolve";
import type { ChamberStatusPayload } from "@/app/api/congress/status/route";
import type { Chamber, StatusCode } from "@/lib/congress-session/types";

const NOW = Date.parse("2026-04-26T20:00:00Z"); // Sunday

function makePayload(
  chamber: Chamber,
  status: StatusCode,
  nextTransitionAt: string | null,
  nextTransitionLabel: string | null,
  overrides: Partial<ChamberStatusPayload> = {},
): ChamberStatusPayload {
  return {
    chamber,
    status,
    detail: null,
    source: "calendar",
    lastActionAt: null,
    nextTransitionAt,
    nextTransitionLabel,
    lastCheckedAt: new Date(NOW - 60_000).toISOString(), // 1 min ago — fresh
    ...overrides,
  };
}

describe("resolveOverall", () => {
  it("when both chambers are in recess, surfaces the earlier return — fixes the weekend-vs-named-recess pill bug", () => {
    // House is in a multi-week District Work Period; Senate is just out for
    // the weekend. The pill should answer "when's Congress next back?" with
    // the imminent Monday return, not the distant House return.
    const data = {
      chambers: {
        house: makePayload(
          "house",
          "recess",
          "2026-05-04T00:00:00Z",
          "Returns Mon, May 4",
        ),
        senate: makePayload(
          "senate",
          "recess",
          "2026-04-27T00:00:00Z",
          "Returns Mon, Apr 27",
        ),
      },
    };

    const r = resolveOverall(data, NOW);
    expect(r.status).toBe("recess");
    expect(r.primaryChamber).toBe("senate");
    expect(r.nextTransitionLabel).toBe("Returns Mon, Apr 27");
  });

  it("falls back to the House when the Senate is null (no priority tie)", () => {
    const data = {
      chambers: {
        house: makePayload(
          "house",
          "recess",
          "2026-05-04T00:00:00Z",
          "Returns Mon, May 4",
        ),
        senate: null,
      },
    };

    const r = resolveOverall(data, NOW);
    expect(r.status).toBe("recess");
    expect(r.primaryChamber).toBe("house");
    expect(r.nextTransitionLabel).toBe("Returns Mon, May 4");
  });

  it("voting outranks recess regardless of which chamber is voting", () => {
    const data = {
      chambers: {
        house: makePayload("house", "recess", null, null),
        senate: makePayload(
          "senate",
          "voting",
          "2026-05-23T00:00:00Z",
          "Next recess May 23 — Memorial Day",
        ),
      },
    };

    const r = resolveOverall(data, NOW);
    expect(r.status).toBe("voting");
    expect(r.primaryChamber).toBe("senate");
  });

  it("when both are voting, prefers the chamber that breaks first", () => {
    const data = {
      chambers: {
        house: makePayload(
          "house",
          "voting",
          "2026-05-23T00:00:00Z",
          "Next recess May 23",
        ),
        senate: makePayload(
          "senate",
          "voting",
          "2026-05-09T00:00:00Z",
          "Next recess May 9",
        ),
      },
    };

    const r = resolveOverall(data, NOW);
    expect(r.primaryChamber).toBe("senate");
    expect(r.nextTransitionLabel).toBe("Next recess May 9");
  });

  it("ties break consistently when both nextTransitionAt are null (House wins)", () => {
    const data = {
      chambers: {
        house: makePayload("house", "recess", null, null),
        senate: makePayload("senate", "recess", null, null),
      },
    };

    const r = resolveOverall(data, NOW);
    expect(r.primaryChamber).toBe("house");
  });

  it("returns unknown when no data", () => {
    const r = resolveOverall(undefined, NOW);
    expect(r.status).toBe("unknown");
    expect(r.primaryChamber).toBeNull();
  });

  it("returns unknown when both chambers are null", () => {
    const data = { chambers: { house: null, senate: null } };
    const r = resolveOverall(data, NOW);
    expect(r.status).toBe("unknown");
    expect(r.primaryChamber).toBeNull();
  });

  it("downgrades a stale chamber to unknown so a fresh recess can win the tie", () => {
    // House row is fresh (recess), Senate row is stale (would be voting if
    // we trusted it). The pill should pick the house and not lie about
    // ongoing votes.
    const stale = new Date(NOW - STALE_THRESHOLD_MS * 4).toISOString();
    const data = {
      chambers: {
        house: makePayload(
          "house",
          "recess",
          "2026-04-27T00:00:00Z",
          "Returns Mon, Apr 27",
        ),
        senate: makePayload("senate", "voting", null, null, {
          lastCheckedAt: stale,
        }),
      },
    };

    const r = resolveOverall(data, NOW);
    expect(r.status).toBe("recess");
    expect(r.primaryChamber).toBe("house");
  });
});

describe("effectiveStatus", () => {
  it("returns the stored status when fresh", () => {
    const p = makePayload("house", "voting", null, null);
    expect(effectiveStatus(p, NOW)).toBe("voting");
  });

  it("downgrades to unknown when older than 3× STALE_THRESHOLD_MS", () => {
    const p = makePayload("house", "voting", null, null, {
      lastCheckedAt: new Date(NOW - STALE_THRESHOLD_MS * 4).toISOString(),
    });
    expect(effectiveStatus(p, NOW)).toBe("unknown");
  });

  it("returns unknown for null payload", () => {
    expect(effectiveStatus(null, NOW)).toBe("unknown");
    expect(effectiveStatus(undefined, NOW)).toBe("unknown");
  });
});

import { describe, it, expect } from "vitest";
import {
  resolveOverall,
  effectiveStatus,
  labelFor,
  chamberHintFor,
  STALE_THRESHOLD_MS,
} from "./resolve";
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
    scheduledConveneAt: null,
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

describe("resolveOverall — adjourned_today", () => {
  it("picks the in-session chamber over an adjourned-today chamber (one is still live)", () => {
    const data = {
      chambers: {
        house: makePayload(
          "house",
          "in_session",
          "2026-05-23T00:00:00Z",
          "Next recess May 23",
        ),
        senate: makePayload(
          "senate",
          "adjourned_today",
          "2026-04-28T00:00:00Z",
          "Returns Tue, Apr 28",
        ),
      },
    };

    const r = resolveOverall(data, NOW);
    expect(r.status).toBe("in_session");
    expect(r.primaryChamber).toBe("house");
  });

  it("picks the adjourned-today chamber over a chamber in recess (active today beats not-active-today)", () => {
    // Senate gaveled in earlier today and adjourned for the day; House is in
    // a multi-week District Work Period. The pill should reflect the chamber
    // that was actually working today.
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
          "adjourned_today",
          "2026-04-28T00:00:00Z",
          "Returns Tue, Apr 28",
        ),
      },
    };

    const r = resolveOverall(data, NOW);
    expect(r.status).toBe("adjourned_today");
    expect(r.primaryChamber).toBe("senate");
    expect(r.nextTransitionLabel).toBe("Returns Tue, Apr 28");
  });
});

describe("resolveOverall — pre_session", () => {
  it("picks the pre_session chamber over a chamber in multi-day recess (the screenshot bug)", () => {
    // The motivating case: House is in a multi-week District Work Period
    // and Senate is scheduled to convene at 10am today. The pill should
    // surface the imminent Senate convene, not the distant House return —
    // and the next-transition label should be the convene time, not the
    // contradictory "Returns Wed, Apr 29" that nextInSessionDate produced
    // when this state was incorrectly modeled as `recess`.
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
          "pre_session",
          "2026-04-28T14:00:00Z", // 10am ET = 14:00 UTC
          "Convenes at 10:00 a.m. ET",
        ),
      },
    };

    const r = resolveOverall(data, NOW);
    expect(r.status).toBe("pre_session");
    expect(r.primaryChamber).toBe("senate");
    expect(r.nextTransitionLabel).toBe("Convenes at 10:00 a.m. ET");
  });

  it("picks pre_session over adjourned_today (about-to-start beats already-done)", () => {
    // House gaveled in earlier today and adjourned; Senate is about to
    // convene. The actionable signal is the imminent Senate session.
    const data = {
      chambers: {
        house: makePayload(
          "house",
          "adjourned_today",
          "2026-04-29T00:00:00Z",
          "Returns Wed, Apr 29",
        ),
        senate: makePayload(
          "senate",
          "pre_session",
          "2026-04-28T14:00:00Z",
          "Convenes at 10:00 a.m. ET",
        ),
      },
    };

    const r = resolveOverall(data, NOW);
    expect(r.status).toBe("pre_session");
    expect(r.primaryChamber).toBe("senate");
  });

  it("in_session still outranks pre_session (one chamber actually live trumps the other about to start)", () => {
    const data = {
      chambers: {
        house: makePayload(
          "house",
          "in_session",
          "2026-05-23T00:00:00Z",
          "Next recess May 23",
        ),
        senate: makePayload(
          "senate",
          "pre_session",
          "2026-04-28T14:00:00Z",
          "Convenes at 10:00 a.m. ET",
        ),
      },
    };

    const r = resolveOverall(data, NOW);
    expect(r.status).toBe("in_session");
    expect(r.primaryChamber).toBe("house");
  });
});

describe("labelFor", () => {
  it('returns "Adjourned" for adjourned_today (chamber is done for the day, not still in session)', () => {
    expect(labelFor("adjourned_today")).toBe("Adjourned");
  });

  it('returns "Opening soon" for pre_session', () => {
    expect(labelFor("pre_session")).toBe("Opening soon");
  });

  it("covers every StatusCode value (no fall-through)", () => {
    const codes: StatusCode[] = [
      "voting",
      "in_session",
      "pro_forma",
      "pre_session",
      "adjourned_today",
      "adjourned_sine_die",
      "recess",
      "unknown",
    ];
    for (const c of codes) {
      const label = labelFor(c);
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
    }
  });
});

describe("chamberHintFor", () => {
  it("surfaces the chamber for adjourned_today (citizen wants to know which chamber was working)", () => {
    const r = {
      status: "adjourned_today" as StatusCode,
      primaryChamber: "senate" as Chamber,
      nextTransitionLabel: "Returns Tue, Apr 28",
    };
    expect(chamberHintFor(r)).toBe("Senate");
  });

  it("surfaces the chamber for pre_session (citizen wants to know who's opening)", () => {
    const r = {
      status: "pre_session" as StatusCode,
      primaryChamber: "senate" as Chamber,
      nextTransitionLabel: "Convenes at 10:00 a.m. ET",
    };
    expect(chamberHintFor(r)).toBe("Senate");
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

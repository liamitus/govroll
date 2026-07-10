// @vitest-environment jsdom
/**
 * The RecessNotice exists to stop a quiet feed from reading as broken data
 * ("nothing since June?!"), but the flip side is worse: showing "Congress is
 * in recess" while a chamber is actually on the floor. These tests pin both
 * directions — visible during a calendar-named recess, absent for ordinary
 * quiet days (`no_session`) and whenever either chamber is working.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ChamberStatusPayload,
  CongressStatusResponse,
} from "@/app/api/congress/status/route";
import type { StatusCode } from "@/lib/congress-session/types";
import { RecessNotice } from "./recess-notice";
import { CONGRESS_STATUS_QUERY_KEY } from "./status-query";

afterEach(() => {
  cleanup();
});

function chamber(
  name: "house" | "senate",
  status: StatusCode,
  overrides: Partial<ChamberStatusPayload> = {},
): ChamberStatusPayload {
  return {
    chamber: name,
    status,
    detail: null,
    source: "calendar",
    lastActionAt: null,
    nextTransitionAt: null,
    nextTransitionLabel: null,
    scheduledConveneAt: null,
    lastCheckedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Render with the shared status query pre-seeded — no network involved. */
function renderWithStatus(data: CongressStatusResponse) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(CONGRESS_STATUS_QUERY_KEY, data);
  return render(
    <QueryClientProvider client={client}>
      <RecessNotice />
    </QueryClientProvider>,
  );
}

describe("RecessNotice", () => {
  it("shows detail and return date when both chambers are in a named recess", () => {
    renderWithStatus({
      chambers: {
        house: chamber("house", "recess", {
          detail: "Independence Day District Work Period",
          nextTransitionAt: "2026-07-13T00:00:00.000Z",
          nextTransitionLabel: "Returns Mon, Jul 13",
        }),
        senate: chamber("senate", "recess", {
          detail: "Independence Day State Work Period",
          nextTransitionAt: "2026-07-14T00:00:00.000Z",
          nextTransitionLabel: "Returns Tue, Jul 14",
        }),
      },
    });

    expect(screen.getByText(/congress is in recess/i)).toBeInTheDocument();
    // The house returns sooner, so its detail + return date lead.
    expect(screen.getByText(/returns mon, jul 13/i)).toBeInTheDocument();
    expect(
      screen.getByText(/independence day district work period/i),
    ).toBeInTheDocument();
  });

  it("renders nothing on an ordinary quiet day (no_session)", () => {
    renderWithStatus({
      chambers: {
        house: chamber("house", "no_session"),
        senate: chamber("senate", "no_session"),
      },
    });

    expect(screen.queryByText(/recess/i)).toBeNull();
  });

  it("renders nothing while either chamber is in session", () => {
    renderWithStatus({
      chambers: {
        house: chamber("house", "in_session"),
        senate: chamber("senate", "recess", {
          detail: "State Work Period",
          nextTransitionLabel: "Returns Mon, Jul 13",
        }),
      },
    });

    expect(screen.queryByText(/congress is in recess/i)).toBeNull();
  });

  it("renders nothing when status has never been populated", () => {
    renderWithStatus({ chambers: { house: null, senate: null } });

    expect(screen.queryByText(/recess/i)).toBeNull();
  });
});

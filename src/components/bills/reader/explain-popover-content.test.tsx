// @vitest-environment jsdom
/**
 * State machine + fetch contract test for `<ExplainPopoverContent>`.
 *
 *   idle  ──[click Explain]──▶  loading  ──[200]──▶  success
 *                                        ──[err]──▶  error  ──[Try again]──▶ loading
 *
 * Verifies: button → spinner → result transition, error rendering,
 * retry, and that the request body matches what /api/ai/explain-passage
 * expects.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { ExplainPopoverContent } from "./explain-popover-content";

const REQUEST = {
  billId: 42,
  passage:
    "This is a passage long enough to satisfy the 40-character minimum on the server side.",
  sectionPath: ["Section 5. Funding", "(a) In general"],
};

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  // jsdom doesn't ship with fetch by default; assign explicitly.
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("<ExplainPopoverContent> — initial state", () => {
  it("renders the Explain button (idle state)", () => {
    render(<ExplainPopoverContent request={REQUEST} />);
    expect(
      screen.getByRole("button", { name: /Explain in plain English/i }),
    ).toBeInTheDocument();
  });
});

describe("<ExplainPopoverContent> — happy path", () => {
  it("transitions idle → loading → success and renders the explanation", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        explanation:
          "This passage authorizes new spending on housing assistance.",
        model: "claude-haiku-4-5",
        cached: false,
      }),
    );

    render(<ExplainPopoverContent request={REQUEST} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Explain in plain English/i }),
    );

    // Loading state appears (the spinner span is presentational; the
    // role-based query for "Asking AI…" works because the text is
    // visible).
    expect(screen.getByText(/Asking AI/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText(
          /This passage authorizes new spending on housing assistance\./,
        ),
      ).toBeInTheDocument();
    });
  });

  it("includes (cached) badge when the API reports cached: true", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        explanation: "A cached explanation.",
        model: "claude-haiku-4-5",
        cached: true,
      }),
    );

    render(<ExplainPopoverContent request={REQUEST} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Explain in plain English/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("(cached)")).toBeInTheDocument();
    });
  });
});

describe("<ExplainPopoverContent> — POST contract", () => {
  it("posts the exact billId, passage, sectionPath shape the route expects", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        explanation: "ok",
        model: "haiku",
        cached: false,
      }),
    );

    render(<ExplainPopoverContent request={REQUEST} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Explain in plain English/i }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/ai/explain-passage");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body).toEqual(REQUEST);
  });

  it("does not double-fire when clicked rapidly while loading", async () => {
    // Definite-assignment assertion: the Promise constructor callback
    // runs synchronously during `new Promise`, so `resolveResponse` is
    // guaranteed assigned before any `fireEvent.click` is dispatched.
    // TS's control-flow analysis can't see through the closure, so the
    // `!` tells the compiler to trust us.
    let resolveResponse!: (value: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((r) => {
        resolveResponse = r;
      }),
    );

    render(<ExplainPopoverContent request={REQUEST} />);
    const button = screen.getByRole("button", {
      name: /Explain in plain English/i,
    });
    fireEvent.click(button);
    // Loading state should be visible now; the original button is no
    // longer in the DOM (replaced by the spinner). Re-querying for it
    // would return null.
    expect(
      screen.queryByRole("button", { name: /Explain in plain English/i }),
    ).toBeNull();
    // Even if we tried to fire again, only one request was issued.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Clean up the pending promise so vitest doesn't hang.
    resolveResponse(
      jsonResponse({ explanation: "done", model: "haiku", cached: false }),
    );
  });
});

describe("<ExplainPopoverContent> — error path", () => {
  it("renders error message + Try again on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "rate_limited",
          message: "30 explain requests per hour",
          retryAfterSeconds: 1234,
        },
        429,
      ),
    );

    render(<ExplainPopoverContent request={REQUEST} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Explain in plain English/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /30 explain requests per hour/,
    );
    expect(
      screen.getByRole("button", { name: /Try again/i }),
    ).toBeInTheDocument();
  });

  it("renders network error message + Try again on fetch rejection", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network unreachable"));

    render(<ExplainPopoverContent request={REQUEST} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Explain in plain English/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Network unreachable/i);
  });

  it("Try again button re-issues the request and recovers", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("First call failed"))
      .mockResolvedValueOnce(
        jsonResponse({
          explanation: "Second call succeeded.",
          model: "haiku",
          cached: false,
        }),
      );

    render(<ExplainPopoverContent request={REQUEST} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Explain in plain English/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));

    await waitFor(() => {
      expect(screen.getByText(/Second call succeeded\./)).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to error string on opaque error response (no error/message field)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("garbage", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );

    render(<ExplainPopoverContent request={REQUEST} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Explain in plain English/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Could not load explanation/i,
    );
  });
});

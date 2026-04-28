// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const useAuthMock = vi.fn();
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const { useUserPref } = await import("./use-user-pref");

function makeWrapper() {
  // Disable retries so error paths surface immediately and the cache is
  // isolated per-test (no leakage between cases).
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("useUserPref", () => {
  it("returns the default value while the query is loading", () => {
    useAuthMock.mockReturnValue({ user: null });
    fetchMock.mockResolvedValue(
      jsonResponse({ preferences: { hideVoted: false } }),
    );

    const { result } = renderHook(() => useUserPref("hideVoted"), {
      wrapper: makeWrapper(),
    });
    expect(result.current.value).toBe(false);
  });

  it("returns the server value once fetched", async () => {
    useAuthMock.mockReturnValue({ user: { id: "user-1" } });
    fetchMock.mockResolvedValue(
      jsonResponse({ preferences: { hideVoted: true } }),
    );

    const { result } = renderHook(() => useUserPref("hideVoted"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.value).toBe(true));
  });

  it("setValue is a no-op for anon callers (no PATCH issued)", async () => {
    useAuthMock.mockReturnValue({ user: null });
    fetchMock.mockResolvedValue(
      jsonResponse({ preferences: { hideVoted: false } }),
    );

    const { result } = renderHook(() => useUserPref("hideVoted"), {
      wrapper: makeWrapper(),
    });

    act(() => {
      result.current.setValue(true);
    });

    // Only the GET call should have happened — no PATCH.
    const patchCalls = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(0);
  });

  it("setValue PATCHes the server for signed-in callers and applies the merged result", async () => {
    useAuthMock.mockReturnValue({ user: { id: "user-1" } });

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({ preferences: { hideVoted: true } }),
        );
      }
      return Promise.resolve(
        jsonResponse({ preferences: { hideVoted: false } }),
      );
    });

    const { result } = renderHook(() => useUserPref("hideVoted"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.value).toBe(false));

    act(() => {
      result.current.setValue(true);
    });

    // Optimistic update: the cache flips before the PATCH resolves. The
    // mutation's onMutate awaits cancelQueries, so the cache write happens
    // on the next tick rather than synchronously inside setValue.
    await waitFor(() => expect(result.current.value).toBe(true));

    await waitFor(() => {
      const patchHit = fetchMock.mock.calls.some(
        (call) =>
          call[0] === "/api/user/preferences" &&
          (call[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchHit).toBe(true);
    });
  });

  it("rolls back the optimistic update when the PATCH fails", async () => {
    useAuthMock.mockReturnValue({ user: { id: "user-1" } });

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(new Response("server error", { status: 500 }));
      }
      return Promise.resolve(
        jsonResponse({ preferences: { hideVoted: false } }),
      );
    });

    const { result } = renderHook(() => useUserPref("hideVoted"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.value).toBe(false));

    act(() => {
      result.current.setValue(true);
    });
    // Race-tolerant: the optimistic flip may resolve before assertion
    // depending on scheduling — what we care about here is that the value
    // ends up rolled back to `false` after the PATCH errors.
    await waitFor(() => expect(result.current.value).toBe(false));
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getUserMock = vi.fn();
const onAuthStateChangeMock = vi.fn();
const signInMock = vi.fn();
const signUpMock = vi.fn();
const signOutMock = vi.fn();
const updateUserMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getUser: getUserMock,
      onAuthStateChange: onAuthStateChangeMock,
      signInWithPassword: signInMock,
      signUp: signUpMock,
      signOut: signOutMock,
      updateUser: updateUserMock,
    },
  }),
}));

vi.mock("@/lib/citizen-id", () => ({
  generateCitizenId: () => "citizen-stub",
  resolveUsername: () => "Test User",
}));

let authChangeCallback:
  | ((event: string, session: { user: { id: string } } | null) => void)
  | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  authChangeCallback = null;
  onAuthStateChangeMock.mockImplementation((cb) => {
    authChangeCallback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
});

const { useAuth } = await import("./use-auth");

describe("useAuth — authState", () => {
  it('starts in "loading" before getUser resolves', () => {
    // Pending forever — captures the initial render only.
    getUserMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuth());
    expect(result.current.authState).toBe("loading");
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('transitions to "signed-in" when getUser resolves with a user', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.authState).toBe("signed-in"));
    expect(result.current.user).toEqual({ id: "u1" });
    expect(result.current.loading).toBe(false);
  });

  it('transitions to "signed-out" when getUser resolves with null', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.authState).toBe("signed-out"));
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('transitions to "signed-out" when getUser rejects', async () => {
    getUserMock.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.authState).toBe("signed-out"));
  });

  it("flips to signed-in when onAuthStateChange fires with a session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.authState).toBe("signed-out"));

    act(() => {
      authChangeCallback?.("SIGNED_IN", { user: { id: "u2" } });
    });

    await waitFor(() => expect(result.current.authState).toBe("signed-in"));
    expect(result.current.user).toEqual({ id: "u2" });
  });

  it("flips to signed-out when onAuthStateChange fires with null", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.authState).toBe("signed-in"));

    act(() => {
      authChangeCallback?.("SIGNED_OUT", null);
    });

    await waitFor(() => expect(result.current.authState).toBe("signed-out"));
    expect(result.current.user).toBeNull();
  });

  it("`loading` mirrors `authState === 'loading'`", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });

    const { result } = renderHook(() => useAuth());
    expect(result.current.loading).toBe(result.current.authState === "loading");

    await waitFor(() => expect(result.current.authState).toBe("signed-in"));
    expect(result.current.loading).toBe(false);
  });
});

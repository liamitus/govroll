import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const profileFindUniqueMock = vi.fn();
const profileUpdateMock = vi.fn();
const getAuthenticatedUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: {
      findUnique: profileFindUniqueMock,
      update: profileUpdateMock,
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

const { GET, PATCH } = await import("./route");

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/user/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/user/preferences", () => {
  it("returns defaults for anonymous callers (no 401)", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ preferences: { hideVoted: false } });
  });

  it("returns the user's stored preferences merged with defaults", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    profileFindUniqueMock.mockResolvedValue({
      preferences: { hideVoted: true },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ preferences: { hideVoted: true } });
    expect(profileFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { preferences: true },
    });
  });

  it("falls back to defaults when stored prefs are corrupt", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    profileFindUniqueMock.mockResolvedValue({
      preferences: { hideVoted: "not a boolean" },
    });

    const res = await GET();
    expect(await res.json()).toEqual({ preferences: { hideVoted: false } });
  });
});

describe("PATCH /api/user/preferences", () => {
  it("returns 401 for anon callers", async () => {
    getAuthenticatedUserMock.mockResolvedValue({
      userId: null,
      error: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      }),
    });

    const res = await PATCH(patchRequest({ hideVoted: true }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON", async () => {
    getAuthenticatedUserMock.mockResolvedValue({
      userId: "user-1",
      error: null,
    });

    const res = await PATCH(patchRequest("not-json{"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown keys (strict zod)", async () => {
    getAuthenticatedUserMock.mockResolvedValue({
      userId: "user-1",
      error: null,
    });

    const res = await PATCH(patchRequest({ unknownKey: "x" }));
    expect(res.status).toBe(400);
    expect(profileUpdateMock).not.toHaveBeenCalled();
  });

  it("merges patch into stored prefs and returns the merged result", async () => {
    getAuthenticatedUserMock.mockResolvedValue({
      userId: "user-1",
      error: null,
    });
    profileFindUniqueMock.mockResolvedValue({
      preferences: { hideVoted: false },
    });
    profileUpdateMock.mockResolvedValue({});

    const res = await PATCH(patchRequest({ hideVoted: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ preferences: { hideVoted: true } });
    expect(profileUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { preferences: { hideVoted: true } },
    });
  });

  it("uses defaults when the user has no stored prefs yet", async () => {
    getAuthenticatedUserMock.mockResolvedValue({
      userId: "user-1",
      error: null,
    });
    profileFindUniqueMock.mockResolvedValue(null);
    profileUpdateMock.mockResolvedValue({});

    const res = await PATCH(patchRequest({ hideVoted: true }));
    expect(res.status).toBe(200);
    expect(profileUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { preferences: { hideVoted: true } },
    });
  });
});

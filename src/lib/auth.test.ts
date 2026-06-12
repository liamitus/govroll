import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression guard for the username-moderation bypass: a user can set an
 * arbitrary `user_metadata.username` via supabase.auth.updateUser() with their
 * own session, with zero moderation. getAuthenticatedUser() must NEVER copy
 * that client-controlled value into Profile.username (the public source of
 * truth). The only writer of Profile.username is the moderated PATCH
 * /api/account/username route.
 */

const getUserMock = vi.fn();
const profileUpsertMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: {
      upsert: profileUpsertMock,
    },
  },
}));

const { getAuthenticatedUser } = await import("./auth");

const USER_ID = "11111111-2222-3333-4444-555566667777";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAuthenticatedUser — username write isolation", () => {
  it("does not copy an unmoderated user_metadata.username into Profile.username", async () => {
    const slur = "Slur McSlurface";
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: USER_ID,
          email: "u@example.com",
          user_metadata: { username: slur },
        },
      },
    });
    // Profile already exists; upsert resolves with the stored (moderated) name.
    profileUpsertMock.mockResolvedValue({
      id: USER_ID,
      username: "Citizen-1234",
      email: "u@example.com",
    });

    const result = await getAuthenticatedUser();

    expect(profileUpsertMock).toHaveBeenCalledTimes(1);
    const arg = profileUpsertMock.mock.calls[0][0];

    // The update path must not write a username at all — doing so would
    // propagate the unmoderated metadata value to every public surface.
    expect(arg.update).not.toHaveProperty("username");

    // Even the create seed is a safe, non-user-controlled Citizen ID, never
    // the metadata value.
    expect(arg.create.username).not.toBe(slur);
    expect(arg.create.username).toMatch(/^Citizen-\d{4}$/);

    // The returned username is the trusted stored Profile value, not metadata.
    expect(result.username).toBe("Citizen-1234");
    expect(result.username).not.toBe(slur);
  });

  it("ignores even a benign metadata name on first profile creation", async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: USER_ID,
          email: "new@example.com",
          user_metadata: { username: "Totally Fine Name" },
        },
      },
    });
    // Simulate a fresh insert: upsert returns the row it just created.
    profileUpsertMock.mockImplementation(async (args) => ({
      id: args.where.id,
      username: args.create.username,
      email: args.create.email,
    }));

    const result = await getAuthenticatedUser();

    // A name only becomes the public display name through the moderated PATCH
    // route — never auto-applied from metadata, however benign it looks.
    expect(result.username).toMatch(/^Citizen-\d{4}$/);
    expect(result.username).not.toBe("Totally Fine Name");
  });

  it("returns a 401 error response for anonymous callers without upserting", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const result = await getAuthenticatedUser();

    expect(result.error).not.toBeNull();
    expect(result.userId).toBeNull();
    expect(profileUpsertMock).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aiUsageCountMock = vi.fn();
const aiUsageFindFirstMock = vi.fn();
const commentFindManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiUsageEvent: {
      count: aiUsageCountMock,
      findFirst: aiUsageFindFirstMock,
    },
    comment: {
      findMany: commentFindManyMock,
    },
  },
}));

const { assertUserRateLimit, assertUserCommentRateLimit, RateLimitError } =
  await import("./rate-limit");

const NOW = new Date("2026-06-10T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("assertUserCommentRateLimit", () => {
  it("resolves when the user is under the cap", async () => {
    commentFindManyMock.mockResolvedValue([{ date: NOW }, { date: NOW }]);

    await expect(
      assertUserCommentRateLimit("user-1", 30),
    ).resolves.toBeUndefined();

    // Counts real Comment rows by userId within the trailing hour — not
    // AiUsageEvent (the bug that made the cap a no-op).
    const arg = commentFindManyMock.mock.calls[0][0];
    expect(arg.where.userId).toBe("user-1");
    expect(arg.where.date.gte).toEqual(new Date(NOW.getTime() - HOUR_MS));
    expect(arg.take).toBe(30);
    expect(arg.orderBy).toEqual({ date: "asc" });
  });

  it("throws RateLimitError when the user is at the cap", async () => {
    // Oldest counted comment was 30 minutes ago → frees in another 30 min.
    const oldest = new Date(NOW.getTime() - 30 * 60 * 1000);
    const rows = Array.from({ length: 30 }, (_, i) => ({
      date: i === 0 ? oldest : NOW,
    }));
    commentFindManyMock.mockResolvedValue(rows);

    await expect(
      assertUserCommentRateLimit("user-1", 30),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("derives retryAfterSeconds from the oldest counted comment", async () => {
    const oldest = new Date(NOW.getTime() - 30 * 60 * 1000);
    const rows = Array.from({ length: 30 }, (_, i) => ({
      date: i === 0 ? oldest : NOW,
    }));
    commentFindManyMock.mockResolvedValue(rows);

    const err = await assertUserCommentRateLimit("user-1", 30).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    // oldest + 1h - now = 30 minutes = 1800s.
    expect((err as InstanceType<typeof RateLimitError>).retryAfterSeconds).toBe(
      1800,
    );
  });
});

describe("assertUserRateLimit (retryAfter regression)", () => {
  it("resolves when under the cap", async () => {
    aiUsageCountMock.mockResolvedValue(3);

    await expect(
      assertUserRateLimit("user-1", "chat", 10),
    ).resolves.toBeUndefined();
    expect(aiUsageFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns a real (non-zero) retryAfter from the oldest counted event", async () => {
    aiUsageCountMock.mockResolvedValue(10);
    // Oldest event 45 minutes ago → window frees in 15 minutes (900s).
    aiUsageFindFirstMock.mockResolvedValue({
      createdAt: new Date(NOW.getTime() - 45 * 60 * 1000),
    });

    const err = await assertUserRateLimit("user-1", "chat", 10).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    const retry = (err as InstanceType<typeof RateLimitError>)
      .retryAfterSeconds;
    // The pre-fix formula always produced ~0; the fix yields the real wait.
    expect(retry).toBe(900);
    expect(retry).toBeGreaterThan(0);
  });

  it("falls back to 60s when the oldest event can't be read", async () => {
    aiUsageCountMock.mockResolvedValue(10);
    aiUsageFindFirstMock.mockResolvedValue(null);

    const err = await assertUserRateLimit("user-1", "chat", 10).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as InstanceType<typeof RateLimitError>).retryAfterSeconds).toBe(
      60,
    );
  });
});

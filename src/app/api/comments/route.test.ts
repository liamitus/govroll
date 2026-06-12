import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const getAuthenticatedUserMock = vi.fn();
const assertUserCommentRateLimitMock = vi.fn();
const checkContentL2Mock = vi.fn();
const reportErrorMock = vi.fn();

const commentFindFirstMock = vi.fn();
const commentFindUniqueMock = vi.fn();
const commentCreateMock = vi.fn();
const billFindUniqueMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

vi.mock("@/lib/moderation/layer2", () => ({
  checkContentL2: checkContentL2Mock,
}));

vi.mock("@/lib/error-reporting", () => ({
  reportError: reportErrorMock,
}));

// Keep the real RateLimitError (the route's `instanceof` check depends on it);
// only stub the limiter so we can drive the rate-limited path.
vi.mock("@/lib/rate-limit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    assertUserCommentRateLimit: assertUserCommentRateLimitMock,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    comment: {
      findFirst: commentFindFirstMock,
      findUnique: commentFindUniqueMock,
      create: commentCreateMock,
    },
    bill: {
      findUnique: billFindUniqueMock,
    },
  },
}));

const { POST } = await import("./route");
const { RateLimitError } = await import("@/lib/rate-limit");

const BILL_ID = 100;

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/comments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "1.2.3.4",
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Happy-path defaults; individual tests override as needed.
  getAuthenticatedUserMock.mockResolvedValue({
    userId: "user-1",
    username: "Alice",
    error: null,
  });
  assertUserCommentRateLimitMock.mockResolvedValue(undefined);
  checkContentL2Mock.mockResolvedValue({ ok: true, flagged: false });
  commentFindFirstMock.mockResolvedValue(null); // no duplicate
  billFindUniqueMock.mockResolvedValue({ id: BILL_ID });
  commentFindUniqueMock.mockResolvedValue({ billId: BILL_ID }); // parent in-bill
  commentCreateMock.mockResolvedValue({
    id: 5,
    userId: "user-1",
    username: "Alice",
    billId: BILL_ID,
    content: "hello",
    parentCommentId: null,
  });
});

describe("POST /api/comments", () => {
  it("returns 401 when unauthenticated", async () => {
    const { NextResponse } = await import("next/server");
    getAuthenticatedUserMock.mockResolvedValue({
      userId: null,
      username: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await POST(makeRequest({ billId: BILL_ID, content: "hi" }));

    expect(res.status).toBe(401);
    expect(commentCreateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when content is missing", async () => {
    const res = await POST(makeRequest({ billId: BILL_ID }));
    expect(res.status).toBe(400);
    expect(commentCreateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when content exceeds the length cap", async () => {
    const res = await POST(
      makeRequest({ billId: BILL_ID, content: "x".repeat(10001) }),
    );
    expect(res.status).toBe(400);
    expect(commentCreateMock).not.toHaveBeenCalled();
  });

  it("returns 429 on a duplicate before checking the rate limit", async () => {
    commentFindFirstMock.mockResolvedValue({ id: 9 });

    const res = await POST(makeRequest({ billId: BILL_ID, content: "dup" }));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Duplicate comment detected" });
    expect(assertUserCommentRateLimitMock).not.toHaveBeenCalled();
  });

  it("returns 429 (friendly message) when the per-user comment cap trips", async () => {
    assertUserCommentRateLimitMock.mockRejectedValue(
      new RateLimitError("30 comments per hour", 1800),
    );

    const res = await POST(makeRequest({ billId: BILL_ID, content: "flood" }));

    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/posting too quickly/i);
    // The cap is enforced via the comment limiter (counts Comment rows), and
    // before we spend a moderation call.
    expect(assertUserCommentRateLimitMock).toHaveBeenCalledWith("user-1", 30);
    expect(checkContentL2Mock).not.toHaveBeenCalled();
    expect(commentCreateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when moderation flags the content", async () => {
    checkContentL2Mock.mockResolvedValue({ ok: false, flagged: true });

    const res = await POST(makeRequest({ billId: BILL_ID, content: "bad" }));

    expect(res.status).toBe(400);
    expect(commentCreateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the bill does not exist", async () => {
    billFindUniqueMock.mockResolvedValue(null);

    const res = await POST(makeRequest({ billId: BILL_ID, content: "hi" }));

    expect(res.status).toBe(404);
    expect(commentCreateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when parentCommentId is not a valid id", async () => {
    const res = await POST(
      makeRequest({
        billId: BILL_ID,
        content: "reply",
        parentCommentId: "abc",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid parent comment" });
    expect(commentFindUniqueMock).not.toHaveBeenCalled();
    expect(commentCreateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the parent comment does not exist", async () => {
    commentFindUniqueMock.mockResolvedValue(null);

    const res = await POST(
      makeRequest({ billId: BILL_ID, content: "reply", parentCommentId: 999 }),
    );

    expect(res.status).toBe(400);
    expect(commentCreateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the parent belongs to a different bill", async () => {
    commentFindUniqueMock.mockResolvedValue({ billId: 200 });

    const res = await POST(
      makeRequest({ billId: BILL_ID, content: "reply", parentCommentId: 7 }),
    );

    expect(res.status).toBe(400);
    expect(commentCreateMock).not.toHaveBeenCalled();
  });

  it("creates a top-level comment (parentCommentId null) and returns 201", async () => {
    const res = await POST(makeRequest({ billId: BILL_ID, content: "hello" }));

    expect(res.status).toBe(201);
    expect(commentCreateMock).toHaveBeenCalledTimes(1);
    expect(commentCreateMock.mock.calls[0][0].data.parentCommentId).toBeNull();
  });

  it("creates a reply when the parent is valid and in the same bill", async () => {
    commentFindUniqueMock.mockResolvedValue({ billId: BILL_ID });

    const res = await POST(
      makeRequest({ billId: BILL_ID, content: "reply", parentCommentId: 7 }),
    );

    expect(res.status).toBe(201);
    expect(commentFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { billId: true },
    });
    expect(commentCreateMock.mock.calls[0][0].data.parentCommentId).toBe(7);
  });
});

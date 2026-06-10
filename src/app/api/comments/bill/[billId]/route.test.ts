import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const commentFindManyMock = vi.fn();
const commentVoteGroupByMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    comment: { findMany: commentFindManyMock },
    commentVote: { groupBy: commentVoteGroupByMock },
  },
}));

const { GET } = await import("./route");

const BILL_ID = 100;

// Tree: c1 + c2 are top-level; c3 replies to c1; c4 is an orphaned reply
// (parent 999 doesn't exist) which the builder promotes to top-level.
function fixtureComments() {
  const base = {
    billId: BILL_ID,
    userId: "u",
    username: "Alice",
    profile: null,
  };
  return [
    {
      ...base,
      id: 1,
      content: "c1",
      parentCommentId: null,
      date: new Date("2026-06-10T10:00:00Z"),
    },
    {
      ...base,
      id: 2,
      content: "c2",
      parentCommentId: null,
      date: new Date("2026-06-10T09:00:00Z"),
    },
    {
      ...base,
      id: 3,
      content: "c3",
      parentCommentId: 1,
      date: new Date("2026-06-10T09:30:00Z"),
    },
    {
      ...base,
      id: 4,
      content: "c4-orphan",
      parentCommentId: 999,
      date: new Date("2026-06-10T08:00:00Z"),
    },
  ];
}

function makeRequest(query: string): NextRequest {
  return {
    nextUrl: new URL(`http://localhost/api/comments/bill/${BILL_ID}?${query}`),
  } as unknown as NextRequest;
}

function makeParams() {
  return { params: Promise.resolve({ billId: String(BILL_ID) }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  commentFindManyMock.mockResolvedValue(fixtureComments());
  commentVoteGroupByMock.mockResolvedValue([]);
});

describe("GET /api/comments/bill/[billId]", () => {
  it("returns total (all comments) and topLevelTotal (pagination denominator)", async () => {
    const res = await GET(makeRequest("page=1&sort=new"), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    // 4 comments total (incl. the reply); 3 render at top level (c1, c2, and
    // the promoted orphan c4).
    expect(body.total).toBe(4);
    expect(body.topLevelTotal).toBe(3);
    expect(body.comments).toHaveLength(3);
  });

  it("nests replies under their parent", async () => {
    const res = await GET(makeRequest("page=1&sort=new"), makeParams());
    const body = await res.json();

    const c1 = body.comments.find((c: { id: number }) => c.id === 1);
    expect(c1.replies.map((r: { id: number }) => r.id)).toEqual([3]);
  });

  it("keeps topLevelTotal stable across pages while slicing top-level", async () => {
    const page1 = await (
      await GET(makeRequest("page=1&limit=2&sort=new"), makeParams())
    ).json();
    const page2 = await (
      await GET(makeRequest("page=2&limit=2&sort=new"), makeParams())
    ).json();

    expect(page1.topLevelTotal).toBe(3);
    expect(page2.topLevelTotal).toBe(3);
    expect(page1.comments).toHaveLength(2);
    expect(page2.comments).toHaveLength(1);
    // No overlap between pages — "load more" appends genuinely new comments.
    const ids1 = page1.comments.map((c: { id: number }) => c.id);
    const ids2 = page2.comments.map((c: { id: number }) => c.id);
    expect(ids1.filter((id: number) => ids2.includes(id))).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findMany: findManyMock,
      count: countMock,
    },
  },
}));

const { GET } = await import("./route");

function getRequest(url = "http://localhost/api/account/conversations") {
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/account/conversations", () => {
  it("returns 401 for anon callers", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const res = await GET(getRequest());
    expect(res.status).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("returns the user's conversations with bill, last message, and question count", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    findManyMock.mockResolvedValue([
      {
        id: "c1",
        createdAt: new Date("2026-04-20T00:00:00Z"),
        updatedAt: new Date("2026-04-25T00:00:00Z"),
        bill: { id: 1, billId: "house_bill-1-118", title: "Bill One" },
        messages: [
          {
            sender: "ai",
            text: "Some answer",
            createdAt: new Date("2026-04-25T00:00:00Z"),
          },
        ],
        _count: { messages: 2 },
      },
    ]);
    countMock.mockResolvedValue(1);

    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.page).toBe(1);
    expect(json.conversations).toHaveLength(1);
    expect(json.conversations[0]).toMatchObject({
      id: "c1",
      bill: { id: 1, billId: "house_bill-1-118", title: "Bill One" },
      lastMessage: { sender: "ai", text: "Some answer" },
      questionCount: 2,
    });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          _count: { select: { messages: { where: { sender: "user" } } } },
        }),
      }),
    );
  });

  it("paginates with skip/take based on the `page` query param", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    await GET(getRequest("http://localhost/api/account/conversations?page=3"));

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40, // (3 - 1) * 20
        take: 20,
        orderBy: { updatedAt: "desc" },
      }),
    );
  });

  it("clamps invalid page params to 1", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    await GET(
      getRequest("http://localhost/api/account/conversations?page=garbage"),
    );

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });

  it("returns null lastMessage when a conversation has no messages", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    findManyMock.mockResolvedValue([
      {
        id: "c2",
        createdAt: new Date(),
        updatedAt: new Date(),
        bill: { id: 1, billId: "x", title: "y" },
        messages: [],
        _count: { messages: 0 },
      },
    ]);
    countMock.mockResolvedValue(1);

    const res = await GET(getRequest());
    const json = await res.json();
    expect(json.conversations[0].lastMessage).toBeNull();
    expect(json.conversations[0].questionCount).toBe(0);
  });
});

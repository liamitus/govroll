import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const getAuthenticatedUserIdMock = vi.fn();
const findUniqueMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    comment: {
      findUnique: findUniqueMock,
      delete: deleteMock,
    },
  },
}));

const { DELETE } = await import("./route");

function makeRequest(): Request {
  return new Request("http://localhost/api/comments/1", { method: "DELETE" });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function authedAs(userId: string) {
  getAuthenticatedUserIdMock.mockResolvedValue({ userId, error: null });
}

function unauthed() {
  getAuthenticatedUserIdMock.mockResolvedValue({
    userId: null,
    error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/comments/[id]", () => {
  it("returns 401 when caller is not authenticated", async () => {
    unauthed();

    const res = await DELETE(makeRequest(), makeParams("1"));

    expect(res.status).toBe(401);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the comment does not exist", async () => {
    authedAs("user-1");
    findUniqueMock.mockResolvedValue(null);

    const res = await DELETE(makeRequest(), makeParams("999"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Comment not found" });
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: 999 } });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the comment belongs to a different user", async () => {
    authedAs("user-1");
    findUniqueMock.mockResolvedValue({ id: 5, userId: "user-2", billId: 1 });

    const res = await DELETE(makeRequest(), makeParams("5"));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 403 for anonymous comments (userId is null) — they have no owner", async () => {
    authedAs("user-1");
    findUniqueMock.mockResolvedValue({ id: 7, userId: null, billId: 1 });

    const res = await DELETE(makeRequest(), makeParams("7"));

    expect(res.status).toBe(403);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("deletes the comment and returns 200 when caller owns it", async () => {
    authedAs("user-1");
    findUniqueMock.mockResolvedValue({ id: 5, userId: "user-1", billId: 1 });
    deleteMock.mockResolvedValue({ id: 5 });

    const res = await DELETE(makeRequest(), makeParams("5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: "Comment deleted successfully",
    });
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when the id param is not a valid integer", async () => {
    authedAs("user-1");

    const res = await DELETE(makeRequest(), makeParams("not-a-number"));

    expect(res.status).toBe(400);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the id param is empty", async () => {
    authedAs("user-1");

    const res = await DELETE(makeRequest(), makeParams(""));

    expect(res.status).toBe(400);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the id param is non-positive", async () => {
    authedAs("user-1");

    const res = await DELETE(makeRequest(), makeParams("0"));

    expect(res.status).toBe(400);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the database fails during delete", async () => {
    authedAs("user-1");
    findUniqueMock.mockResolvedValue({ id: 5, userId: "user-1", billId: 1 });
    deleteMock.mockRejectedValue(new Error("connection refused"));

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await DELETE(makeRequest(), makeParams("5"));
    consoleErr.mockRestore();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });

  it("returns 500 when findUnique fails before ownership can be checked", async () => {
    authedAs("user-1");
    findUniqueMock.mockRejectedValue(new Error("db down"));

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await DELETE(makeRequest(), makeParams("5"));
    consoleErr.mockRestore();

    expect(res.status).toBe(500);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

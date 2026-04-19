/**
 * Cache-key collision contract test.
 *
 * The explain-passage endpoint (Day 6-7) and the chat first-turn cache
 * both use the same `AiResponseCache` table, scoped per-bill via the
 * `(billId, promptHash)` unique constraint. To avoid the explain
 * endpoint accidentally serving a chat answer (or vice versa), the
 * explain route prefixes its cache key with `"explain:"` before
 * hashing.
 *
 * This test pins that contract: hashing "explain:" + passage produces
 * a different DB row than hashing the bare passage, so a chat asking
 * "What does this section do?" won't collide with an explain on the
 * same string.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock prisma so we observe the hashes used at the persistence layer
// without requiring a real DB connection. The mock factory must NOT
// reference outer-scope variables — vitest hoists vi.mock above
// imports.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiResponseCache: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { getCachedResponse, setCachedResponse } from "./ai-cache";

const mockedFindUnique = prisma.aiResponseCache.findUnique as ReturnType<
  typeof vi.fn
>;
const mockedUpsert = prisma.aiResponseCache.upsert as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedFindUnique.mockReset();
  mockedUpsert.mockReset();
  mockedFindUnique.mockResolvedValue(null);
  mockedUpsert.mockResolvedValue({});
});

describe("AiResponseCache — chat vs explain key separation", () => {
  it("hashes 'explain:<passage>' to a different key than '<passage>'", async () => {
    const passage = "This Act may be cited as the Test Act of 2026.";
    const billId = 42;

    await setCachedResponse(billId, passage, "chat answer", "haiku");
    await setCachedResponse(
      billId,
      `explain:${passage}`,
      "explain answer",
      "haiku",
    );

    expect(mockedUpsert).toHaveBeenCalledTimes(2);
    const chatHash = mockedUpsert.mock.calls[0][0].where.billId_promptHash
      .promptHash as string;
    const explainHash = mockedUpsert.mock.calls[1][0].where.billId_promptHash
      .promptHash as string;

    expect(chatHash).not.toBe(explainHash);
    // Both should look like SHA-256 hex (64 hex chars).
    expect(chatHash).toMatch(/^[a-f0-9]{64}$/);
    expect(explainHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("getCachedResponse for explain key does not return chat-cached value", async () => {
    const passage = "Identical passage in both contexts.";
    const billId = 1;

    // Simulate: chat cache exists (bare passage), explain cache absent
    // (prefixed key). The explain lookup must return null.
    let chatPromptHash: string | null = null;

    // First write: chat
    mockedUpsert.mockImplementationOnce(async (args) => {
      chatPromptHash = args.where.billId_promptHash.promptHash;
      return {};
    });
    await setCachedResponse(billId, passage, "chat answer", "haiku");
    expect(chatPromptHash).not.toBeNull();

    // Now explain lookup: should call findUnique with a DIFFERENT
    // promptHash, and our mock returns null for it.
    mockedFindUnique.mockResolvedValueOnce(null);
    const result = await getCachedResponse(billId, `explain:${passage}`);
    expect(result).toBeNull();

    const lookupHash =
      mockedFindUnique.mock.calls[0][0].where.billId_promptHash.promptHash;
    expect(lookupHash).not.toBe(chatPromptHash);
  });

  it("the same passage with the same prefix produces the same hash (deterministic)", async () => {
    await setCachedResponse(7, "explain:foo", "x", "haiku");
    await setCachedResponse(7, "explain:foo", "y", "haiku");

    const a = mockedUpsert.mock.calls[0][0].where.billId_promptHash.promptHash;
    const b = mockedUpsert.mock.calls[1][0].where.billId_promptHash.promptHash;
    expect(a).toBe(b);
  });

  it("normalization is case-insensitive (matches existing chat cache contract)", async () => {
    await setCachedResponse(1, "Some Passage", "x", "haiku");
    await setCachedResponse(1, "some passage", "y", "haiku");
    await setCachedResponse(1, "  SOME  passage  ", "z", "haiku");

    const a = mockedUpsert.mock.calls[0][0].where.billId_promptHash.promptHash;
    const b = mockedUpsert.mock.calls[1][0].where.billId_promptHash.promptHash;
    const c = mockedUpsert.mock.calls[2][0].where.billId_promptHash.promptHash;

    // a and b must match (case-insensitive) — that's the existing
    // contract. c may NOT match because internal whitespace isn't
    // collapsed (only leading/trailing trimmed) — pin both behaviors.
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

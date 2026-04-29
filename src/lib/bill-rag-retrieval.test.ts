/**
 * Tests for the RAG retrieval module. The cosine-search SQL path is
 * exercised via integration tests against a real pgvector DB; here we
 * pin the unit-level invariants:
 *   - feature-flag plumbing reads the env at call time
 *   - Voyage query embedding is requested with the user's question
 *   - the SQL parameter shape matches what pgvector expects
 *   - retrieval results map to the BillSection[] the prompt builder
 *     consumes
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import {
  isRagPathEnabled,
  retrieveRelevantSections,
  billHasEmbeddings,
  DEFAULT_RAG_TOP_K,
} from "./bill-rag-retrieval";
import { VOYAGE_EMBED_MODEL } from "./voyage";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  process.env.VOYAGE_API_KEY = "test-key-not-real";
  delete process.env.AI_CHAT_RAG_ENABLED;
});

describe("isRagPathEnabled", () => {
  it("returns false when the env var is unset", () => {
    expect(isRagPathEnabled()).toBe(false);
  });

  it("returns true only when set to the literal string 'true'", () => {
    process.env.AI_CHAT_RAG_ENABLED = "true";
    expect(isRagPathEnabled()).toBe(true);
  });

  it("rejects truthy-looking values that aren't the literal 'true'", () => {
    // The flag is a hard switch — the chat route shouldn't get RAG'd
    // by accident from a sloppy env value. Pin that "1", "yes", "on"
    // do NOT enable the path.
    for (const value of ["1", "yes", "on", "TRUE", "True"]) {
      process.env.AI_CHAT_RAG_ENABLED = value;
      expect(isRagPathEnabled()).toBe(false);
    }
  });
});

describe("billHasEmbeddings", () => {
  it("returns true when at least one chunk exists for the bill", async () => {
    const fakePrisma = {
      billEmbeddingChunk: {
        findFirst: vi.fn().mockResolvedValue({ id: 42 }),
      },
    } as unknown as Parameters<typeof billHasEmbeddings>[0];
    expect(await billHasEmbeddings(fakePrisma, 18630)).toBe(true);
  });

  it("returns false when no chunks exist for the bill", async () => {
    const fakePrisma = {
      billEmbeddingChunk: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Parameters<typeof billHasEmbeddings>[0];
    expect(await billHasEmbeddings(fakePrisma, 18630)).toBe(false);
  });
});

describe("retrieveRelevantSections", () => {
  function mockVoyage(
    embedding: number[] = new Array(1024).fill(0).map((_, i) => i / 1024),
  ) {
    server.use(
      http.post("https://api.voyageai.com/v1/embeddings", () =>
        HttpResponse.json({
          object: "list",
          data: [{ object: "embedding", embedding, index: 0 }],
          model: VOYAGE_EMBED_MODEL,
          usage: { total_tokens: 12 },
        }),
      ),
    );
  }

  it("embeds the query, runs cosine search, and returns BillSection[] in similarity order", async () => {
    mockVoyage();
    const sqlSpy = vi.fn().mockResolvedValue([
      {
        id: 1,
        sectionRef: "Section 5(a)",
        heading: "Section 5. Pesticide registration > (a) Fast-track",
        content: "fast-track text",
        contextPrefix: "context",
        distance: 0.12,
      },
      {
        id: 2,
        sectionRef: "Section 7",
        heading: "Section 7. Definitions",
        content: "defs text",
        contextPrefix: "context2",
        distance: 0.34,
      },
    ]);
    const fakePrisma = {
      $queryRawUnsafe: sqlSpy,
    } as unknown as Parameters<typeof retrieveRelevantSections>[0];

    const result = await retrieveRelevantSections(
      fakePrisma,
      18630,
      "what does this bill do for bayer",
    );

    expect(result.hadResults).toBe(true);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].sectionRef).toBe("Section 5(a)");
    expect(result.sections[0].heading).toContain("Pesticide");
    // Distances flow through unchanged for downstream telemetry.
    expect(result.distances).toEqual([0.12, 0.34]);
    // Voyage usage is reported so the route can bill it via recordSpend.
    expect(result.queryEmbeddingTokens).toBe(12);
  });

  it("forwards the model filter and bill id as SQL parameters", async () => {
    mockVoyage();
    const sqlSpy = vi.fn().mockResolvedValue([]);
    const fakePrisma = {
      $queryRawUnsafe: sqlSpy,
    } as unknown as Parameters<typeof retrieveRelevantSections>[0];

    await retrieveRelevantSections(fakePrisma, 18630, "question");

    // SQL is parameterized: $1=vector literal, $2=billId, $3=model, $4=k.
    // Pin the parameter order so a future refactor doesn't silently
    // break the cosine-search column binding.
    expect(sqlSpy).toHaveBeenCalledTimes(1);
    const args = sqlSpy.mock.calls[0];
    expect(args[1]).toMatch(/^\[/); // vector literal
    expect(args[2]).toBe(18630);
    expect(args[3]).toBe(VOYAGE_EMBED_MODEL);
    expect(args[4]).toBe(DEFAULT_RAG_TOP_K);
  });

  it("respects an explicit top-K override", async () => {
    mockVoyage();
    const sqlSpy = vi.fn().mockResolvedValue([]);
    const fakePrisma = {
      $queryRawUnsafe: sqlSpy,
    } as unknown as Parameters<typeof retrieveRelevantSections>[0];

    await retrieveRelevantSections(fakePrisma, 18630, "question", 10);

    expect(sqlSpy.mock.calls[0][4]).toBe(10);
  });

  it("returns hadResults=false when the cosine search is empty", async () => {
    mockVoyage();
    const sqlSpy = vi.fn().mockResolvedValue([]);
    const fakePrisma = {
      $queryRawUnsafe: sqlSpy,
    } as unknown as Parameters<typeof retrieveRelevantSections>[0];

    const result = await retrieveRelevantSections(
      fakePrisma,
      18630,
      "question",
    );
    expect(result.hadResults).toBe(false);
    expect(result.sections).toEqual([]);
  });

  it("throws cleanly when the query embedding is empty", async () => {
    // Voyage occasionally returns empty data on errors; the function
    // must surface that as a real Error rather than silently issuing a
    // SQL query with `[]::vector`.
    server.use(
      http.post("https://api.voyageai.com/v1/embeddings", () =>
        HttpResponse.json({
          object: "list",
          data: [{ object: "embedding", embedding: [], index: 0 }],
          model: VOYAGE_EMBED_MODEL,
          usage: { total_tokens: 0 },
        }),
      ),
    );
    const fakePrisma = {
      $queryRawUnsafe: vi.fn(),
    } as unknown as Parameters<typeof retrieveRelevantSections>[0];

    await expect(
      retrieveRelevantSections(fakePrisma, 18630, "question"),
    ).rejects.toThrow(/no embedding/);
  });
});

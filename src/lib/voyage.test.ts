/**
 * Tests for the Voyage AI embedding client. MSW intercepts the
 * Voyage REST endpoint so we never hit the real API in CI.
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
  voyageEmbedDocuments,
  voyageEmbedQuery,
  batchTextsForVoyage,
  VoyageError,
  VOYAGE_EMBED_MODEL,
} from "./voyage";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  // The client throws if the key is unset; tests need it configured.
  process.env.VOYAGE_API_KEY = "test-key-not-real";
});

function mockVoyageEmbed(
  responder: (body: {
    input: string[];
    input_type: string;
  }) => Response | Promise<Response>,
) {
  server.use(
    http.post("https://api.voyageai.com/v1/embeddings", async ({ request }) => {
      const body = (await request.json()) as {
        input: string[];
        input_type: string;
      };
      return responder(body);
    }),
  );
}

describe("voyageEmbedDocuments", () => {
  it("returns embeddings in the input order even when the API returns them shuffled", async () => {
    // Voyage's docs say results carry an `index` field; we sort on it
    // before returning so a server-side reorder doesn't silently
    // misalign embeddings with their source chunks. This pins that
    // contract — the response below is index 1 first, then 0, then 2.
    mockVoyageEmbed(() =>
      HttpResponse.json({
        object: "list",
        data: [
          { object: "embedding", embedding: [0.2, 0.2, 0.2], index: 1 },
          { object: "embedding", embedding: [0.1, 0.1, 0.1], index: 0 },
          { object: "embedding", embedding: [0.3, 0.3, 0.3], index: 2 },
        ],
        model: VOYAGE_EMBED_MODEL,
        usage: { total_tokens: 9 },
      }),
    );

    const result = await voyageEmbedDocuments(["a", "b", "c"]);
    expect(result.embeddings[0][0]).toBe(0.1);
    expect(result.embeddings[1][0]).toBe(0.2);
    expect(result.embeddings[2][0]).toBe(0.3);
  });

  it("computes cents from voyage-3-large pricing", async () => {
    mockVoyageEmbed(() =>
      HttpResponse.json({
        object: "list",
        data: [{ object: "embedding", embedding: [0.1], index: 0 }],
        model: VOYAGE_EMBED_MODEL,
        usage: { total_tokens: 1_000_000 },
      }),
    );

    const result = await voyageEmbedDocuments(["text"]);
    // 1M tokens × 18 cents/Mtok = 18 cents.
    expect(result.costCents).toBe(18);
    expect(result.totalTokens).toBe(1_000_000);
  });

  it("throws cleanly when VOYAGE_API_KEY is unset", async () => {
    delete process.env.VOYAGE_API_KEY;
    await expect(voyageEmbedDocuments(["text"])).rejects.toBeInstanceOf(
      VoyageError,
    );
  });

  it("returns an empty result for an empty input array (no API call)", async () => {
    // No mock registered — if the function tried to call out, the
    // onUnhandledRequest: "error" lifecycle would fail the test.
    const result = await voyageEmbedDocuments([]);
    expect(result.embeddings).toEqual([]);
    expect(result.totalTokens).toBe(0);
    expect(result.costCents).toBe(0);
  });

  it("rejects batches larger than Voyage's 128-input cap", async () => {
    const big = Array.from({ length: 129 }, () => "x");
    await expect(voyageEmbedDocuments(big)).rejects.toBeInstanceOf(VoyageError);
  });

  it("retries transient 5xx errors", async () => {
    let calls = 0;
    server.use(
      http.post("https://api.voyageai.com/v1/embeddings", () => {
        calls++;
        if (calls < 2) {
          return new HttpResponse(null, { status: 503 });
        }
        return HttpResponse.json({
          object: "list",
          data: [{ object: "embedding", embedding: [0.1], index: 0 }],
          model: VOYAGE_EMBED_MODEL,
          usage: { total_tokens: 1 },
        });
      }),
    );

    const result = await voyageEmbedDocuments(["text"]);
    expect(result.embeddings).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("does NOT retry on 4xx (client error — caller bug)", async () => {
    let calls = 0;
    server.use(
      http.post("https://api.voyageai.com/v1/embeddings", () => {
        calls++;
        return new HttpResponse(null, { status: 400 });
      }),
    );

    await expect(voyageEmbedDocuments(["text"])).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });

  it('sends `input_type: "document"` for indexed-side embeddings', async () => {
    let receivedType: string | undefined;
    mockVoyageEmbed((body) => {
      receivedType = body.input_type;
      return HttpResponse.json({
        object: "list",
        data: [{ object: "embedding", embedding: [0.1], index: 0 }],
        model: VOYAGE_EMBED_MODEL,
        usage: { total_tokens: 1 },
      });
    });

    await voyageEmbedDocuments(["chunk text"]);
    expect(receivedType).toBe("document");
  });
}, 15_000);

describe("voyageEmbedQuery", () => {
  it('sends `input_type: "query"` for the search-side embedding', async () => {
    let receivedType: string | undefined;
    mockVoyageEmbed((body) => {
      receivedType = body.input_type;
      return HttpResponse.json({
        object: "list",
        data: [{ object: "embedding", embedding: [0.1], index: 0 }],
        model: VOYAGE_EMBED_MODEL,
        usage: { total_tokens: 1 },
      });
    });

    await voyageEmbedQuery("what does this bill do for bayer?");
    expect(receivedType).toBe("query");
  });

  it("throws on empty query input", async () => {
    await expect(voyageEmbedQuery("   ")).rejects.toBeInstanceOf(VoyageError);
  });
});

describe("batchTextsForVoyage", () => {
  it("packs into a single batch when small", () => {
    const texts = ["a", "b", "c"];
    const batches = batchTextsForVoyage(texts);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(texts);
  });

  it("splits at the 128-input request cap", () => {
    const texts = Array.from({ length: 200 }, () => "small");
    const batches = batchTextsForVoyage(texts);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(128);
    expect(batches[1]).toHaveLength(72);
  });

  it("splits when the running token estimate exceeds the per-request cap", () => {
    // ~50K chars per chunk → ~16.7K tokens at 3 chars/token. Six of those
    // crosses the 100K-token cap, so we expect at least two batches.
    const big = Array.from({ length: 6 }, () => "x".repeat(50_000));
    const batches = batchTextsForVoyage(big);
    expect(batches.length).toBeGreaterThan(1);
    // No batch may itself exceed the token cap.
    for (const batch of batches) {
      const totalChars = batch.reduce((s, t) => s + t.length, 0);
      expect(totalChars / 3).toBeLessThanOrEqual(100_000);
    }
  });

  it("preserves input order across split batches", () => {
    const texts = Array.from({ length: 200 }, (_, i) => `text-${i}`);
    const batches = batchTextsForVoyage(texts);
    const flattened = batches.flat();
    expect(flattened).toEqual(texts);
  });
});

// Silence unused import warning from vi (kept for future expansion).
void vi;

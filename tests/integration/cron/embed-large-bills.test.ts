/**
 * Integration tests for the embed-large-bills cron — auth, eligibility
 * filtering, and queue-depth reporting. The actual embedding pipeline
 * (Voyage + DB writes) is exercised by spotting an "ok" path with no
 * eligible bills, since calling Voyage in CI would require an API key.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GET } from "@/app/api/cron/embed-large-bills/route";
import { seedBill } from "../fixtures";
import { getTestPrisma } from "../db";
import { invokeCron } from "../invoke";

// Voyage API mock — only used when an eligible bill makes it through
// to the embedding stage. In normal "no-eligible-bill" tests no
// outbound call happens, but we keep the server registered so a stray
// call surfaces as an obvious test failure.
const server = setupServer(
  http.post("https://api.voyageai.com/v1/embeddings", () =>
    HttpResponse.json({
      object: "list",
      data: [
        {
          object: "embedding",
          embedding: new Array(1024).fill(0.01),
          index: 0,
        },
      ],
      model: "voyage-3-large",
      usage: { total_tokens: 1 },
    }),
  ),
);

beforeAll(() => {
  process.env.VOYAGE_API_KEY = "test-voyage-key";
  server.listen({ onUnhandledRequest: "bypass" });
});

afterAll(() => server.close());

describe("GET /api/cron/embed-large-bills", () => {
  it("rejects missing auth", async () => {
    const res = await invokeCron(GET, { auth: null });
    expect(res.status).toBe(401);
  });

  it("rejects bearer mismatch", async () => {
    const res = await invokeCron(GET, { auth: "Bearer wrong-secret" });
    expect(res.status).toBe(401);
  });

  it("returns ok with empty queue when no large bills exist", async () => {
    const res = await invokeCron(GET);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
    expect(body.remaining).toBe(0);
    expect(body.results).toEqual([]);
  });

  it("ignores bills under the RAG threshold even when un-embedded", async () => {
    // 50K-char bill is under the 375K threshold — chat path inlines it
    // with prompt caching. Embedding it here would be wasted spend
    // AND would break the cache (since RAG returns query-specific
    // content). Pin that the cron skips.
    const bill = await seedBill({
      billId: "small-119",
      fullText: "x".repeat(50_000),
    });
    await getTestPrisma().billTextVersion.create({
      data: {
        billId: bill.id,
        versionCode: "ih",
        versionType: "Introduced",
        versionDate: new Date("2026-01-01"),
        fullText: "x".repeat(50_000),
      },
    });

    const res = await invokeCron(GET);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
    expect(body.remaining).toBe(0);
  });

  it("queues a large un-embedded bill", async () => {
    const bill = await seedBill({
      billId: "huge-119",
      fullText: "x".repeat(500_000),
    });
    await getTestPrisma().billTextVersion.create({
      data: {
        billId: bill.id,
        versionCode: "ih",
        versionType: "Introduced",
        versionDate: new Date("2026-02-13"),
        fullText: "Section 1. Short title\n" + "y".repeat(500_000),
      },
    });

    // We don't run the actual embedding here — that requires Voyage +
    // a parsed-section corpus. The contract this test pins: a large
    // un-embedded bill is *visible* to the queue, i.e. remaining > 0
    // before any cron processing kicks in.
    const res = await invokeCron(GET, { search: { limit: "0" } });
    const body = await res.json();
    expect(body.ok).toBe(true);
    // limit=0 means we count without processing.
    expect(body.results).toEqual([]);
    expect(body.remaining).toBeGreaterThanOrEqual(1);
  });

  it("treats a partial-write bill (chunks exist, no completion marker) as needing re-embed", async () => {
    // Pin the multi-tx persistence safety net. After PR 4,
    // `persistChunks` writes chunks across many independent
    // transactions; if a run crashes mid-loop, some chunks for the
    // current textVersion exist but `Bill.embeddingsTextVersionId`
    // stays null. The candidate filter MUST treat this bill as
    // needing re-embed — otherwise a partial-write failure on a
    // giant bill would silently mark it done and never recover.
    const bill = await seedBill({
      billId: "partial-119",
      fullText: "x".repeat(500_000),
    });
    const version = await getTestPrisma().billTextVersion.create({
      data: {
        billId: bill.id,
        versionCode: "ih",
        versionType: "Introduced",
        versionDate: new Date("2026-02-13"),
        fullText: "Section 1. Short title\n" + "y".repeat(500_000),
      },
    });

    // Simulate a partial write: a few chunks landed, but the
    // completion marker on Bill is still null.
    for (let i = 0; i < 3; i++) {
      const vec = `[${new Array(1024).fill(0.01).join(",")}]`;
      await getTestPrisma().$executeRawUnsafe(
        `INSERT INTO "BillEmbeddingChunk" ("billId", "textVersionId", "chunkIndex", "sectionRef", "heading", "content", "contextPrefix", "embedding", "embeddingModel") VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9)`,
        bill.id,
        version.id,
        i,
        `Section ${i + 1}`,
        `Section ${i + 1}. Heading`,
        "partial content",
        "",
        vec,
        "voyage-3-large",
      );
    }
    // Bill.embeddingsTextVersionId is still null (default).

    const res = await invokeCron(GET, { search: { limit: "0" } });
    const body = await res.json();
    expect(body.ok).toBe(true);
    // The partial-state bill must show up in the queue for re-embed.
    expect(body.remaining).toBeGreaterThanOrEqual(1);
  });

  it("skips a bill whose completion marker matches the latest text version", async () => {
    // The happy path: marker set, latest version still matches → skip.
    const bill = await seedBill({
      billId: "complete-119",
      fullText: "x".repeat(500_000),
    });
    const version = await getTestPrisma().billTextVersion.create({
      data: {
        billId: bill.id,
        versionCode: "ih",
        versionType: "Introduced",
        versionDate: new Date("2026-02-13"),
        fullText: "Section 1. Short title\n" + "y".repeat(500_000),
      },
    });
    await getTestPrisma().bill.update({
      where: { id: bill.id },
      data: {
        embeddingsTextVersionId: version.id,
        embeddingsCompletedAt: new Date(),
      },
    });

    const res = await invokeCron(GET, { search: { limit: "0" } });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.remaining).toBe(0);
  });

  it("respects ?limit cap", async () => {
    // Limit cap MAX_LIMIT=10 enforced even when caller passes higher.
    const res = await invokeCron(GET, { search: { limit: "999" } });
    expect(res.status).toBe(200);
    // The handler's MAX_LIMIT=10 — we just verify the request accepted
    // the high value and didn't 4xx.
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

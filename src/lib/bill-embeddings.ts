/**
 * Bill embedding pipeline — turns a bill's parsed sections into rows in
 * `BillEmbeddingChunk` so the chat path can do vector retrieval at
 * query time.
 *
 * Two stages per chunk:
 *  1. **Contextual retrieval prefix** — Haiku writes a 1-line summary
 *     situating the section ("Section 5(a) of HR 7567 covers SNAP
 *     eligibility for non-citizen households"). Anthropic's published
 *     benchmark shows ~30% recall lift on legal/structured docs vs.
 *     embedding the raw chunk alone.
 *  2. **Embedding** — `voyage-3-large` (1024-dim) over `prefix +
 *     heading + content`. Voyage's recommended `input_type: "document"`
 *     setup so the indexed side is biased for retrieval.
 *
 * The function is idempotent on `(billId, textVersionId)`: existing
 * rows for that key are deleted in a single transaction with the
 * inserts, so re-running the backfill on a bill replaces cleanly.
 *
 * Cost tracking: each call returns the running totals (Haiku tokens +
 * Voyage tokens + cents). The backfill script logs these and aborts if
 * a single bill blows past a configured cap.
 */
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { PrismaClient } from "@/generated/prisma/client";

import { type BillSection, parseSectionsFromFullText } from "./bill-sections";
import {
  voyageEmbedDocuments,
  batchTextsForVoyage,
  VOYAGE_EMBED_MODEL,
} from "./voyage";

/** Same Haiku model the rest of the codebase uses for cheap structured
 *  tasks — see `lib/ai.ts`. Pinned to the constant there in spirit; we
 *  re-declare locally rather than importing to keep this module
 *  decoupled from the chat-path constants. */
const HAIKU_MODEL = "claude-haiku-4-5";

/** Pricing for cost tracking. Mirrors `lib/ai-pricing.ts`. */
const HAIKU_INPUT_CENTS_PER_MTOK = 100;
const HAIKU_OUTPUT_CENTS_PER_MTOK = 500;

/** Cap on chars passed to Haiku per chunk for context generation.
 *  Keeps the per-chunk Haiku cost bounded — a 30K-char section produces
 *  the same quality of 1-line context as its first 4K chars. */
const CHUNK_CHARS_FOR_CONTEXT = 4_000;

/** Skip very short sections — pure heading-only or boilerplate.
 *  Embedding "(b) Definitions." alone is noise; the section it
 *  precedes will pull better. */
const MIN_CHUNK_CONTENT_CHARS = 80;

/** Threshold for whether a bill should run through the RAG path.
 *  Bills under this size fit comfortably in Sonnet's window with
 *  prompt caching; embedding them is wasted spend (and breaks the
 *  cache, since RAG returns query-specific content). Matches the
 *  budget logic in `lib/ai.ts` (180K-token input budget − 15K
 *  overhead reserve − history headroom). */
export const RAG_BILL_TOKEN_THRESHOLD = 150_000;
export const RAG_BILL_CHAR_THRESHOLD = RAG_BILL_TOKEN_THRESHOLD * 2.5;

export interface BillEmbeddingMetadata {
  title: string;
  billType: string;
  chamber: string | null;
  sponsor: string | null;
  policyArea: string | null;
  currentStatus: string | null;
}

export interface ChunkInput {
  sectionRef: string;
  heading: string;
  content: string;
}

/**
 * Pure prompt builder for chunk-context generation. Extracted so we
 * can pin the prompt's shape in unit tests without mocking Anthropic.
 *
 * The contextual-retrieval pattern hinges on the model receiving
 * enough about the bill to ground the chunk; we deliberately include
 * sponsor, chamber, and policy area so a chunk like "(a) Definitions"
 * can still produce a useful context line ("Section 5(a) of the Farm,
 * Food, and National Security Act defines pesticide registrants for
 * the purposes of EPA fast-track review"). Without metadata, that
 * same chunk yields generic noise.
 */
export function buildChunkContextPrompt(
  metadata: BillEmbeddingMetadata,
  chunk: ChunkInput,
): { system: string; user: string } {
  const truncatedContent = chunk.content.slice(0, CHUNK_CHARS_FOR_CONTEXT);

  const system = `You are documenting one section of a U.S. federal bill so a search system can retrieve it later. Given the bill's metadata and a section's text, produce a single sentence that situates the section within the bill's purpose — what topic the section addresses, who or what it affects, and what mechanism (eligibility, funding, prohibition, definition, etc.) it uses.

Output only the sentence. No preamble, no quotes, no markdown. Maximum 30 words. Stay strictly factual; if the section is purely procedural, say so plainly.`;

  const user = `Bill: "${metadata.title}"
Type: ${metadata.billType}${metadata.chamber ? ` (${metadata.chamber})` : ""}
${metadata.sponsor ? `Sponsor: ${metadata.sponsor}\n` : ""}${metadata.policyArea ? `Policy area: ${metadata.policyArea}\n` : ""}${metadata.currentStatus ? `Status: ${metadata.currentStatus}\n` : ""}
Section: ${chunk.sectionRef}
Heading: ${chunk.heading}

Content:
${truncatedContent}

Write the one-sentence context.`;

  return { system, user };
}

/**
 * Build one chunk-context line via Haiku. Thin wrapper around the
 * pure prompt builder + the AI SDK call.
 */
export async function generateChunkContext(
  metadata: BillEmbeddingMetadata,
  chunk: ChunkInput,
): Promise<{
  context: string;
  usage: { inputTokens: number; outputTokens: number };
}> {
  const { system, user } = buildChunkContextPrompt(metadata, chunk);

  const result = await generateText({
    model: anthropic(HAIKU_MODEL),
    system,
    messages: [{ role: "user", content: user }],
    maxOutputTokens: 80,
  });

  return {
    context: result.text.trim(),
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    },
  };
}

export interface EmbedBillResult {
  billId: number;
  textVersionId: number;
  chunksWritten: number;
  chunksSkipped: number;
  haikuInputTokens: number;
  haikuOutputTokens: number;
  voyageTokens: number;
  totalCostCents: number;
  /** True when the existing rows were dropped before the new write. */
  replacedExisting: boolean;
}

export interface EmbedBillOptions {
  /** When true, computes cost + plans the work but writes nothing. */
  dryRun?: boolean;
  /** Maximum cents we're willing to spend on this bill. Aborts if the
   *  running total exceeds this. Set generously by default; backfill
   *  script overrides per-bill. */
  maxCostCents?: number;
  /** Hook for progress logs from the script. */
  onProgress?: (msg: string) => void;
}

/**
 * Embed every section of a bill's latest substantive text version.
 * Idempotent: existing chunks for the (billId, textVersionId) tuple
 * are removed before insert.
 *
 * Returns a result summary or throws on any pipeline error. The script
 * caller is responsible for logging + per-bill error handling.
 */
export async function embedBill(
  prisma: PrismaClient,
  billId: number,
  options: EmbedBillOptions = {},
): Promise<EmbedBillResult> {
  const { dryRun = false, maxCostCents, onProgress } = options;
  const log = onProgress ?? (() => {});

  // ── Resolve bill + latest substantive version ─────────────────────
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    select: {
      id: true,
      billId: true,
      title: true,
      billType: true,
      currentChamber: true,
      sponsor: true,
      policyArea: true,
      currentStatus: true,
      // Latest version with fullText. We deliberately do NOT filter on
      // `isSubstantive` because the chat route doesn't either — an
      // omnibus that was only introduced (and therefore flagged
      // non-substantive by the parser's heuristic) still gets chatted
      // about, and we want to keep the embeddings aligned with what
      // the user-facing path actually shows.
      textVersions: {
        where: { fullText: { not: null } },
        orderBy: { versionDate: "desc" },
        take: 1,
        select: {
          id: true,
          fullText: true,
          versionType: true,
          versionDate: true,
        },
      },
    },
  });
  if (!bill) {
    throw new Error(`Bill ${billId} not found.`);
  }
  const version = bill.textVersions[0];
  if (!version || !version.fullText) {
    throw new Error(
      `Bill ${billId} (${bill.billId}) has no text version with fullText.`,
    );
  }

  log(
    `[embed] bill ${bill.billId} version ${version.id} (${version.versionType}, ${version.versionDate.toISOString().slice(0, 10)})`,
  );

  // ── Parse + filter sections ───────────────────────────────────────
  const parsed = parseSectionsFromFullText(version.fullText);
  const usable = parsed.filter(
    (s) => s.content.trim().length >= MIN_CHUNK_CONTENT_CHARS,
  );
  log(
    `[embed]   ${parsed.length} parsed sections, ${usable.length} usable (>= ${MIN_CHUNK_CONTENT_CHARS} chars)`,
  );

  if (usable.length === 0) {
    return {
      billId,
      textVersionId: version.id,
      chunksWritten: 0,
      chunksSkipped: parsed.length,
      haikuInputTokens: 0,
      haikuOutputTokens: 0,
      voyageTokens: 0,
      totalCostCents: 0,
      replacedExisting: false,
    };
  }

  const metadata: BillEmbeddingMetadata = {
    title: bill.title,
    billType: bill.billType,
    chamber: bill.currentChamber,
    sponsor: bill.sponsor,
    policyArea: bill.policyArea,
    currentStatus: bill.currentStatus,
  };

  // ── Stage 1: contextual prefixes (sequential, bounded concurrency) ─
  // Anthropic accepts moderate concurrency, but cron-time runs are not
  // latency-sensitive — sequential keeps us nicely under their TPS
  // budget and produces predictable cost numbers in dry-run.
  let haikuInputTokens = 0;
  let haikuOutputTokens = 0;
  const contexts: string[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < usable.length; i += CONCURRENCY) {
    const batch = usable.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((s) =>
        dryRun
          ? Promise.resolve({
              context: `(dry-run) ${s.sectionRef} ${s.heading.slice(0, 50)}`,
              usage: {
                // Estimate: ~50 input tokens metadata + chars/3 for content,
                // capped at CHUNK_CHARS_FOR_CONTEXT chars.
                inputTokens:
                  50 +
                  Math.ceil(
                    Math.min(s.content.length, CHUNK_CHARS_FOR_CONTEXT) / 3,
                  ),
                outputTokens: 30,
              },
            })
          : generateChunkContext(metadata, {
              sectionRef: s.sectionRef,
              heading: s.heading,
              content: s.content,
            }),
      ),
    );
    for (const r of results) {
      contexts.push(r.context);
      haikuInputTokens += r.usage.inputTokens;
      haikuOutputTokens += r.usage.outputTokens;
    }
    if (i % (CONCURRENCY * 10) === 0) {
      log(
        `[embed]   contexts: ${Math.min(i + CONCURRENCY, usable.length)}/${usable.length}`,
      );
    }

    // Cost guard inside the loop so we abort early on runaway bills.
    const haikuCostSoFar = Math.ceil(
      (haikuInputTokens * HAIKU_INPUT_CENTS_PER_MTOK) / 1_000_000 +
        (haikuOutputTokens * HAIKU_OUTPUT_CENTS_PER_MTOK) / 1_000_000,
    );
    if (maxCostCents != null && haikuCostSoFar > maxCostCents) {
      throw new Error(
        `Bill ${bill.billId} exceeded maxCostCents (${maxCostCents}) at the contextual-retrieval stage. Aborting.`,
      );
    }
  }

  // ── Stage 2: embeddings (batched) ─────────────────────────────────
  const inputsForVoyage = usable.map((s, i) => {
    const prefix = contexts[i];
    return `${prefix}\n\n${s.heading}\n\n${s.content}`;
  });
  const batches = batchTextsForVoyage(inputsForVoyage);
  log(
    `[embed]   embedding ${inputsForVoyage.length} chunks in ${batches.length} batch(es)`,
  );

  let voyageTokens = 0;
  let voyageCostCents = 0;
  const allEmbeddings: number[][] = [];
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    if (dryRun) {
      // Mock vectors so the rest of the pipeline can dry-run end-to-end.
      // Voyage charges ~chars/3 input tokens — match that estimate.
      const tokens = Math.ceil(batch.reduce((sum, t) => sum + t.length, 0) / 3);
      voyageTokens += tokens;
      voyageCostCents += Math.ceil((tokens * 18) / 1_000_000);
      for (let i = 0; i < batch.length; i++) {
        allEmbeddings.push(new Array(1024).fill(0));
      }
    } else {
      const result = await voyageEmbedDocuments(batch);
      voyageTokens += result.totalTokens;
      voyageCostCents += result.costCents;
      allEmbeddings.push(...result.embeddings);
    }

    const totalSoFar =
      Math.ceil(
        (haikuInputTokens * HAIKU_INPUT_CENTS_PER_MTOK) / 1_000_000 +
          (haikuOutputTokens * HAIKU_OUTPUT_CENTS_PER_MTOK) / 1_000_000,
      ) + voyageCostCents;
    if (maxCostCents != null && totalSoFar > maxCostCents) {
      throw new Error(
        `Bill ${bill.billId} exceeded maxCostCents (${maxCostCents}) at the embedding stage. Aborting.`,
      );
    }
  }

  // ── Persist (or skip on dry-run) ──────────────────────────────────
  const haikuCostCents =
    Math.ceil((haikuInputTokens * HAIKU_INPUT_CENTS_PER_MTOK) / 1_000_000) +
    Math.ceil((haikuOutputTokens * HAIKU_OUTPUT_CENTS_PER_MTOK) / 1_000_000);
  const totalCostCents = haikuCostCents + voyageCostCents;

  if (dryRun) {
    log(
      `[embed]   DRY RUN — would write ${usable.length} rows. Estimated cost: ${(totalCostCents / 100).toFixed(2)} USD (haiku ${(haikuCostCents / 100).toFixed(2)} + voyage ${(voyageCostCents / 100).toFixed(2)})`,
    );
    return {
      billId,
      textVersionId: version.id,
      chunksWritten: 0,
      chunksSkipped: parsed.length - usable.length,
      haikuInputTokens,
      haikuOutputTokens,
      voyageTokens,
      totalCostCents,
      replacedExisting: false,
    };
  }

  const replacedExisting = await persistChunks(
    prisma,
    billId,
    version.id,
    usable,
    contexts,
    allEmbeddings,
  );

  log(
    `[embed]   wrote ${usable.length} rows (replacedExisting=${replacedExisting}). Cost: ${(totalCostCents / 100).toFixed(2)} USD`,
  );

  return {
    billId,
    textVersionId: version.id,
    chunksWritten: usable.length,
    chunksSkipped: parsed.length - usable.length,
    haikuInputTokens,
    haikuOutputTokens,
    voyageTokens,
    totalCostCents,
    replacedExisting,
  };
}

/**
 * Delete + insert in a single transaction. Prisma has no native pgvector
 * write helper, so we issue parameterized raw SQL — the `vector(1024)`
 * column expects a literal in the form `'[0.1,0.2,...]'::vector`.
 *
 * Batched into multi-row INSERTs (~100 rows per call) so a 5000-section
 * omnibus doesn't issue 5000 round trips.
 */
async function persistChunks(
  prisma: PrismaClient,
  billId: number,
  textVersionId: number,
  sections: BillSection[],
  contexts: string[],
  embeddings: number[][],
): Promise<boolean> {
  const INSERT_BATCH = 100;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.billEmbeddingChunk.deleteMany({
      where: { billId, textVersionId },
    });
    const replacedExisting = existing.count > 0;

    for (let i = 0; i < sections.length; i += INSERT_BATCH) {
      const batchSections = sections.slice(i, i + INSERT_BATCH);
      const batchContexts = contexts.slice(i, i + INSERT_BATCH);
      const batchEmbeddings = embeddings.slice(i, i + INSERT_BATCH);

      const values: string[] = [];
      const params: (string | number)[] = [];
      for (let j = 0; j < batchSections.length; j++) {
        const idx = i + j;
        const section = batchSections[j];
        const context = batchContexts[j];
        const embedding = batchEmbeddings[j];
        const vectorLiteral = `[${embedding.join(",")}]`;

        const base = params.length;
        // Order matches the column list below. Vector goes through as a
        // text literal cast to vector — pg-style $N::vector.
        params.push(
          billId,
          textVersionId,
          idx,
          section.sectionRef,
          section.heading,
          section.content,
          context,
          vectorLiteral,
          VOYAGE_EMBED_MODEL,
        );
        values.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::vector, $${base + 9})`,
        );
      }

      const sql = `INSERT INTO "BillEmbeddingChunk" ("billId", "textVersionId", "chunkIndex", "sectionRef", "heading", "content", "contextPrefix", "embedding", "embeddingModel") VALUES ${values.join(", ")}`;
      await tx.$executeRawUnsafe(sql, ...params);
    }

    return replacedExisting;
  });
}

/**
 * Whether a bill is large enough to need RAG. Sized to match the chat
 * path's overhead-aware budget — bills under this comfortably fit in
 * Sonnet's window with prompt caching, where RAG would only add cost +
 * break the cache.
 */
export function shouldUseRag(billFullTextChars: number): boolean {
  return billFullTextChars > RAG_BILL_CHAR_THRESHOLD;
}

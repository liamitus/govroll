/**
 * Vector retrieval (RAG) at chat time.
 *
 * Replaces the Haiku-name-filter pre-pass for bills that have been
 * embedded into `BillEmbeddingChunk`. The previous filter looked at
 * section *headings* and tried to keyword-match user questions against
 * them — fast, but blind to questions that don't share vocabulary with
 * the bill. The HR 7567 "what does this bill do for bayer" failure was
 * the canonical case: the relevant sections (pesticide registration,
 * agrichemical fast-track, EPA review) don't contain the word "bayer"
 * anywhere, so name-matching missed them entirely.
 *
 * Vector retrieval over Voyage embeddings catches that kind of
 * semantic linkage. The contextual-retrieval prefix added at embed
 * time ("Section 5(a) of HR 7567 covers pesticide registration for
 * fast-track applicants") gives chunks a search-friendly framing
 * beyond their raw text.
 *
 * The retrieval result feeds the same `BillSection[]` shape the
 * existing prompt builder consumes, so the prompt structure +
 * citation rules stay identical regardless of which path produced
 * the sections.
 */
import type { PrismaClient } from "@/generated/prisma/client";

import type { BillSection } from "./bill-sections";
import { voyageEmbedQuery, VOYAGE_EMBED_MODEL } from "./voyage";

/** Default top-K for retrieval. Sized so the section pack still has
 *  room to fit comfortably under the prompt budget — at ~3K tokens
 *  per chunk, K=30 is ~90K tokens of section content, well under the
 *  165K-token section budget left after metadata + history reserves. */
export const DEFAULT_RAG_TOP_K = 30;

/** Whether the chat path should attempt RAG retrieval at all. Toggled
 *  by `AI_CHAT_RAG_ENABLED` env var so we can ship the code dark and
 *  flip it on per-bill or globally once HR 7567 quality is proven.
 *
 *  Read at call time (not module load) so the env can be flipped
 *  without redeploying — the chat route picks up the new value on the
 *  next request. */
export function isRagPathEnabled(): boolean {
  return process.env.AI_CHAT_RAG_ENABLED === "true";
}

/** Cheap existence probe — does this bill have any embedded chunks?
 *  Used to fall back to the Haiku-name-filter path when a bill is
 *  large enough to need RAG but hasn't been backfilled yet.
 *
 *  Goes through the FK index, so it's a single-row read at most. */
export async function billHasEmbeddings(
  prisma: PrismaClient,
  billId: number,
): Promise<boolean> {
  const row = await prisma.billEmbeddingChunk.findFirst({
    where: { billId },
    select: { id: true },
  });
  return row != null;
}

export interface RagRetrievalResult {
  /** Top-K sections, in similarity order (best first). Shape matches
   *  what the existing prompt builder expects so it can be drop-in
   *  swapped with `selectSectionsForQuestion`'s output. */
  sections: BillSection[];
  /** Voyage tokens consumed by the query embedding. The chat route
   *  forwards this to `recordSpend` so the budget gate stays
   *  accurate. */
  queryEmbeddingTokens: number;
  queryEmbeddingCostCents: number;
  /** Pgvector cosine *distance* for each returned chunk (lower is
   *  more similar). Useful in logs for tuning top-K and chunk
   *  granularity later. */
  distances: number[];
  /** True when retrieval ran cleanly. False when the cosine search
   *  produced zero rows (e.g. bill embedded but query embedding
   *  failed to match anything — vanishingly rare with HNSW). */
  hadResults: boolean;
}

/** Raw row shape returned by the cosine search query. */
interface RawChunkRow {
  id: number;
  sectionRef: string;
  heading: string;
  content: string;
  contextPrefix: string;
  /** pgvector returns `embedding <=> $1` as a numeric distance. */
  distance: number;
}

/**
 * Embed the user's question and pull the top-K most similar chunks
 * from `BillEmbeddingChunk`.
 *
 * Uses Voyage's asymmetric retrieval setup: `input_type: "query"` on
 * the question side, paired with the `input_type: "document"`
 * embeddings produced at indexing time. This consistently lifts recall
 * a few points over symmetric encoding.
 *
 * Cosine distance via the `<=>` operator. The HNSW index makes this
 * a sublinear lookup; even a 5K-section bill returns top-30 in tens
 * of milliseconds.
 */
export async function retrieveRelevantSections(
  prisma: PrismaClient,
  billId: number,
  query: string,
  k: number = DEFAULT_RAG_TOP_K,
): Promise<RagRetrievalResult> {
  // ── Embed the query ───────────────────────────────────────────────
  const embedResult = await voyageEmbedQuery(query);
  const vector = embedResult.embeddings[0];
  if (!vector || vector.length === 0) {
    throw new Error(
      `voyageEmbedQuery returned no embedding for query (billId=${billId}).`,
    );
  }

  // ── Cosine search via raw SQL ─────────────────────────────────────
  // pgvector requires the query vector as a literal `'[…]'::vector`.
  // We send it parameterized to avoid SQL-injection risk, but the
  // cast suffix is part of the SQL since `::` isn't expressible
  // through Prisma's parameter binding.
  const vectorLiteral = `[${vector.join(",")}]`;

  // Match the embedding model so we don't accidentally search across
  // chunks indexed with a different (incompatible-dimension) model
  // after a future swap. With one model in production today this is
  // a no-op filter, but it future-proofs the code at near-zero cost.
  const rows = await prisma.$queryRawUnsafe<RawChunkRow[]>(
    `SELECT
       id,
       "sectionRef" AS "sectionRef",
       heading,
       content,
       "contextPrefix" AS "contextPrefix",
       (embedding <=> $1::vector)::float8 AS distance
     FROM "BillEmbeddingChunk"
     WHERE "billId" = $2
       AND "embeddingModel" = $3
     ORDER BY embedding <=> $1::vector
     LIMIT $4`,
    vectorLiteral,
    billId,
    VOYAGE_EMBED_MODEL,
    k,
  );

  const sections: BillSection[] = rows.map((r) => ({
    sectionRef: r.sectionRef,
    heading: r.heading,
    content: r.content,
  }));
  const distances = rows.map((r) => r.distance);

  return {
    sections,
    queryEmbeddingTokens: embedResult.totalTokens,
    queryEmbeddingCostCents: embedResult.costCents,
    distances,
    hadResults: rows.length > 0,
  };
}

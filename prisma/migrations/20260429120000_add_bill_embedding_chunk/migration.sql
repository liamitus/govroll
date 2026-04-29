-- Vector retrieval (RAG) for bills too large to fit in the chat context
-- window. Prevents the silent truncation we did for HR 7567 when the
-- 60-section Haiku pre-filter still produced > 200K tokens — instead we
-- embed every section once on ingest and run a semantic similarity
-- search at query time.
--
-- Schema: one row per (bill, version, section). The contextPrefix is
-- the Anthropic-style contextual-retrieval line ("Section 4(a) of HR
-- 7567 covers pesticide registration") prepended to the chunk before
-- embedding — empirically lifts recall ~30% on legal text.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "BillEmbeddingChunk" (
    "id"             SERIAL PRIMARY KEY,
    "billId"         INTEGER NOT NULL,
    "textVersionId"  INTEGER NOT NULL,
    "chunkIndex"     INTEGER NOT NULL,
    "sectionRef"     TEXT NOT NULL,
    "heading"        TEXT NOT NULL,
    "content"        TEXT NOT NULL,
    "contextPrefix"  TEXT NOT NULL,
    "embedding"      vector(1024) NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillEmbeddingChunk_billId_fkey"
        FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE,
    CONSTRAINT "BillEmbeddingChunk_textVersionId_fkey"
        FOREIGN KEY ("textVersionId") REFERENCES "BillTextVersion"("id") ON DELETE CASCADE
);

-- One row per section per version. Re-embedding a version replaces in
-- place via UPSERT on this key. New versions of the same bill produce
-- new rows (we keep historical embeddings around so a user reading an
-- older version still gets semantically-grounded answers).
CREATE UNIQUE INDEX "BillEmbeddingChunk_billId_textVersionId_chunkIndex_key"
    ON "BillEmbeddingChunk"("billId", "textVersionId", "chunkIndex");

CREATE INDEX "BillEmbeddingChunk_billId_idx"
    ON "BillEmbeddingChunk"("billId");

CREATE INDEX "BillEmbeddingChunk_textVersionId_idx"
    ON "BillEmbeddingChunk"("textVersionId");

-- HNSW for fast approximate cosine search. Defaults (m=16,
-- ef_construction=64) are appropriate at our scale (~30K chunks for
-- ~500 large bills); revisit if pgvector docs flag tuning needs as the
-- corpus grows. We index against vector_cosine_ops because Voyage's
-- voyage-3-large embeddings are L2-normalized and we want angular
-- similarity, not Euclidean distance.
CREATE INDEX "BillEmbeddingChunk_embedding_hnsw_idx"
    ON "BillEmbeddingChunk"
    USING hnsw (embedding vector_cosine_ops);

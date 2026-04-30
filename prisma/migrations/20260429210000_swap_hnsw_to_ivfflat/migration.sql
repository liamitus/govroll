-- Swap the BillEmbeddingChunk vector index from HNSW to IVFFlat.
--
-- Why: pgvector's HNSW per-row insert cost grows nonlinearly with
-- index size. Empirically, on 161K vectors, individual INSERTs into
-- BillEmbeddingChunk routinely hit the Supabase pooler's 2-min
-- statement_timeout — meaning the cron's "embed a new bill version"
-- job fails on any bill with more than a few hundred chunks. A full
-- HNSW rebuild on the same 161K vectors didn't complete in 8.5 min
-- (we cancelled it), reinforcing how expensive HNSW maintenance is at
-- our scale.
--
-- IVFFlat trades:
--   - Slightly slower query (~5-10ms vs HNSW ~3ms — immaterial against
--     the 30s end-to-end Sonnet streaming)
--   - Slightly lower recall (~90% vs ~95% — top-60 retrieval has
--     enough redundancy that this is fine for our use case)
--   - For: insert cost that DOESN'T grow with index size. Each row
--     finds its cluster centroid (cheap) and appends. Build time on
--     161K vectors is ~1-2 min vs HNSW's 10+ min.
--
-- `lists = 200`: pgvector's recommended default is `rows/1000` for
-- corpora under 1M rows. With ~161K rows today and growing slowly,
-- 200 is a comfortable choice (between rows/1000 and sqrt(rows)).
-- Revisit if the corpus grows past 500K rows.

DROP INDEX IF EXISTS "BillEmbeddingChunk_embedding_hnsw_idx";

-- IVFFlat needs `statement_timeout = 0` for the build, same as HNSW
-- did, since the build can exceed the pooler's 2-min cap on a fresh
-- corpus load. SET LOCAL applies only inside this transaction.
SET LOCAL statement_timeout = 0;

CREATE INDEX "BillEmbeddingChunk_embedding_ivfflat_idx"
  ON "BillEmbeddingChunk"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 200);

-- IVFFlat needs current statistics for the planner to pick the right
-- probe count. Without ANALYZE the index works but recall can drop
-- noticeably on the first few queries until autovacuum catches up.
ANALYZE "BillEmbeddingChunk";

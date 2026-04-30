-- Enable Row Level Security on tables created after the original
-- `enable_rls_on_all_tables` migration ran.
--
-- Background: 20260414150000_enable_rls_on_all_tables uses a one-shot
-- pg_tables loop, which only flips on RLS for tables that exist at the
-- moment it runs. Tables created later inherit the Postgres default
-- (rowsecurity=false), which exposes them to anon-key reads via
-- PostgREST. Two such tables exist today:
--
--   - BillEmbeddingChunk (created 2026-04-29 in
--     20260429120000_add_bill_embedding_chunk)
--   - AiSummaryFeedback (created 2026-04-27 in
--     20260427100000_add_ai_summary_feedback, but only applied to prod
--     today after the migration was found to have never run)
--
-- The bill text these tables expose is already public on govroll.com,
-- so the practical leak was modest. But the project's stance is
-- "RLS on every public-schema table" and these were the two exceptions.
--
-- Going forward: every CREATE TABLE migration should include its own
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` line. We'll add a CI
-- guard for this in a follow-up.
--
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent — re-running
-- against an already-enabled table is a no-op.

ALTER TABLE "BillEmbeddingChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiSummaryFeedback" ENABLE ROW LEVEL SECURITY;

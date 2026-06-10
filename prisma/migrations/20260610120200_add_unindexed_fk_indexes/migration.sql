-- Covering indexes for two foreign keys the Supabase performance advisor
-- flagged as unindexed.
--
--   Vote.billId             No index led with billId (only userId and the
--                           (userId, billId) unique constraint). Per-bill
--                           vote lookups and ON DELETE CASCADE from a bill
--                           did sequential scans.
--   Comment.parentCommentId The existing (billId, parentCommentId) composite
--                           leads with billId, so it cannot serve the
--                           parentCommentId FK on its own (reply lookups and
--                           ON DELETE CASCADE from a parent comment).
CREATE INDEX IF NOT EXISTS "Vote_billId_idx" ON "Vote" ("billId");
CREATE INDEX IF NOT EXISTS "Comment_parentCommentId_idx" ON "Comment" ("parentCommentId");

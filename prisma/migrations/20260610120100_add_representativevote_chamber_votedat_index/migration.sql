-- Add (chamber, "votedAt" DESC) to RepresentativeVote.
--
-- The congress-session vote-recency signal (src/lib/congress-session/
-- vote-recency.ts) runs every 10 minutes and asks "newest votedAt for this
-- chamber". With chamber now normalized to lowercase at write time, the
-- query switched from `chamber ILIKE $1` to
-- `chamber = $1 AND "votedAt" IS NOT NULL ORDER BY "votedAt" DESC LIMIT 1`.
-- No existing index led with chamber (the composites lead with billId), so
-- the planner did a full scan + top-N sort (~457ms x 2.4k calls). This
-- index turns it into a single index-scan fetch.
CREATE INDEX IF NOT EXISTS "RepresentativeVote_chamber_votedAt_idx"
  ON "RepresentativeVote" ("chamber", "votedAt" DESC);

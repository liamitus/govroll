-- Track per-bill embedding completion state.
--
-- Background: persistChunks used to wrap delete+all-inserts in a single
-- Prisma transaction so it was atomic. That works for small bills but
-- the very largest legislation we index (NDAA-class, 10K+ chunks) blows
-- through any reasonable transaction timeout because pgvector's HNSW
-- index update gets nonlinearly slow at that scale.
--
-- The fix is to split persistChunks into many smaller (implicit) per-
-- statement transactions. The trade-off: a mid-run failure leaves the
-- bill in a partial state — some chunks for the new textVersion exist,
-- some don't.
--
-- The old `--incremental` candidate filter just checked "any chunk
-- exists for this textVersion" — which would silently mark a partial
-- bill as done and never retry it. This column gives us a real
-- "completed" signal: it's set ONLY after the last insert succeeds, so
-- partial states stay invisible to the candidate filter and the
-- embedding pipeline picks them up on the next run.

ALTER TABLE "Bill"
  ADD COLUMN "embeddingsTextVersionId" INTEGER,
  ADD COLUMN "embeddingsCompletedAt" TIMESTAMP(3);

-- Lookup index for the candidate filter — every cron run scans all
-- bills WHERE latest text version differs from `embeddingsTextVersionId`.
CREATE INDEX "Bill_embeddingsTextVersionId_idx"
  ON "Bill"("embeddingsTextVersionId");

-- Backfill state for the 77 bills already embedded by the script before
-- this column existed. Take the textVersionId of any chunk for that
-- bill (they all share the same textVersionId per bill — see the
-- unique constraint on (billId, textVersionId, chunkIndex)) and the
-- max(createdAt) as a reasonable approximation of completion time.
-- After this, the candidate filter behaves correctly for both pre-
-- existing and freshly-embedded bills.
UPDATE "Bill" b
SET
  "embeddingsTextVersionId" = chunks."textVersionId",
  "embeddingsCompletedAt" = chunks.completed_at
FROM (
  SELECT DISTINCT ON ("billId")
    "billId",
    "textVersionId",
    MAX("createdAt") OVER (PARTITION BY "billId") AS completed_at
  FROM "BillEmbeddingChunk"
) chunks
WHERE b.id = chunks."billId";

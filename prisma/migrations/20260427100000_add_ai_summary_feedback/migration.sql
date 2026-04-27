-- Anonymous thumbs-up/-down feedback on AI-generated bill content.
-- Snapshots the model + bill text version at submission time so quality
-- can be analyzed per model/version after a later regeneration overwrites
-- the columns on Bill.
CREATE TABLE "AiSummaryFeedback" (
  "id"                 TEXT NOT NULL,
  "billId"             INTEGER NOT NULL,
  "surface"            TEXT NOT NULL,
  "aiSummaryVersionId" INTEGER,
  "aiSummaryModel"     TEXT,
  "rating"             INTEGER NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiSummaryFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiSummaryFeedback_billId_surface_createdAt_idx"
  ON "AiSummaryFeedback"("billId", "surface", "createdAt");

CREATE INDEX "AiSummaryFeedback_createdAt_idx"
  ON "AiSummaryFeedback"("createdAt");

ALTER TABLE "AiSummaryFeedback"
  ADD CONSTRAINT "AiSummaryFeedback_billId_fkey"
  FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AI-generated plain-language explainer for the bill detail page: a short
-- 2–3 sentence description and 3 key-point bullets sourced from the latest
-- substantive bill text (or CRS summary if text is unavailable). Replaces
-- the leading-with-CRS-legalese pattern on the bill page.
--
-- `aiSummaryVersionId` tracks which BillTextVersion row was analyzed so the
-- backfill script can detect stale explainers after a new substantive
-- amendment lands and regenerate. Kept as a plain Int (not a relation) for
-- the same reason section captions are tracked loosely.
ALTER TABLE "Bill"
  ADD COLUMN IF NOT EXISTS "aiShortDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "aiKeyPoints" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "aiSummaryModel" TEXT,
  ADD COLUMN IF NOT EXISTS "aiSummaryCreatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "aiSummaryVersionId" INTEGER;

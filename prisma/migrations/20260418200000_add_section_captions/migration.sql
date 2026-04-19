-- AI-generated one-sentence plain-English captions for each parsed section
-- of a bill text version. Used by the new bill reader (/bills/[id]/read)
-- to power the smart outline. Generated lazily on first reader visit via
-- after() and warmed for hot bills by the generate-section-captions cron.
-- Null means "not yet generated for this version."
ALTER TABLE "BillTextVersion"
  ADD COLUMN IF NOT EXISTS "sectionCaptions" JSONB,
  ADD COLUMN IF NOT EXISTS "captionsModel" TEXT,
  ADD COLUMN IF NOT EXISTS "captionsCreatedAt" TIMESTAMP(3);

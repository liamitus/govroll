-- Add BillTextVersion.textLength — the character length of fullText,
-- written at ingest (fetch-bill-text) alongside the text itself.
--
-- Why: the embed-large-bills candidate scan compared
-- LENGTH(v."fullText") > threshold to find bills big enough to need RAG.
-- On a TOASTed text column LENGTH() detoasts the whole value, so every
-- 30-min run fetched the latest fullText of every bill just to read a
-- number — ~12-15s/run, ~10% of total DB time across 48 runs/day, for a
-- queue that is usually empty. This column stores the length inline so the
-- scan reads an int and never touches toast storage.
--
-- Nullable: a row's textLength is null exactly when its fullText is null.
-- Backfilled below for every existing row that has text; thereafter
-- fetch-bill-text writes it on every upsert.

ALTER TABLE "BillTextVersion" ADD COLUMN "textLength" INTEGER;

-- Backfill existing rows. LENGTH() on a text column counts characters
-- (not bytes), matching the prior LENGTH(v."fullText") threshold semantics
-- and JavaScript's String#length for the all-BMP text of federal bills, so
-- the comparison stays consistent across backfilled and freshly-written rows.
UPDATE "BillTextVersion"
SET "textLength" = LENGTH("fullText")
WHERE "fullText" IS NOT NULL;

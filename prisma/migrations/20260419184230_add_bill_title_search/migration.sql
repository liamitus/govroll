-- Add popular/short/display title columns, a weighted tsvector for ranked
-- full-text search, and pg_trgm for typo-tolerant fuzzy fallback. Users
-- type the popular name ("CHIPS Act"), not the official title, so the
-- weighting deliberately ranks popular + display titles above the
-- official title.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Bill"
  ADD COLUMN "popularTitle" TEXT,
  ADD COLUMN "shortTitle" TEXT,
  ADD COLUMN "displayTitle" TEXT;

-- Weighted tsvector. 'english' config is immutable, so this is usable
-- in a STORED generated column. Weights match search UX priority:
--   A: popularTitle + displayTitle (what humans type)
--   B: shortTitle
--   C: title (official title)
--   D: shortText (CRS summary)
ALTER TABLE "Bill"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("popularTitle", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("displayTitle", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("shortTitle", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("title", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("shortText", '')), 'D')
  ) STORED;

CREATE INDEX "Bill_searchVector_idx" ON "Bill" USING GIN ("searchVector");

-- Trigram fallback — fuzzy match against all title fields concatenated.
-- pg_trgm is designed for similarity/ILIKE acceleration; weighting is
-- handled in SQL via similarity() thresholds at query time.
CREATE INDEX "Bill_title_trgm_idx" ON "Bill"
  USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Bill_popularTitle_trgm_idx" ON "Bill"
  USING GIN ("popularTitle" gin_trgm_ops);
CREATE INDEX "Bill_shortTitle_trgm_idx" ON "Bill"
  USING GIN ("shortTitle" gin_trgm_ops);

-- Per-account user preferences (e.g. hideVoted on the bills feed). JSONB so
-- we can add new keys without per-pref migrations; treated as opaque by the
-- DB and validated by Zod at the API boundary. Existing rows get '{}' so
-- callers always see a usable object.
ALTER TABLE "Profile"
  ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}';

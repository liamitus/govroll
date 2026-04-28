-- Adds two momentum-supporting columns:
--
--   latestMajorActionDate  — most recent action that materially advanced
--   the bill (markup, chamber passage, conference report, etc.; see
--   isMajorAction in src/lib/momentum.ts). The momentum recency signal
--   now uses this instead of the any-action latestActionDate, so a bill
--   getting only sub-referrals stops pumping its score on procedural noise.
--
--   hasImminentFloorAction — true when an action within the last ~14 days
--   matches a vote-imminent pattern (placed on calendar, cloture motion,
--   rule reported, discharged from committee, etc.). Drives a small flat
--   score boost and floors the tier at ACTIVE so advocates can find
--   bills before the vote, not after.
--
-- Both fields are populated by the compute-momentum cron on its next
-- sweep. No data backfill needed — the cron's `full=1` mode can be run
-- manually after deploy to repopulate every bill in one pass.

ALTER TABLE "Bill"
  ADD COLUMN "latestMajorActionDate" TIMESTAMP(3),
  ADD COLUMN "hasImminentFloorAction" BOOLEAN NOT NULL DEFAULT false;

-- Tiny index to support a future "imminent floor action" filter or badge
-- in the bills list. Cheap (boolean + Bill is ~15k rows).
CREATE INDEX "Bill_hasImminentFloorAction_idx"
  ON "Bill" ("hasImminentFloorAction")
  WHERE "hasImminentFloorAction" = true;

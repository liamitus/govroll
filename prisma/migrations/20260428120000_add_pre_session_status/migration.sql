-- Adds a structured `scheduledConveneAt` for the `pre_session` status code.
--
-- Background: when the Senate's PAIL page lists today as "Convene at 10:00
-- a.m." (future tense, not yet gaveled in), the scraper used to emit
-- `recess` with the time stuffed into a free-text detail string — which
-- the popover would then display next to a contradictory "Returns Wed,
-- Apr 29" line computed independently from the recess calendar.
--
-- Promoting this to a first-class status with a structured Date lets
-- compute.ts surface the convene moment itself as the next transition,
-- and lets the client render a self-consistent row without re-parsing
-- the detail.
--
-- No data backfill needed: the cron upserts both chamber rows on every
-- run (~10 min), so the column populates naturally on next tick.

ALTER TABLE "CongressChamberStatus"
  ADD COLUMN "scheduledConveneAt" TIMESTAMP(3);

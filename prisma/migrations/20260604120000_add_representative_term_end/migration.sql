-- Add Representative.termEnd — the end of a member's current term (Jan 3 of an
-- odd year), sourced from GovTrack's role.enddate at ingest time.
--
-- Drives the next-election countdown. The deciding election for a seat is the
-- November before the term ends, so next election = year(termEnd) - 1. This is
-- what distinguishes a state's two senators: they sit in different election
-- classes, so their terms end two years apart (NY — Schumer 2029-01-03,
-- Gillibrand 2031-01-03 → elections Nov 2028 and Nov 2030).
--
-- Before this column, nextElection() added a flat +4 to every senator's "next
-- even year", so both of a state's senators showed "in about 4 years".
--
-- Nullable, no backfill in this migration — populated immediately via the
-- Supabase MCP from GovTrack and thereafter on the weekly fetch-representatives
-- cron (which now persists role.enddate).

ALTER TABLE "Representative" ADD COLUMN "termEnd" TIMESTAMP(3);

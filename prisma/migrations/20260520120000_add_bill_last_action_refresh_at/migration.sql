-- Add Bill.lastActionRefreshAt — set whenever the backfill-bill-actions
-- cron refreshes a bill's action history from congress.gov, regardless
-- of whether it found new actions. Drives the rolling re-refresh that
-- catches passage actions GovTrack hasn't yet propagated.
--
-- Before this column the cron's WHERE was `actions: { none: {} }`,
-- which permanently excluded any bill that had ever been backfilled
-- once — so a bill that passed the House after its first ingest never
-- got its action list updated. The Farm Bill (H.R. 7567) sat at
-- `currentStatus = "reported"` while we showed its 224-200 passage
-- roll call on the same page.
--
-- Partial index on the column (WHERE lastActionRefreshAt IS NULL OR
-- < cutoff) would be tempting but we want a non-partial btree because
-- the cron's ORDER BY uses NULLS FIRST + ASC across the full table.

ALTER TABLE "Bill" ADD COLUMN "lastActionRefreshAt" TIMESTAMP(3);
CREATE INDEX "Bill_lastActionRefreshAt_idx" ON "Bill"("lastActionRefreshAt");

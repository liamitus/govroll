-- Index supporting the on-demand summary endpoint's daily-cap check.
--
-- assertOndemandSummaryDailyCap() runs `SELECT count(*) FROM "SummaryJob"
-- WHERE "startedAt" >= <todayStart>` before every public POST that would start
-- a new (paid) generation. SummaryJob rows are only ever created by that
-- endpoint (the cron writes BillTextVersion.changeSummary directly), so the
-- table grows steadily over time; without an index on "startedAt" that count
-- degrades into a seq scan on the trigger hot path. A plain btree range scan
-- keeps it bounded.
CREATE INDEX "SummaryJob_startedAt_idx" ON "SummaryJob" ("startedAt");

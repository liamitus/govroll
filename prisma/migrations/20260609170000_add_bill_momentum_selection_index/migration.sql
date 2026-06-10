-- Index supporting compute-momentum's batch-selection ordering.
--
-- The cron selects a bounded batch of bills `ORDER BY "momentumComputedAt"
-- ASC NULLS FIRST, "latestActionDate" DESC NULLS LAST` (never-computed first,
-- then oldest-computed). Without a matching index that ORDER BY forced a full
-- Seq Scan + top-N heapsort over every Bill row (~2.4s at 22k bills on a warm
-- cache, far worse cold). On a large stale backlog that fixed cost — stacked
-- with a year-wide BillAction read and the per-row update fan-out — pushed the
-- function past its 60s cap, surfacing as a curl timeout in the GitHub Actions
-- ingest job.
--
-- The NULLS FIRST / NULLS LAST placement is spelled out explicitly because it
-- must match the query for the planner to use the index in place of a sort,
-- and Prisma's @@index can't express null ordering (see the Bill model note).
CREATE INDEX "Bill_momentumComputedAt_latestActionDate_idx"
  ON "Bill" ("momentumComputedAt" ASC NULLS FIRST, "latestActionDate" DESC NULLS LAST);

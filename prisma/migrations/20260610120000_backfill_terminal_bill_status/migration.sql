-- Backfill terminal bill statuses stranded by the GovTrack -> Congress.gov
-- ingest switch (PR #111).
--
-- Since that switch, fetch-bills.ts hardcodes every new row to 'introduced'
-- and reconcile-bill-status.ts (the only status corrector) had no branch for
-- enacted/failed/vetoed states, so bills signed into law, voted down, or
-- adopted (simple resolutions) sat forever at introduced / passed_bill /
-- pass_over_*. This one-shot re-derives the correct terminal status from each
-- bill's already-ingested BillAction rows (no API calls), using the SAME
-- action vocabulary as src/lib/reconcile-bill-status.ts:
--   * became public law / signed by president  -> enacted_signed
--   * vetoed (not since overridden)             -> prov_kill_veto
--   * floor defeat in the origin chamber        -> fail_originating_{house,senate}
--   * simple-resolution adoption in origin       -> passed_simpleres
--   * bicameral progress                        -> passed_{bill,concurrentres} / pass_over_*
--
-- Passage detection is anchored to REAL chamber passage (canonical
-- "Passed/agreed to in House/Senate", "On passage Passed", suspension passage,
-- self-executing "considered passed", one-step "read the third time, and
-- passed", and resolution adoption) -- not the loose /passed|agreed/ that
-- swept up procedural motions ("Rule H. Res. NNNN passed House", motions to
-- proceed/table/recommit, previous question, committee-of-the-whole rise).
-- Failed suspension votes (a recoverable two-thirds miss) are excluded so
-- prov_kill_suspensionfailed rows survive. Enacted rows are never touched.
--
-- Go-forward correctness is handled by the cron calling reconcileStatus; this
-- only clears the historical backlog. Guarded by new_status <> currentStatus,
-- so it is safe to re-run (and a no-op on an empty/seeded local database).

WITH classified AS (
  SELECT
    b.id, b."billType", b."currentStatus", ba."actionDate",
    (ba."text" ~* 'became public law|signed by president') AS is_law,
    (ba."actionType" = 'Veto'
      OR ba."text" ~* 'vetoed by( the)? president|veto message received') AS is_veto,
    (ba."actionType" = 'Floor' AND (
      ba."text" ~* 'passed/agreed to in house'
      OR ba."text" ~* '^passed( the)? house\M'
      OR ba."text" ~* 'considered passed( the)? house'
      OR ba."text" ~* '^resolution agreed to in house'
      OR (ba."chamber" = 'House' AND (
        ba."text" ~* 'on passage.*passed'
        OR ba."text" ~* 'motion to suspend the rules and (pass|agree).*agreed to'
        OR ba."text" ~* 'read the third time, and passed'
        OR ba."text" ~* 'on agreeing to the resolution.*agreed to'
        OR ba."text" ~* 'submitted in the house, considered, and agreed to'))
    )) AS is_pass_house,
    (ba."actionType" = 'Floor' AND (
      ba."text" ~* 'passed/agreed to in senate'
      OR ba."text" ~* '^passed( the)? senate\M'
      OR ba."text" ~* 'considered passed( the)? senate'
      OR ba."text" ~* '^resolution agreed to in senate'
      OR (ba."chamber" = 'Senate' AND (
        ba."text" ~* 'on passage.*passed'
        OR ba."text" ~* 'motion to suspend the rules and (pass|agree).*agreed to'
        OR ba."text" ~* 'read the third time, and passed'
        OR ba."text" ~* 'on agreeing to the resolution.*agreed to'
        OR ba."text" ~* 'submitted in the senate, considered, and agreed to'))
    )) AS is_pass_senate,
    (ba."actionType" = 'Floor' AND ba."text" !~* 'suspend the rules' AND (
      ba."text" ~* 'failed of (passage|adoption)(/not agreed to)? in house'
      OR (ba."chamber" = 'House' AND (
        ba."text" ~* 'on passage.*failed'
        OR ba."text" ~* 'on agreeing to the resolution.*failed'
        OR ba."text" ~* 'motion to table the measure.*agreed to'))
    )) AS is_fail_house,
    (ba."actionType" = 'Floor' AND ba."text" !~* 'suspend the rules' AND (
      ba."text" ~* 'failed of (passage|adoption)(/not agreed to)? in senate'
      OR (ba."chamber" = 'Senate' AND (
        ba."text" ~* 'on passage.*failed'
        OR ba."text" ~* 'on agreeing to the resolution.*failed'
        OR ba."text" ~* 'motion to table the measure.*agreed to'))
    )) AS is_fail_senate
  FROM "Bill" b
  JOIN "BillAction" ba ON ba."billId" = b.id
  WHERE b."currentStatus" NOT LIKE 'enacted_%'
), ev AS (
  SELECT
    id, "billType", "currentStatus",
    ("billType" LIKE 'house%') AS origin_is_house,
    ("billType" IN ('house_resolution', 'senate_resolution')) AS is_simple,
    ("billType" IN ('house_concurrent_resolution', 'senate_concurrent_resolution')) AS is_concurrent,
    bool_or(is_law) AS law,
    max("actionDate") FILTER (WHERE is_law) AS law_date,
    bool_or(is_veto) AS veto,
    max("actionDate") FILTER (WHERE is_veto) AS veto_date,
    bool_or(is_pass_house) AS passed_house,
    max("actionDate") FILTER (WHERE is_pass_house) AS pass_house_date,
    bool_or(is_pass_senate) AS passed_senate,
    max("actionDate") FILTER (WHERE is_pass_senate) AS pass_senate_date,
    bool_or(is_fail_house) AS failed_house,
    max("actionDate") FILTER (WHERE is_fail_house) AS fail_house_date,
    bool_or(is_fail_senate) AS failed_senate,
    max("actionDate") FILTER (WHERE is_fail_senate) AS fail_senate_date
  FROM classified
  GROUP BY id, "billType", "currentStatus"
), decided AS (
  SELECT
    id, "currentStatus", origin_is_house, is_simple, is_concurrent, law, veto,
    law_date, veto_date,
    (CASE WHEN origin_is_house THEN passed_house ELSE passed_senate END) AS passed_origin,
    (CASE WHEN origin_is_house THEN passed_senate ELSE passed_house END) AS passed_other,
    (CASE WHEN origin_is_house THEN failed_house ELSE failed_senate END) AS failed_origin,
    (CASE WHEN origin_is_house THEN fail_house_date ELSE fail_senate_date END) AS fail_origin_date,
    (CASE WHEN origin_is_house THEN pass_house_date ELSE pass_senate_date END) AS pass_origin_date,
    greatest(pass_house_date, pass_senate_date) AS pass_both_date
  FROM ev
), final AS (
  SELECT id, "currentStatus",
    CASE
      WHEN law THEN 'enacted_signed'
      WHEN veto AND "currentStatus" NOT LIKE 'vetoed_%' AND "currentStatus" <> 'prov_kill_veto' THEN 'prov_kill_veto'
      WHEN failed_origin AND NOT passed_origin THEN (CASE WHEN origin_is_house THEN 'fail_originating_house' ELSE 'fail_originating_senate' END)
      WHEN is_simple AND passed_origin THEN 'passed_simpleres'
      WHEN "currentStatus" IN ('introduced', 'reported') AND passed_origin AND passed_other THEN (CASE WHEN is_concurrent THEN 'passed_concurrentres' ELSE 'passed_bill' END)
      WHEN "currentStatus" IN ('introduced', 'reported') AND passed_origin THEN (CASE WHEN origin_is_house THEN 'pass_over_house' ELSE 'pass_over_senate' END)
      WHEN "currentStatus" IN ('pass_over_house', 'pass_over_senate') AND passed_origin AND passed_other THEN (CASE WHEN is_concurrent THEN 'passed_concurrentres' ELSE 'passed_bill' END)
      ELSE NULL
    END AS new_status,
    CASE
      WHEN law THEN law_date
      WHEN veto AND "currentStatus" NOT LIKE 'vetoed_%' AND "currentStatus" <> 'prov_kill_veto' THEN veto_date
      WHEN failed_origin AND NOT passed_origin THEN fail_origin_date
      WHEN is_simple AND passed_origin THEN pass_origin_date
      WHEN "currentStatus" IN ('introduced', 'reported') AND passed_origin AND passed_other THEN pass_both_date
      WHEN "currentStatus" IN ('introduced', 'reported') AND passed_origin THEN pass_origin_date
      WHEN "currentStatus" IN ('pass_over_house', 'pass_over_senate') AND passed_origin AND passed_other THEN pass_both_date
      ELSE NULL
    END AS decision_date
  FROM decided
)
UPDATE "Bill" b
SET "currentStatus" = f.new_status,
    "currentStatusDate" = COALESCE(f.decision_date, b."currentStatusDate")
FROM final f
WHERE b.id = f.id
  AND f.new_status IS NOT NULL
  AND f.new_status <> b."currentStatus";

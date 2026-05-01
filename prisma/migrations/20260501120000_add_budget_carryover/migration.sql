-- Govroll's budget previously reset to $0 at the start of every month, which
-- silently voided unspent donor money and would pause AI within an hour of
-- the month rollover. Add a `carryoverCents` column that holds the surplus
-- rolled forward from the previous period and is treated like income for the
-- purposes of the public progress bar and the `aiEnabled` evaluation.

ALTER TABLE "BudgetLedger"
ADD COLUMN "carryoverCents" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows: walk chronologically and propagate each period's
-- surplus into the next period's carryover. The earliest row stays at 0.
-- Surplus chains forward, so May's carryover reflects April's surplus
-- inclusive of any earlier carryover that April itself had received.
DO $$
DECLARE
  r RECORD;
  prev_surplus INTEGER := 0;
  applied_carryover INTEGER;
BEGIN
  FOR r IN
    SELECT id, "incomeCents", "spendCents", "reserveCents"
    FROM "BudgetLedger"
    ORDER BY period ASC
  LOOP
    applied_carryover := GREATEST(0, prev_surplus);
    UPDATE "BudgetLedger"
    SET "carryoverCents" = applied_carryover
    WHERE id = r.id;
    prev_surplus := applied_carryover
                    + r."incomeCents"
                    - r."spendCents"
                    - r."reserveCents";
  END LOOP;
END $$;

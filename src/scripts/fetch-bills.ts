import "dotenv/config";
import { fetchGovTrackBills } from "../lib/govtrack";
import { createStandalonePrisma } from "../lib/prisma-standalone";
import dayjs, { type Dayjs } from "dayjs";

const prisma = createStandalonePrisma();

// Tunables for the cursor-driven chunked ingest. The defaults are chosen so
// a single run comfortably fits Vercel's Hobby 60s cap: one API call per
// 2-day window, parallel upserts 10-at-a-time, hard 50s deadline before bail.
const WINDOW_DAYS = 2;
const BACKSTOP_DAYS = 14;
const DEADLINE_MS = 50_000;
const UPSERT_CONCURRENCY = 10;
const CURSOR_KEY = "fetch-bills";

export interface FetchBillsResult {
  processed: number;
  windows: number;
  cursor: Date;
  done: boolean;
  timedOut: boolean;
  elapsedMs: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Cursor-driven ingest of new bills from GovTrack.
 *
 * Replaces the old design that walked 6 months in a single invocation and
 * reliably blew the 60s serverless cap. The current invocation:
 *
 *   1. Reads (or initializes) an IngestCursor row — the last fully-processed
 *      window end. First run backstops to `BACKSTOP_DAYS` ago.
 *   2. Processes 2-day slices in order, upserting bills in parallel chunks
 *      of `UPSERT_CONCURRENCY`.
 *   3. Bails at `DEADLINE_MS` with partial progress persisted. The next
 *      invocation resumes from the advanced cursor.
 *
 * Convergence: for hourly cadence, each run advances the cursor by up to
 * ~48h worth of windows. Once caught up, each run processes a single partial
 * window and returns `done: true`.
 *
 * When `billIds` is provided (CLI/manual invocation), fetches those specific
 * bills and ignores the cursor.
 */
export async function fetchBillsFunction(
  billIds?: string[],
): Promise<FetchBillsResult | void> {
  if (billIds && billIds.length > 0) {
    await fetchSpecificBills(billIds);
    return;
  }

  const started = Date.now();
  const now = dayjs();

  const cursorRow = await prisma.ingestCursor.findUnique({
    where: { key: CURSOR_KEY },
  });
  let windowStart: Dayjs = cursorRow
    ? dayjs(cursorRow.cursor)
    : now.subtract(BACKSTOP_DAYS, "day");

  let processed = 0;
  let windows = 0;
  let timedOut = false;

  while (windowStart.isBefore(now)) {
    if (Date.now() - started > DEADLINE_MS) {
      timedOut = true;
      break;
    }

    const tentativeEnd = windowStart.add(WINDOW_DAYS, "day");
    const windowEnd = tentativeEnd.isAfter(now) ? now : tentativeEnd;

    const bills = await fetchGovTrackBills({
      introduced_date__gte: windowStart.format("YYYY-MM-DD"),
      introduced_date__lt: windowEnd.format("YYYY-MM-DD"),
      limit: 1000,
      order_by: "-introduced_date",
    });

    for (let i = 0; i < bills.length; i += UPSERT_CONCURRENCY) {
      if (Date.now() - started > DEADLINE_MS) {
        timedOut = true;
        break;
      }
      const chunk = bills.slice(i, i + UPSERT_CONCURRENCY);
      await Promise.all(chunk.map(upsertBillRecord));
      processed += chunk.length;
    }

    if (timedOut) break;

    await prisma.ingestCursor.upsert({
      where: { key: CURSOR_KEY },
      update: { cursor: windowEnd.toDate() },
      create: { key: CURSOR_KEY, cursor: windowEnd.toDate() },
    });

    windowStart = windowEnd;
    windows++;
  }

  const elapsedMs = Date.now() - started;
  return {
    processed,
    windows,
    cursor: windowStart.toDate(),
    done: !timedOut && !windowStart.isBefore(now),
    timedOut,
    elapsedMs,
  };
}

async function fetchSpecificBills(billIds: string[]): Promise<void> {
  console.log(`Fetching ${billIds.length} specific bills:`, billIds);
  for (const billId of billIds) {
    try {
      const [billType, number, congress] = billId.split("-");
      if (!billType || !number || !congress) {
        console.warn(`Invalid billId: ${billId}; skipping`);
        continue;
      }
      const bills = await fetchGovTrackBills({
        bill_type: billType,
        number,
        congress,
        limit: 1,
      });
      if (bills.length === 0) {
        console.warn(`No bill found for ${billId}`);
        continue;
      }
      await upsertBillRecord(bills[0]);
    } catch (error: any) {
      console.error(`Error fetching bill ${billId}:`, error.message);
    }
  }
}

async function upsertBillRecord(govTrackBill: any) {
  const billId = `${govTrackBill.bill_type}-${govTrackBill.number}-${govTrackBill.congress}`;
  try {
    await prisma.bill.upsert({
      where: { billId },
      update: {
        title: govTrackBill.title_without_number,
        date: new Date(govTrackBill.introduced_date),
        billType: govTrackBill.bill_type,
        currentChamber: govTrackBill.current_chamber,
        currentStatus: govTrackBill.current_status,
        currentStatusDate: new Date(govTrackBill.current_status_date),
        introducedDate: new Date(govTrackBill.introduced_date),
        link: govTrackBill.link,
      },
      create: {
        billId,
        title: govTrackBill.title_without_number,
        date: new Date(govTrackBill.introduced_date),
        billType: govTrackBill.bill_type,
        currentChamber: govTrackBill.current_chamber,
        currentStatus: govTrackBill.current_status,
        currentStatusDate: new Date(govTrackBill.current_status_date),
        introducedDate: new Date(govTrackBill.introduced_date),
        link: govTrackBill.link,
      },
    });
  } catch (error: any) {
    console.error(`Error upserting bill ${billId}:`, error.message);
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// CLI invocation
if (require.main === module) {
  const billIds = process.argv.slice(2);
  fetchBillsFunction(billIds.length > 0 ? billIds : undefined)
    .then((result) => {
      if (result) {
        console.log("Result:", JSON.stringify(result, null, 2));
      }
    })
    .finally(() => prisma.$disconnect());
}

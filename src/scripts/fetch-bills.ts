import "dotenv/config";
import {
  fetchBillIntroducedDate,
  fetchCongressBillsByUpdate,
  type CongressListBill,
} from "../lib/congress-api";
import { createStandalonePrisma } from "../lib/prisma-standalone";
import dayjs, { type Dayjs } from "dayjs";

const prisma = createStandalonePrisma();

// Tunables for the cursor-driven chunked ingest. The defaults are chosen so
// a single run comfortably fits Vercel's Hobby 60s cap: 3-hour windows, a
// 48-hour rewind on each run so updates that arrive late don't slip the
// cursor, and a 50s hard deadline before bail.
const WINDOW_HOURS = 72;
const LOOKBACK_HOURS = 48;
const BACKSTOP_DAYS = 14;
const DEADLINE_MS = 50_000;
const UPSERT_CONCURRENCY = 8;
const CURSOR_KEY = "fetch-bills";

// Congress.gov returns billType uppercase (HR, S, HJRES, …). We keep the
// GovTrack-shape billType strings ("house_bill", "senate_bill", …) in the
// DB because the billId PK format depends on them and changing it would
// orphan every existing row.
const CONGRESS_TYPE_TO_GOVTRACK: Record<string, string> = {
  HR: "house_bill",
  S: "senate_bill",
  HJRES: "house_joint_resolution",
  SJRES: "senate_joint_resolution",
  HCONRES: "house_concurrent_resolution",
  SCONRES: "senate_concurrent_resolution",
  HRES: "house_resolution",
  SRES: "senate_resolution",
};

const GOVTRACK_TO_API_BILL_TYPE: Record<string, string> = {
  house_bill: "hr",
  senate_bill: "s",
  house_joint_resolution: "hjres",
  senate_joint_resolution: "sjres",
  house_concurrent_resolution: "hconres",
  senate_concurrent_resolution: "sconres",
  house_resolution: "hres",
  senate_resolution: "sres",
};

export interface FetchBillsResult {
  processed: number;
  created: number;
  updated: number;
  windows: number;
  cursor: Date;
  done: boolean;
  timedOut: boolean;
  elapsedMs: number;
}

/**
 * Cursor-driven ingest of bills from Congress.gov.
 *
 * Walks `updateDate` windows (not `introducedDate`) so the feed surfaces
 * both newly introduced bills and existing bills with new action — one
 * pass keeps every row in sync.
 *
 *   1. Read (or initialize) an IngestCursor row holding the last
 *      `updateDate` we processed. First run backstops `BACKSTOP_DAYS` ago.
 *   2. Rewind `LOOKBACK_HOURS` from that cursor before walking forward,
 *      so updates that arrived after our last pass don't slip through.
 *      Upserts are idempotent — re-seeing a bill is free.
 *   3. Step forward in `WINDOW_HOURS` slices, fetching the Congress.gov
 *      `/bill` list endpoint and upserting in parallel chunks.
 *   4. Bail at `DEADLINE_MS` with the cursor advanced to wherever we got.
 *      The next cron invocation resumes from there.
 *
 * Replaces the previous GovTrack-backed implementation, which lagged
 * Congress.gov by 3–5 days because GovTrack scrapes the official source
 * on its own delayed schedule.
 *
 * When `billIds` is provided (CLI/manual invocation), re-ingests those
 * specific bills and ignores the cursor.
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
  // Always rewind LOOKBACK_HOURS from the saved cursor. Congress.gov
  // re-surfaces a bill into the updateDate feed when ANY field changes,
  // and those edits commonly land hours after the bill first appeared.
  // Without the rewind, we'd miss the late-arriving update and never
  // re-check that window.
  let windowStart: Dayjs = cursorRow
    ? dayjs(cursorRow.cursor).subtract(LOOKBACK_HOURS, "hour")
    : now.subtract(BACKSTOP_DAYS, "day");

  let processed = 0;
  let created = 0;
  let updated = 0;
  let windows = 0;
  let timedOut = false;

  while (windowStart.isBefore(now)) {
    if (Date.now() - started > DEADLINE_MS) {
      timedOut = true;
      break;
    }

    const tentativeEnd = windowStart.add(WINDOW_HOURS, "hour");
    const windowEnd = tentativeEnd.isAfter(now) ? now : tentativeEnd;

    const bills = await fetchCongressBillsByUpdate({
      fromDateTime: toCongressIso(windowStart),
      toDateTime: toCongressIso(windowEnd),
    });

    for (let i = 0; i < bills.length; i += UPSERT_CONCURRENCY) {
      if (Date.now() - started > DEADLINE_MS) {
        timedOut = true;
        break;
      }
      const chunk = bills.slice(i, i + UPSERT_CONCURRENCY);
      const results = await Promise.all(chunk.map(upsertBillFromList));
      processed += results.length;
      for (const r of results) {
        if (r === "created") created++;
        else if (r === "updated") updated++;
      }
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
    created,
    updated,
    windows,
    cursor: windowStart.toDate(),
    done: !timedOut && !windowStart.isBefore(now),
    timedOut,
    elapsedMs,
  };
}

function toCongressIso(d: Dayjs): string {
  // Congress.gov's `/bill` endpoint wants "YYYY-MM-DDTHH:mm:ssZ".
  // dayjs.toISOString() includes milliseconds, which the endpoint silently
  // ignores but isn't part of the documented format — strip them so the
  // value matches the docs and the test fixtures.
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function fetchSpecificBills(billIds: string[]): Promise<void> {
  console.log(`Fetching ${billIds.length} specific bills:`, billIds);
  for (const billId of billIds) {
    try {
      const synthetic = await buildListBillFromBillId(billId);
      if (!synthetic) {
        console.warn(`No bill found for ${billId}`);
        continue;
      }
      await upsertBillFromList(synthetic);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error fetching bill ${billId}:`, msg);
    }
  }
}

async function buildListBillFromBillId(
  billId: string,
): Promise<CongressListBill | null> {
  const parts = billId.split("-");
  if (parts.length < 3) return null;
  const [govTrackType, numberStr, congressStr] = parts;
  const apiBillType = GOVTRACK_TO_API_BILL_TYPE[govTrackType];
  const number = parseInt(numberStr, 10);
  const congress = parseInt(congressStr, 10);
  if (!apiBillType || !number || !congress) return null;

  const introducedDate = await fetchBillIntroducedDate(
    congress,
    apiBillType,
    number,
  );
  if (!introducedDate) return null;

  const congressType = Object.entries(CONGRESS_TYPE_TO_GOVTRACK).find(
    ([, v]) => v === govTrackType,
  )?.[0];
  if (!congressType) return null;

  // Synthetic list-shaped record so the CLI path can reuse upsertBillFromList.
  // Title is left as a placeholder — the refresh-bill-metadata cron will fill
  // in the real title from /bill/{c}/{t}/{n}/titles on its next pass.
  return {
    congress,
    number: numberStr,
    type: congressType,
    originChamberCode: govTrackType.startsWith("house") ? "H" : "S",
    title: "(pending refresh)",
    updateDate: introducedDate,
    latestAction: { actionDate: introducedDate, text: "Introduced" },
  };
}

async function upsertBillFromList(
  listBill: CongressListBill,
): Promise<"created" | "updated" | "skipped"> {
  const govTrackType = CONGRESS_TYPE_TO_GOVTRACK[listBill.type.toUpperCase()];
  if (!govTrackType) {
    console.warn(`Unknown Congress.gov bill type: ${listBill.type}`);
    return "skipped";
  }
  const number = parseInt(listBill.number, 10);
  if (!number) return "skipped";

  const billId = `${govTrackType}-${number}-${listBill.congress}`;
  const apiBillType = GOVTRACK_TO_API_BILL_TYPE[govTrackType];

  const latestActionDate = listBill.latestAction?.actionDate
    ? new Date(listBill.latestAction.actionDate)
    : null;

  const existing = await prisma.bill.findUnique({
    where: { billId },
    select: { id: true },
  });

  if (existing) {
    // UPDATE — refresh only the fields the list endpoint owns. Don't touch
    // currentStatus / sponsor / metadata; those are managed by
    // refresh-bill-metadata and stomping them every cron tick would
    // overwrite enriched data with the leaner list response.
    await prisma.bill.update({
      where: { billId },
      data: {
        title: listBill.title,
        latestActionText: listBill.latestAction?.text ?? null,
        latestActionDate,
      },
    });
    return "updated";
  }

  // CREATE — list endpoint omits introducedDate. One extra detail call per
  // truly-new bill (chunked at UPSERT_CONCURRENCY so we don't burst the API).
  let introducedDateStr = await fetchBillIntroducedDate(
    listBill.congress,
    apiBillType,
    number,
  );
  // Fall back to latestAction.actionDate if the detail endpoint errored —
  // we'd rather create the row with an approximate date than skip a fresh
  // bill on a transient 5xx.
  if (!introducedDateStr && listBill.latestAction?.actionDate) {
    introducedDateStr = listBill.latestAction.actionDate;
  }
  if (!introducedDateStr) return "skipped";

  const introducedDate = new Date(introducedDateStr);
  const chamber =
    listBill.originChamberCode === "H"
      ? "house"
      : listBill.originChamberCode === "S"
        ? "senate"
        : null;
  const link = `https://www.congress.gov/bill/${listBill.congress}th-congress/${govTrackType.replace(/_/g, "-")}/${number}`;

  try {
    await prisma.bill.create({
      data: {
        billId,
        title: listBill.title,
        date: introducedDate,
        billType: govTrackType,
        currentChamber: chamber,
        currentStatus: "introduced",
        currentStatusDate: latestActionDate ?? introducedDate,
        introducedDate,
        link,
        latestActionText: listBill.latestAction?.text ?? null,
        latestActionDate,
        congressNumber: listBill.congress,
      },
    });
    return "created";
  } catch (error) {
    // Lose the race against a concurrent create? Treat as update so the
    // chunk doesn't fail; the row already exists.
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Unique constraint")) {
      await prisma.bill.update({
        where: { billId },
        data: {
          title: listBill.title,
          latestActionText: listBill.latestAction?.text ?? null,
          latestActionDate,
        },
      });
      return "updated";
    }
    console.error(`Error creating bill ${billId}:`, msg);
    return "skipped";
  }
}

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

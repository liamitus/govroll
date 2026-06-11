import "dotenv/config";
import {
  fetchGovTrackVoteVoters,
  fetchGovTrackBill,
  delay,
} from "../lib/govtrack";
import { createStandalonePrisma } from "../lib/prisma-standalone";
import dayjs, { type Dayjs } from "dayjs";

const prisma = createStandalonePrisma();

// Resumable-ingest plumbing. The cursor records the high-water mark of
// contiguous day-by-day ingestion so an outage longer than OVERLAP_DAYS
// doesn't silently drop every roll call in the gap (a fixed now-2d lookback
// did exactly that). Mirrors the fetch-bills cursor pattern.
const CURSOR_KEY = "fetch-votes";
// Re-walk at least this many days on every run so a healthy cursor still
// self-heals a missed cron tick; the overlap is free thanks to skipDuplicates.
const OVERLAP_DAYS = 2;

export interface FetchVotesOptions {
  /**
   * Explicit start date (deep backfill). When set, overrides the cursor and
   * walks forward from here. The per-day cursor advance still applies, so a
   * backfill that exceeds the deadline resumes on the next run.
   */
  since?: Date;
  /**
   * Soft wall-clock budget. The day loop breaks cleanly between days once
   * exceeded, leaving the cursor at the last fully-ingested day so the next
   * invocation resumes there instead of being hard-killed mid-write.
   */
  deadlineMs?: number;
}

interface GovTrackBillData {
  bill_type: string;
  number: number;
  congress: number;
  introduced_date: string;
  current_chamber: string | null;
  current_status: string;
  current_status_date: string;
  link: string;
  title_without_number: string;
}

type VoteRecord = {
  bioguideId: string;
  govtrackBillId: number;
  rollCallNumber: number;
  chamber: string | null;
  votedAt: Date | null;
  category: string | null;
  voteValue: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchVotesFunction(opts: FetchVotesOptions = {}) {
  const started = Date.now();
  const deadlineMs = opts.deadlineMs ?? Number.POSITIVE_INFINITY;

  try {
    const now = dayjs();
    const startDate = await resolveStartDate(opts.since, now);
    const endDate = now;
    let currentDate: Dayjs = startDate;
    const billCache = new Map<number, GovTrackBillData>();

    while (currentDate.isBefore(endDate)) {
      // Break between days (never mid-write) once the budget is spent. The
      // cursor is already at the last completed day, so the next run resumes.
      if (Date.now() - started > deadlineMs) {
        console.log(
          `[fetch-votes] deadline reached at ${currentDate.format("YYYY-MM-DD")}; resuming next run`,
        );
        break;
      }

      const nextDate = currentDate.add(1, "day");
      const voteVoters = await fetchGovTrackVoteVoters({
        created__gte: currentDate.format("YYYY-MM-DD"),
        created__lt: nextDate.format("YYYY-MM-DD"),
        order_by: "-created",
      });

      console.log(
        `Fetched ${voteVoters.length} votes from ${currentDate.format("YYYY-MM-DD")}`,
      );

      if (voteVoters.length > 0) {
        await processVoteBatch(voteVoters as any[], billCache);
      }

      // Advance the cursor only after the day's writes succeed. If a later
      // day throws, the cursor stays at the last fully-ingested day rather
      // than jumping to now and stranding the gap. Errors propagate so the
      // caller (cron route) surfaces a 500 instead of a false success.
      await prisma.ingestCursor.upsert({
        where: { key: CURSOR_KEY },
        update: { cursor: nextDate.toDate() },
        create: { key: CURSOR_KEY, cursor: nextDate.toDate() },
      });

      await delay(500);
      currentDate = nextDate;
    }

    console.log("Votes fetched and stored successfully.");
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Where to start the day-by-day walk.
 *
 *   - Explicit `since` (manual/admin deep backfill) wins outright.
 *   - Otherwise walk from min(saved cursor, now - OVERLAP_DAYS): a healthy
 *     cursor still re-walks the overlap window (self-heal), while a cursor
 *     stalled by an outage is honored so the whole gap is recovered.
 *   - No cursor yet (first run): just the overlap window.
 */
async function resolveStartDate(
  since: Date | undefined,
  now: Dayjs,
): Promise<Dayjs> {
  if (since) return dayjs(since);

  const overlapStart = now.subtract(OVERLAP_DAYS, "day");
  const cursorRow = await prisma.ingestCursor.findUnique({
    where: { key: CURSOR_KEY },
  });
  if (cursorRow && dayjs(cursorRow.cursor).isBefore(overlapStart)) {
    return dayjs(cursorRow.cursor);
  }
  return overlapStart;
}

/**
 * Turn a day's worth of GovTrack voteVoters into database writes using
 * bulk operations: one findMany for representatives, one createMany for
 * any new bills, one findMany to resolve bill row ids, one createMany
 * for votes. Previously this was N+1 per voter (findUnique → upsert →
 * upsert), which blew the 60s Hobby-plan budget on busy roll-call days.
 *
 * Two deliberate semantic choices here:
 *
 * 1. Bill rows use createMany({ skipDuplicates: true }) — existing bills
 *    keep their metadata. fetch-bills / refresh-bill-metadata own bill
 *    updates; fetch-votes only ensures the row exists so a vote can
 *    reference it. The old code re-wrote title/status on every vote
 *    sighting, which duplicated fetch-bills' job and occasionally
 *    clobbered fresher data.
 *
 * 2. RepresentativeVote rows likewise use createMany({ skipDuplicates }).
 *    A (representativeId, billId, rollCallNumber) tuple is immutable
 *    once the roll call is recorded — there's no legitimate update path
 *    from GovTrack after the fact. skipDuplicates gives us idempotent
 *    re-runs without an UPSERT per row.
 */
async function processVoteBatch(
  voters: any[],
  billCache: Map<number, GovTrackBillData>,
) {
  const records: VoteRecord[] = [];
  for (const v of voters) {
    const bioguideId = v?.person?.bioguideid;
    const relatedBill = v?.vote?.related_bill;
    const voteValue = v?.option?.value;
    if (!bioguideId || !relatedBill || !voteValue) continue;
    records.push({
      bioguideId,
      govtrackBillId: relatedBill,
      rollCallNumber: v.vote?.number ?? 0,
      chamber: v.vote?.chamber ?? null,
      votedAt: v.vote?.created ? new Date(v.vote.created) : null,
      category: v.vote?.category ?? null,
      voteValue,
    });
  }
  if (records.length === 0) return;

  const bioguideIds = [...new Set(records.map((r) => r.bioguideId))];
  const reps = await prisma.representative.findMany({
    where: { bioguideId: { in: bioguideIds } },
    select: { id: true, bioguideId: true },
  });
  const repIdByBioguide = new Map(reps.map((r) => [r.bioguideId, r.id]));

  const knownRecords = records.filter((r) => repIdByBioguide.has(r.bioguideId));
  if (knownRecords.length === 0) return;

  const uniqueGovtrackIds = [
    ...new Set(knownRecords.map((r) => r.govtrackBillId)),
  ];
  const toFetch = uniqueGovtrackIds.filter((id) => !billCache.has(id));
  if (toFetch.length > 0) {
    const fetched = await Promise.all(
      toFetch.map((id) =>
        fetchGovTrackBill(id).catch((err: any) => {
          console.error(
            `Failed to fetch bill ${id}:`,
            err?.message ?? String(err),
          );
          return null;
        }),
      ),
    );
    fetched.forEach((data, i) => {
      if (isUsableBill(data)) billCache.set(toFetch[i], data);
    });
  }

  const billPayloadByCanonicalId = new Map<
    string,
    {
      billId: string;
      title: string;
      date: Date;
      billType: string;
      currentChamber: string | null;
      currentStatus: string;
      currentStatusDate: Date;
      introducedDate: Date;
      link: string;
      congressNumber: number;
    }
  >();
  for (const govtrackId of uniqueGovtrackIds) {
    const b = billCache.get(govtrackId);
    if (!b) continue;
    const canonicalId = `${b.bill_type}-${b.number}-${b.congress}`;
    if (billPayloadByCanonicalId.has(canonicalId)) continue;
    billPayloadByCanonicalId.set(canonicalId, {
      billId: canonicalId,
      title: b.title_without_number,
      date: new Date(b.introduced_date),
      billType: b.bill_type,
      currentChamber: b.current_chamber,
      currentStatus: b.current_status,
      currentStatusDate: new Date(b.current_status_date),
      introducedDate: new Date(b.introduced_date),
      link: b.link,
      // The congress is in hand here (GovTrack returns it on the bill). Set
      // it so vote-created bills aren't exempted from CONGRESS_ENDED death in
      // momentum.ts (its prior-congress override requires congressNumber !==
      // null) and don't sort to the bottom of feeds (bills.ts orders
      // congressNumber desc nulls last).
      congressNumber: b.congress,
    });
  }
  if (billPayloadByCanonicalId.size === 0) return;
  const billPayloads = [...billPayloadByCanonicalId.values()];

  await prisma.bill.createMany({
    data: billPayloads,
    skipDuplicates: true,
  });

  const billRows = await prisma.bill.findMany({
    where: { billId: { in: billPayloads.map((b) => b.billId) } },
    select: { id: true, billId: true },
  });
  const billRowIdByCanonical = new Map(billRows.map((b) => [b.billId, b.id]));

  const votePayloads: {
    representativeId: number;
    billId: number;
    vote: string;
    rollCallNumber: number;
    chamber: string | null;
    votedAt: Date | null;
    category: string | null;
  }[] = [];
  for (const r of knownRecords) {
    const billData = billCache.get(r.govtrackBillId);
    if (!billData) continue;
    const canonicalId = `${billData.bill_type}-${billData.number}-${billData.congress}`;
    const billRowId = billRowIdByCanonical.get(canonicalId);
    const repId = repIdByBioguide.get(r.bioguideId);
    if (!billRowId || !repId) continue;
    votePayloads.push({
      representativeId: repId,
      billId: billRowId,
      vote: r.voteValue,
      rollCallNumber: r.rollCallNumber,
      chamber: r.chamber,
      votedAt: r.votedAt,
      category: r.category,
    });
  }
  if (votePayloads.length === 0) return;

  await prisma.representativeVote.createMany({
    data: votePayloads,
    skipDuplicates: true,
  });
}

function isUsableBill(data: unknown): data is GovTrackBillData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.bill_type === "string" &&
    typeof d.number === "number" &&
    typeof d.congress === "number" &&
    typeof d.introduced_date === "string" &&
    typeof d.current_status === "string" &&
    typeof d.current_status_date === "string" &&
    typeof d.link === "string" &&
    typeof d.title_without_number === "string"
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

if (require.main === module) {
  // Optional CLI arg: a YYYY-MM-DD start date for a manual deep backfill.
  const sinceArg = process.argv[2];
  const since = sinceArg ? new Date(`${sinceArg}T00:00:00Z`) : undefined;
  fetchVotesFunction({ since }).catch((err) => {
    console.error("fetch-votes failed:", err);
    process.exitCode = 1;
  });
}

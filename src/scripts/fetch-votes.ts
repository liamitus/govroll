import "dotenv/config";
import {
  fetchGovTrackVoteVoters,
  fetchGovTrackBill,
  delay,
} from "../lib/govtrack";
import { createStandalonePrisma } from "../lib/prisma-standalone";
import dayjs from "dayjs";

const prisma = createStandalonePrisma();

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
export async function fetchVotesFunction(since?: Date) {
  try {
    // Use explicit parameter, then env var, then default to 2 years ago
    const startDate = since
      ? dayjs(since)
      : process.env.VOTES_LAST_FETCHED
        ? dayjs(process.env.VOTES_LAST_FETCHED)
        : dayjs().subtract(2, "year");

    const endDate = dayjs();
    let currentDate = startDate;
    const billCache = new Map<number, GovTrackBillData>();

    while (currentDate.isBefore(endDate)) {
      const nextDate = currentDate.add(1, "day");
      const voteVoters = await fetchGovTrackVoteVoters({
        created__gte: currentDate.format("YYYY-MM-DD"),
        created__lt: nextDate.format("YYYY-MM-DD"),
        limit: 1000,
        order_by: "-created",
      });

      console.log(
        `Fetched ${voteVoters.length} votes from ${currentDate.format("YYYY-MM-DD")}`,
      );

      if (voteVoters.length > 0) {
        await processVoteBatch(voteVoters, billCache);
      }

      await delay(500);
      currentDate = nextDate;
    }

    console.log("Votes fetched and stored successfully.");
  } catch (error: any) {
    // A failure that reaches here is systemic — GovTrack is unreachable or the
    // DB is down, which would recur on every day in the walk. Per-bill fetch
    // failures are already swallowed+logged inside processVoteBatch and never
    // reach this catch. Re-throw so the cron route returns 500 + fires
    // reportError instead of laundering the outage into a green {ok:true}.
    console.error("Error fetching votes:", error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
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
  fetchVotesFunction();
}

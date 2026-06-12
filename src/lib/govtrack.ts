import axios from "axios";
import { withRetry } from "./congress-api";

const govtrackClient = axios.create({
  baseURL: "https://www.govtrack.us/api/v2",
  timeout: 15_000,
});

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchGovTrackBills(params: Record<string, unknown>) {
  const response = await withRetry(() =>
    govtrackClient.get("/bill", { params }),
  );
  return response.data.objects;
}

export async function fetchGovTrackBill(govtrackId: number) {
  const response = await withRetry(() =>
    govtrackClient.get(`/bill/${govtrackId}`),
  );
  return response.data;
}

export async function fetchGovTrackRoles(params: Record<string, unknown>) {
  const response = await withRetry(() =>
    govtrackClient.get("/role", { params }),
  );
  return response.data.objects;
}

// Lists roll-call votes (the /vote resource), not individual voter rows. A
// day has at most a few dozen roll calls, so a single page (limit owned by the
// caller) covers any real window and the offset never approaches GovTrack's
// 1000 cap. fetch-votes uses this to enumerate a day's roll calls, then pulls
// each roll call's voters separately via fetchGovTrackVoteVoters.
export async function fetchGovTrackVotes(params: Record<string, unknown>) {
  const response = await withRetry(() =>
    govtrackClient.get("/vote", { params }),
  );
  return response.data.objects;
}

// GovTrack caps vote_voter page size at 600 (documented; larger is clamped)
// AND rejects any offset > 1000 outright ("Offset > 1000 is not permitted",
// HTTP 400). So a single query can never reach past ~1600 rows — but a busy
// day has 3k+ voter rows across several roll calls, far beyond that. Callers
// MUST therefore scope each query to a single roll call (all of whose voters
// share one `created` second, <=435 rows), never a whole day; within that
// scope the offset never climbs past 0–600 and the cap is untouched.
// PAGE_SIZE stays at the documented ceiling; MAX_PAGES is a runaway backstop.
const VOTE_VOTER_PAGE_SIZE = 600;
const VOTE_VOTER_MAX_PAGES = 100;

/**
 * Fetch every vote_voter row matching `params`, walking offsets until the
 * endpoint is exhausted. `params` should carry only the filter/order fields
 * (e.g. created__gte / created__lt) — limit and offset are owned here.
 *
 * Scope `params` to a single roll call (a ~1s created window); see the note
 * above on GovTrack's offset>1000 cap. Termination is driven by
 * `meta.total_count` (authoritative) with a short/empty-page fallback, so it
 * stays correct even if the server returns a different page size than
 * requested. Offset advances by the number of rows actually returned.
 */
export async function fetchGovTrackVoteVoters(
  params: Record<string, unknown>,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let offset = 0;
  let totalCount = Number.POSITIVE_INFINITY;

  for (let page = 0; page < VOTE_VOTER_MAX_PAGES; page++) {
    const response = await withRetry(() =>
      govtrackClient.get("/vote_voter", {
        params: { ...params, limit: VOTE_VOTER_PAGE_SIZE, offset },
      }),
    );

    const objects: unknown[] = response.data?.objects ?? [];
    const metaTotal = response.data?.meta?.total_count;
    if (typeof metaTotal === "number") totalCount = metaTotal;

    all.push(...objects);
    offset += objects.length;

    // Stop when the server says we have everything, or it returned a
    // short/empty page (the last page), or it stopped making progress
    // (defensive against a server that ignores offset).
    if (
      objects.length === 0 ||
      all.length >= totalCount ||
      objects.length < VOTE_VOTER_PAGE_SIZE
    ) {
      break;
    }
  }

  return all;
}

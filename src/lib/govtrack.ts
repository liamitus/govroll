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

// GovTrack paginates the vote_voter endpoint and caps page size server-side
// (documented max is 600; requesting more is silently clamped). A single
// House roll call is ~430 voter rows and a busy day stacks several roll
// calls, so one unpaginated page drops every voter past the cap — and those
// rows are never recoverable on a re-walk because the same first page comes
// back. PAGE_SIZE stays at/below the documented cap; MAX_PAGES is a runaway
// backstop (100 * 600 = 60k rows, far beyond any real day's voting).
const VOTE_VOTER_PAGE_SIZE = 600;
const VOTE_VOTER_MAX_PAGES = 100;

/**
 * Fetch every vote_voter row matching `params`, walking offsets until the
 * endpoint is exhausted. `params` should carry only the filter/order fields
 * (e.g. created__gte / created__lt / order_by) — limit and offset are owned
 * here so callers can't accidentally reintroduce the single-page cap bug.
 *
 * Termination is driven by `meta.total_count` (authoritative) with a
 * short/empty-page fallback, so it stays correct even if the server returns
 * a different page size than requested. Offset advances by the number of
 * rows actually returned, not the requested limit.
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

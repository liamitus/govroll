import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { fetchBillTextFunction } from "@/scripts/fetch-bill-text";
import { billHref } from "@/lib/bills/url";

/**
 * Cold-start threshold — if we haven't tried to fetch a bill's text within
 * this window, a page view is allowed to trigger a fresh attempt.
 *
 * The hourly cron covers the happy path; this exists for the case where a
 * user hits a brand-new bill before the cron has reached it, or a bill
 * the cron has repeatedly failed on (rotated to the back of the queue).
 */
const TRY_AGAIN_AFTER_MS = 60 * 60 * 1000; // 1 hour

/**
 * If `bill` has no text and we haven't tried recently, kick off a fetch
 * after the response returns. Uses Next's `after()` so the fetch runs as
 * a background task on the same Vercel function instance (Fluid Compute)
 * without blocking the page render.
 *
 * Concurrency: we atomically "claim" the fetch by bumping the attempt
 * timestamp via updateMany WHERE the stale-timestamp predicate still
 * matches. Only the view that wins the claim runs the fetch; the rest
 * bail out, so N concurrent page loads don't produce N concurrent
 * Congress.gov requests.
 *
 * Safe to call unconditionally from the bill detail page's server
 * component — the claim query is a fast indexed update, and early-outs
 * cheaply when text is already present.
 */
export function maybeFetchBillTextInBackground(bill: {
  id: number;
  billId: string;
  title: string;
  fullText: string | null;
  textFetchAttemptedAt: Date | null;
}): void {
  if (bill.fullText != null && bill.fullText.length > 0) return;

  const staleAt = new Date(Date.now() - TRY_AGAIN_AFTER_MS);
  if (
    bill.textFetchAttemptedAt != null &&
    bill.textFetchAttemptedAt > staleAt
  ) {
    return;
  }

  after(async () => {
    try {
      // Atomic claim: only the request that flips the timestamp from
      // "stale" to "now" actually runs the fetch. updateMany returns
      // {count} so we can see whether we won the race.
      const claimed = await prisma.bill.updateMany({
        where: {
          id: bill.id,
          fullText: null,
          OR: [
            { textFetchAttemptedAt: null },
            { textFetchAttemptedAt: { lt: staleAt } },
          ],
        },
        data: { textFetchAttemptedAt: new Date() },
      });
      if (claimed.count === 0) return;

      await fetchBillTextFunction(bill.billId, 1);
      revalidatePath(billHref({ billId: bill.billId, title: bill.title }));
    } catch {
      // Swallow — the failure is already logged by fetchBillTextFunction,
      // and the claim timestamp we just wrote will prevent hot-looping.
    }
  });
}

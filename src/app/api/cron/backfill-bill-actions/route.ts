import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchBillActions } from "@/lib/congress-api";
import { parseBillId } from "@/lib/parse-bill-id";
import { reconcileStatus } from "@/lib/reconcile-bill-status";
import { reportError } from "@/lib/error-reporting";

/**
 * GET /api/cron/backfill-bill-actions
 *
 * Rolling refresh of BillAction + reconciliation of Bill.currentStatus.
 *
 * Action history drives the bill-journey timeline on /bills/[id] AND
 * feeds the status reconciliation that fixes GovTrack staleness (the
 * Farm Bill May 2026 class: GovTrack stuck at `reported` while
 * congress.gov shows the House passed the bill).
 *
 * Prior behavior (pre-rewrite): WHERE was `actions: { none: {} }`,
 * which permanently excluded any bill that had ever had any action
 * stored. That made the route a one-shot initial backfill — once a
 * bill had any action, this cron never touched it again, and
 * currentStatus drifted forever. 24 production bills ended up with
 * passage roll calls in our DB but `currentStatus = "reported"`.
 *
 * Current behavior: pick bills that have never been refreshed, OR
 * were refreshed before the cooldown cutoff, OR have status that's
 * older than their underlying action data. Refresh actions, call
 * `reconcileStatus`, write currentStatus/currentStatusDate +
 * latestActionText/Date when the data says so, and ALWAYS stamp
 * lastActionRefreshAt so each pass advances the queue.
 *
 * Protected by CRON_SECRET. Bills with NULL lastActionRefreshAt come
 * first (never refreshed), then oldest refresh, then random tiebreak.
 * Each call is idempotent — fetchBillActions upserts on
 * (billId, actionDate, text).
 */

export const maxDuration = 60;
const TIMEOUT_MS = 55_000;
// How long a bill can go without an action refresh before it re-enters
// the pool. 6h is short enough that a chamber vote shows up the same
// day, long enough that the ~5k live bills don't hammer congress.gov.
const REFRESH_COOLDOWN_HOURS = 6;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  // Actions are ~1s each (one API call). Batch of 20 fits in ~30s with
  // overhead. Reconcile + Bill.update adds ~50ms per bill, negligible.
  const limit = Math.min(
    30,
    parseInt(url.searchParams.get("limit") ?? "20", 10),
  );
  const tiers = (url.searchParams.get("tiers") ?? "ACTIVE,ADVANCING,STALLED")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const started = Date.now();
  const deadline = started + TIMEOUT_MS;
  const cooldownCutoff = new Date(
    Date.now() - REFRESH_COOLDOWN_HOURS * 60 * 60 * 1000,
  );

  // Live, non-terminal bills due for refresh. Order: never-refreshed
  // first (NULL last in DESC == NULL first in ASC NULLS FIRST), then
  // oldest refresh. We exclude terminal-state bills (enacted/became
  // law) — actions there are stable and we don't need to keep pinging
  // congress.gov for them. Failed bills (fail_* / prov_kill_*) are
  // also stable; we leave them for occasional manual reruns.
  const batch = await prisma.bill.findMany({
    where: {
      momentumTier: { in: tiers },
      currentStatus: { not: { startsWith: "enacted_" } },
      OR: [
        { lastActionRefreshAt: null },
        { lastActionRefreshAt: { lt: cooldownCutoff } },
      ],
    },
    orderBy: [
      // NULLS FIRST — bills we've never refreshed take priority. Then
      // oldest refresh. Prisma supports `nulls: "first"` on PG.
      { lastActionRefreshAt: { sort: "asc", nulls: "first" } },
      { currentStatusDate: "desc" },
    ],
    select: {
      id: true,
      billId: true,
      billType: true,
      currentStatus: true,
      currentStatusDate: true,
      latestActionText: true,
      latestActionDate: true,
    },
    take: limit,
  });

  let processed = 0;
  let statusesReconciled = 0;
  let latestActionUpdated = 0;
  let timedOut = false;
  const errors: Array<{ billId: string; error: string }> = [];

  for (const b of batch) {
    if (Date.now() >= deadline) {
      timedOut = true;
      break;
    }
    try {
      const parsed = parseBillId(b.billId);
      if (!parsed.congress || !parsed.apiBillType || !parsed.billNumber) {
        errors.push({ billId: b.billId, error: "invalid bill id" });
        // Stamp anyway so we don't loop on this unparseable id.
        await prisma.bill.update({
          where: { id: b.id },
          data: { lastActionRefreshAt: new Date() },
        });
        continue;
      }
      const actions = await fetchBillActions(
        parsed.congress,
        parsed.apiBillType,
        parsed.billNumber,
      );

      // Stamp refresh-attempted clock no matter what — we're trying to
      // *drain the queue*, not just record successes. A bill that has
      // no congress.gov actions yet shouldn't monopolize the next ten
      // runs as a NULL-first head-of-queue.
      const refreshStamp = { lastActionRefreshAt: new Date() };

      if (!actions || actions.length === 0) {
        await prisma.bill.update({
          where: { id: b.id },
          data: refreshStamp,
        });
        processed++;
        continue;
      }

      // Dedupe on (actionDate, text) — congress.gov occasionally
      // returns identical action rows, which would race the
      // (billId, actionDate, text) unique constraint when upserted
      // in parallel.
      const seen = new Set<string>();
      const uniqueActions = actions.filter((a) => {
        if (!a.actionDate || !a.text) return false;
        const key = `${a.actionDate}::${a.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await Promise.all(
        uniqueActions.map((a) =>
          prisma.billAction.upsert({
            where: {
              billId_actionDate_text: {
                billId: b.id,
                actionDate: new Date(a.actionDate),
                text: a.text,
              },
            },
            update: {},
            create: {
              billId: b.id,
              actionDate: new Date(a.actionDate),
              chamber: a.chamber,
              text: a.text,
              actionType: a.type,
            },
          }),
        ),
      );

      // Reconcile currentStatus + latest action against what
      // congress.gov now shows. The reconcile function returns null
      // when GovTrack's status looks fine; otherwise it returns the
      // corrected status string.
      const correctedStatus = reconcileStatus(
        b.currentStatus,
        b.billType,
        actions,
      );

      // Latest action is the newest by actionDate. Even when status
      // doesn't change, latestActionText/Date can advance (e.g. a
      // motion vote on a still-pending bill).
      const latest = uniqueActions.reduce<
        (typeof uniqueActions)[number] | null
      >(
        (acc, a) =>
          !acc || new Date(a.actionDate) > new Date(acc.actionDate) ? a : acc,
        null,
      );

      const billUpdate: {
        lastActionRefreshAt: Date;
        currentStatus?: string;
        currentStatusDate?: Date;
        latestActionText?: string;
        latestActionDate?: Date;
      } = { ...refreshStamp };

      if (correctedStatus && correctedStatus !== b.currentStatus) {
        billUpdate.currentStatus = correctedStatus;
        // Use the latest action date as the status date — the action
        // that drove the status change is the most relevant timestamp.
        if (latest) {
          billUpdate.currentStatusDate = new Date(latest.actionDate);
        }
        statusesReconciled++;
      }

      if (latest) {
        const latestDate = new Date(latest.actionDate);
        // Only write when newer than what's on the row — avoid
        // pointless writes (and avoid clobbering manual fixes if the
        // ingest somehow returns a slightly older latest).
        if (
          !b.latestActionDate ||
          latestDate > b.latestActionDate ||
          (b.latestActionText !== latest.text &&
            latestDate.getTime() === b.latestActionDate.getTime())
        ) {
          billUpdate.latestActionText = latest.text;
          billUpdate.latestActionDate = latestDate;
          latestActionUpdated++;
        }
      }

      await prisma.bill.update({
        where: { id: b.id },
        data: billUpdate,
      });
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ billId: b.billId, error: msg });
      // Stamp on failure too — a bill that throws on every fetch
      // (deleted, redirected, unparseable congress.gov page) must not
      // monopolize the head of the queue. It'll come back around in
      // REFRESH_COOLDOWN_HOURS, behind everyone we successfully
      // touched in the meantime.
      try {
        await prisma.bill.update({
          where: { id: b.id },
          data: { lastActionRefreshAt: new Date() },
        });
      } catch {
        // best-effort; don't mask the original error
      }
    }
  }

  const remaining = await prisma.bill.count({
    where: {
      momentumTier: { in: tiers },
      currentStatus: { not: { startsWith: "enacted_" } },
      OR: [
        { lastActionRefreshAt: null },
        { lastActionRefreshAt: { lt: cooldownCutoff } },
      ],
    },
  });

  const elapsedMs = Date.now() - started;

  if (errors.length > 0) {
    reportError(new Error(`Action backfill errors: ${errors.length}`), {
      route: "GET /api/cron/backfill-bill-actions",
      errors: errors.slice(0, 10),
    });
  }

  return NextResponse.json({
    ok: true,
    processed,
    statusesReconciled,
    latestActionUpdated,
    errorCount: errors.length,
    errors: errors.slice(0, 5),
    remaining,
    timedOut,
    elapsedMs,
    elapsedSec: Math.round(elapsedMs / 1000),
  });
}

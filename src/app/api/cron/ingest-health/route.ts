import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";
import { prisma } from "@/lib/prisma";
import { reportError } from "@/lib/error-reporting";
import {
  evaluateIngestHealth,
  CURSOR_STALE_HOURS,
  BACKFILL_STALE_HOURS,
  type CursorSignal,
  type BackfillSignal,
} from "@/lib/ingest-health";

/**
 * GET /api/cron/ingest-health
 *
 * Freshness watchdog for the ingest fleet. The Congress.gov crons now stop
 * cleanly on a transient 429 (no longer paging), so the remaining real risks
 * are a SUSTAINED stall — a cron that stopped running or is chronically
 * quota-blocked — and a SILENT zero-progress run (the #139 class). Neither
 * surfaces as a failed request, so this watchdog inspects the durable evidence
 * instead: cursor `updatedAt` and backfill progress stamps. See
 * lib/ingest-health for why those signals are weekend-proof.
 *
 * Emits at most one alert per run while a breach persists (reportError dedupes
 * within 5 min and rate-limits to 10/hr), so a genuine multi-hour outage nags
 * about once an hour instead of spamming. Always returns 200 — the watchdog
 * succeeding while it reports an unhealthy fleet is not itself a failure.
 *
 * Protected by CRON_SECRET. Invoked hourly by GitHub Actions.
 */

export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const auth = request.headers.get("authorization");
  if (!timingSafeEqualStr(auth, `Bearer ${expected}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const [cursorRows, metaAgg, metaBacklog] = await Promise.all([
      prisma.ingestCursor.findMany({ select: { key: true, updatedAt: true } }),
      prisma.bill.aggregate({ _max: { lastMetadataRefreshAt: true } }),
      // The refresh-metadata cron's exact eligibility gap. shortText is null for
      // most bills (CRS summarizes few), so this is ~always > 0 — which makes
      // the paired freshness check below a pure "is the cron still advancing?"
      // signal, exactly the #139 silent-stall detector.
      prisma.bill.count({
        where: {
          OR: [
            { sponsor: null },
            { sponsorBioguideId: null },
            { shortText: null },
          ],
        },
      }),
    ]);

    const updatedByKey = new Map(cursorRows.map((r) => [r.key, r.updatedAt]));
    const cursors: CursorSignal[] = Object.entries(CURSOR_STALE_HOURS).map(
      ([key, maxStaleHours]) => ({
        key,
        updatedAt: updatedByKey.get(key) ?? null,
        maxStaleHours,
      }),
    );

    const backfills: BackfillSignal[] = [
      {
        name: "refresh-bill-metadata",
        backlog: metaBacklog,
        lastProgressAt: metaAgg._max.lastMetadataRefreshAt ?? null,
        maxStaleHours: BACKFILL_STALE_HOURS,
      },
    ];

    const breaches = evaluateIngestHealth({
      now: new Date(),
      cursors,
      backfills,
    });

    if (breaches.length > 0) {
      const summary = breaches
        .map((b) => `- ${b.pipeline}: ${b.detail}`)
        .join("\n");
      console.warn(
        `[ingest-health] ${breaches.length} breach(es):\n${summary}`,
      );
      // Await so a fire-and-forget alert isn't frozen by the function returning
      // before the Resend fetch resolves (same gotcha as the other crons).
      await reportError(new Error(`Ingest pipeline(s) stalled:\n${summary}`), {
        context: "ingest-health watchdog",
        breaches,
      });
    }

    return NextResponse.json({
      ok: true,
      healthy: breaches.length === 0,
      breaches,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[ingest-health] check failed:`, msg);
    await reportError(error instanceof Error ? error : new Error(msg), {
      context: "ingest-health cron",
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

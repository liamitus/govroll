import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportError } from "@/lib/error-reporting";
import { computeChamberStatus } from "@/lib/congress-session/compute";
import { ensureRecessesSeeded } from "@/lib/congress-session/seed-calendar";
import { CHAMBERS } from "@/lib/congress-session/types";

/**
 * Recomputes "Is Congress working right now?" for both chambers.
 *
 * Waterfall (see src/lib/congress-session/compute.ts):
 *   1. Live House Clerk XML / Senate PAIL scrape
 *   2. Recent roll-call vote from our own DB (auth ground truth)
 *   3. Published recess calendar (seeded yearly)
 *   4. Weekend fallback
 *
 * On the first run against a fresh DB the seed helper pops the known
 * 2026 recess windows into CongressRecess. Subsequent runs are no-ops.
 *
 * Invoked by GitHub Actions every 10 minutes. Idempotent.
 */

export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    const seed = await ensureRecessesSeeded(prisma);

    const now = new Date();
    const statuses = await Promise.all(
      CHAMBERS.map((chamber) => computeChamberStatus(prisma, chamber, now)),
    );

    await Promise.all(
      statuses.map((s) =>
        prisma.congressChamberStatus.upsert({
          where: { chamber: s.chamber },
          create: {
            chamber: s.chamber,
            status: s.status,
            detail: s.detail,
            source: s.source,
            lastActionAt: s.lastActionAt,
            nextTransitionAt: s.nextTransitionAt,
            nextTransitionLabel: s.nextTransitionLabel,
            scheduledConveneAt: s.scheduledConveneAt,
            lastCheckedAt: s.lastCheckedAt,
          },
          update: {
            status: s.status,
            detail: s.detail,
            source: s.source,
            lastActionAt: s.lastActionAt,
            nextTransitionAt: s.nextTransitionAt,
            nextTransitionLabel: s.nextTransitionLabel,
            scheduledConveneAt: s.scheduledConveneAt,
            lastCheckedAt: s.lastCheckedAt,
          },
        }),
      ),
    );

    const ms = Date.now() - start;
    console.log(
      `[compute-congress-status] ok in ${ms}ms — ` +
        statuses.map((s) => `${s.chamber}=${s.status}(${s.source})`).join(" "),
    );
    return NextResponse.json({
      ok: true,
      ms,
      seeded: seed.upserted,
      statuses: statuses.map((s) => ({
        chamber: s.chamber,
        status: s.status,
        source: s.source,
      })),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[compute-congress-status] failed:`, msg);
    await reportError(error instanceof Error ? error : new Error(msg), {
      context: "compute-congress-status cron",
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Chamber } from "@/lib/congress-session/types";

/**
 * Published non-session calendar for the CongressStatus popover's month grid.
 *
 * Returns every seeded recess window per chamber. The client inverts these
 * (a weekday not inside any window = a scheduled session day) to draw the
 * color-coded session bars — the same rule `nextInSessionDate()` uses for the
 * "Returns {date}" labels, so the grid and the live pill agree on the schedule.
 *
 * The data changes ~yearly (re-seeded when the next calendar is published), so
 * it's aggressively edge-cached and lazy-fetched only when the popover opens.
 * The whole table is tiny (~26 rows/year), so we ship all of it and let the
 * client window/navigate locally without further round-trips.
 */

// Pre-rendering would run at build time, where Vercel builds can't reach the
// database. Edge caching is handled via the Cache-Control header below.
export const dynamic = "force-dynamic";

export interface RecessWindow {
  /** Inclusive YYYY-MM-DD (Eastern calendar day). */
  startDate: string;
  /** Inclusive YYYY-MM-DD (Eastern calendar day). */
  endDate: string;
  label: string;
}

export interface CongressCalendarResponse {
  recesses: {
    house: RecessWindow[];
    senate: RecessWindow[];
  };
}

/**
 * `@db.Date` columns come back as UTC-midnight Date objects, so the date part
 * of the ISO string is the stored calendar day verbatim — no timezone shift.
 */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const rows = await prisma.congressRecess.findMany({
    where: { chamber: { in: ["house", "senate"] } },
    orderBy: { startDate: "asc" },
    select: { chamber: true, startDate: true, endDate: true, label: true },
  });

  const recesses: CongressCalendarResponse["recesses"] = {
    house: [],
    senate: [],
  };
  for (const row of rows) {
    const window: RecessWindow = {
      startDate: toIsoDate(row.startDate),
      endDate: toIsoDate(row.endDate),
      label: row.label,
    };
    (recesses[row.chamber as Chamber] ?? recesses.house).push(window);
  }

  const body: CongressCalendarResponse = { recesses };

  return NextResponse.json(body, {
    headers: {
      // Recess calendars are published yearly; serve stale aggressively.
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

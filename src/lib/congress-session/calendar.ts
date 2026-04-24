import { PrismaClient } from "@/generated/prisma/client";
import type { Chamber } from "./types";

/**
 * Calendar fallback: is today inside a published non-session period for this
 * chamber? Returns the matching recess row (if any) plus the next transition
 * into a recess (for the "Returns Apr 28" label on in-session days).
 *
 * Dates are stored as `@db.Date` (no time), so we compare against the calling
 * code's "today" expressed as a UTC date. Congress operates in ET, which
 * means a late-night UTC conversion could put us on the wrong day — we
 * explicitly derive the ET calendar day below.
 */

export interface CalendarWindow {
  startDate: Date;
  endDate: Date;
  label: string;
}

/** YYYY-MM-DD in US Eastern time, the reference timezone for Congress. */
function easternCalendarDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function getRecessToday(
  prisma: PrismaClient,
  chamber: Chamber,
  now: Date = new Date(),
): Promise<CalendarWindow | null> {
  const today = easternCalendarDay(now);
  const rows = await prisma.$queryRaw<
    { startDate: Date; endDate: Date; label: string }[]
  >`
    SELECT "startDate", "endDate", "label"
    FROM "CongressRecess"
    WHERE "chamber" = ${chamber}
      AND "startDate" <= ${today}::date
      AND "endDate"   >= ${today}::date
    ORDER BY "startDate" ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Next upcoming recess strictly after today — used as the
 * `nextTransitionAt` when the chamber is currently in session.
 */
export async function getNextRecess(
  prisma: PrismaClient,
  chamber: Chamber,
  now: Date = new Date(),
): Promise<CalendarWindow | null> {
  const today = easternCalendarDay(now);
  const rows = await prisma.$queryRaw<
    { startDate: Date; endDate: Date; label: string }[]
  >`
    SELECT "startDate", "endDate", "label"
    FROM "CongressRecess"
    WHERE "chamber" = ${chamber}
      AND "startDate" > ${today}::date
    ORDER BY "startDate" ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Next ET calendar day from tomorrow that isn't inside a scheduled recess
 * window and isn't a weekend. Used as the "Returns {date}" label when a
 * chamber is currently in recess — including pre-recess limbo days (House
 * hasn't gaveled in yet, but a named recess starts tomorrow) and back-to-back
 * adjacent recesses where the naive "endDate + 1" would land inside another
 * window.
 *
 * Walks day-by-day: if cursor falls in a recess, jump to that window's
 * endDate + 1; if cursor is Sat/Sun, advance to Monday. 180-iteration cap
 * so malformed calendar data can't hang the request.
 */
export async function nextInSessionDate(
  prisma: PrismaClient,
  chamber: Chamber,
  now: Date = new Date(),
): Promise<Date | null> {
  const todayIso = easternCalendarDay(now);
  const windows = await prisma.$queryRaw<{ startDate: Date; endDate: Date }[]>`
    SELECT "startDate", "endDate"
    FROM "CongressRecess"
    WHERE "chamber" = ${chamber}
      AND "endDate" >= ${todayIso}::date
    ORDER BY "startDate" ASC
  `;

  let cursor = addUtcDays(parseUtcDate(todayIso), 1);

  for (let i = 0; i < 180; i++) {
    const cursorMs = cursor.getTime();
    const hit = windows.find(
      (w) =>
        cursorMs >= w.startDate.getTime() && cursorMs <= w.endDate.getTime(),
    );
    if (hit) {
      cursor = addUtcDays(hit.endDate, 1);
      continue;
    }
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
    }).format(cursor);
    if (weekday === "Sat") {
      cursor = addUtcDays(cursor, 2);
      continue;
    }
    if (weekday === "Sun") {
      cursor = addUtcDays(cursor, 1);
      continue;
    }
    return cursor;
  }
  return null;
}

function parseUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function addUtcDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

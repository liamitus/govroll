import type { RecessWindow } from "@/app/api/congress/calendar/route";

/**
 * Pure date logic for the CongressStatus month grid. No React, no I/O — unit
 * tested in node (see calendar-grid.test.ts).
 *
 * All math runs on UTC-midnight Date objects keyed by YYYY-MM-DD, mirroring
 * lib/congress-session/calendar.ts. "Today" is supplied as an Eastern calendar
 * day (the reference timezone for Congress) so the grid lands on the same day
 * the rest of the app considers current, regardless of the viewer's timezone.
 */

export const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

export interface DayCell {
  /** YYYY-MM-DD (UTC). */
  iso: string;
  /** Day of month, 1-31. */
  day: number;
  /** Month index 0-11. */
  month: number;
  year: number;
  /** Sun=0 … Sat=6. */
  weekday: number;
  isToday: boolean;
  /** Strictly before today. */
  isPast: boolean;
  isWeekend: boolean;
  /** True on the 1st of a month — used to print a month tick. */
  isMonthStart: boolean;
}

/** One chamber's session run state for a single day, within its week row. */
export interface SessionBar {
  inSession: boolean;
  /** Left cap: run begins here (prev day in this row is not in session). */
  isRunStart: boolean;
  /** Right cap: run ends here (next day in this row is not in session). */
  isRunEnd: boolean;
}

export interface WeekRow {
  days: DayCell[];
}

function parseUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function buildCell(date: Date, todayIso: string): DayCell {
  const weekday = date.getUTCDay();
  const iso = toIso(date);
  return {
    iso,
    day: date.getUTCDate(),
    month: date.getUTCMonth(),
    year: date.getUTCFullYear(),
    weekday,
    isToday: iso === todayIso,
    isPast: iso < todayIso,
    isWeekend: weekday === 0 || weekday === 6,
    isMonthStart: date.getUTCDate() === 1,
  };
}

/**
 * A Sunday-started window of `weeks` rows, vertically centered on today's week.
 * With the default 5 weeks, today's row sits in the middle (2 above, 2 below);
 * because the window straddles week boundaries it almost always spans parts of
 * two calendar months. `weekOffset` shifts the whole window by N weeks for the
 * prev/next navigation (0 = centered on today).
 */
export function buildWindow(
  todayIso: string,
  weekOffset = 0,
  weeks = 5,
): WeekRow[] {
  const today = parseUtcDate(todayIso);
  const startOfTodayWeek = addUtcDays(today, -today.getUTCDay());
  const rowsAbove = Math.floor((weeks - 1) / 2);
  const windowStart = addUtcDays(
    startOfTodayWeek,
    (weekOffset - rowsAbove) * 7,
  );

  const rows: WeekRow[] = [];
  for (let w = 0; w < weeks; w++) {
    const days: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      days.push(buildCell(addUtcDays(windowStart, w * 7 + d), todayIso));
    }
    rows.push({ days });
  }
  return rows;
}

/**
 * Is this day a scheduled session day for a chamber? Weekends are never session
 * days (matching the weekend-fallback rule in the status waterfall); otherwise
 * a weekday is "in session" unless it falls inside a published recess window.
 * ISO date strings compare correctly with `<=`/`>=`, so no parsing needed.
 */
export function isInSession(cell: DayCell, recesses: RecessWindow[]): boolean {
  if (cell.isWeekend) return false;
  for (const r of recesses) {
    if (cell.iso >= r.startDate && cell.iso <= r.endDate) return false;
  }
  return true;
}

/**
 * Per-day session bars for one week row + chamber, with run-cap flags so the
 * renderer can round only the ends of each consecutive in-session run and let
 * the interior days merge into one continuous bar.
 */
export function computeBars(
  week: WeekRow,
  recesses: RecessWindow[],
): SessionBar[] {
  const flags = week.days.map((c) => isInSession(c, recesses));
  return flags.map((inSession, i) => ({
    inSession,
    isRunStart: inSession && !flags[i - 1],
    isRunEnd: inSession && !flags[i + 1],
  }));
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Short month name for a 0-11 index. */
export function monthShort(month: number): string {
  return MONTH_SHORT[month] ?? "";
}

/**
 * "June 2026" when the window sits in one month, "May – Jun 2026" across two,
 * "Dec 2026 – Jan 2027" across a year boundary. Derived from the first and last
 * visible cells.
 */
export function monthRangeLabel(rows: WeekRow[]): string {
  const first = rows[0]?.days[0];
  const lastRow = rows[rows.length - 1]?.days;
  const last = lastRow?.[lastRow.length - 1];
  if (!first || !last) return "";

  if (first.year === last.year && first.month === last.month) {
    return `${monthName(first.month)} ${first.year}`;
  }
  if (first.year === last.year) {
    return `${monthShort(first.month)} – ${monthShort(last.month)} ${last.year}`;
  }
  return `${monthShort(first.month)} ${first.year} – ${monthShort(last.month)} ${last.year}`;
}

const MONTH_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function monthName(month: number): string {
  return MONTH_FULL[month] ?? "";
}

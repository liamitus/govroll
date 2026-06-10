import { describe, it, expect } from "vitest";
import {
  buildWindow,
  isInSession,
  computeBars,
  monthRangeLabel,
  type DayCell,
} from "./calendar-grid";
import type { RecessWindow } from "@/app/api/congress/calendar/route";

// 2026-06-02 is a Tuesday; the seeded House Memorial Day recess runs
// 2026-05-22 … 2026-06-01 (inclusive), Senate 2026-05-25 … 2026-05-29.
const TODAY = "2026-06-02";

const HOUSE_RECESS: RecessWindow[] = [
  { startDate: "2026-05-22", endDate: "2026-06-01", label: "Memorial Day DWP" },
];
const SENATE_RECESS: RecessWindow[] = [
  { startDate: "2026-05-25", endDate: "2026-05-29", label: "Memorial Day SWP" },
];

function cell(iso: string): DayCell {
  // Reference TODAY (not `iso`) so isPast/isToday reflect the real "now"; a
  // wide window guarantees the target day is present.
  for (const row of buildWindow(TODAY, 0, 9)) {
    for (const c of row.days) if (c.iso === iso) return c;
  }
  throw new Error(`no cell for ${iso}`);
}

describe("buildWindow", () => {
  const rows = buildWindow(TODAY, 0, 5);

  it("returns `weeks` rows of 7 Sunday-started days", () => {
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.days).toHaveLength(7);
      expect(row.days[0].weekday).toBe(0); // Sunday
      expect(row.days[6].weekday).toBe(6); // Saturday
    }
  });

  it("centers today's week in the middle row (2 above, 2 below)", () => {
    const middle = rows[2].days;
    expect(middle.some((c) => c.isToday)).toBe(true);
    const todayCell = middle.find((c) => c.isToday)!;
    expect(todayCell.iso).toBe(TODAY);
    expect(todayCell.isPast).toBe(false);
    // First visible day is the Sunday two weeks before today's week start.
    expect(rows[0].days[0].iso).toBe("2026-05-17");
    expect(rows[4].days[6].iso).toBe("2026-06-20");
  });

  it("flags past days, weekends, and month starts", () => {
    expect(cell("2026-06-01").isPast).toBe(true);
    expect(cell("2026-06-02").isPast).toBe(false);
    expect(cell("2026-06-03").isPast).toBe(false);
    expect(cell("2026-05-23").isWeekend).toBe(true); // Saturday
    expect(cell("2026-06-01").isMonthStart).toBe(true);
    expect(cell("2026-06-02").isMonthStart).toBe(false);
  });

  it("shifts the whole window by weekOffset", () => {
    const next = buildWindow(TODAY, 1, 5);
    expect(next[0].days[0].iso).toBe("2026-05-24"); // one week later
    expect(buildWindow(TODAY, -1, 5)[0].days[0].iso).toBe("2026-05-10");
  });
});

describe("isInSession", () => {
  it("is false on weekends regardless of recess data", () => {
    expect(isInSession(cell("2026-05-23"), [])).toBe(false); // Saturday
    expect(isInSession(cell("2026-05-24"), [])).toBe(false); // Sunday
  });

  it("is false inside a recess window (inclusive of both ends)", () => {
    expect(isInSession(cell("2026-05-22"), HOUSE_RECESS)).toBe(false); // start
    expect(isInSession(cell("2026-06-01"), HOUSE_RECESS)).toBe(false); // end
    expect(isInSession(cell("2026-05-27"), HOUSE_RECESS)).toBe(false); // middle
  });

  it("is true on a weekday outside every recess window", () => {
    expect(isInSession(cell("2026-06-02"), HOUSE_RECESS)).toBe(true);
    expect(isInSession(cell("2026-05-21"), HOUSE_RECESS)).toBe(true); // Thu before recess
  });
});

describe("computeBars", () => {
  const rows = buildWindow(TODAY, 0, 5);

  it("caps each consecutive in-session run and merges the interior", () => {
    // Row 2 = May 31 – Jun 6. House recess ends Jun 1, so the run is
    // Tue Jun 2 → Fri Jun 5 (weekend Sat Jun 6 excluded).
    const bars = computeBars(rows[2], HOUSE_RECESS);
    const flags = bars.map((b) => b.inSession);
    expect(flags).toEqual([false, false, true, true, true, true, false]);
    expect(bars[2].isRunStart).toBe(true); // Tue
    expect(bars[2].isRunEnd).toBe(false);
    expect(bars[5].isRunStart).toBe(false);
    expect(bars[5].isRunEnd).toBe(true); // Fri
  });

  it("produces an empty row when the whole week is in recess", () => {
    // Row 1 = May 24 – 30: Senate is in its Memorial Day recess all week.
    const bars = computeBars(rows[1], SENATE_RECESS);
    expect(bars.every((b) => !b.inSession)).toBe(true);
  });
});

describe("monthRangeLabel", () => {
  it("spans two months in the same year", () => {
    expect(monthRangeLabel(buildWindow(TODAY, 0, 5))).toBe("May – Jun 2026");
  });

  it("uses the full month name when the window sits in one month", () => {
    // A window deep inside August stays within a single month.
    expect(monthRangeLabel(buildWindow("2026-08-15", 0, 3))).toContain("2026");
  });
});

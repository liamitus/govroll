"use client";

import { useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildWindow,
  computeBars,
  monthRangeLabel,
  monthShort,
  WEEKDAY_LABELS,
  type DayCell,
  type SessionBar,
} from "./calendar-grid";
import type { RecessWindow } from "@/app/api/congress/calendar/route";

/**
 * Month grid of the published floor schedule. Each weekday that isn't inside a
 * recess window draws a color-coded session bar — House (amber) and Senate
 * (teal), matching the chamber swatches on the status rows above — and
 * consecutive in-session days merge into one continuous bar with rounded caps,
 * reading like a legislative timeline.
 *
 * The window is vertically centered on today (2 weeks above, 2 below) so it
 * almost always spans parts of two months; prev/next nudge it a week at a time.
 *
 * These bars are the *planned* schedule, not live status: they're drawn purely
 * from recess windows and never consult the floor scrapers, so a day can read
 * "in session" here while the live badge above reads "No session." A caption
 * under the grid says as much so the divergence doesn't look like a bug.
 */

const WEEKDAY_FULL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function SessionCalendar({
  recesses,
  todayIso,
  loading = false,
}: {
  recesses: { house: RecessWindow[]; senate: RecessWindow[] };
  todayIso: string;
  loading?: boolean;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const rows = useMemo(
    () => buildWindow(todayIso, weekOffset, 5),
    [todayIso, weekOffset],
  );
  const rangeLabel = monthRangeLabel(rows);

  return (
    <section aria-label="Congressional floor schedule" className="space-y-2">
      <div className="flex items-center justify-between">
        <NavButton
          aria-label="Earlier weeks"
          onClick={() => setWeekOffset((o) => o - 1)}
        >
          <ChevronLeftIcon className="size-4" />
        </NavButton>

        <button
          type="button"
          onClick={() => setWeekOffset(0)}
          title={weekOffset === 0 ? rangeLabel : "Jump to today"}
          aria-label={
            weekOffset === 0 ? rangeLabel : `${rangeLabel} — jump to today`
          }
          className="text-foreground hover:bg-foreground/5 rounded px-1.5 py-0.5 text-xs font-medium tracking-wide tabular-nums transition-colors"
        >
          {rangeLabel}
          {weekOffset !== 0 && (
            <span className="text-muted-foreground"> · Today</span>
          )}
        </button>

        <NavButton
          aria-label="Later weeks"
          onClick={() => setWeekOffset((o) => o + 1)}
        >
          <ChevronRightIcon className="size-4" />
        </NavButton>
      </div>

      <div
        role="grid"
        aria-label={`Session days, ${rangeLabel}`}
        className="select-none"
      >
        <div role="row" className="mb-1 grid grid-cols-7">
          {WEEKDAY_LABELS.map((label, i) => (
            <span
              key={i}
              role="columnheader"
              aria-hidden
              className="text-muted-foreground text-center text-[10px] font-medium tracking-wider uppercase"
            >
              {label}
            </span>
          ))}
        </div>

        <div className="space-y-[3px]">
          {rows.map((row, rIdx) => {
            const houseBars = computeBars(row, recesses.house);
            const senateBars = computeBars(row, recesses.senate);
            return (
              <div
                key={row.days[0].iso}
                role="row"
                className="cal-row-in grid grid-cols-7"
                style={{ animationDelay: `${rIdx * 45}ms` }}
              >
                {row.days.map((cell, i) => (
                  <DayCellView
                    key={cell.iso}
                    cell={cell}
                    house={houseBars[i]}
                    senate={senateBars[i]}
                    loading={loading}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* The bars are the *published* schedule (every non-recess weekday is
          drawn as a session day). A chamber's live status above is scraped
          from the floor log and can differ on a given day — e.g. a quiet
          Friday the schedule counts as a session day but no session is held.
          Say so, so the two readings don't look like a bug. */}
      <p className="text-muted-foreground/70 text-[10px] leading-snug">
        Planned floor schedule — a chamber&apos;s live status today may differ.
      </p>
    </section>
  );
}

function DayCellView({
  cell,
  house,
  senate,
  loading,
}: {
  cell: DayCell;
  house: SessionBar;
  senate: SessionBar;
  loading: boolean;
}) {
  return (
    <div
      role="gridcell"
      aria-label={cellLabel(cell, house, senate, loading)}
      title={cellLabel(cell, house, senate, loading)}
      className="flex flex-col gap-1 pt-0.5"
    >
      <span className="text-muted-foreground/70 h-3 text-center text-[8px] leading-none tracking-wide uppercase">
        {cell.isMonthStart ? monthShort(cell.month) : ""}
      </span>

      <span
        className={cn(
          "mx-auto flex size-[18px] items-center justify-center rounded-full text-[11px] leading-none tabular-nums",
          numberClass(cell),
        )}
      >
        {cell.day}
      </span>

      <div className="flex flex-col gap-[3px] pb-0.5">
        <Lane
          bar={house}
          chamber="house"
          past={cell.isPast}
          loading={loading}
        />
        <Lane
          bar={senate}
          chamber="senate"
          past={cell.isPast}
          loading={loading}
        />
      </div>
    </div>
  );
}

function Lane({
  bar,
  chamber,
  past,
  loading,
}: {
  bar: SessionBar;
  chamber: "house" | "senate";
  past: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="bg-foreground/10 block h-[3px] animate-pulse rounded-full" />
    );
  }
  if (!bar.inSession) return <span className="block h-[3px]" />;
  return (
    <span
      className={cn(
        "block h-[3px]",
        barColor(chamber, past),
        bar.isRunStart && "rounded-l-full",
        bar.isRunEnd && "rounded-r-full",
      )}
    />
  );
}

function NavButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
      {...props}
    >
      {children}
    </button>
  );
}

// Literal class strings (not interpolated) so Tailwind's JIT keeps them.
function barColor(chamber: "house" | "senate", past: boolean): string {
  if (chamber === "house") return past ? "bg-house/40" : "bg-house";
  return past ? "bg-senate/40" : "bg-senate";
}

function numberClass(cell: DayCell): string {
  if (cell.isToday) return "bg-foreground text-background font-semibold";
  if (cell.isPast)
    return cell.isWeekend
      ? "text-muted-foreground/50"
      : "text-muted-foreground";
  return cell.isWeekend ? "text-foreground/50" : "text-foreground/90";
}

function cellLabel(
  cell: DayCell,
  house: SessionBar,
  senate: SessionBar,
  loading: boolean,
): string {
  const date = `${WEEKDAY_FULL[cell.weekday]}, ${monthShort(cell.month)} ${cell.day}`;
  if (loading) return date;
  if (cell.isWeekend) return `${date} · Weekend`;
  const h = house.inSession ? "House in session" : "House out";
  const s = senate.inSession ? "Senate in session" : "Senate out";
  return `${date} · ${h} · ${s}`;
}

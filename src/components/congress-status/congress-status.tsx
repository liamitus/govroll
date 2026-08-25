"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { StatusDot } from "./status-dot";
import { SessionCalendar } from "./session-calendar";
import { cn } from "@/lib/utils";
import {
  resolveOverall,
  effectiveStatus,
  freshness,
  labelFor,
  chamberHintFor,
  type Resolved,
} from "./resolve";
import type {
  CongressStatusResponse,
  ChamberStatusPayload,
} from "@/app/api/congress/status/route";
import type { CongressCalendarResponse } from "@/app/api/congress/calendar/route";
import { CONGRESS_STATUS_QUERY_KEY, fetchCongressStatus } from "./status-query";

/**
 * "Is Congress working right now?" — pill lives in the global NavBar,
 * shows the most active chamber's state inline, opens a popover with the
 * per-chamber breakdown.
 *
 * Data flow:
 *   compute-congress-status cron → CongressChamberStatus rows
 *     → /api/congress/status (short-cached)
 *     → React Query poll here (60s while voting=false, 15s while voting=true)
 *
 * Responsive tiers:
 *   - sm (<640px)   : dot + short label
 *   - md (640-1024) : dot + label + chamber hint
 *   - lg (>1024)    : dot + label + chamber hint + next-transition
 */

const POLL_INTERVAL_IDLE_MS = 60_000;
const POLL_INTERVAL_VOTING_MS = 15_000;

export function CongressStatus() {
  const [open, setOpen] = useState(false);

  const query = useQuery<CongressStatusResponse>({
    queryKey: CONGRESS_STATUS_QUERY_KEY,
    queryFn: fetchCongressStatus,
    refetchInterval: (q) => {
      const house = q.state.data?.chambers.house;
      const senate = q.state.data?.chambers.senate;
      const voting = house?.status === "voting" || senate?.status === "voting";
      return voting ? POLL_INTERVAL_VOTING_MS : POLL_INTERVAL_IDLE_MS;
    },
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  // The recess calendar changes ~yearly, so fetch it once — only after the
  // popover first opens — and let it sit in cache for the session.
  const calendarQuery = useQuery<CongressCalendarResponse>({
    queryKey: ["congress-calendar"],
    queryFn: async () => {
      const res = await fetch("/api/congress/calendar");
      if (!res.ok) throw new Error(`calendar ${res.status}`);
      return res.json();
    },
    enabled: open,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  const resolved = resolveOverall(query.data);
  const label = labelFor(resolved.status);
  const chamberHint = chamberHintFor(resolved);
  const pillNextTransition = resolved.nextTransitionLabel;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* Trigger lives on the ink nav — paper type, with the next-transition
          date picked out in gold ("RECESS · RETURNS MON, AUG 31"). Gold as
          type is allowed only here, reversed on ink. */}
      <Popover.Trigger
        className={cn(
          "group border-paper/20 bg-paper/5 hover:border-paper/40 hover:bg-paper/10 focus-visible:ring-gold inline-flex h-8 items-center gap-1.5 border px-2.5 text-xs tracking-wide uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none",
          "min-w-[44px]",
        )}
        aria-label={ariaLabelFor(resolved, query.data)}
      >
        <span
          role="status"
          aria-live="polite"
          className="text-paper/80 group-hover:text-paper inline-flex items-center gap-1.5"
        >
          <StatusDot status={resolved.status} stale={resolved.stale} />
          <span className="font-medium">{label}</span>
          {chamberHint && (
            <span className="text-paper/50 hidden sm:inline">
              · {chamberHint}
            </span>
          )}
          {pillNextTransition && (
            <span className="text-gold hidden lg:inline">
              · {pillNextTransition}
            </span>
          )}
        </span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner
          sideOffset={8}
          className="isolate z-50 outline-none"
        >
          <Popover.Popup className="bg-paper text-ink border-rule data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 w-[340px] max-w-[calc(100vw-1rem)] origin-(--transform-origin) border p-3 text-sm duration-100 outline-none">
            <PopoverContent
              data={query.data}
              loading={query.isLoading}
              calendar={calendarQuery.data}
              calendarLoading={calendarQuery.isLoading}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PopoverContent({
  data,
  loading,
  calendar,
  calendarLoading,
}: {
  data: CongressStatusResponse | undefined;
  loading: boolean;
  calendar: CongressCalendarResponse | undefined;
  calendarLoading: boolean;
}) {
  const todayIso = useMemo(() => easternToday(), []);

  if (loading && !data) {
    return <p className="text-muted-foreground">Checking Congress status…</p>;
  }

  const house = data?.chambers.house;
  const senate = data?.chambers.senate;
  const lastChecked = [house?.lastCheckedAt, senate?.lastCheckedAt]
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();

  const recesses = calendar?.recesses;
  const showCalendar = calendarLoading || Boolean(recesses);

  return (
    <div className="space-y-3">
      <header>
        {/* Kicker, not display type — Archivo never renders below 18px. */}
        <h3 className="text-ink-muted font-sans text-[11px] font-bold tracking-[0.18em] uppercase">
          U.S. Congress
        </h3>
      </header>
      <ul className="space-y-2">
        <ChamberRow label="House" chamber="house" payload={house} />
        <ChamberRow label="Senate" chamber="senate" payload={senate} />
      </ul>

      {showCalendar && (
        <div className="border-rule border-t pt-3">
          <SessionCalendar
            recesses={recesses ?? { house: [], senate: [] }}
            todayIso={todayIso}
            loading={!recesses}
          />
        </div>
      )}

      <footer className="border-rule text-ink-muted border-t pt-2 text-[11px] tabular-nums">
        {lastChecked ? (
          <>Updated {formatAgo(lastChecked)}</>
        ) : (
          <>No recent check</>
        )}
      </footer>
    </div>
  );
}

function ChamberRow({
  label,
  chamber,
  payload,
}: {
  label: string;
  chamber: "house" | "senate";
  payload: ChamberStatusPayload | null | undefined;
}) {
  const status = effectiveStatus(payload);
  const statusLabel = labelFor(status);
  const detail = payload?.detail;
  const nextLabel = payload?.nextTransitionLabel;
  // Past the freshness ceiling we still show the last-known status, just dimmed
  // and tagged "as of Xm ago" — never a blunt "Status unavailable" on real data.
  const isStale = freshness(payload) === "stale";

  return (
    <li className={cn("flex items-start gap-2", isStale && "opacity-65")}>
      {/* Chamber swatch — ties this row to its lane in the calendar below.
          Session marks are sapphire for both chambers (the lanes are
          positional: house above, senate below); chamber never gets its
          own colour channel. */}
      <span
        aria-hidden
        data-chamber={chamber}
        className="bg-sapphire mt-[5px] inline-flex size-2.5 shrink-0 items-center justify-center"
      >
        {status === "voting" && !isStale && (
          <span className="bg-paper/90 size-1 animate-ping rounded-full motion-reduce:hidden" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-foreground text-sm font-medium">{label}</span>
          <span className="text-muted-foreground shrink-0 text-xs">
            {statusLabel}
            {isStale && payload?.lastCheckedAt && (
              <span className="text-muted-foreground/70">
                {" "}
                · as of {formatAgo(payload.lastCheckedAt)}
              </span>
            )}
          </span>
        </div>
        {detail && (
          <p className="text-muted-foreground truncate text-xs">{detail}</p>
        )}
        {nextLabel && (
          <p className="text-muted-foreground/80 truncate text-[11px]">
            {nextLabel}
          </p>
        )}
      </div>
    </li>
  );
}

/** YYYY-MM-DD in US Eastern time — the reference timezone for Congress. */
function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function ariaLabelFor(
  r: Resolved,
  data: CongressStatusResponse | undefined,
): string {
  const parts: string[] = [
    "Congress status",
    (labelFor(r.status) ?? "unknown").toLowerCase(),
  ];
  if (r.primaryChamber) parts.push(`primary chamber ${r.primaryChamber}`);
  const h = data?.chambers.house?.status;
  const s = data?.chambers.senate?.status;
  if (h) parts.push(`House ${h}`);
  if (s) parts.push(`Senate ${s}`);
  parts.push("click for details");
  return parts.join(", ");
}

function formatAgo(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diffMs)) return "just now";
  const mins = Math.max(0, Math.round(diffMs / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

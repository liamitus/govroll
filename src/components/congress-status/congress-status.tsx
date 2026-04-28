"use client";

import { useQuery } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { StatusDot } from "./status-dot";
import { cn } from "@/lib/utils";
import {
  resolveOverall,
  effectiveStatus,
  labelFor,
  chamberHintFor,
  type Resolved,
} from "./resolve";
import type {
  CongressStatusResponse,
  ChamberStatusPayload,
} from "@/app/api/congress/status/route";

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
  const query = useQuery<CongressStatusResponse>({
    queryKey: ["congress-status"],
    queryFn: async () => {
      const res = await fetch("/api/congress/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return res.json();
    },
    refetchInterval: (q) => {
      const house = q.state.data?.chambers.house;
      const senate = q.state.data?.chambers.senate;
      const voting = house?.status === "voting" || senate?.status === "voting";
      return voting ? POLL_INTERVAL_VOTING_MS : POLL_INTERVAL_IDLE_MS;
    },
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const resolved = resolveOverall(query.data);
  const label = labelFor(resolved.status);
  const chamberHint = chamberHintFor(resolved);
  const pillNextTransition = resolved.nextTransitionLabel;

  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          "group inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 text-xs tracking-wide uppercase transition-colors hover:border-white/25 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none",
          "min-w-[44px]",
        )}
        aria-label={ariaLabelFor(resolved, query.data)}
      >
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 text-white/80 group-hover:text-white"
        >
          <StatusDot status={resolved.status} />
          <span className="font-medium">{label}</span>
          {chamberHint && (
            <span className="hidden text-white/50 sm:inline">
              · {chamberHint}
            </span>
          )}
          {pillNextTransition && (
            <span className="hidden text-white/40 lg:inline">
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
          <Popover.Popup className="bg-popover text-popover-foreground ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 w-[280px] origin-(--transform-origin) rounded-lg p-3 text-sm shadow-md ring-1 duration-100 outline-none">
            <PopoverContent data={query.data} loading={query.isLoading} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PopoverContent({
  data,
  loading,
}: {
  data: CongressStatusResponse | undefined;
  loading: boolean;
}) {
  if (loading && !data) {
    return <p className="text-muted-foreground">Checking Congress status…</p>;
  }

  const house = data?.chambers.house;
  const senate = data?.chambers.senate;
  const lastChecked = [house?.lastCheckedAt, senate?.lastCheckedAt]
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();

  return (
    <div className="space-y-3">
      <header>
        <h3 className="font-heading text-muted-foreground text-[11px] tracking-widest uppercase">
          U.S. Congress
        </h3>
      </header>
      <ul className="space-y-2">
        <ChamberRow label="House" payload={house} />
        <ChamberRow label="Senate" payload={senate} />
      </ul>
      <footer className="border-border/60 text-muted-foreground border-t pt-2 text-[11px]">
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
  payload,
}: {
  label: string;
  payload: ChamberStatusPayload | null | undefined;
}) {
  const status = effectiveStatus(payload);
  const statusLabel = labelFor(status);
  const detail = payload?.detail;
  const nextLabel = payload?.nextTransitionLabel;

  return (
    <li className="flex items-start gap-2">
      <span className="mt-1 inline-block">
        <StatusDot
          status={status}
          className="[&_span]:bg-foreground/60 [&_span]:ring-foreground/30"
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-foreground text-sm font-medium">{label}</span>
          <span className="text-muted-foreground text-xs">{statusLabel}</span>
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

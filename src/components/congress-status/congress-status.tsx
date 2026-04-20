"use client";

import { useQuery } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { StatusDot } from "./status-dot";
import { cn } from "@/lib/utils";
import type { Chamber, StatusCode } from "@/lib/congress-session/types";
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
// GH Actions cron routinely drifts 20-30 min under load, so the old 30 min
// ceiling fired false "Status unavailable" downgrades. 60 min tolerates up
// to five missed 10-min runs before we stop trusting the cached status.
const STALE_THRESHOLD_MS = 20 * 60 * 1000;

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
  // When the current status is already "Recess", the pill would otherwise
  // read "RECESS · NEXT RECESS MAY 25 — …" which is tautological at a glance.
  // The popover still surfaces the upcoming named recess for context.
  const pillNextTransition =
    resolved.status === "recess" ? null : resolved.nextTransitionLabel;

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

interface Resolved {
  status: StatusCode;
  primaryChamber: Chamber | null;
  nextTransitionLabel: string | null;
}

/**
 * Pick an overall "Congress" state from the per-chamber rows. Priority:
 *   voting > in_session > pro_forma > adjourned_sine_die > recess > unknown
 * If one chamber is active and the other isn't, show the active one's state.
 */
function resolveOverall(data: CongressStatusResponse | undefined): Resolved {
  if (!data) {
    return {
      status: "unknown",
      primaryChamber: null,
      nextTransitionLabel: null,
    };
  }
  const house = data.chambers.house;
  const senate = data.chambers.senate;
  const priority: StatusCode[] = [
    "voting",
    "in_session",
    "pro_forma",
    "adjourned_sine_die",
    "recess",
    "unknown",
  ];
  const score = (p: ChamberStatusPayload | null) =>
    p ? priority.indexOf(effectiveStatus(p)) : priority.length;

  const winner = score(house) <= score(senate) ? house : senate;
  if (!winner) {
    return {
      status: "unknown",
      primaryChamber: null,
      nextTransitionLabel: null,
    };
  }
  return {
    status: effectiveStatus(winner),
    primaryChamber: winner.chamber,
    nextTransitionLabel: winner.nextTransitionLabel,
  };
}

/**
 * Downgrade to `unknown` when the stored status is older than our staleness
 * threshold. Matches the research recommendation: never lie green on stale
 * data; always prefer honest "Unknown" over confident-but-wrong.
 */
function effectiveStatus(
  p: ChamberStatusPayload | null | undefined,
): StatusCode {
  if (!p) return "unknown";
  const last = Date.parse(p.lastCheckedAt);
  if (!Number.isFinite(last)) return p.status;
  const age = Date.now() - last;
  if (age > STALE_THRESHOLD_MS * 3) return "unknown"; // 60 min ceiling
  return p.status;
}

function labelFor(status: StatusCode): string {
  switch (status) {
    case "voting":
      return "Voting";
    case "in_session":
      return "In Session";
    case "pro_forma":
      return "Pro Forma";
    case "recess":
      return "Recess";
    case "adjourned_sine_die":
      return "Adjourned";
    case "unknown":
      return "Status unavailable";
  }
}

function chamberHintFor(r: Resolved): string | null {
  if (r.status === "unknown") return null;
  if (r.status === "recess") return null; // both chambers usually recess together at this level
  if (!r.primaryChamber) return null;
  return r.primaryChamber === "house" ? "House" : "Senate";
}

function ariaLabelFor(
  r: Resolved,
  data: CongressStatusResponse | undefined,
): string {
  const parts: string[] = ["Congress status", labelFor(r.status).toLowerCase()];
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

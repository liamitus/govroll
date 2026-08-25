"use client";

import { useQuery } from "@tanstack/react-query";
import { resolveOverall } from "./resolve";
import type { CongressStatusResponse } from "@/app/api/congress/status/route";
import { CONGRESS_STATUS_QUERY_KEY, fetchCongressStatus } from "./status-query";

/**
 * Slim strip above the bills feed shown only while Congress is in a named
 * multi-day recess (July 4th, August, holidays — anything the calendar
 * source flags). Its job is expectation-setting: during a recess the feed's
 * "latest activity" dates go quiet for a week-plus, and without an
 * explanation next to the list itself that reads as stale data, not a
 * recess. The NavBar pill already says "Recess" but sits far from the dates
 * users actually scan.
 *
 * Renders nothing for `no_session` (a quiet day / weekend) — only the
 * calendar-confirmed `recess` status, so it can't cry wolf every Saturday.
 * No poll of its own: it reads the cache the NavBar pill keeps warm.
 */
export function RecessNotice() {
  const { data } = useQuery<CongressStatusResponse>({
    queryKey: CONGRESS_STATUS_QUERY_KEY,
    queryFn: fetchCongressStatus,
    staleTime: 30_000,
  });

  const resolved = resolveOverall(data);
  if (resolved.status !== "recess") return null;

  const winner = resolved.primaryChamber
    ? data?.chambers[resolved.primaryChamber]
    : null;
  const detail = winner?.detail ?? null;

  return (
    <div className="border-l-gold bg-gold/25 flex items-start gap-2.5 border-l-4 px-3.5 py-2.5">
      <svg
        className="text-ink/70 mt-0.5 h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth="2"
        aria-hidden
      >
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" />
      </svg>
      <div className="text-ink min-w-0 text-sm">
        <p className="font-medium">
          Congress is in recess
          {resolved.nextTransitionLabel && (
            <span className="text-ink-muted font-normal">
              {" "}
              · {resolved.nextTransitionLabel}
            </span>
          )}
        </p>
        <p className="text-ink/80 text-xs">
          {detail ? `${detail}. ` : ""}
          Votes and floor action are paused, so the latest activity here may
          look a few days old — new bills still appear as they&apos;re
          introduced.
        </p>
      </div>
    </div>
  );
}

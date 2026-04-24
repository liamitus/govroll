"use client";

import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";

type SummaryState =
  | {
      status: "ready";
      summary: string;
      versionCode: string;
      versionType: string;
      versionDate: string;
    }
  | {
      status: "pending";
      versionCode: string;
      versionType: string;
      versionDate: string;
      startedAt: string;
    }
  | { status: "disabled"; reason: "budget" | "manual" }
  | {
      status: "error";
      error: string;
      versionCode: string;
      versionType: string;
      versionDate: string;
    }
  | { status: "none" };

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_MS = 90_000;

interface Props {
  billId: number;
  /** The latest substantive version, pre-fetched at SSR so we can render
   *  immediately without an initial network round-trip. */
  initialVersion: {
    versionCode: string;
    versionType: string;
    versionDate: string;
    changeSummary: string | null;
  };
}

export function BillChangeSummary({ billId, initialVersion }: Props) {
  const [state, setState] = useState<SummaryState>(
    initialVersion.changeSummary
      ? {
          status: "ready",
          summary: initialVersion.changeSummary,
          versionCode: initialVersion.versionCode,
          versionType: initialVersion.versionType,
          versionDate: initialVersion.versionDate,
        }
      : {
          status: "pending",
          versionCode: initialVersion.versionCode,
          versionType: initialVersion.versionType,
          versionDate: initialVersion.versionDate,
          startedAt: new Date().toISOString(),
        },
  );
  const pollingRef = useRef(false);

  useEffect(() => {
    if (state.status !== "pending" || pollingRef.current) return;
    pollingRef.current = true;

    const started = Date.now();
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/bills/${billId}/summary`, {
          method: "POST",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as SummaryState;
        if (cancelled) return;

        setState(next);

        if (next.status === "pending" && Date.now() - started < MAX_POLL_MS) {
          setTimeout(poll, POLL_INTERVAL_MS);
        } else {
          pollingRef.current = false;
        }
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : "request failed",
          versionCode: initialVersion.versionCode,
          versionType: initialVersion.versionType,
          versionDate: initialVersion.versionDate,
        });
        pollingRef.current = false;
      }
    };

    poll();

    return () => {
      cancelled = true;
      pollingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId, state.status]);

  if (state.status === "none") return null;

  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
        What changed in the latest version · AI-generated
      </p>
      <div className="border-civic-gold/30 bg-civic-gold/5 rounded-md border p-3">
        {state.status === "ready" && (
          <>
            <p className="text-foreground/80 text-sm leading-relaxed">
              {state.summary}
            </p>
            <p className="text-muted-foreground mt-2 text-[11px]">
              {versionLabel(state)}
            </p>
          </>
        )}

        {state.status === "pending" && (
          <>
            <SummaryShimmer />
            <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-[11px]">
              <span className="border-civic-gold/40 border-t-civic-gold inline-block h-3 w-3 animate-spin rounded-full border-2" />
              Generating summary…
            </p>
          </>
        )}

        {state.status === "disabled" && (
          <p className="text-muted-foreground text-xs leading-relaxed">
            AI summaries are{" "}
            {state.reason === "budget"
              ? "paused for this month while the community-funded budget resets"
              : "temporarily paused"}
            .{" "}
            <a
              href="/support"
              className="text-navy/80 hover:text-navy font-medium underline underline-offset-2"
            >
              Support Govroll
            </a>{" "}
            to keep them running.
          </p>
        )}

        {state.status === "error" && (
          <p className="text-muted-foreground text-xs leading-relaxed">
            Couldn&rsquo;t generate a summary right now. Please try again later.
          </p>
        )}
      </div>
    </div>
  );
}

function versionLabel(state: {
  versionType: string;
  versionDate: string;
}): string {
  return `Summary compares to previous version · ${state.versionType} on ${dayjs(state.versionDate).format("MMM D, YYYY")}`;
}

function SummaryShimmer() {
  return (
    <div
      className="space-y-1.5"
      aria-busy="true"
      aria-label="Generating summary"
    >
      <div className="bg-muted/60 h-3 w-full animate-pulse rounded" />
      <div className="bg-muted/60 h-3 w-[92%] animate-pulse rounded" />
      <div className="bg-muted/60 h-3 w-[78%] animate-pulse rounded" />
    </div>
  );
}

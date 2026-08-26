"use client";

import { useEffect, useReducer } from "react";

type FeedDonor = {
  id: string;
  displayName: string | null;
  tributeName: string | null;
  displayMode: string;
  regionCode: string | null;
  createdAt: string | Date;
};

function formatRegion(code: string | null): string {
  if (!code) return "";
  // "US-OH" → "Ohio"
  const state = code.replace("US-", "");
  try {
    return (
      new Intl.DisplayNames("en-US", { type: "region" }).of(`US-${state}`) ??
      state
    );
  } catch {
    return state;
  }
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function donorLabel(d: FeedDonor): string {
  if (d.displayMode === "TRIBUTE" && d.tributeName) {
    return `In honor of ${d.tributeName}`;
  }
  if (d.displayMode === "NAMED" && d.displayName) {
    return d.displayName;
  }
  const region = formatRegion(d.regionCode);
  return region ? `A citizen from ${region}` : "A citizen";
}

export function LiveFeed({ donors }: { donors: FeedDonor[] }) {
  // A pure render-time counter that ticks every 30s — force-refreshes relative
  // times (`timeAgo`) without reading `Date.now()` during render.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {/* Gold = "here, now" — the live marker for the most recent activity. */}
        <span
          className="bg-gold inline-flex h-2 w-2 rounded-full"
          aria-hidden="true"
        />
        <h2 className="text-ink-muted text-sm font-medium tracking-wide uppercase">
          Recent
        </h2>
      </div>
      <div className="space-y-1.5">
        {donors.map((d) => (
          <div
            key={d.id}
            className="animate-fade-slide-up flex items-center justify-between py-1.5 text-sm"
          >
            <span className="text-ink">{donorLabel(d)}</span>
            <span className="text-ink-muted ml-3 text-xs whitespace-nowrap tabular-nums">
              {timeAgo(new Date(d.createdAt))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

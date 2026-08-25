"use client";

import dayjs from "dayjs";

interface VoteHistoryEntry {
  voteType: string;
  createdAt: string;
  versionCode: string | null;
  versionType: string | null;
}

export function VoteHistorySection({
  history,
}: {
  history: VoteHistoryEntry[];
}) {
  // Only show if there are 2+ entries (single entry = no re-votes, not interesting)
  if (history.length < 2) return null;

  return (
    <div className="border-rule border-t pt-3">
      <p className="text-ink-muted mb-1.5 text-[11px] font-bold tracking-[0.18em] uppercase">
        Your vote history
      </p>
      <div className="space-y-1">
        {history.map((entry, i) => (
          <div
            key={i}
            className="text-muted-foreground flex items-center gap-2 text-sm"
          >
            <span className="tabular-nums">
              {dayjs(entry.createdAt).format("MMM D, YYYY")}
            </span>
            <span className="text-foreground/70">—</span>
            <span className="text-foreground/80 font-medium">
              {entry.voteType}
            </span>
            {entry.versionType && (
              <span className="text-muted-foreground">
                ({entry.versionType})
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

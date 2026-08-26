"use client";

import type { RepVotingStats } from "@/types";

interface RepQuickStatsProps {
  stats: RepVotingStats;
  sponsoredBillsCount: number;
}

export function RepQuickStats({
  stats,
  sponsoredBillsCount,
}: RepQuickStatsProps) {
  const attendancePct = 100 - stats.missedVotePct;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        value={`${attendancePct}%`}
        label="Attendance"
        sublabel={`${stats.missedVotes} missed`}
      />
      <StatCard
        value={stats.totalVotes.toLocaleString("en-US")}
        label="Votes Cast"
        sublabel="on tracked bills"
      />
      <StatCard
        value={`${stats.yeaCount + stats.nayCount > 0 ? Math.round((stats.yeaCount / (stats.yeaCount + stats.nayCount)) * 100) : 0}%`}
        label="Voted Yea"
        sublabel={`${stats.yeaCount} of ${stats.yeaCount + stats.nayCount}`}
      />
      <StatCard
        value={sponsoredBillsCount.toLocaleString("en-US")}
        label="Bills Sponsored"
        sublabel="in our database"
      />
    </div>
  );
}

/**
 * Stats are facts, not verdicts — every figure is set in ink. (The old
 * green/amber/red attendance colouring read as a grade; Roll Call never
 * colour-codes a number.)
 */
function StatCard({
  value,
  label,
  sublabel,
}: {
  value: string;
  label: string;
  sublabel: string;
}) {
  return (
    <div className="border-rule bg-paper border p-4 text-center">
      <p className="text-ink text-3xl font-bold tabular-nums">{value}</p>
      <p className="text-ink-muted mt-1 text-sm font-medium">{label}</p>
      <p className="text-ink-muted mt-0.5 text-xs">{sublabel}</p>
    </div>
  );
}

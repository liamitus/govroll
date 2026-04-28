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
        color={
          attendancePct >= 90
            ? "text-vote-yea"
            : attendancePct >= 75
              ? "text-vote-present"
              : "text-vote-nay"
        }
      />
      <StatCard
        value={stats.totalVotes.toLocaleString("en-US")}
        label="Votes Cast"
        sublabel="on tracked bills"
        color="text-navy"
      />
      <StatCard
        value={`${stats.yeaCount + stats.nayCount > 0 ? Math.round((stats.yeaCount / (stats.yeaCount + stats.nayCount)) * 100) : 0}%`}
        label="Voted Yea"
        sublabel={`${stats.yeaCount} of ${stats.yeaCount + stats.nayCount}`}
        color="text-vote-yea"
      />
      <StatCard
        value={sponsoredBillsCount.toLocaleString("en-US")}
        label="Bills Sponsored"
        sublabel="in our database"
        color="text-navy"
      />
    </div>
  );
}

function StatCard({
  value,
  label,
  sublabel,
  color,
}: {
  value: string;
  label: string;
  sublabel: string;
  color: string;
}) {
  return (
    <div className="border-border/60 rounded-lg border bg-white p-4 text-center">
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className="text-navy/70 mt-1 text-sm font-medium">{label}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">{sublabel}</p>
    </div>
  );
}

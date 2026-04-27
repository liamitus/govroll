import type { MomentumTier, DeathReason } from "@/types";

function formatSilence(days: number): string {
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  const years = Math.floor(days / 365);
  const remMonths = Math.round((days - years * 365) / 30);
  return remMonths === 0
    ? `${years} year${years > 1 ? "s" : ""}`
    : `${years} year${years > 1 ? "s" : ""}, ${remMonths} month${remMonths > 1 ? "s" : ""}`;
}

interface BannerSpec {
  title: string;
  body: string;
  tone: "dead" | "dormant" | "stalled";
}

function pickBanner(
  tier: MomentumTier | null,
  days: number | null,
  reason: DeathReason | null,
): BannerSpec | null {
  if (!tier) return null;
  const silence = days != null ? formatSilence(days) : null;

  switch (tier) {
    case "DEAD":
      if (reason === "CONGRESS_ENDED")
        return {
          title: "This bill died when its Congress ended.",
          body: "Bills don't carry over between Congresses. Without re-introduction in a new session, it cannot advance.",
          tone: "dead",
        };
      if (reason === "FAILED_VOTE")
        return {
          title: "This bill failed on a recorded vote.",
          body: "A chamber voted it down. It cannot advance in this form.",
          tone: "dead",
        };
      if (reason === "VETOED")
        return {
          title: "This bill was vetoed and not overridden.",
          body: "The President vetoed this bill and Congress did not override. It cannot become law.",
          tone: "dead",
        };
      return {
        title: "This bill appears to be dead.",
        body: silence
          ? `No action recorded in ${silence}. The structural status reflects an earlier milestone, not current activity.`
          : "No recent activity recorded. The structural status reflects an earlier milestone.",
        tone: "dead",
      };
    case "DORMANT":
      return {
        title: "This bill has gone quiet.",
        body: silence
          ? `No action in ${silence}. It hasn't officially died, but bills this inactive rarely revive.`
          : "No recent activity. Bills this inactive rarely revive.",
        tone: "dormant",
      };
    case "STALLED":
      return {
        title: "This bill is stalled.",
        body: silence
          ? `No action in ${silence}. It may still move, but has lost momentum.`
          : "No recent activity. It may still move, but has lost momentum.",
        tone: "stalled",
      };
    case "ACTIVE":
    case "ADVANCING":
    case "ENACTED":
    default:
      return null;
  }
}

const TONE_CLASSES: Record<BannerSpec["tone"], string> = {
  dead: "border-border/60 bg-muted/60 text-foreground/75",
  dormant: "border-border/60 bg-muted/40 text-foreground/80",
  stalled:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
};

export function BillStatusBanner({
  tier,
  days,
  reason,
}: {
  tier: MomentumTier | null;
  days: number | null;
  reason: DeathReason | null;
}) {
  const banner = pickBanner(tier, days, reason);
  if (!banner) return null;
  return (
    <div className={`rounded-lg border px-4 py-3 ${TONE_CLASSES[banner.tone]}`}>
      <p className="text-base leading-tight font-semibold">{banner.title}</p>
      <p className="mt-1 text-sm leading-relaxed opacity-90">{banner.body}</p>
    </div>
  );
}

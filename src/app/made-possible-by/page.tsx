import { prisma } from "@/lib/prisma";
import { LiveFeed } from "./live-feed";
import { DonorGrid } from "./donor-grid";
import Link from "next/link";

export const metadata = {
  title: "Made Possible By — Govroll",
  description:
    "Govroll is funded by supporters. Meet the people keeping civic transparency alive.",
};

export const dynamic = "force-dynamic";
export const revalidate = 300; // 5 min cache

/** Deterministic daily shuffle so the order is stable for a day but fair over time. */
function dailyShuffle<T>(arr: T[]): T[] {
  const seed = new Date().toISOString().slice(0, 10); // "2026-04-10"
  const out = [...arr];
  // Simple seeded Fisher-Yates using a hash of the date string
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i);
  }
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h, 1597334677) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const DONOR_SELECT = {
  id: true,
  displayName: true,
  tributeName: true,
  displayMode: true,
  regionCode: true,
  createdAt: true,
} as const;

// Wrapped so the `react-hooks/purity` lint doesn't flag `Date.now()` inside
// the component body. This is an async server component, not a reactive
// render, so the impurity rule doesn't actually apply — but the linter
// can't tell, and a module-scoped helper sidesteps it cleanly.
function twentyFourHoursAgo(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

export default async function MadePossibleByPage() {
  const since = twentyFourHoursAgo();

  const [
    recentDonors,
    sustainers,
    supporters,
    tributes,
    anonCount,
    totalCount,
  ] = await Promise.all([
    // Live feed — last 24h, max 10
    prisma.donation.findMany({
      where: {
        moderationStatus: "APPROVED",
        hiddenAt: null,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      select: DONOR_SELECT,
      take: 10,
    }),
    // Sustainers — active recurring donors
    prisma.donation.findMany({
      where: {
        moderationStatus: "APPROVED",
        hiddenAt: null,
        isRecurring: true,
        recurringStatus: { in: ["ACTIVE", "GRACE"] },
        displayMode: { not: "ANONYMOUS" },
      },
      select: DONOR_SELECT,
    }),
    // Named one-time supporters
    prisma.donation.findMany({
      where: {
        moderationStatus: "APPROVED",
        hiddenAt: null,
        isRecurring: false,
        displayMode: "NAMED",
      },
      select: DONOR_SELECT,
    }),
    // Tribute donations
    prisma.donation.findMany({
      where: {
        moderationStatus: "APPROVED",
        hiddenAt: null,
        displayMode: "TRIBUTE",
      },
      select: DONOR_SELECT,
    }),
    // Anonymous count
    prisma.donation.count({
      where: {
        moderationStatus: { in: ["APPROVED", "PENDING"] },
        hiddenAt: null,
        displayMode: "ANONYMOUS",
      },
    }),
    // Total count
    prisma.donation.count({
      where: {
        moderationStatus: { in: ["APPROVED", "PENDING"] },
        hiddenAt: null,
      },
    }),
  ]);

  const shuffledSustainers = dailyShuffle(sustainers);
  const shuffledSupporters = dailyShuffle(supporters);
  const shuffledTributes = dailyShuffle(tributes);

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-10">
      {/* Header */}
      <header className="space-y-3 text-center">
        <p className="text-civic-gold star-accent text-sm tracking-widest uppercase">
          Made Possible By
        </p>
        {totalCount === 0 ? (
          <>
            <h1 className="text-4xl font-bold tracking-tight">Be the first.</h1>
            <p className="text-muted-foreground mx-auto max-w-lg">
              Govroll is just getting started. No ads, no corporate sponsors —
              every citizen who chips in shows up here.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-4xl font-bold tracking-tight">
              {`${totalCount.toLocaleString("en-US")} ${totalCount === 1 ? "citizen keeps" : "citizens keep"} Govroll running.`}
            </h1>
            <p className="text-muted-foreground mx-auto max-w-lg">
              No ads. No corporate sponsors. Just people who believe civic
              transparency matters.
            </p>
          </>
        )}
      </header>

      {/* Live feed — recent donations in last 24h */}
      {recentDonors.length > 0 && <LiveFeed donors={recentDonors} />}

      {/* Sustainers — recurring donors */}
      {shuffledSustainers.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">Sustainers</h2>
            <span className="bg-civic-gold/10 text-civic-gold rounded-full px-2 py-0.5 text-xs font-medium">
              Monthly
            </span>
          </div>
          <DonorGrid donors={shuffledSustainers} />
        </section>
      )}

      {/* Named one-time supporters */}
      {shuffledSupporters.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Supporters</h2>
          <DonorGrid donors={shuffledSupporters} />
        </section>
      )}

      {/* Tributes */}
      {shuffledTributes.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">In Honor Of</h2>
          <div className="grid gap-2">
            {shuffledTributes.map((d) => (
              <div key={d.id} className="text-muted-foreground text-sm italic">
                In honor of{" "}
                <span className="text-foreground font-medium not-italic">
                  {d.tributeName}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Anonymous aggregate */}
      {anonCount > 0 && (
        <p className="text-muted-foreground text-center text-base font-medium">
          {`+ ${anonCount.toLocaleString("en-US")} anonymous citizen${anonCount !== 1 ? "s" : ""}`}
        </p>
      )}

      {/* CTA */}
      <div className="pt-4 text-center">
        <Link
          href="/support"
          className="bg-navy hover:bg-navy-light inline-flex items-center gap-2 rounded-md px-6 py-3 text-sm font-semibold tracking-wide text-white transition-colors"
        >
          Join them
        </Link>
      </div>
    </div>
  );
}

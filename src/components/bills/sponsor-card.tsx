"use client";

import Link from "next/link";
import { useState } from "react";
import { partyColor } from "@/lib/representative-utils";
import { parseSponsorString } from "@/lib/sponsor";
import { RepPhoto } from "@/components/representatives/rep-photo";

type RepMatch = {
  bioguideId: string;
  slug: string | null;
  firstName: string;
  lastName: string;
} | null;

type Cosponsor = {
  bioguideId: string;
  slug: string | null;
  firstName: string;
  lastName: string;
  state: string;
  party: string;
};

interface SponsorCardProps {
  /** Raw sponsor text string from `Bill.sponsor`. */
  sponsor: string | null;
  /** Matched Representative row, if we were able to join on name+state. */
  rep: RepMatch;
  /**
   * Full cosponsor list (excluding withdrawn). May be empty for bills whose
   * cosponsors haven't been backfilled yet — when that happens, we still
   * render the summary line using the metadata count/split below.
   */
  cosponsors: Cosponsor[];
  /** Authoritative count from `Bill.cosponsorCount` (scraped from Congress.gov). */
  cosponsorCount: number | null;
  /** Raw "11 D, 10 R" string from `Bill.cosponsorPartySplit`. */
  cosponsorPartySplit: string | null;
  /** True when the bill is enacted, dead, or hard-failed. Settled bills no
   *  longer accumulate cosponsors, so the "yet" framing reads as misleading
   *  ("still gathering support"); we drop it. */
  isSettled?: boolean;
}

/** Parse "11 D, 10 R, 1 I" into structured counts for the bar and groupings. */
function parsePartySplit(split: string | null): {
  dem: number;
  rep: number;
  other: number;
} {
  if (!split) return { dem: 0, rep: 0, other: 0 };
  const dem = parseInt(/(\d+)\s*D/.exec(split)?.[1] ?? "0", 10);
  const rep = parseInt(/(\d+)\s*R/.exec(split)?.[1] ?? "0", 10);
  const other = parseInt(/(\d+)\s*I/.exec(split)?.[1] ?? "0", 10);
  return { dem, rep, other };
}

/** Normalize `Representative.party` to a single-letter code. */
function partyCode(party: string): "D" | "R" | "I" | "L" | "G" | "?" {
  const p = party.toLowerCase();
  if (p.includes("democrat")) return "D";
  if (p.includes("republican")) return "R";
  if (p.includes("independent")) return "I";
  if (p.includes("libertarian")) return "L";
  if (p.includes("green")) return "G";
  return "?";
}

/** Build the "Bipartisan / mostly X / all Y" coalition summary line. */
function coalitionLine(
  count: number,
  demCount: number,
  repCount: number,
  otherCount: number,
  sponsorParty: string | null,
  isSettled: boolean,
): string {
  if (count === 0) {
    return isSettled
      ? "Introduced solo — no cosponsors joined."
      : "Introduced solo — no cosponsors yet.";
  }

  const parts: string[] = [];
  if (demCount) parts.push(`${demCount} D`);
  if (repCount) parts.push(`${repCount} R`);
  if (otherCount) parts.push(`${otherCount} I`);
  const split = parts.join(", ");
  const noun = `cosponsor${count === 1 ? "" : "s"}`;

  // Bipartisan threshold: ≥3 from the minority major party (same heuristic as
  // momentum scoring in src/lib/momentum.ts).
  const minority = Math.min(demCount, repCount);
  if (minority >= 3) return `Bipartisan — ${count} ${noun} (${split})`;

  if (demCount > 0 && repCount > 0) {
    const leaning =
      demCount > repCount ? "mostly Democrats" : "mostly Republicans";
    return `${count} ${noun} — ${leaning}`;
  }

  const partyWord =
    sponsorParty === "R"
      ? "all Republican"
      : sponsorParty === "D"
        ? "all Democrat"
        : split;
  return `${count} ${noun} — ${partyWord}`;
}

/** Proportional D/R/I bar. Decorative — numeric counts are in the text above. */
function PartyBar({
  demCount,
  repCount,
  otherCount,
}: {
  demCount: number;
  repCount: number;
  otherCount: number;
}) {
  const total = demCount + repCount + otherCount;
  if (total === 0) return null;
  const demPct = (demCount / total) * 100;
  const repPct = (repCount / total) * 100;
  const otherPct = (otherCount / total) * 100;
  return (
    <div
      className="bg-muted flex h-1 overflow-hidden rounded-full"
      aria-hidden="true"
    >
      {demCount > 0 && (
        <div className="bg-dem h-full" style={{ width: `${demPct}%` }} />
      )}
      {repCount > 0 && (
        <div className="bg-rep h-full" style={{ width: `${repPct}%` }} />
      )}
      {otherCount > 0 && (
        <div className="bg-ind h-full" style={{ width: `${otherPct}%` }} />
      )}
    </div>
  );
}

/** Single cosponsor row: photo, name, "D-TX" party+state tag. */
function CosponsorRow({ cosponsor }: { cosponsor: Cosponsor }) {
  const code = partyCode(cosponsor.party);
  const colors = partyColor(cosponsor.party);
  const href = `/representatives/${cosponsor.slug || cosponsor.bioguideId}`;
  return (
    <Link
      href={href}
      className="hover:bg-muted/60 flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors"
    >
      <div className="bg-muted relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-full">
        <RepPhoto
          bioguideId={cosponsor.bioguideId}
          firstName={cosponsor.firstName}
          lastName={cosponsor.lastName}
          alt={`${cosponsor.firstName} ${cosponsor.lastName}`}
          imgClassName="object-[center_20%]"
          fallbackClassName="text-xs font-semibold"
        />
      </div>
      <p className="text-navy min-w-0 flex-1 truncate text-base">
        {cosponsor.firstName} {cosponsor.lastName}
      </p>
      <span
        className={`inline-flex flex-shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold ${colors.badge}`}
      >
        {code}-{cosponsor.state}
      </span>
    </Link>
  );
}

export function SponsorCard({
  sponsor,
  rep,
  cosponsors,
  cosponsorCount,
  cosponsorPartySplit,
  isSettled = false,
}: SponsorCardProps) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseSponsorString(sponsor);
  if (!parsed) return null;

  const colors = partyColor(
    parsed.party === "R"
      ? "Republican"
      : parsed.party === "D"
        ? "Democrat"
        : parsed.party === "I"
          ? "Independent"
          : parsed.party,
  );

  const chamberLabel =
    parsed.chamberPrefix === "Sen."
      ? "U.S. Senator"
      : parsed.chamberPrefix === "Del."
        ? "Delegate"
        : parsed.chamberPrefix === "Res.Comm."
          ? "Resident Commissioner"
          : "U.S. Representative";

  const locationLabel = `${parsed.state}${parsed.district ? `-${parsed.district}` : ""}`;
  const displayName = `${parsed.firstName} ${parsed.lastName}`;

  const demCosponsors = cosponsors.filter((c) => partyCode(c.party) === "D");
  const repCosponsors = cosponsors.filter((c) => partyCode(c.party) === "R");
  const otherCosponsors = cosponsors.filter(
    (c) => partyCode(c.party) !== "D" && partyCode(c.party) !== "R",
  );

  // Prefer the authoritative metadata count + split from the Bill row — many
  // bills haven't had their `BillCosponsor` rows backfilled yet, so falling
  // back to `cosponsors.length` would misreport them as "Introduced solo".
  const metaSplit = parsePartySplit(cosponsorPartySplit);
  const count = cosponsorCount ?? cosponsors.length;
  const demCount = metaSplit.dem || demCosponsors.length;
  const repCount = metaSplit.rep || repCosponsors.length;
  const otherCount = metaSplit.other || otherCosponsors.length;
  const coalition = coalitionLine(
    count,
    demCount,
    repCount,
    otherCount,
    parsed.party,
    isSettled,
  );
  // Only show the expander when we actually have rows to reveal; otherwise
  // render the coalition line as static text (matches pre-feature behavior
  // for bills missing cosponsor rows).
  const canExpand = cosponsors.length > 0;

  // Sponsor identity row — photo, name, chamber, "View profile" arrow. The
  // whole row links to the rep's profile when we have a match; otherwise
  // it's a static div (prior Congress / name-join miss).
  const sponsorRow = (
    <>
      <div className="bg-muted relative h-15 w-12 flex-shrink-0 overflow-hidden rounded-md">
        <RepPhoto
          bioguideId={rep?.bioguideId ?? null}
          firstName={parsed.firstName}
          lastName={parsed.lastName}
          alt={displayName}
          imgClassName="object-[center_20%]"
          fallbackClassName="text-sm font-semibold"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-navy text-base leading-snug font-semibold">
            {displayName}
          </p>
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${colors.badge}`}
          >
            {parsed.party === "D"
              ? "Democrat"
              : parsed.party === "R"
                ? "Republican"
                : parsed.party === "I"
                  ? "Independent"
                  : parsed.party}
          </span>
        </div>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {chamberLabel} · {locationLabel}
        </p>
      </div>

      {rep && (
        <span className="text-muted-foreground group-hover:text-navy hidden items-center text-sm transition-colors sm:inline-flex">
          View profile
          <svg
            className="ml-1 h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
      )}
    </>
  );

  const sponsorRowClasses =
    "flex items-center gap-3 px-4 py-3 transition-colors";
  const sponsorSection = rep ? (
    <Link
      href={`/representatives/${rep.slug || rep.bioguideId}`}
      className={`${sponsorRowClasses} group hover:bg-muted/40`}
    >
      {sponsorRow}
    </Link>
  ) : (
    <div className={sponsorRowClasses}>{sponsorRow}</div>
  );

  return (
    <div
      className={`border-border/60 overflow-hidden rounded-lg border bg-white ${colors.bar}`}
    >
      {sponsorSection}

      {/* Coalition line — static for solo bills or unbackfilled bills,
          expandable when we actually have cosponsor rows to reveal. */}
      {!canExpand ? (
        <div className="border-border/60 border-t px-4 py-2.5">
          <p className="text-muted-foreground/80 text-sm">{coalition}</p>
          {count > 0 && (
            <div className="mt-1.5">
              <PartyBar
                demCount={demCount}
                repCount={repCount}
                otherCount={otherCount}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="sponsor-cosponsor-list"
            className="border-border/60 hover:bg-muted/40 flex w-full items-center gap-3 border-t px-4 py-2.5 text-left transition-colors"
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-muted-foreground/80 text-sm">{coalition}</p>
              <PartyBar
                demCount={demCount}
                repCount={repCount}
                otherCount={otherCount}
              />
            </div>
            <svg
              className={`text-muted-foreground h-4 w-4 flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {expanded && (
            <div
              id="sponsor-cosponsor-list"
              className="border-border/60 border-t px-3 py-3"
            >
              {demCosponsors.length > 0 && (
                <CosponsorGroup
                  label="Democrats"
                  cosponsors={demCosponsors}
                  isFirst
                />
              )}
              {repCosponsors.length > 0 && (
                <CosponsorGroup
                  label="Republicans"
                  cosponsors={repCosponsors}
                  isFirst={demCosponsors.length === 0}
                />
              )}
              {otherCosponsors.length > 0 && (
                <CosponsorGroup
                  label="Independents"
                  cosponsors={otherCosponsors}
                  isFirst={
                    demCosponsors.length === 0 && repCosponsors.length === 0
                  }
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CosponsorGroup({
  label,
  cosponsors,
  isFirst,
}: {
  label: string;
  cosponsors: Cosponsor[];
  isFirst: boolean;
}) {
  return (
    <div className={isFirst ? "" : "mt-3"}>
      <p className="text-muted-foreground px-2 pb-1 text-xs font-semibold tracking-[0.12em] uppercase">
        {label} ({cosponsors.length})
      </p>
      <ul className="space-y-0.5">
        {cosponsors.map((c) => (
          <li key={c.bioguideId}>
            <CosponsorRow cosponsor={c} />
          </li>
        ))}
      </ul>
    </div>
  );
}

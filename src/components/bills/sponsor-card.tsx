"use client";

import Link from "next/link";
import { useState } from "react";
import { partyLetter } from "@/lib/representative-utils";
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

  // Single-party label keyed off the cosponsors themselves — never the
  // sponsor's party. A Democrat-sponsored bill cosponsored only by a
  // Republican (e.g. sres-538-119: Alsobrooks + Collins) must read as
  // "all Republican".
  let partyWord: string;
  if (demCount > 0 && repCount === 0 && otherCount === 0) {
    partyWord = "all Democrat";
  } else if (repCount > 0 && demCount === 0 && otherCount === 0) {
    partyWord = "all Republican";
  } else if (otherCount > 0 && demCount === 0 && repCount === 0) {
    partyWord = "all Independent";
  } else {
    partyWord = split;
  }
  return `${count} ${noun} — ${partyWord}`;
}

/** Single cosponsor row: photo, name, party letter node + state. Party is
 *  encoded by letter only — identical frames for every party, no tints. */
function CosponsorRow({ cosponsor }: { cosponsor: Cosponsor }) {
  const href = `/representatives/${cosponsor.slug || cosponsor.bioguideId}`;
  return (
    <Link
      href={href}
      className="hover:bg-muted/60 flex items-center gap-2.5 px-2 py-1.5 transition-colors"
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
      <p className="text-ink min-w-0 flex-1 truncate text-base">
        {cosponsor.firstName} {cosponsor.lastName}
      </p>
      <span className="flex flex-shrink-0 items-center gap-1.5">
        <span className="party-node party-node--sm">
          {partyLetter(cosponsor.party)}
        </span>
        <span className="text-ink-muted text-xs font-medium">
          {cosponsor.state}
        </span>
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
          <p className="text-ink text-base leading-snug font-semibold">
            {displayName}
          </p>
          {/* Party is a letter in an identical frame — never a colour. */}
          <span
            className="party-node party-node--sm"
            aria-label={
              parsed.party === "D"
                ? "Democrat"
                : parsed.party === "R"
                  ? "Republican"
                  : parsed.party === "I"
                    ? "Independent"
                    : parsed.party
            }
          >
            {parsed.party}
          </span>
        </div>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {chamberLabel} · {locationLabel}
        </p>
      </div>

      {rep && (
        <span className="text-muted-foreground group-hover:text-ink hidden items-center text-sm transition-colors sm:inline-flex">
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
    // Rep-card grammar: paper surface, rule hairline, 4px sapphire left
    // border. No party tint anywhere — the coalition split is stated in
    // words, never as a red/blue bar.
    <div className="border-rule border-l-sapphire bg-paper overflow-hidden border border-l-4">
      {sponsorSection}

      {/* Coalition line — static for solo bills or unbackfilled bills,
          expandable when we actually have cosponsor rows to reveal. */}
      {!canExpand ? (
        <div className="border-rule border-t px-4 py-2.5">
          <p className="text-muted-foreground/80 text-sm">{coalition}</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="sponsor-cosponsor-list"
            className="border-rule hover:bg-muted/40 flex w-full items-center gap-3 border-t px-4 py-2.5 text-left transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground/80 text-sm">{coalition}</p>
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
              className="border-rule border-t px-3 py-3"
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
      <p className="text-ink-muted px-2 pb-1 text-[11px] font-bold tracking-[0.18em] uppercase tabular-nums">
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

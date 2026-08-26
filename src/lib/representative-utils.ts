// Shared utilities for representative display

/**
 * Roll Call encodes party by letter ONLY — D · R · I in identical
 * circular frames (`.party-node` in globals.css). Party never gets a
 * colour, a fill, or a heavier mark: red/blue would put a partisan
 * read on every screen, and node fill is already reserved for stage
 * (docs/design/roll-call.md, "the encoding law").
 */
export function partyLetter(party: string): string {
  const p = party.toLowerCase();
  if (p.includes("democrat")) return "D";
  if (p.includes("republican")) return "R";
  if (p.includes("independent")) return "I";
  if (p.includes("libertarian")) return "L";
  if (p.includes("green")) return "G";
  return "?";
}

export function chamberLabel(chamber: string) {
  if (chamber === "senator") return "U.S. Senator";
  if (chamber === "representative") return "U.S. Representative";
  return chamber;
}

export function nextElection(
  termEnd: Date | string | null | undefined,
  chamber: string,
): string {
  const electionDate = getElectionDay(nextElectionYear(termEnd, chamber));
  return timeUntil(new Date(), electionDate);
}

/**
 * Year of a sitting member's next election.
 *
 * `termEnd` is the end of the member's CURRENT term — Jan 3 of an odd year.
 * The election that decides the seat is held the prior November, so the next
 * election falls in `year(termEnd) - 1`. This is exactly why a state's two
 * senators differ: they sit in different election classes, so their terms end
 * two years apart (NY — Schumer's term ends 2029, Gillibrand's 2031 → elections
 * in 2028 and 2030). The old code added a flat +4 to every senator, which
 * showed both as "in about 4 years".
 *
 * Falls back to the next even year when `termEnd` is missing (e.g. a member
 * ingested before the term-end backfill ran): House seats are always up then,
 * and a senator's class is unknowable without the term.
 */
export function nextElectionYear(
  termEnd: Date | string | null | undefined,
  chamber: string,
): number {
  const cycle = chamber === "representative" ? 2 : 6;
  const parsed = parseDate(termEnd);
  const now = new Date();

  let year: number;
  if (parsed) {
    const endYear = parsed.getFullYear();
    // Regular terms end in early January, so the deciding election was the
    // prior November (endYear - 1). Some appointments instead run until an
    // election day in November — that same election fills the seat, so the year
    // is endYear. Split on mid-year to tell them apart; it's timezone-robust
    // since a January or November date never crosses the H1/H2 boundary.
    year = parsed.getMonth() >= 6 ? endYear : endYear - 1;
  } else {
    const y = now.getFullYear();
    year = y % 2 === 0 ? y : y + 1;
  }

  // Never return a past election: advance whole cycles past the post-election
  // lame-duck window (Nov–Jan, before term data refreshes) or any stale data.
  while (getElectionDay(year) < now) year += cycle;
  return year;
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getElectionDay(year: number): Date {
  // First Monday in November
  const nov1 = new Date(year, 10, 1);
  const dayOfWeek = nov1.getDay();
  const firstMonday =
    dayOfWeek <= 1 ? 1 + (1 - dayOfWeek) : 1 + (8 - dayOfWeek);
  // First Tuesday after first Monday
  return new Date(year, 10, firstMonday + 1);
}

/** Returns a self-contained phrase like "in about 5 years" or "tomorrow". */
function timeUntil(from: Date, to: Date): string {
  const diffMs = to.getTime() - from.getTime();

  if (diffMs < 0) return "passed";

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 30) return `in ${Math.ceil(days / 7)} weeks`;
  if (days < 60) return "in about a month";

  const months = Math.round(days / 30.44);
  if (months < 12) return `in ${months} months`;
  if (months < 18) return "in about a year";

  const years = Math.round(days / 365.25);
  return `in about ${years} years`;
}

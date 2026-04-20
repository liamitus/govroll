/**
 * Parse user-typed bill citations like "HR 1234", "H.R. 1234", "S. 200",
 * "H.J.Res. 5", "119 HR 1" into a structured reference we can look up in
 * the database.
 *
 * Handles variation in casing, punctuation, whitespace between the type
 * letters, and optional leading or trailing Congress number ("119 HR 1",
 * "HR 1 (119)", "HR 1 119th").
 *
 * Returns null when the input doesn't look like a citation — in which
 * case the caller falls through to full-text title search.
 */

const TYPE_CODE_TO_DB: Record<string, string> = {
  // Longer codes listed first; the matcher iterates longest-to-shortest so
  // "HJRES" beats "HR" on the same input.
  HJRES: "house_joint_resolution",
  SJRES: "senate_joint_resolution",
  HCONRES: "house_concurrent_resolution",
  SCONRES: "senate_concurrent_resolution",
  HRES: "house_resolution",
  SRES: "senate_resolution",
  HR: "house_bill",
  S: "senate_bill",
};

const TYPE_CODES = Object.keys(TYPE_CODE_TO_DB).sort(
  (a, b) => b.length - a.length,
);

const SHORT_LABEL: Record<string, string> = {
  house_bill: "H.R.",
  senate_bill: "S.",
  house_joint_resolution: "H.J.Res.",
  senate_joint_resolution: "S.J.Res.",
  house_concurrent_resolution: "H.Con.Res.",
  senate_concurrent_resolution: "S.Con.Res.",
  house_resolution: "H.Res.",
  senate_resolution: "S.Res.",
};

const SHORT_CODE: Record<string, string> = {
  house_bill: "hr",
  senate_bill: "s",
  house_joint_resolution: "hjres",
  senate_joint_resolution: "sjres",
  house_concurrent_resolution: "hconres",
  senate_concurrent_resolution: "sconres",
  house_resolution: "hres",
  senate_resolution: "sres",
};

export interface BillCitation {
  /** DB-form bill type, e.g. "house_bill" — matches Prisma Bill.billType. */
  billType: string;
  /** Display label, e.g. "H.R." */
  shortLabel: string;
  /** GovTrack/Congress.gov URL shorthand, e.g. "hr". */
  shortCode: string;
  /** Bill number, always positive. */
  number: number;
  /** Congress number if user specified it; null otherwise. */
  congress: number | null;
}

/** Normalize raw input: uppercase, drop punctuation, collapse whitespace. */
function normalize(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ");
}

export function parseBillCitation(raw: string): BillCitation | null {
  if (!raw) return null;
  const s = normalize(raw);
  if (!s) return null;

  for (const code of TYPE_CODES) {
    // Allow spaces between each letter of the code so "H R" and "H. R."
    // both normalize to the same match as "HR".
    const codeRegex = code.split("").join("\\s*");
    // Optional leading Congress: "119 HR 1", "119th HR 1".
    // Optional trailing Congress: "HR 1 119", "HR 1 (119)", "HR 1 119th".
    const pattern = new RegExp(
      `^(?:(\\d{1,3})(?:ST|ND|RD|TH)?\\s+)?${codeRegex}\\s*(\\d+)(?:\\s*\\(?\\s*(\\d{1,3})(?:ST|ND|RD|TH)?\\s*\\)?)?$`,
    );
    const m = s.match(pattern);
    if (!m) continue;

    const number = Number.parseInt(m[2], 10);
    if (!Number.isFinite(number) || number <= 0) continue;

    const leadingCongress = m[1] ? Number.parseInt(m[1], 10) : null;
    const trailingCongress = m[3] ? Number.parseInt(m[3], 10) : null;
    const congress = leadingCongress ?? trailingCongress ?? null;
    // Plausible Congress range: the 1st Congress began in 1789; we'll
    // never see anything outside ~1-999 so the regex \d{2,3} is enough.
    if (congress !== null && (congress < 1 || congress > 999)) continue;

    const billType = TYPE_CODE_TO_DB[code];
    return {
      billType,
      shortLabel: SHORT_LABEL[billType],
      shortCode: SHORT_CODE[billType],
      number,
      congress,
    };
  }

  return null;
}

/** Human display form, e.g. "H.R. 1234" or "H.R. 1234 · 119th Congress". */
export function formatBillCitation(citation: BillCitation): string {
  const base = `${citation.shortLabel} ${citation.number}`;
  if (citation.congress === null) return base;
  return `${base} · ${formatOrdinal(citation.congress)} Congress`;
}

export function formatOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

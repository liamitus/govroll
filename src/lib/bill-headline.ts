import type { BillSummary } from "@/types";

export interface BillHeadline {
  /** Primary bold text — the human-scannable headline. */
  headline: string;
  /** Optional muted subtitle. Null when the headline already covers it. */
  secondary: string | null;
  /**
   * Set when the headline was derived from the summary (because the
   * official title was procedural). UI should render it as a small italic
   * caption so the bill stays citable.
   */
  officialTitle: string | null;
}

// Titles that begin with these are procedural / boilerplate and read
// poorly as scan headlines. They almost always have a paired summary that
// communicates more.
const PROCEDURAL_PREFIXES: RegExp[] = [/^Providing for\b/i];

// Trailing congressional boilerplate. When a title ends this way the
// preceding text is usually amendment-citation language, not a headline.
const PROCEDURAL_SUFFIX = /\bfor other purposes\.?$/i;

function isProceduralTitle(title: string): boolean {
  if (title.length > 100) return true;
  if (PROCEDURAL_PREFIXES.some((p) => p.test(title))) return true;
  if (PROCEDURAL_SUFFIX.test(title)) return true;
  return false;
}

// Strips the standard CRS opener so the summary reads as an action
// statement. Mirrors the patterns in scripts/clean-summary-prefixes.ts.
const SUMMARY_OPENER =
  /^(?:This|The)\s+(?:bill|act|joint\s+resolution|concurrent\s+resolution|resolution|measure|section)\s+/i;

const HEADLINE_MAX = 140;

/**
 * Convert a CRS summary into a single-sentence headline. Strips the
 * "This bill / This resolution" opener, capitalizes the verb, and caps
 * length at HEADLINE_MAX with an ellipsis at a word boundary. Returns
 * null when the input is too short to yield a useful headline.
 */
export function extractHeadlineFromSummary(summary: string): string | null {
  const stripped = summary.replace(SUMMARY_OPENER, "").trim();
  if (stripped.length < 8) return null;

  const capitalized = stripped[0].toUpperCase() + stripped.slice(1);

  // First sentence — period followed by whitespace or end of string.
  const periodMatch = capitalized.search(/\.(\s|$)/);
  let firstSentence =
    periodMatch === -1 ? capitalized : capitalized.slice(0, periodMatch + 1);

  if (firstSentence.length > HEADLINE_MAX) {
    const truncated = firstSentence.slice(0, HEADLINE_MAX);
    const lastSpace = truncated.lastIndexOf(" ");
    const cut = lastSpace > 40 ? lastSpace : HEADLINE_MAX;
    firstSentence = truncated.slice(0, cut).replace(/[,;:]\s*$/, "") + "…";
  }

  return firstSentence;
}

type HeadlineInput = Pick<
  BillSummary,
  "title" | "popularTitle" | "shortTitle" | "displayTitle" | "shortText"
>;

/**
 * Pick the best headline + secondary text for a bill card.
 *
 * Order:
 *   1. popularTitle     — "CHIPS Act"
 *   2. shortTitle       — "ALERT Act"
 *   3. displayTitle     — Congress.gov display variant, when distinct + non-procedural
 *   4. summary headline — first sentence of shortText, when the official
 *                         title is procedural / over-long
 *   5. official title   — last resort
 *
 * When (4) fires, `officialTitle` carries the demoted long title so the
 * caller can still surface it as a small caption.
 */
export function pickBillHeadline(bill: HeadlineInput): BillHeadline {
  if (bill.popularTitle) {
    return {
      headline: bill.popularTitle,
      secondary: bill.shortText,
      officialTitle: null,
    };
  }

  if (bill.shortTitle) {
    return {
      headline: bill.shortTitle,
      secondary: bill.shortText,
      officialTitle: null,
    };
  }

  if (
    bill.displayTitle &&
    bill.displayTitle !== bill.title &&
    !isProceduralTitle(bill.displayTitle)
  ) {
    return {
      headline: bill.displayTitle,
      secondary: bill.shortText,
      officialTitle: null,
    };
  }

  if (isProceduralTitle(bill.title) && bill.shortText) {
    const fromSummary = extractHeadlineFromSummary(bill.shortText);
    if (fromSummary) {
      return {
        headline: fromSummary,
        secondary: null,
        officialTitle: bill.title,
      };
    }
  }

  return {
    headline: bill.title,
    secondary: bill.shortText,
    officialTitle: null,
  };
}

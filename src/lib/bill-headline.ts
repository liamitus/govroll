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

// Strips the "and for other purposes" suffix off a title so the
// substantive portion can stand alone as a headline.
const FOR_OTHER_PURPOSES_TAIL =
  /\s*,?\s+and\s+for\s+other\s+purposes\s*\.?\s*$/i;

// Captures the action half of an "amend X to Y" bill title. Non-greedy on
// the target so the first " to " (the one separating target from action)
// is the cut point. The trailing boilerplate is consumed optionally so
// the action group doesn't include it.
const AMEND_TO_ACTION_PATTERN =
  /^to\s+amend\s+.+?\s+to\s+(.+?)(?:\s*,?\s+and\s+for\s+other\s+purposes\s*\.?)?\s*$/i;

// Marks a House Rules Committee "rule" resolution ("Providing for
// consideration of the bill (H.R. X)…"). Anchored — we only treat the
// title as a rule when it opens with this phrase; the inner repetitions
// of "providing for consideration of" inside the same string don't
// count as new resolutions.
const RULE_RESOLUTION_PREFIX = /^Providing for consideration\b/i;

// Bill citations as they appear inside rule resolution titles. The
// alternation is ordered longest-first so the regex doesn't bail on a
// shorter prefix (e.g. matching "S." inside "S.J. Res."). Whitespace
// inside the abbreviation is permissive — Congress.gov inconsistently
// emits "H. Res." vs "H.Res." vs "H.R." vs "H. R.".
const BILL_CITATION_PATTERN =
  /\b(H\.\s*Con\.\s*Res\.|S\.\s*Con\.\s*Res\.|H\.\s*J\.\s*Res\.|S\.\s*J\.\s*Res\.|H\.\s*Res\.|S\.\s*Res\.|H\.\s*R\.|S\.)\s*(\d+)/gi;

function normalizeCitation(prefix: string, number: string): string {
  // Strip whitespace from inside the abbreviation, preserve the dots,
  // then re-emit with a single space before the number.
  return `${prefix.replace(/\s+/g, "")} ${number}`;
}

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

/**
 * Truncate at a word boundary so a synthesized headline still ends on a
 * complete word with an ellipsis. Mirrors the truncation in
 * extractHeadlineFromSummary.
 */
function truncateToHeadlineMax(s: string): string {
  if (s.length <= HEADLINE_MAX) return s;
  const truncated = s.slice(0, HEADLINE_MAX);
  const lastSpace = truncated.lastIndexOf(" ");
  const cut = lastSpace > 40 ? lastSpace : HEADLINE_MAX;
  return truncated.slice(0, cut).replace(/[,;:]\s*$/, "") + "…";
}

/**
 * Synthesize a compact headline for a House Rules Committee "rule"
 * resolution — the kind that begins "Providing for consideration of the
 * bill (H.R. X) to amend…; providing for consideration of the resolution
 * (H. Res. Y) expressing…; ...". These titles can run 600+ words because
 * they enumerate every bill the rule covers, with full descriptions
 * inline.
 *
 * Extracts the underlying bill citations and renders "Rule for H.R. X +
 * N more". Returns null when the title doesn't open with the rule
 * prefix or when no citations parse out (a defensive guard — if the
 * regex misses, fall back to whatever the next tier produces rather
 * than emitting "Rule for ").
 */
export function synthesizeRuleHeadline(title: string): string | null {
  if (!RULE_RESOLUTION_PREFIX.test(title)) return null;

  const matches = [...title.matchAll(BILL_CITATION_PATTERN)];
  if (matches.length === 0) return null;

  // Dedupe — a rule could in theory cite the same bill twice via the
  // "providing for consideration of" + "to amend" repetition. Preserve
  // first-occurrence order so the first-cited bill anchors the headline.
  const seen = new Set<string>();
  const citations: string[] = [];
  for (const m of matches) {
    const cite = normalizeCitation(m[1], m[2]);
    if (seen.has(cite)) continue;
    seen.add(cite);
    citations.push(cite);
  }

  if (citations.length === 1) return `Rule for ${citations[0]}`;
  if (citations.length === 2)
    return `Rule for ${citations[0]} and ${citations[1]}`;
  if (citations.length === 3)
    return `Rule for ${citations[0]}, ${citations[1]}, and ${citations[2]}`;
  return `Rule for ${citations[0]}, ${citations[1]}, ${citations[2]} + ${citations.length - 3} more`;
}

/**
 * For amendment-style titles ("To amend X to extend Y through DATE, and
 * for other purposes."), the substantive change is the second half. The
 * citation row already conveys "this is an amendment", so dropping the
 * "amend X to" framing yields a scannable headline like "Extend Y through
 * DATE." Returns null if the title doesn't match the pattern, the action
 * is too short to be informative, or the action begins with another
 * "amend" (which would just nest more procedural language).
 */
export function synthesizeAmendmentHeadline(title: string): string | null {
  const match = title.match(AMEND_TO_ACTION_PATTERN);
  if (!match) return null;
  const action = match[1].trim().replace(FOR_OTHER_PURPOSES_TAIL, "").trim();
  if (action.length < 8) return null;
  if (/^amend\b/i.test(action)) return null;
  const capitalized = action[0].toUpperCase() + action.slice(1);
  return truncateToHeadlineMax(capitalized);
}

type HeadlineInput = Pick<
  BillSummary,
  "title" | "popularTitle" | "shortTitle" | "displayTitle" | "shortText"
> & {
  /** Plain-language AI explainer paragraph. Used as a 4th-tier headline
   *  source when CRS hasn't published a summary yet. */
  aiShortDescription?: string | null;
};

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

  if (isProceduralTitle(bill.title)) {
    // Rule resolutions ("Providing for consideration of the bill (H.R.
    // X)…") get a deterministic synth ahead of the summary tier — CRS
    // doesn't summarize rules, and even when it does the summary is also
    // procedural. "Rule for H.R. X + N more" is shorter and more
    // scannable than any natural-language alternative.
    const fromRule = synthesizeRuleHeadline(bill.title);
    if (fromRule) {
      return {
        headline: fromRule,
        secondary: null,
        officialTitle: bill.title,
      };
    }
    if (bill.shortText) {
      const fromSummary = extractHeadlineFromSummary(bill.shortText);
      if (fromSummary) {
        return {
          headline: fromSummary,
          secondary: null,
          officialTitle: bill.title,
        };
      }
    }
    // CRS often hasn't published a summary yet for fresh-passed bills.
    // Fall back to the AI explainer so the page still gets a real
    // headline instead of "To amend the FISA Amendments Act of 2008…".
    if (bill.aiShortDescription) {
      const fromAi = extractHeadlineFromSummary(bill.aiShortDescription);
      if (fromAi) {
        return {
          headline: fromAi,
          secondary: null,
          officialTitle: bill.title,
        };
      }
    }
    // Last resort before falling back to the procedural title: synthesize
    // from the title structure. Catches bills with no AI/CRS coverage.
    const synthesized = synthesizeAmendmentHeadline(bill.title);
    if (synthesized) {
      return {
        headline: synthesized,
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

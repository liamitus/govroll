/**
 * Detect when a user is asking about a specific representative's vote so the
 * chat UI can promote that rep's contact card and the chat route can inject
 * a verified vote fact into the system prompt.
 *
 * Deliberately permissive: false positives only cost an extra contact card
 * (which is benign), false negatives mean the user gets the generic AI
 * response without contact affordances. We bias toward recall.
 */

export interface RepCandidate {
  bioguideId: string;
  firstName: string;
  lastName: string;
}

export interface RepMentionMatch {
  bioguideId: string;
  /** "why" intent triggered the match (vs. a bare name mention). Used by the
   *  prompt to add a rationale-specific instruction. */
  isWhyIntent: boolean;
}

const WHY_PATTERNS = [
  /\bwhy\s+(?:did|does|would|has|is)\b/i,
  /\b(?:explain|reason(?:ing)?|rationale|justif(?:y|ication))\b/i,
  /\bvoted?\s+(?:nay|no|aye|yea|yes|against|for)\b/i,
];

/**
 * Exported so the chat route's verified-vote resolver and the user-message
 * demand-signal logger can share the same definition — keeping the client
 * detector and server analytics in lockstep.
 */
export function hasWhyIntent(message: string): boolean {
  return WHY_PATTERNS.some((re) => re.test(message));
}

/**
 * Find the rep most likely being asked about. Strategy:
 *  - Match on last name (case-insensitive, word-boundary) — covers "AOC",
 *    "Sanders", "McConnell".
 *  - Fall back to first-name match for short distinctive first names
 *    (Bernie, Mitch, Alexandria) only if no last-name hit, since common
 *    first names ("John", "Mike") would over-match.
 *  - If multiple last-name hits, prefer the one closest to a "why/voted"
 *    keyword in the message.
 */
export function detectRepMention(
  message: string,
  candidates: RepCandidate[],
): RepMentionMatch | null {
  if (!message.trim() || candidates.length === 0) return null;

  const why = hasWhyIntent(message);

  const hits: Array<{ rep: RepCandidate; index: number }> = [];
  for (const rep of candidates) {
    const last = rep.lastName.trim();
    if (!last) continue;
    const re = new RegExp(`\\b${escapeRegex(last)}\\b`, "i");
    const match = message.match(re);
    if (match && match.index != null) {
      hits.push({ rep, index: match.index });
    }
  }

  if (hits.length === 0) {
    // Permissive AOC-style nickname pass — only if no last name matched.
    const aocLike = /\bAOC\b/.test(message);
    if (aocLike) {
      const aoc = candidates.find(
        (c) =>
          c.firstName.toLowerCase().startsWith("alex") &&
          c.lastName.toLowerCase().includes("ocasio"),
      );
      if (aoc) return { bioguideId: aoc.bioguideId, isWhyIntent: why };
    }
    return null;
  }

  if (hits.length === 1) {
    return { bioguideId: hits[0].rep.bioguideId, isWhyIntent: why };
  }

  // Multi-hit tiebreak: keep the first occurrence so "AOC voted no but
  // Pelosi voted yes — why?" promotes AOC. Most natural English questions
  // put the subject of "why" first.
  hits.sort((a, b) => a.index - b.index);
  return { bioguideId: hits[0].rep.bioguideId, isWhyIntent: why };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Query expansion for representative search.
 *
 * Two transformations are applied:
 *
 *   1. **Nicknames** — common American given-name diminutives that map to
 *      one or more canonical first names. "Bernie" → ["Bernard"], "Pat"
 *      → ["Patrick", "Patricia"]. Applied to every whitespace-delimited
 *      token of the query so "Bernie Sanders" expands to both
 *      "bernie sanders" and "bernard sanders".
 *
 *   2. **Acronyms / nicknames-as-handle** — initialisms and informal
 *      handles for specific legislators that aren't compositional
 *      ("AOC" → "Alexandria Ocasio-Cortez"). Applied only when the entire
 *      query is a single token matching the table.
 *
 * Both maps live in code rather than the DB. The set is small, slow-moving
 * (national-figure shorthand changes on the order of years), and
 * additions cost nothing — keeping it inline avoids a migration and a
 * data-entry workflow for what amounts to ~30 entries.
 *
 * If the maintenance burden ever crosses ~100 entries or starts churning,
 * this should graduate to a `RepresentativeAlias` table seeded from a
 * data file. Until then, this is the right shape.
 */

const NICKNAMES: Record<string, string[]> = {
  bernie: ["bernard"],
  bill: ["william"],
  billy: ["william"],
  bob: ["robert"],
  bobby: ["robert"],
  charlie: ["charles"],
  chuck: ["charles"],
  dick: ["richard"],
  ed: ["edward", "edmund"],
  eddie: ["edward"],
  frank: ["francis", "franklin"],
  fred: ["frederick", "alfred"],
  jack: ["john"],
  jerry: ["gerald", "jerome"],
  jim: ["james"],
  jimmy: ["james"],
  joe: ["joseph"],
  kate: ["katherine", "kathleen"],
  liz: ["elizabeth"],
  meg: ["margaret"],
  mike: ["michael"],
  mitch: ["mitchell"],
  nan: ["nancy"],
  nick: ["nicholas"],
  pat: ["patrick", "patricia"],
  peggy: ["margaret"],
  pete: ["peter"],
  rich: ["richard"],
  rick: ["richard"],
  ron: ["ronald"],
  steve: ["steven", "stephen"],
  sue: ["susan", "suzanne"],
  ted: ["theodore", "edward"],
  tim: ["timothy"],
  tom: ["thomas"],
  tony: ["anthony"],
  will: ["william"],
};

const ACRONYMS: Record<string, string> = {
  aoc: "Alexandria Ocasio-Cortez",
};

// Cap the cartesian-product size so a pathological query like "Pat Pat Pat"
// (3 tokens with 2 expansions each = 8 variants) doesn't grow unbounded.
// Real civic queries are 1–2 tokens; 8 variants is well past anything sane.
const MAX_VARIANTS = 8;

/**
 * Expand a search query into all reasonable forms to try. Always includes
 * the original query as the first variant. Lowercased internally because
 * search downstream is case-insensitive (ILIKE).
 *
 * Examples:
 *   "Schumer"        → ["schumer"]
 *   "Bernie Sanders" → ["bernie sanders", "bernard sanders"]
 *   "Pat"            → ["pat", "patrick", "patricia"]
 *   "AOC"            → ["aoc", "alexandria ocasio-cortez"]
 */
export function expandQueryVariants(query: string): string[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [];

  // Single-token acronym path. Acronym match shouldn't gate the nickname
  // path — "ed" is both a nickname and conceivably an acronym — but in
  // practice acronyms are sparse and unique, so checking first is fine.
  const variants = new Set<string>([trimmed]);
  const acronymExpansion = ACRONYMS[trimmed];
  if (acronymExpansion) variants.add(acronymExpansion.toLowerCase());

  // Per-token nickname expansion, then cartesian product.
  const tokens = trimmed.split(/\s+/);
  const tokenForms: string[][] = tokens.map((t) => {
    const expansions = NICKNAMES[t];
    return expansions ? [t, ...expansions] : [t];
  });

  // Bail on the cartesian build entirely if every token is unique — saves
  // the recursion when the only variant is the original query.
  const cartesianSize = tokenForms.reduce((n, f) => n * f.length, 1);
  if (cartesianSize > 1) {
    const built: string[] = [];
    buildCartesian(tokenForms, 0, [], built, MAX_VARIANTS);
    for (const v of built) variants.add(v);
  }

  return Array.from(variants);
}

function buildCartesian(
  forms: string[][],
  idx: number,
  current: string[],
  out: string[],
  max: number,
): void {
  if (out.length >= max) return;
  if (idx === forms.length) {
    out.push(current.join(" "));
    return;
  }
  for (const variant of forms[idx]) {
    if (out.length >= max) return;
    buildCartesian(forms, idx + 1, [...current, variant], out, max);
  }
}

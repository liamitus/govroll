/**
 * Bill XML parser — extracts structured sections from congress.gov bill XML.
 *
 * Design: the old parser kept a hardcoded whitelist of tags to recurse into
 * and dropped everything else. That silently lost <quoted-block> content —
 * the inserted text of amendments, which is the substantive change in most
 * amendment bills. This version traverses <quoted-block> transparently,
 * captures the USLM textual tags (text, continuation-text), and falls
 * through to "recurse if it has structural children; capture if it has
 * text" for any future tag we haven't taught it about.
 *
 * <after-quoted-block> is handled specially — see the note where it's
 * consumed below.
 */

const STRUCTURAL_TAGS = new Set([
  "legis-body",
  "division",
  "title",
  "subtitle",
  "part",
  "subpart",
  "chapter",
  "subchapter",
  "section",
  "subsection",
  "paragraph",
  "subparagraph",
  "clause",
  "subclause",
  "item",
  "subitem",
  // <quoted-block> wraps text a bill inserts into existing law. It has no
  // own enum/header, so we traverse it transparently — children surface with
  // the outer bill's path.
  "quoted-block",
]);

// Tags whose content is a block of bill text that should be captured
// verbatim, without introducing a new heading level.
const TEXTUAL_TAGS = new Set(["text", "continuation-text"]);

// <after-quoted-block> holds the trailing connective that closes an
// amendment's quoted insertion — usually `.`, `;`, or `; and`. It sits
// at the SAME path as the outer section that's doing the amending (the
// <quoted-block> itself is a pass-through with no heading), so emitting
// it as its own chunk would surface as a duplicate section header in
// the re-parse stage. We attach it to the last chunk emitted from the
// quoted block instead, which is where the connective actually reads
// in the rendered bill.
const AFTER_QUOTED_TAG = "after-quoted-block";

// Tags ignored inside a legis-body subtree — either handled separately
// (enum/header via extractHeading) or structurally irrelevant.
const SKIP_TAGS = new Set(["enum", "header", "toc", "toc-entry", "sidenote"]);

export interface ParsedChunk {
  path: string[];
  content: string;
}

export const BillXmlParser = { extractSections };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function extractSections(xmlObj: any): Promise<ParsedChunk[]> {
  let chunks: ParsedChunk[] = [];
  if (xmlObj.bill) chunks = parseBillOrResolution(xmlObj.bill);
  else if (xmlObj.resolution) chunks = parseBillOrResolution(xmlObj.resolution);
  else return [];
  return coalesceSamePathChunks(chunks);
}

/**
 * Collapse any chunks that land at the same path into the first such
 * chunk. <quoted-block> is a header-less pass-through, so its child
 * <after-quoted-block> (typically just the closing "." of the outer
 * amending sentence) would otherwise emit a second chunk at the outer
 * section's path — re-rendering downstream as a duplicate heading
 * with near-empty body. Collapsing here keeps one heading per path.
 */
function coalesceSamePathChunks(chunks: ParsedChunk[]): ParsedChunk[] {
  const firstIdxByKey = new Map<string, number>();
  const out: ParsedChunk[] = [];
  for (const chunk of chunks) {
    const key = chunk.path.join("\u0000");
    const existingIdx = firstIdxByKey.get(key);
    if (existingIdx !== undefined) {
      const existing = out[existingIdx];
      existing.content = mergeContent(existing.content, chunk.content);
      continue;
    }
    firstIdxByKey.set(key, out.length);
    out.push(chunk);
  }
  return out;
}

function mergeContent(existing: string, addition: string): string {
  const trimmed = addition.trim();
  if (!trimmed) return existing;
  // Pure punctuation continuations (the after-quoted-block "." case):
  // if the existing chunk already terminates cleanly, drop the
  // redundant punctuation; otherwise append without a preceding space.
  if (/^[.,;:!?]+$/.test(trimmed)) {
    if (/[.;:!?]$/.test(existing)) return existing;
    return existing + trimmed;
  }
  return tidyContent(existing + " " + trimmed);
}

function parseBillOrResolution(topNode: any): ParsedChunk[] {
  if (!Array.isArray(topNode.$$)) return [];
  const bodies = topNode.$$.filter((c: any) => c["#name"] === "legis-body");
  const results: ParsedChunk[] = [];
  for (const body of bodies) {
    results.push(...parseContainer(body, []));
  }
  return results;
}

function parseContainer(node: any, path: string[]): ParsedChunk[] {
  const results: ParsedChunk[] = [];
  const { enumVal, headerVal } = extractHeading(node);
  const localHeading = buildContainerHeading(node["#name"], enumVal, headerVal);
  // <quoted-block> has no enum/header of its own — don't introduce an empty
  // path segment; just pass the parent path through.
  const newPath = localHeading ? [...path, localHeading] : [...path];

  if (node.$$) {
    for (const child of node.$$) {
      const name = child["#name"];
      if (!name || SKIP_TAGS.has(name)) continue;

      if (STRUCTURAL_TAGS.has(name)) {
        results.push(...parseContainer(child, newPath));
      } else if (name === AFTER_QUOTED_TAG) {
        const text = parseTextNode(child);
        if (!text) continue;
        // Merge the trailing connective into the most recent chunk so
        // the re-parse doesn't see a second top-level section at the
        // outer path. If the quoted block emitted nothing (shouldn't
        // happen in well-formed bills), drop it — a lone `.` or `;`
        // at the outer path is never information we'd render usefully.
        const last = results[results.length - 1];
        if (!last) continue;
        const trimmedText = text.trim();
        const trimmedLast = last.content.trimEnd();
        // The quoted text usually already ends in the same punctuation
        // that after-quoted-block carries (e.g. a sentence `.` inside
        // the quote, plus the outer `.` that closes the amending
        // sentence). Emitting both is cosmetically noisy and rarely
        // meaningful — drop the redundant copy.
        if (
          /^[.,;:!?]$/.test(trimmedText) &&
          trimmedLast.endsWith(trimmedText)
        ) {
          continue;
        }
        last.content = tidyContent(`${trimmedLast} ${trimmedText}`);
      } else if (TEXTUAL_TAGS.has(name)) {
        const text = parseTextNode(child);
        if (text) results.push({ path: newPath, content: text });
      } else if (hasStructuralChildren(child)) {
        // Unknown tag with children — traverse transparently rather than
        // silently dropping. Missing a future USLM container is fail-open.
        results.push(...parseContainer(child, newPath));
      } else {
        // Unknown leaf — capture any text it holds.
        const text = parseTextNode(child);
        if (text) results.push({ path: newPath, content: text });
      }
    }
  }

  if (typeof node._ === "string") {
    const directText = tidyContent(node._);
    if (directText) results.push({ path: newPath, content: directText });
  }

  return results;
}

function hasStructuralChildren(node: any): boolean {
  if (!Array.isArray(node.$$)) return false;
  return node.$$.some(
    (c: any) => STRUCTURAL_TAGS.has(c["#name"]) || TEXTUAL_TAGS.has(c["#name"]),
  );
}

function extractHeading(node: any) {
  let enumVal = "";
  let headerVal = "";
  if (!Array.isArray(node.$$)) return { enumVal, headerVal };

  const eChild = node.$$.find((ch: any) => ch["#name"] === "enum");
  if (eChild && typeof eChild._ === "string") enumVal = eChild._.trim();

  const hChild = node.$$.find((ch: any) => ch["#name"] === "header");
  if (hChild) headerVal = parseNodeInReadingOrder(hChild);

  return { enumVal, headerVal };
}

function buildContainerHeading(
  nodeName: string,
  enumVal: string,
  headerVal: string,
): string {
  enumVal = enumVal.trim();
  headerVal = headerVal.trim();
  if (!enumVal && !headerVal) return "";

  if (nodeName === "division") {
    if (enumVal && headerVal)
      return tidyContent(`Division ${enumVal} ${headerVal}`);
    if (enumVal) return `Division ${enumVal}`;
    return tidyContent(`Division: ${headerVal}`);
  }

  if (nodeName === "section") {
    const cleanedEnum = enumVal.replace(/\.$/, "");
    if (cleanedEnum && headerVal)
      return tidyContent(`Section ${cleanedEnum}. ${headerVal}`);
    if (cleanedEnum) return tidyContent(`Section ${cleanedEnum}`);
    return tidyContent(`Section ${headerVal}`);
  }

  if (
    nodeName === "subsection" ||
    nodeName === "paragraph" ||
    nodeName === "subparagraph" ||
    nodeName === "clause" ||
    nodeName === "subclause" ||
    nodeName === "item" ||
    nodeName === "subitem"
  ) {
    if (enumVal && headerVal) return tidyContent(`${enumVal} ${headerVal}`);
    return tidyContent(enumVal || headerVal);
  }

  if (enumVal && headerVal) return tidyContent(`${enumVal} ${headerVal}`);
  return tidyContent(enumVal || headerVal);
}

function parseNodeInReadingOrder(node: any): string {
  if (!node.$$) return typeof node._ === "string" ? tidyContent(node._) : "";
  let out = "";
  for (const child of node.$$) {
    const name = child["#name"];
    if (name === "_") out += child._ || "";
    else out += " " + parseNodeInReadingOrder(child);
  }
  return tidyContent(out);
}

function parseTextNode(node: any): string {
  return tidyContent(parseNodeInReadingOrder(node));
}

function tidyContent(str: string): string {
  return str
    .replace(/\s+([,.;?!])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}
/* eslint-enable @typescript-eslint/no-explicit-any */

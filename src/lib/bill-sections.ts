/**
 * Parses stored bill fullText into structured sections for AI context.
 *
 * Handles two formats:
 * 1. Parsed XML format: "Section 1. Heading\ncontent\n\nSection 2. Heading > (a)\ncontent"
 * 2. Raw HTML fallback: "<html><body><pre>...</pre></body></html>"
 */

export interface BillSection {
  heading: string;
  content: string;
  sectionRef: string;
}

const HEADING_PATTERN = /^(Section|Division|Title|Subtitle|Part|Chapter)\s/i;
const RAW_SECTION_PATTERN = /^(?:SEC(?:TION)?\.?\s+\d+)/im;

/**
 * Parse stored fullText into structured sections.
 */
export function parseSectionsFromFullText(fullText: string): BillSection[] {
  if (!fullText.trim()) return [];

  // Detect raw HTML fallback
  if (
    fullText.trimStart().startsWith("<html") ||
    fullText.trimStart().startsWith("<pre")
  ) {
    return parseHtmlFallback(fullText);
  }

  return parseParsedFormat(fullText);
}

/**
 * Build a compact table of contents from sections (headings only).
 * Used for the two-step large-bill approach.
 */
export function buildSectionIndex(sections: BillSection[]): string {
  return sections.map((s) => `- ${s.sectionRef}: ${s.heading}`).join("\n");
}

/**
 * Filter sections by reference strings (case-insensitive partial match).
 */
export function filterSections(
  sections: BillSection[],
  refs: string[],
): BillSection[] {
  const lowerRefs = refs.map((r) => r.toLowerCase());
  return sections.filter((s) =>
    lowerRefs.some(
      (ref) =>
        s.sectionRef.toLowerCase().includes(ref) ||
        s.heading.toLowerCase().includes(ref),
    ),
  );
}

/**
 * Parse the clean format produced by the XML parser:
 * "Section 1. Short title\nContent here\n\nSection 2. Defs > (a) In general\nMore content"
 */
function parseParsedFormat(fullText: string): BillSection[] {
  const blocks = fullText.split(/\n\n+/);
  const sections: BillSection[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split("\n");
    const firstLine = lines[0].trim();

    // Check if the first line is a heading (contains > path separator or matches heading pattern)
    const isHeading =
      firstLine.includes(" > ") || HEADING_PATTERN.test(firstLine);

    if (isHeading) {
      const heading = firstLine;
      const content = lines.slice(1).join("\n").trim();
      // Drop degenerate blocks whose "body" is just trailing punctuation.
      // These came from the pre-fix XML parser emitting <after-quoted-block>
      // at the outer section's path — the fix is in bill-xml-parser.ts, but
      // fullText stored before the fix still looks like this on re-parse.
      if (/^[.,;:!?\s]+$/.test(content)) continue;
      const sectionRef = extractSectionRef(heading);
      sections.push({ heading, content, sectionRef });
    } else if (sections.length > 0) {
      // Continuation of previous section
      sections[sections.length - 1].content += "\n\n" + trimmed;
    } else {
      // Orphan text before any heading
      sections.push({
        heading: "Preamble",
        content: trimmed,
        sectionRef: "Preamble",
      });
    }
  }

  return sections;
}

/**
 * Parse raw HTML/pre-formatted text from congress.gov.
 * Strips tags, then attempts to detect SEC./SECTION patterns.
 */
function parseHtmlFallback(html: string): BillSection[] {
  // Decode entities first so encoded angle brackets become real ones,
  // then strip tags — otherwise things like &lt;DOC&gt; survive as literal <DOC>.
  let text = html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/``/g, '"')
    .replace(/''/g, '"');

  // Normalize whitespace within lines but preserve line breaks
  text = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");

  // Try to split on SEC. or SECTION patterns
  const sectionSplits = text.split(/(?=\nSEC(?:TION)?\.?\s+\d+)/i);

  if (sectionSplits.length > 1) {
    const sections: BillSection[] = [];
    for (const chunk of sectionSplits) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;

      const match = trimmed.match(RAW_SECTION_PATTERN);
      if (match) {
        // Extract the section header line
        const firstNewline = trimmed.indexOf("\n");
        const headerLine =
          firstNewline > -1 ? trimmed.slice(0, firstNewline).trim() : trimmed;
        const content =
          firstNewline > -1 ? trimmed.slice(firstNewline + 1).trim() : "";
        const sectionRef = extractSectionRef(headerLine);
        sections.push({
          heading: headerLine,
          content,
          sectionRef,
        });
      } else {
        // Preamble or non-section text
        sections.push({
          heading: "Preamble",
          content: trimmed,
          sectionRef: "Preamble",
        });
      }
    }
    return sections;
  }

  // Can't detect sections — return as single block
  return [
    {
      heading: "Full Text",
      content: text.trim(),
      sectionRef: "Full Text",
    },
  ];
}

/**
 * Extract a short section reference from a heading string.
 * "Section 2. Definitions > (a) In general" → "Section 2(a)"
 * "Division A Title I" → "Division A, Title I"
 */
function extractSectionRef(heading: string): string {
  // Handle path-style headings: "Section 2. Foo > (a) Bar > (1) Baz"
  if (heading.includes(" > ")) {
    const parts = heading.split(" > ");
    const base = parts[0].trim();
    // Extract enum labels from child parts: "(a)", "(1)", etc.
    const enums = parts
      .slice(1)
      .map((p) => {
        const match = p.match(/^\(([^)]+)\)/);
        return match ? `(${match[1]})` : "";
      })
      .filter(Boolean);

    // Clean the base: "Section 2. Definitions" → "Section 2"
    const baseRef = base.replace(/\.\s+.*$/, "");
    return enums.length > 0 ? `${baseRef}${enums.join("")}` : baseRef;
  }

  // Handle flat headings: "Section 1. Short title" → "Section 1"
  const match = heading.match(
    /^(Section|Division|Title|Subtitle|Part|Chapter)\s+(\S+)/i,
  );
  if (match) return `${match[1]} ${match[2].replace(/\.$/, "")}`;

  // Handle raw format: "SEC. 2. ENSURING ONLY CITIZENS..." → "Section 2"
  const secMatch = heading.match(/^SEC(?:TION)?\.?\s+(\d+)/i);
  if (secMatch) return `Section ${secMatch[1]}`;

  return heading.slice(0, 40);
}

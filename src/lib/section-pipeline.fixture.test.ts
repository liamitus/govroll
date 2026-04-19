/**
 * End-to-end round-trip tests against a real bill fixture and several
 * synthetic edge-case XMLs. The goal is to catch regressions where
 * the parser → fullText → re-parse → slug → matchSectionBySlug
 * pipeline silently drops or mangles content for shapes nobody
 * explicitly tested.
 *
 * Pipeline under test:
 *   xml2js → BillXmlParser.extractSections → ParsedChunk[]
 *     → render to fullText (path + content, \n\n separated)
 *     → parseSectionsFromFullText (the prod read path)
 *     → sectionSlugsForBill
 *     → matchSectionBySlug for every slug
 *
 * Failures here are real production bugs, not just unit nits.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStringPromise } from "xml2js";

import { BillXmlParser } from "./bill-xml-parser";
import { parseSectionsFromFullText } from "./bill-sections";
import { sectionSlugsForBill, matchSectionBySlug } from "./section-slug";

async function parseXml(xml: string) {
  const obj = await parseStringPromise(xml, {
    preserveChildrenOrder: true,
    explicitChildren: true,
    charsAsChildren: true,
    trim: true,
    includeWhiteChars: false,
  });
  return BillXmlParser.extractSections(obj);
}

function renderToFullText(
  chunks: Array<{ path: string[]; content: string }>,
): string {
  return chunks
    .map((c) => {
      const heading = c.path.length > 0 ? c.path.join(" > ") + "\n" : "";
      return heading + c.content;
    })
    .join("\n\n");
}

function fixture(name: string): string {
  return readFileSync(
    resolve(__dirname, "..", "..", "tests", "fixtures", name),
    "utf8",
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Real-bill round-trip — s1884 HEAR Act
// ─────────────────────────────────────────────────────────────────────────

describe("Pipeline round-trip — s1884 HEAR Act fixture", () => {
  it("every parsed section round-trips through slug → match", async () => {
    const chunks = await parseXml(fixture("s1884-hear-act.xml"));
    const fullText = renderToFullText(chunks);
    const parsed = parseSectionsFromFullText(fullText);

    expect(parsed.length).toBeGreaterThan(0);

    const slugs = sectionSlugsForBill(parsed);
    expect(slugs).toHaveLength(parsed.length);

    // Every slug must be unique (collision dedup applied).
    expect(new Set(slugs).size).toBe(slugs.length);

    // Every slug must round-trip back to its source section.
    for (let i = 0; i < parsed.length; i++) {
      const m = matchSectionBySlug(parsed, slugs[i]);
      expect(m, `slug "${slugs[i]}" should match section ${i}`).not.toBeNull();
      expect(m?.index).toBe(i);
    }
  });

  it("every slug is URL-safe (alphanumerics + dash only)", async () => {
    const chunks = await parseXml(fixture("s1884-hear-act.xml"));
    const fullText = renderToFullText(chunks);
    const parsed = parseSectionsFromFullText(fullText);
    const slugs = sectionSlugsForBill(parsed);

    for (const slug of slugs) {
      expect(slug, `slug "${slug}" should be URL-safe`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("section count is non-trivial (parser is actually working)", async () => {
    const chunks = await parseXml(fixture("s1884-hear-act.xml"));
    const fullText = renderToFullText(chunks);
    const parsed = parseSectionsFromFullText(fullText);
    // S.1884 has multiple amendments + a severability clause; expect
    // many sections. Loose floor catches "parser silently broke".
    expect(parsed.length).toBeGreaterThan(3);
  });

  it("all parsed content survives the round-trip — total char count is preserved within tolerance", async () => {
    const chunks = await parseXml(fixture("s1884-hear-act.xml"));
    const originalChars = chunks.reduce(
      (sum, c) => sum + c.path.join(" > ").length + c.content.length,
      0,
    );

    const fullText = renderToFullText(chunks);
    const parsed = parseSectionsFromFullText(fullText);
    const reparsedChars = parsed.reduce(
      (sum, s) => sum + s.heading.length + s.content.length,
      0,
    );

    // Allow a small loss to whitespace normalization in tidyContent +
    // continuation handling. Anything above ~5% loss would be a real
    // regression.
    const loss = (originalChars - reparsedChars) / originalChars;
    expect(loss).toBeLessThan(0.05);
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Synthetic edge cases — inline XML, no fixture files
// ─────────────────────────────────────────────────────────────────────────

describe("Pipeline edge cases — synthetic XML", () => {
  it("handles a single-section bill (minimal viable XML)", async () => {
    const xml = `<?xml version="1.0"?>
<bill>
  <legis-body>
    <section>
      <enum>1.</enum>
      <header>Short title</header>
      <text>This Act may be cited as the Tiny Act of 2026.</text>
    </section>
  </legis-body>
</bill>`;
    const chunks = await parseXml(xml);
    const fullText = renderToFullText(chunks);
    const parsed = parseSectionsFromFullText(fullText);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].heading).toContain("Section 1");

    const slugs = sectionSlugsForBill(parsed);
    expect(slugs).toEqual(["sec-1-short-title"]);

    const match = matchSectionBySlug(parsed, "sec-1-short-title");
    expect(match?.index).toBe(0);
  });

  it("handles deeply nested structure (Title → Subtitle → Section → (a) → (1) → (A))", async () => {
    const xml = `<?xml version="1.0"?>
<bill>
  <legis-body>
    <title>
      <enum>I</enum>
      <header>Reform</header>
      <subtitle>
        <enum>A</enum>
        <header>Fiscal</header>
        <section>
          <enum>1701.</enum>
          <header>Funding</header>
          <subsection>
            <enum>(a)</enum>
            <header>In general</header>
            <paragraph>
              <enum>(1)</enum>
              <header>Eligible</header>
              <subparagraph>
                <enum>(A)</enum>
                <header>Definition</header>
                <text>Eligible person means an individual who...</text>
              </subparagraph>
            </paragraph>
          </subsection>
        </section>
      </subtitle>
    </title>
  </legis-body>
</bill>`;
    const chunks = await parseXml(xml);
    const fullText = renderToFullText(chunks);
    const parsed = parseSectionsFromFullText(fullText);

    expect(parsed.length).toBeGreaterThan(0);
    const deepest = parsed[parsed.length - 1];
    // Heading should reflect the full ancestor path.
    expect(deepest.heading.split(" > ").length).toBeGreaterThanOrEqual(4);

    const slugs = sectionSlugsForBill(parsed);
    // Every slug must be unique.
    expect(new Set(slugs).size).toBe(slugs.length);

    // Round-trip each.
    for (let i = 0; i < parsed.length; i++) {
      const m = matchSectionBySlug(parsed, slugs[i]);
      expect(m?.index).toBe(i);
    }
  });

  it("handles duplicate section paths across divisions (omnibus shape)", async () => {
    const xml = `<?xml version="1.0"?>
<bill>
  <legis-body>
    <division>
      <enum>A</enum>
      <header>Energy</header>
      <section>
        <enum>1.</enum>
        <header>Findings</header>
        <text>Congress finds the following.</text>
      </section>
    </division>
    <division>
      <enum>B</enum>
      <header>Defense</header>
      <section>
        <enum>1.</enum>
        <header>Findings</header>
        <text>Congress finds the following.</text>
      </section>
    </division>
  </legis-body>
</bill>`;
    const chunks = await parseXml(xml);
    const fullText = renderToFullText(chunks);
    const parsed = parseSectionsFromFullText(fullText);
    const slugs = sectionSlugsForBill(parsed);

    // Different divisions, so paths differ at the top level — no
    // collision should occur. Both should slug uniquely.
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs[0]).toMatch(/^div-a-energy/);
    expect(slugs[1]).toMatch(/^div-b-defense/);
  });

  it("handles two sections with literally identical paths (parser pathology)", async () => {
    // Contrived: same enum + header twice in same parent. Not normal
    // legislation but the parser must not crash, and slugs must
    // disambiguate.
    const xml = `<?xml version="1.0"?>
<bill>
  <legis-body>
    <section>
      <enum>1.</enum>
      <header>Findings</header>
      <text>First findings block.</text>
    </section>
    <section>
      <enum>1.</enum>
      <header>Findings</header>
      <text>Second findings block.</text>
    </section>
  </legis-body>
</bill>`;
    const chunks = await parseXml(xml);
    const fullText = renderToFullText(chunks);
    const parsed = parseSectionsFromFullText(fullText);
    const slugs = sectionSlugsForBill(parsed);

    // All slugs unique even with identical headings.
    expect(new Set(slugs).size).toBe(slugs.length);

    // Each slug round-trips to the right section.
    for (let i = 0; i < parsed.length; i++) {
      const m = matchSectionBySlug(parsed, slugs[i]);
      expect(m?.index).toBe(i);
    }
  });

  it("handles unicode characters in section headings", async () => {
    const xml = `<?xml version="1.0"?>
<bill>
  <legis-body>
    <section>
      <enum>1.</enum>
      <header>“Short” title—amended</header>
      <text>Body text with caf\u00e9 and r\u00e9sum\u00e9.</text>
    </section>
  </legis-body>
</bill>`;
    const chunks = await parseXml(xml);
    const fullText = renderToFullText(chunks);
    const parsed = parseSectionsFromFullText(fullText);
    const slugs = sectionSlugsForBill(parsed);

    expect(slugs[0]).toMatch(/^[a-z0-9-]+$/);
    // Body text preserves unicode (the slug strips it; the content keeps it).
    expect(parsed[0].content).toContain("caf");
  });

  it("handles a bill with empty / heading-only sections", async () => {
    const xml = `<?xml version="1.0"?>
<bill>
  <legis-body>
    <section>
      <enum>1.</enum>
      <header>Heading-only</header>
    </section>
    <section>
      <enum>2.</enum>
      <header>With body</header>
      <text>Body content here.</text>
    </section>
  </legis-body>
</bill>`;
    const chunks = await parseXml(xml);
    const fullText = renderToFullText(chunks);
    const parsed = parseSectionsFromFullText(fullText);
    const slugs = sectionSlugsForBill(parsed);

    // The heading-only section may or may not appear in parsed
    // (depends on whether the renderer emits an empty section). If it
    // does, slugs must still all be unique.
    expect(new Set(slugs).size).toBe(slugs.length);
    // The body-bearing section must be present and matchable.
    const m = matchSectionBySlug(parsed, "sec-2-with-body");
    expect(m).not.toBeNull();
  });

  it("returns empty array gracefully for an empty bill body", async () => {
    const xml = `<?xml version="1.0"?><bill><legis-body></legis-body></bill>`;
    const chunks = await parseXml(xml);
    expect(chunks).toEqual([]);
    const parsed = parseSectionsFromFullText(renderToFullText(chunks));
    expect(parsed).toEqual([]);
    expect(sectionSlugsForBill(parsed)).toEqual([]);
    expect(matchSectionBySlug(parsed, "any-slug")).toBeNull();
  });

  it("handles a joint resolution (top-level <resolution> wrapper)", async () => {
    const xml = `<?xml version="1.0"?>
<resolution>
  <legis-body>
    <section>
      <enum>1.</enum>
      <header>Findings</header>
      <text>Congress finds the following.</text>
    </section>
    <section>
      <enum>2.</enum>
      <header>Sense of Congress</header>
      <text>It is the sense of Congress that...</text>
    </section>
  </legis-body>
</resolution>`;
    const chunks = await parseXml(xml);
    const parsed = parseSectionsFromFullText(renderToFullText(chunks));
    const slugs = sectionSlugsForBill(parsed);

    expect(parsed.length).toBe(2);
    expect(slugs).toEqual(["sec-1-findings", "sec-2-sense-of-congress"]);
  });

  it("tolerates whitespace-heavy malformed XML (extra newlines, indentation)", async () => {
    // Real bills sometimes have aggressive whitespace. The parser
    // shouldn't break, and content shouldn't have weird leading/
    // trailing space artifacts.
    const xml = `<?xml version="1.0"?>
<bill>


    <legis-body>


        <section>


            <enum>1.</enum>


            <header>     Padded     header     </header>


            <text>     Body with extra spaces     and    runs    of    whitespace.   </text>


        </section>


    </legis-body>


</bill>`;
    const chunks = await parseXml(xml);
    const parsed = parseSectionsFromFullText(renderToFullText(chunks));
    expect(parsed[0].heading).not.toMatch(/^\s/);
    expect(parsed[0].heading).not.toMatch(/\s$/);
    // Whitespace is normalized — no runs of multiple spaces.
    expect(parsed[0].content).not.toMatch(/ {2}/);
  });

  it("preserves quoted-block content (regression: amendment-heavy bills)", async () => {
    // The same regression covered by bill-xml-parser.test.ts but
    // verified through the full pipeline (parse → render → reparse →
    // slug → match).
    const xml = `<?xml version="1.0"?>
<bill>
  <legis-body>
    <section>
      <enum>2.</enum>
      <header>Amendment</header>
      <subsection>
        <enum>(a)</enum>
        <header>In general</header>
        <text>Section X is amended by adding the following:</text>
        <quoted-block>
          <text>This new language must survive the round-trip.</text>
        </quoted-block>
      </subsection>
    </section>
  </legis-body>
</bill>`;
    const chunks = await parseXml(xml);
    const parsed = parseSectionsFromFullText(renderToFullText(chunks));
    const allText = parsed.map((p) => p.content).join("\n");
    expect(allText).toContain("This new language must survive the round-trip");
  });
});

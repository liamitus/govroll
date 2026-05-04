import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStringPromise } from "xml2js";
import { BillXmlParser } from "./bill-xml-parser";

async function parse(xml: string) {
  const obj = await parseStringPromise(xml, {
    preserveChildrenOrder: true,
    explicitChildren: true,
    charsAsChildren: true,
    trim: true,
    includeWhiteChars: false,
  });
  return BillXmlParser.extractSections(obj);
}

/** Render chunks the way fetch-bill-text.ts persists them (path + content). */
function render(chunks: Array<{ path: string[]; content: string }>): string {
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

describe("BillXmlParser — S.1884 HEAR Act (amendment bill)", () => {
  it("captures text inserted inside quoted-block (regression: #quoted-block)", async () => {
    const chunks = await parse(fixture("s1884-hear-act.xml"));
    const all = render(chunks);

    // Paragraph (8) inserted into the HEAR Act's Section 2
    expect(all).toContain("The intent of this Act is to permit claims");
    expect(all).toContain("Zuckerman v Metropolitan Museum of Art");
    // Paragraph (9) — the nationality/citizenship provision the AI said was missing
    expect(all).toContain(
      "regardless of the nationality or citizenship of the alleged victim",
    );
    // New subsection (b) Relation to foreign state immunities
    expect(all).toContain("Relation to foreign state immunities");
    expect(all).toContain(
      "rights in violation of international law are in issue",
    );
    // New subsection (f) Defenses based on passage of time
    expect(all).toContain(
      "Defenses based on passage of time and other non-Merits defenses",
    );
    // New subsection (g) Nationwide service of process
    expect(all).toContain("Nationwide service of process");
    expect(all).toContain("process may be served in the judicial district");
    // New Section 6 Severability
    expect(all).toContain("Severability");
    expect(all).toContain(
      "If any provision of this Act, or the application of a provision",
    );
  });

  it("preserves inline text around <quote>, <external-xref>, and short-title", async () => {
    const chunks = await parse(fixture("s1884-hear-act.xml"));
    const all = render(chunks);

    // Short title inside a <quote> block
    expect(all).toContain(
      "This Act may be cited as the Holocaust Expropriated Art Recovery Act of 2025",
    );
    // External USC cross-reference rendered inline
    expect(all).toContain("22 U.S.C. 1621");
  });

  it("gives the HEAR Act more content than the pre-fix 3,761-char fingerprint", async () => {
    const chunks = await parse(fixture("s1884-hear-act.xml"));
    // Pre-fix prod DB stored 3,761 chars for all four text versions.
    // Post-fix must capture the inserted amendment text (many more chars).
    expect(render(chunks).length).toBeGreaterThan(6000);
  });

  it("keeps subsection (b) Applicability inside its parent section", async () => {
    const chunks = await parse(fixture("s1884-hear-act.xml"));
    const applicability = chunks.find((c) =>
      c.content.startsWith("The amendments made by subsection (a) shall apply"),
    );
    expect(applicability).toBeDefined();
    // Path should reflect: Section 2 > (b) Applicability
    expect(applicability?.path.join(" > ")).toMatch(
      /Section 2\..*>.*\(b\) Applicability/,
    );
  });
});

describe("BillXmlParser — S.3706 Victims' VOICES Act (after-quoted-block regression)", () => {
  it("does not emit a phantom second Section 2 from <after-quoted-block>", async () => {
    // The enrolled XML contains a Section 2 whose amendment text ends
    // with `<after-quoted-block>.</after-quoted-block>`. Before the
    // fix, that period was emitted as its own chunk at Section 2's
    // path, which re-parsed into a duplicate "Section 2" with content
    // "." — showing up twice in the outline and at the bottom of the
    // reader body.
    const chunks = await parse(fixture("s3706-victims-voices-enr.xml"));

    const topLevelSections = chunks.filter(
      (c) => c.path.length === 1 && /^Section \d+\./.test(c.path[0]),
    );
    const uniqueTopLevelHeadings = new Set(
      topLevelSections.map((c) => c.path[0]),
    );
    // Two distinct top-level sections (§1 Short title, §2 Restitution…)
    // — no duplicates.
    expect(topLevelSections).toHaveLength(uniqueTopLevelHeadings.size);
    expect(uniqueTopLevelHeadings.size).toBe(2);

    // No chunk's content is just trailing punctuation (the stray
    // after-quoted-block period).
    for (const c of chunks) {
      expect(c.content).not.toMatch(/^[.,;:!?]+$/);
    }
  });

  it("still captures the (A) (B) (C) amendment subparagraphs", async () => {
    const chunks = await parse(fixture("s3706-victims-voices-enr.xml"));
    const all = render(chunks);
    expect(all).toContain("lost income, child care");
    expect(all).toContain(
      "transporting the victim for necessary medical and related professional services",
    );
    expect(all).toContain(
      "physical and occupational therapy and rehabilitation",
    );
  });
});

describe("BillXmlParser — unknown container recursion", () => {
  it("recurses into unknown container-level tags that have structural children", async () => {
    // Future-proofing: if Congress adds a new tag we don't know about,
    // don't silently drop its children — recurse if it contains known
    // containers, otherwise capture the text.
    const xml = `<?xml version="1.0"?>
<bill>
  <legis-body>
    <section>
      <enum>1.</enum>
      <header>Example</header>
      <appropriations-major>
        <section>
          <enum>1A.</enum>
          <header>Nested under unknown parent</header>
          <text>This nested text must survive.</text>
        </section>
      </appropriations-major>
    </section>
  </legis-body>
</bill>`;
    const chunks = await parse(xml);
    const all = render(chunks);
    expect(all).toContain("This nested text must survive");
  });

  it("captures text inside unknown leaf tags", async () => {
    // continuation-text is a real USLM tag we didn't handle before.
    const xml = `<?xml version="1.0"?>
<bill>
  <legis-body>
    <section>
      <enum>1.</enum>
      <header>Example</header>
      <text>Opening clause.</text>
      <continuation-text>A closing clause that must not be dropped.</continuation-text>
    </section>
  </legis-body>
</bill>`;
    const chunks = await parse(xml);
    const all = render(chunks);
    expect(all).toContain("Opening clause");
    expect(all).toContain("A closing clause that must not be dropped");
  });
});

describe("BillXmlParser — S.3706 Victims' VOICES Act (after-quoted-block phantom)", () => {
  it("does not emit a phantom chunk for an after-quoted-block containing only closing punctuation", async () => {
    const chunks = await parse(fixture("s3706-victims-voices.xml"));
    // Before the fix, the parser emitted a trailing ParsedChunk at
    // Section 2's path with content just "." — the closing punctuation
    // of the outer amending sentence. That phantom chunk re-rendered
    // as a duplicate "Section 2. Restitution…" heading in the reader.
    for (const chunk of chunks) {
      expect(
        chunk.content.trim(),
        `phantom chunk at ${chunk.path.join(" > ")}`,
      ).not.toMatch(/^[.,;:!?]+$/);
    }
  });

  it("emits exactly one chunk at Section 2's bare path (the lead-in text), not two", async () => {
    const chunks = await parse(fixture("s3706-victims-voices.xml"));
    const section2Bare = chunks.filter(
      (c) =>
        c.path.length === 1 &&
        c.path[0].startsWith("Section 2.") &&
        c.path[0].includes("Restitution"),
    );
    expect(section2Bare).toHaveLength(1);
    // And that one chunk carries the amending sentence lead-in.
    expect(section2Bare[0].content).toContain("Section 3663A(a) of title 18");
  });

  it("preserves inserted amendment content and its (A)/(B)/(C) subparagraphs", async () => {
    const chunks = await parse(fixture("s3706-victims-voices.xml"));
    const all = render(chunks);
    expect(all).toContain("(4) Clarification");
    expect(all).toContain("In ordering restitution under this section");
    expect(all).toContain("lost income, child care, transportation");
    expect(all).toContain(
      "transporting the victim for necessary medical and related professional services",
    );
    expect(all).toContain(
      "to receive necessary physical and occupational therapy and rehabilitation",
    );
  });
});

describe("BillXmlParser — after-quoted-block with substantive continuation text", () => {
  it("attaches substantive after-quoted-block text to the outer section's lead-in, not as a duplicate heading", async () => {
    // Synthetic: after-quoted-block occasionally carries real tail
    // text that continues the outer amending sentence. It must not
    // spawn a second chunk at the outer section's path (which would
    // re-render as a duplicate heading downstream).
    const xml = `<?xml version="1.0"?>
<bill>
  <legis-body>
    <section>
      <enum>2.</enum>
      <header>Amendment</header>
      <text>Section X is amended by adding the following:</text>
      <quoted-block>
        <text>New statutory language.</text>
        <after-quoted-block>; and by striking the second sentence.</after-quoted-block>
      </quoted-block>
    </section>
  </legis-body>
</bill>`;
    const chunks = await parse(xml);
    const section2Bare = chunks.filter(
      (c) => c.path.length === 1 && c.path[0].startsWith("Section 2."),
    );
    // Exactly one chunk at the outer section's bare path — the
    // continuation text should merge into the lead-in, not stand alone.
    expect(section2Bare).toHaveLength(1);
    // The continuation text survives somewhere in the chunk set.
    const all = render(chunks);
    expect(all).toContain("striking the second sentence");
  });
});

describe("BillXmlParser — empty / degenerate input", () => {
  it("returns empty array for a bill with no body", async () => {
    const chunks = await parse(`<?xml version="1.0"?><bill></bill>`);
    expect(chunks).toEqual([]);
  });

  it("handles a resolution (top-level <resolution> wrapper)", async () => {
    const xml = `<?xml version="1.0"?>
<resolution>
  <legis-body>
    <section>
      <enum>1.</enum>
      <header>Findings</header>
      <text>Congress finds the following.</text>
    </section>
  </legis-body>
</resolution>`;
    const chunks = await parse(xml);
    expect(chunks.length).toBeGreaterThan(0);
    expect(render(chunks)).toContain("Congress finds the following");
  });
});

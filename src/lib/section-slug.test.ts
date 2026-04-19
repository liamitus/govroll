import { describe, expect, it } from "vitest";
import {
  matchSectionBySlug,
  parseSlug,
  pathFromHeading,
  sectionSlug,
  sectionSlugFromHeading,
  sectionSlugsForBill,
} from "./section-slug";
import type { BillSection } from "./bill-sections";

function section(heading: string, content = ""): BillSection {
  return { heading, content, sectionRef: heading };
}

describe("sectionSlug", () => {
  it("converts a typical Section heading into a readable slug", () => {
    expect(sectionSlug(["Section 2. Definitions"])).toBe("sec-2-definitions");
  });

  it("joins multi-segment paths with double dash", () => {
    expect(
      sectionSlug([
        "Section 2. Definitions",
        "(a) In general",
        "(1) Eligible person",
      ]),
    ).toBe("sec-2-definitions--a-in-general--1-eligible-person");
  });

  it("handles parenthetical enums by stripping parens", () => {
    expect(sectionSlug(["(a) In general"])).toBe("a-in-general");
    expect(sectionSlug(["(1)"])).toBe("1");
  });

  it("compresses Title/Subtitle/Division prefixes", () => {
    expect(sectionSlug(["Title XVII"])).toBe("title-xvii");
    expect(sectionSlug(["Subtitle B — Fiscal Rules"])).toBe(
      "subt-b-fiscal-rules",
    );
    expect(sectionSlug(["Division A — Energy"])).toBe("div-a-energy");
  });

  it("strips em-dashes and other non-word punctuation", () => {
    expect(sectionSlug(["Title XVII—Reform"])).toBe("title-xvii-reform");
    // Smart quotes
    expect(sectionSlug(["Section 5. \u201cDefined Benefits\u201d"])).toBe(
      "sec-5-defined-benefits",
    );
  });

  it("collapses runs of whitespace into single dashes", () => {
    expect(sectionSlug(["Section   2.    Findings"])).toBe("sec-2-findings");
  });

  it("caps each segment length so URLs stay manageable", () => {
    const long =
      "Section 999. The very long descriptive heading that no real bill would have";
    const result = sectionSlug([long]);
    // First segment must be ≤ 30 chars + slug's "sec-" expansion
    const segments = result.split("--");
    expect(segments[0].length).toBeLessThanOrEqual(30);
  });

  it("returns empty string for empty path", () => {
    expect(sectionSlug([])).toBe("");
  });

  it("filters out segments that would slug to nothing", () => {
    expect(sectionSlug(["—", "Section 1"])).toBe("sec-1");
  });

  it("is round-trip safe (URL-safe characters only)", () => {
    const slug = sectionSlug([
      "Section 5. Short title",
      "(a) Citation",
      "(2) Effective date",
    ]);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("pathFromHeading", () => {
  it("splits a joined heading on ` > `", () => {
    expect(
      pathFromHeading("Section 2. Definitions > (a) In general > (1) Eligible"),
    ).toEqual(["Section 2. Definitions", "(a) In general", "(1) Eligible"]);
  });

  it("returns a one-element array for flat headings", () => {
    expect(pathFromHeading("Section 1. Short title")).toEqual([
      "Section 1. Short title",
    ]);
  });

  it("handles single-word headings", () => {
    expect(pathFromHeading("Preamble")).toEqual(["Preamble"]);
    expect(pathFromHeading("Full Text")).toEqual(["Full Text"]);
  });

  it("trims whitespace around segments", () => {
    expect(pathFromHeading("Section 2  >  (a) Foo  >  (1) Bar")).toEqual([
      "Section 2",
      "(a) Foo",
      "(1) Bar",
    ]);
  });
});

describe("sectionSlugFromHeading", () => {
  it("end-to-end: stored heading → URL slug", () => {
    expect(
      sectionSlugFromHeading(
        "Section 2. Definitions > (a) In general > (1) Eligible person",
      ),
    ).toBe("sec-2-definitions--a-in-general--1-eligible-person");
  });
});

describe("sectionSlugsForBill", () => {
  it("produces a slug per section in document order", () => {
    const sections = [
      section("Section 1. Short title"),
      section("Section 2. Definitions"),
      section("Section 3. Funding"),
    ];
    expect(sectionSlugsForBill(sections)).toEqual([
      "sec-1-short-title",
      "sec-2-definitions",
      "sec-3-funding",
    ]);
  });

  it("disambiguates collisions with -2, -3 suffix in document order", () => {
    // Contrived but possible: two sections sharing the same heading text.
    const sections = [
      section("Section 1. Findings"),
      section("Section 1. Findings"),
      section("Section 1. Findings"),
    ];
    expect(sectionSlugsForBill(sections)).toEqual([
      "sec-1-findings",
      "sec-1-findings-2",
      "sec-1-findings-3",
    ]);
  });

  it("does not pollute slugs with suffixes when there are no collisions", () => {
    const sections = [
      section("Section 1. Short title"),
      section("Section 2. Definitions"),
    ];
    const slugs = sectionSlugsForBill(sections);
    for (const s of slugs) {
      expect(s).not.toMatch(/-\d+$/);
    }
  });
});

describe("parseSlug", () => {
  it("inverts sectionSlug structurally (segments only)", () => {
    expect(parseSlug("sec-2-definitions--a-in-general")).toEqual([
      "sec-2-definitions",
      "a-in-general",
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseSlug("")).toEqual([]);
  });
});

describe("sectionSlug — stress / edge cases", () => {
  it("handles deeply nested paths (Title → Subtitle → Section → Subsection → Paragraph → Subparagraph → Clause)", () => {
    const slug = sectionSlug([
      "Title XVII",
      "Subtitle B — Fiscal Rules",
      "Section 1701. Funding",
      "(a) In general",
      "(1) Eligible person",
      "(A) Definition",
      "(i) Initial period",
    ]);
    // 7 segments joined by `--`
    expect(slug.split("--")).toHaveLength(7);
    expect(slug).toMatch(/^title-xvii--subt-b-fiscal-rules--sec-1701/);
  });

  it("strips smart quotes, em-dashes, and other Unicode punctuation", () => {
    const slug = sectionSlug([
      "Section 5. \u201cDefined Benefits\u201d \u2014 Eligibility",
    ]);
    // Smart quotes and em-dash get cleaned to space → dash.
    expect(slug).toMatch(/^sec-5-defined-benefits-/);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.length).toBeLessThanOrEqual(30);
  });

  it("handles all-uppercase headings (SHOUTING legislative style)", () => {
    expect(sectionSlug(["SECTION 1. SHORT TITLE"])).toBe("sec-1-short-title");
  });

  it("handles dollar amounts and percent signs (common in funding bills)", () => {
    const slug = sectionSlug(["Section 3. $500,000,000 for FY2026 (15%)"]);
    expect(slug).toMatch(/^sec-3-500-000-000-for-fy2026/);
    // Critical: must be URL-safe (no $, ,, %)
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("handles ampersands and slashes (statute names)", () => {
    expect(
      sectionSlug(["Section 7. Amendments to Title I & Title II/III"]),
    ).toMatch(/^[a-z0-9-]+$/);
  });

  it("handles single-character segments without producing empty slugs", () => {
    expect(sectionSlug(["(a)"])).toBe("a");
    expect(sectionSlug(["(1)", "(A)"])).toBe("1--a");
    expect(sectionSlug(["A", "B"])).toBe("a--b");
  });

  it("never produces consecutive dashes inside a segment", () => {
    const slug = sectionSlug(["Section 5.   Multiple      Spaces"]);
    expect(slug).not.toMatch(/--/);
    // Outer joiner uses `--` between path segments — that's separate.
    expect(slug).toBe("sec-5-multiple-spaces");
  });

  it("never produces leading or trailing dashes per segment", () => {
    const slug = sectionSlug(["—Section 1—"]);
    expect(
      slug.split("--").every((s) => !s.startsWith("-") && !s.endsWith("-")),
    ).toBe(true);
  });

  it("collapses runs of punctuation to single space then dash", () => {
    expect(sectionSlug(["Section 1: !!! Findings ???"])).toBe("sec-1-findings");
  });

  it("Preamble and Full Text headings get sane single-segment slugs", () => {
    expect(sectionSlug(["Preamble"])).toBe("preamble");
    expect(sectionSlug(["Full Text"])).toBe("full-text");
  });

  it("respects the 30-char-per-segment cap", () => {
    const slug = sectionSlug([
      "Section 1. " + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    ]);
    const firstSegment = slug.split("--")[0];
    expect(firstSegment.length).toBeLessThanOrEqual(30);
  });

  it("filters out segments that slug to empty (preserves order of survivors)", () => {
    const slug = sectionSlug(["—", "Section 5. Foo", "🎉", "(a) Bar"]);
    expect(slug).toBe("sec-5-foo--a-bar");
  });

  it("handles emoji (some bills use them in titles, e.g. resolutions honoring days)", () => {
    // Emoji are not in \w, so they should be stripped to space → dash.
    const slug = sectionSlug(["Section 1. Honoring 🎂 Day"]);
    expect(slug).toMatch(/^sec-1-honoring/);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("sectionSlugsForBill — stress", () => {
  it("handles 200 sections without performance degradation", () => {
    const sections = Array.from({ length: 200 }, (_, i) =>
      section(`Section ${i + 1}. Topic ${i + 1}`),
    );
    const start = performance.now();
    const slugs = sectionSlugsForBill(sections);
    const ms = performance.now() - start;
    expect(slugs).toHaveLength(200);
    // Loose perf bound — should complete in well under 100ms even on
    // a busy CI runner.
    expect(ms).toBeLessThan(100);
  });

  it("disambiguates 5 collisions with -2 through -5 in document order", () => {
    const sections = Array.from({ length: 5 }, () =>
      section("Section 1. Findings"),
    );
    const slugs = sectionSlugsForBill(sections);
    expect(slugs).toEqual([
      "sec-1-findings",
      "sec-1-findings-2",
      "sec-1-findings-3",
      "sec-1-findings-4",
      "sec-1-findings-5",
    ]);
  });

  it("interleaved collisions get correct suffixes (not order-of-appearance counter)", () => {
    const sections = [
      section("Section 1. A"),
      section("Section 2. B"),
      section("Section 1. A"),
      section("Section 2. B"),
      section("Section 1. A"),
    ];
    const slugs = sectionSlugsForBill(sections);
    expect(slugs).toEqual([
      "sec-1-a",
      "sec-2-b",
      "sec-1-a-2",
      "sec-2-b-2",
      "sec-1-a-3",
    ]);
  });

  it("every slug in a collision-free bill is unique", () => {
    const sections = Array.from({ length: 50 }, (_, i) =>
      section(`Section ${i + 1}. Unique heading number ${i}`),
    );
    const slugs = sectionSlugsForBill(sections);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("matchSectionBySlug — stress / round-trip property", () => {
  it("for every section in a long bill, sectionSlugsForBill[i] round-trips back to section i", () => {
    const sections = [
      section("Section 1. Short title"),
      section("Section 2. Definitions"),
      section("Section 2. Definitions > (a) In general"),
      section("Section 2. Definitions > (a) In general > (1) Eligible"),
      section("Section 3. Funding"),
      section("Section 3. Funding > (a) Authorization"),
      section("Section 4. Effective date"),
      section("Section 5. Severability"),
      // Add a collision pair
      section("Section 3. Funding"),
    ];
    const slugs = sectionSlugsForBill(sections);
    for (let i = 0; i < sections.length; i++) {
      const m = matchSectionBySlug(sections, slugs[i]);
      expect(m).not.toBeNull();
      expect(m?.index).toBe(i);
    }
  });

  it("returns null on injection-style slugs (path traversal, special chars)", () => {
    const sections: BillSection[] = [section("Section 1. Foo")];
    expect(matchSectionBySlug(sections, "../../etc/passwd")).toBeNull();
    expect(
      matchSectionBySlug(sections, "<script>alert(1)</script>"),
    ).toBeNull();
    // The "sec" prefix happens to fuzzy-match "sec-1-foo" since both
    // first segments start with "sec". Acceptable — the user gets a
    // soft landing, not a 404 — and the budget gate prevents abuse.
    const m = matchSectionBySlug(sections, "sec-99--%00null");
    // First-segment "sec-99" doesn't equal or prefix "sec-1-foo" — null.
    expect(m).toBeNull();
  });
});

describe("matchSectionBySlug", () => {
  const sections: BillSection[] = [
    section("Section 1. Short title"),
    section("Section 2. Definitions"),
    section("Section 2. Definitions > (a) In general"),
    section("Section 3. Funding"),
  ];

  it("matches an exact slug", () => {
    const m = matchSectionBySlug(sections, "sec-2-definitions");
    expect(m).not.toBeNull();
    expect(m?.index).toBe(1);
    expect(m?.section.heading).toBe("Section 2. Definitions");
  });

  it("matches a deeper exact slug", () => {
    const m = matchSectionBySlug(sections, "sec-2-definitions--a-in-general");
    expect(m).not.toBeNull();
    expect(m?.index).toBe(2);
  });

  it("falls back to first-segment fuzzy match on miss", () => {
    // Slug points to a deeper path that doesn't exist; fuzzy should
    // resolve to the first section starting with "sec-3".
    const m = matchSectionBySlug(
      sections,
      "sec-3--c-supplemental-thing-that-is-not-real",
    );
    expect(m).not.toBeNull();
    expect(m?.index).toBe(3);
  });

  it("returns null when nothing resembles the slug", () => {
    expect(matchSectionBySlug(sections, "sec-99-not-a-section")).toBeNull();
  });

  it("returns null on empty slug", () => {
    expect(matchSectionBySlug(sections, "")).toBeNull();
  });

  it("returns null on empty section list", () => {
    expect(matchSectionBySlug([], "sec-1-anything")).toBeNull();
  });
});

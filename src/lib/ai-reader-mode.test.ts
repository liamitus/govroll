/**
 * Reader-mode prompt construction tests.
 *
 * Verifies that `buildBillChatSystemPrompt` correctly switches between
 * the default (human-readable attribution) and reader-mode (markdown
 * link to ?section=<slug>) citation forms, and that section slugs are
 * threaded into the section blocks when reader mode is on so the AI
 * has a stable link target to use.
 */
import { describe, expect, it } from "vitest";

import { buildBillChatSystemPrompt } from "./ai";
import type { BillSection } from "./bill-sections";

function section(heading: string, content = "Body text."): BillSection {
  return { heading, content, sectionRef: heading };
}

describe("buildBillChatSystemPrompt — reader mode toggle", () => {
  const sections: BillSection[] = [
    section("Section 1. Short title", "This Act may be cited as the Test Act."),
    section(
      "Section 2. Definitions > (a) In general",
      "In this Act, eligible person means …",
    ),
    section(
      "Section 5. Funding > (b) Authorization",
      "There is authorized $500,000,000.",
    ),
  ];

  it("default mode emits human-attribution citation instructions", () => {
    const prompt = buildBillChatSystemPrompt(
      "Test Act",
      sections,
      null,
      // No opts → default mode.
    );
    expect(prompt).toContain("— Section 4(a)");
    expect(prompt).not.toContain("?section=");
    expect(prompt).not.toContain("[slug:");
  });

  it("reader mode emits markdown-link citation instructions", () => {
    const prompt = buildBillChatSystemPrompt("Test Act", sections, null, {
      readerMode: true,
    });
    expect(prompt).toContain("[Section 4(a)](?section=sec-4--a)");
    expect(prompt).toContain("?section=<slug>");
  });

  it("reader mode threads each section's slug into its block as `[slug: …]`", () => {
    const prompt = buildBillChatSystemPrompt("Test Act", sections, null, {
      readerMode: true,
    });
    expect(prompt).toContain("[slug: sec-1-short-title]");
    expect(prompt).toContain("[slug: sec-2-definitions--a-in-general]");
    expect(prompt).toContain("[slug: sec-5-funding--b-authorization]");
  });

  it("default mode does NOT thread slugs (unnecessary tokens)", () => {
    const prompt = buildBillChatSystemPrompt("Test Act", sections, null);
    expect(prompt).not.toContain("[slug:");
  });

  it("readerMode true still includes every section's heading + content (no truncation)", () => {
    const prompt = buildBillChatSystemPrompt("Test Act", sections, null, {
      readerMode: true,
    });
    for (const s of sections) {
      expect(prompt).toContain(s.heading);
      expect(prompt).toContain(s.content);
    }
  });

  it("falls back to CRS-summary prompt path when sections are null (reader mode irrelevant)", () => {
    const prompt = buildBillChatSystemPrompt(
      "Test Act",
      null,
      {
        sponsor: "Sen. X",
        cosponsorCount: 0,
        cosponsorPartySplit: null,
        policyArea: null,
        latestActionDate: null,
        latestActionText: null,
        shortText: "Plain summary.",
      },
      { readerMode: true },
    );
    // Reader-mode citations only kick in when sections are present; the
    // CRS branch attributes to "CRS summary" instead of section slugs.
    expect(prompt).toContain("CRS summary");
    expect(prompt).not.toContain("?section=");
  });

  it("includes the bill title in both modes", () => {
    const titleQuoted = `"Test Act"`;
    expect(buildBillChatSystemPrompt("Test Act", sections, null)).toContain(
      titleQuoted,
    );
    expect(
      buildBillChatSystemPrompt("Test Act", sections, null, {
        readerMode: true,
      }),
    ).toContain(titleQuoted);
  });

  it("emits stable, URL-safe slug strings in the prompt (no special chars)", () => {
    const tricky = [
      section("Section 7. Amendments to Title I & Title II/III", "Body text."),
      section('Section 8. "Definitions" — Eligibility', "Body text."),
    ];
    const prompt = buildBillChatSystemPrompt("Tricky Bill", tricky, null, {
      readerMode: true,
    });
    // Extract every [slug: …] line and assert URL-safety
    const slugMatches = prompt.match(/\[slug: ([^\]]+)\]/g) ?? [];
    expect(slugMatches.length).toBe(tricky.length);
    for (const m of slugMatches) {
      const slug = m.replace("[slug: ", "").replace("]", "");
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

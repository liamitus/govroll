// @vitest-environment jsdom
/**
 * Component-level test for `<SectionRenderer>`. Verifies the
 * server-renderable shape (heading tag mapping, caption rendering,
 * data attributes, the Ask AI button delegation hook) without
 * needing the full reader page or scroll-spy context.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SectionRenderer } from "./section-renderer";
import type { ReaderSection } from "./reader-types";

afterEach(() => {
  cleanup();
});

function makeSection(overrides: Partial<ReaderSection> = {}): ReaderSection {
  return {
    heading: "Section 1. Short title",
    content: "This Act may be cited as the Test Act.",
    sectionRef: "Section 1",
    slug: "sec-1-short-title",
    depth: 1,
    caption: null,
    ...overrides,
  };
}

describe("<SectionRenderer> — heading depth → tag mapping", () => {
  it("depth 1 renders <h2>", () => {
    render(<SectionRenderer section={makeSection({ depth: 1 })} />);
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2).toBeInTheDocument();
  });

  it("depth 2 with a descriptive label renders <h3>", () => {
    render(
      <SectionRenderer
        section={makeSection({
          depth: 2,
          heading: "Section 1 > (a) In general",
          slug: "sec-1--a-in-general",
        })}
      />,
    );
    expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
  });

  it("depth 3 with a descriptive label renders <h4>", () => {
    render(
      <SectionRenderer
        section={makeSection({
          depth: 3,
          heading: "Section 1 > (a) In general > (1) Eligible",
          slug: "sec-1--a--1-eligible",
        })}
      />,
    );
    expect(screen.getByRole("heading", { level: 4 })).toBeInTheDocument();
  });

  it("depth 5 with a descriptive label still renders <h4> (clamped)", () => {
    render(
      <SectionRenderer
        section={makeSection({
          depth: 5,
          heading: "Section 1 > (a) > (1) > (A) > (i) Covered period",
          slug: "sec-1-deep-clause",
        })}
      />,
    );
    expect(screen.getByRole("heading", { level: 4 })).toBeInTheDocument();
  });
});

describe("<SectionRenderer> — caption rendering", () => {
  it("renders the AI caption when present", () => {
    render(
      <SectionRenderer
        section={makeSection({ caption: "Names the bill the Test Act." })}
      />,
    );
    expect(
      screen.getByLabelText("AI summary of this section"),
    ).toHaveTextContent("Names the bill the Test Act.");
  });

  it("omits the caption element entirely when caption is null", () => {
    render(<SectionRenderer section={makeSection({ caption: null })} />);
    expect(screen.queryByLabelText("AI summary of this section")).toBeNull();
  });

  it("omits the caption element when caption is empty string", () => {
    render(<SectionRenderer section={makeSection({ caption: "" })} />);
    expect(screen.queryByLabelText("AI summary of this section")).toBeNull();
  });
});

describe("<SectionRenderer> — content paragraphs", () => {
  it("renders a single <p> for single-paragraph content", () => {
    const { container } = render(
      <SectionRenderer
        section={makeSection({ content: "One paragraph only." })}
      />,
    );
    const sectionEl = container.querySelector("section");
    const paragraphs = sectionEl?.querySelectorAll(
      "p:not(.bill-prose-caption)",
    );
    expect(paragraphs?.length).toBe(1);
  });

  it("splits content on double-newlines into multiple <p> elements", () => {
    const { container } = render(
      <SectionRenderer
        section={makeSection({
          content: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
        })}
      />,
    );
    const sectionEl = container.querySelector("section");
    const paragraphs = sectionEl?.querySelectorAll("p");
    // 3 body + 0 caption = 3.
    expect(paragraphs?.length).toBe(3);
  });

  it("renders a placeholder when content is empty (heading-only section)", () => {
    render(<SectionRenderer section={makeSection({ content: "" })} />);
    expect(screen.getByText(/no body text/i)).toBeInTheDocument();
  });

  it("escapes HTML in content (XSS safety — React default but verified)", () => {
    const malicious =
      'A passage with <script>alert("XSS")</script> and other <img onerror="..."> attempts.';
    const { container } = render(
      <SectionRenderer section={makeSection({ content: malicious })} />,
    );
    // No script tag should be in the rendered DOM.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // The text should appear as escaped text content.
    expect(container.textContent).toContain('<script>alert("XSS")</script>');
  });
});

describe("<SectionRenderer> — data attributes (event-delegation contract)", () => {
  it("section element carries id, data-section-slug, data-section-depth, data-section-heading", () => {
    const { container } = render(
      <SectionRenderer
        section={makeSection({
          heading: "Section 5. Funding > (a) Authorization",
          slug: "sec-5-funding--a-authorization",
          depth: 2,
        })}
      />,
    );
    const sectionEl = container.querySelector("section") as HTMLElement;
    expect(sectionEl).toBeTruthy();
    expect(sectionEl.id).toBe("sec-5-funding--a-authorization");
    expect(sectionEl.dataset.sectionSlug).toBe(
      "sec-5-funding--a-authorization",
    );
    expect(sectionEl.dataset.sectionDepth).toBe("2");
    expect(sectionEl.dataset.sectionHeading).toBe(
      "Section 5. Funding > (a) Authorization",
    );
  });

  it("includes a delegation-target Ask AI button with correct data-section-slug", () => {
    const { container } = render(
      <SectionRenderer section={makeSection({ slug: "sec-1-short-title" })} />,
    );
    const button = container.querySelector(
      "button[data-section-ask-ai]",
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.dataset.sectionSlug).toBe("sec-1-short-title");
    expect(button.getAttribute("aria-label")).toMatch(/Ask AI/i);
  });

  it("Ask AI button is type=button (no accidental form submission)", () => {
    const { container } = render(<SectionRenderer section={makeSection()} />);
    const button = container.querySelector(
      "button[data-section-ask-ai]",
    ) as HTMLButtonElement;
    expect(button.type).toBe("button");
  });
});

describe("<SectionRenderer> — heading text fidelity", () => {
  it("depth-1 headings render the full heading verbatim (no path to strip)", () => {
    render(
      <SectionRenderer
        section={makeSection({
          depth: 1,
          heading: "Section 1. Short title",
        })}
      />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("Section 1. Short title");
  });

  it("depth ≥ 2 headings render only the innermost path segment", () => {
    render(
      <SectionRenderer
        section={makeSection({
          depth: 3,
          heading: "Section 5. Funding > (a) In general > (1) Eligible person",
        })}
      />,
    );
    const heading = screen.getByRole("heading", { level: 4 });
    expect(heading.textContent).toBe("(1) Eligible person");
  });

  it("preserves the full path on data-section-heading for scroll-spy/breadcrumb", () => {
    const { container } = render(
      <SectionRenderer
        section={makeSection({
          depth: 3,
          heading: "Section 5. Funding > (a) In general > (1) Eligible person",
        })}
      />,
    );
    const sectionEl = container.querySelector("section") as HTMLElement;
    expect(sectionEl.dataset.sectionHeading).toBe(
      "Section 5. Funding > (a) In general > (1) Eligible person",
    );
  });

  it("preserves unicode in heading text", () => {
    render(
      <SectionRenderer
        section={makeSection({
          heading: "Section 1. \u201cShort\u201d title \u2014 amended",
        })}
      />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toContain("\u201cShort\u201d");
  });
});

describe("<SectionRenderer> — marker-only inlining", () => {
  it("bare-marker subsection (e.g. `(1)`) renders no heading and inlines the marker into the first paragraph", () => {
    const { container } = render(
      <SectionRenderer
        section={makeSection({
          depth: 2,
          heading: "Section 2 > (1)",
          slug: "sec-2--1",
          content: "The intent of this Act is to permit claims.",
        })}
      />,
    );
    // No heading element rendered for this section
    expect(container.querySelector("h2, h3, h4")).toBeNull();
    // Marker appears as a <strong> prefix on the first paragraph
    const strong = container.querySelector(".bill-prose-marker") as HTMLElement;
    expect(strong).toBeTruthy();
    expect(strong.textContent).toBe("(1)");
    // And the body text still appears in the paragraph
    expect(container.textContent).toContain(
      "The intent of this Act is to permit claims.",
    );
  });

  it("bare-marker subsection with descriptive text (e.g. `(a) In general`) renders a heading, not an inline marker", () => {
    const { container } = render(
      <SectionRenderer
        section={makeSection({
          depth: 2,
          heading: "Section 2 > (a) In general",
          slug: "sec-2--a",
          content: "Some content here.",
        })}
      />,
    );
    expect(container.querySelector("h3")).toBeTruthy();
    expect(container.querySelector(".bill-prose-marker")).toBeNull();
  });

  it("depth-1 sections are never marker-inlined, even if they would match the pattern", () => {
    const { container } = render(
      <SectionRenderer
        section={makeSection({
          depth: 1,
          heading: "(1)",
          slug: "weird-top-level",
          content: "Body content.",
        })}
      />,
    );
    // Depth-1 always renders a real heading.
    expect(container.querySelector("h2")).toBeTruthy();
    expect(container.querySelector(".bill-prose-marker")).toBeNull();
  });

  it("inlined-marker section with empty body still renders the marker", () => {
    const { container } = render(
      <SectionRenderer
        section={makeSection({
          depth: 3,
          heading: "Section 1 > (a) > (A)",
          slug: "sec-1--a--a",
          content: "",
        })}
      />,
    );
    const strong = container.querySelector(".bill-prose-marker") as HTMLElement;
    expect(strong).toBeTruthy();
    expect(strong.textContent).toBe("(A)");
  });
});

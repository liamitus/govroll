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

  it("depth 2 renders <h3>", () => {
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

  it("depth 3 renders <h4>", () => {
    render(
      <SectionRenderer
        section={makeSection({
          depth: 3,
          heading: "Section 1 > (a) > (1) Eligible",
          slug: "sec-1--a--1-eligible",
        })}
      />,
    );
    expect(screen.getByRole("heading", { level: 4 })).toBeInTheDocument();
  });

  it("depth 5 still renders <h4> (clamped — visual hierarchy collapses past h4)", () => {
    render(
      <SectionRenderer
        section={makeSection({
          depth: 5,
          heading: "Section 1 > (a) > (1) > (A) > (i) Period",
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
  it("renders the full joined heading verbatim (path with ` > `)", () => {
    render(
      <SectionRenderer
        section={makeSection({
          depth: 3,
          heading: "Section 5. Funding > (a) In general > (1) Eligible person",
        })}
      />,
    );
    const heading = screen.getByRole("heading", { level: 4 });
    expect(heading.textContent).toBe(
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

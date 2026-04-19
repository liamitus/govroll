import type { ReaderSection } from "./reader-types";

/**
 * Render a single bill section: heading + (optional) AI caption + body
 * paragraphs. Server-rendered, no interactivity. The wrapping
 * `<section>` carries `id={slug}` so deep-link scrolling and the
 * intersection-observer scroll-spy resolve consistently.
 *
 * Heading depth is mapped: depth 1 → h2, depth 2 → h3, depth 3+ → h4.
 * Bills nest deeper than that (clauses inside paragraphs inside
 * subsections) but visual hierarchy collapses past h4 — the slug + the
 * sticky breadcrumb provide the precise context.
 *
 * The "Ask AI about this" button is a server-rendered `<button data-…>`
 * caught by event delegation in `<ReaderInteractive>` — that lets us
 * keep this whole component server-rendered without threading hooks
 * down from the client provider.
 */
export function SectionRenderer({ section }: { section: ReaderSection }) {
  // Bill content is plain text from the parser. Paragraphs are
  // separated by blank lines (the `\n\n+` split that
  // `parseSectionsFromFullText` writes back). Single-paragraph sections
  // collapse to one <p>.
  const paragraphs = section.content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <section
      id={section.slug}
      data-section-slug={section.slug}
      data-section-depth={section.depth}
      data-section-heading={section.heading}
      className="bill-prose-section group/section"
    >
      <div className="bill-prose-heading-row">
        {/* Render the depth-appropriate heading element directly rather
            than computing a tag string and reifying it as a component
            (the latter trips react-hooks/static-components). */}
        {section.depth <= 1 ? (
          <h2 className="bill-prose-heading">{section.heading}</h2>
        ) : section.depth === 2 ? (
          <h3 className="bill-prose-heading">{section.heading}</h3>
        ) : (
          <h4 className="bill-prose-heading">{section.heading}</h4>
        )}

        <button
          type="button"
          data-section-ask-ai="true"
          data-section-slug={section.slug}
          className="bill-prose-ask-ai"
          aria-label={`Ask AI about this section`}
          title="Ask AI about this section"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          <span className="sr-only">Ask AI</span>
        </button>
      </div>

      {section.caption ? (
        <p
          className="bill-prose-caption"
          aria-label="AI summary of this section"
        >
          {section.caption}
        </p>
      ) : null}

      {paragraphs.length > 0 ? (
        paragraphs.map((para, i) => <p key={`${section.slug}-p${i}`}>{para}</p>)
      ) : (
        <p className="bill-prose-empty">
          (No body text — this section is a heading only.)
        </p>
      )}
    </section>
  );
}

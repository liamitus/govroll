import { SectionRenderer } from "./section-renderer";
import type { ReaderSection } from "./reader-types";

/**
 * A single top-level (depth 1) section rendered as a `<details>` block
 * with its subsections as the expanded body.
 *
 * Server-renderable — `<details>` is native HTML with no JS for basic
 * open/close. Expand-all / collapse-all and navigation-triggered
 * expansion are layered on top via client components elsewhere.
 *
 * The outer `<section id={slug}>` stays on the depth-1 element so deep
 * links and the scroll-spy IntersectionObserver resolve by the same
 * IDs they always have. The `<details>` sits inside that wrapper.
 *
 * Visual intent: the summary row is the quick-scan view — section
 * heading plus the AI caption (if any). Clicking the summary reveals
 * the body: the head section's paragraphs followed by every nested
 * subsection, rendered via the ordinary `<SectionRenderer>`.
 */
export function CollapsibleTopSection({
  head,
  body,
  defaultOpen,
}: {
  head: ReaderSection;
  body: ReaderSection[];
  defaultOpen: boolean;
}) {
  const paragraphs = head.content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <section
      id={head.slug}
      data-section-slug={head.slug}
      data-section-depth={head.depth}
      data-section-heading={head.heading}
      className="bill-prose-section bill-prose-top group/section"
    >
      <details
        className="bill-prose-details"
        data-collapsible-group
        open={defaultOpen || undefined}
      >
        <summary className="bill-prose-summary">
          <span aria-hidden className="bill-prose-summary-chevron">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <path d="M7 5l6 5-6 5" />
            </svg>
          </span>
          <span className="bill-prose-summary-text">
            <h2 className="bill-prose-heading">{head.heading}</h2>
            {head.caption ? (
              <span
                className="bill-prose-summary-caption"
                aria-label="AI summary of this section"
              >
                {head.caption}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            data-section-ask-ai="true"
            data-section-slug={head.slug}
            className="bill-prose-ask-ai bill-prose-summary-ask-ai"
            aria-label="Ask AI about this section"
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
        </summary>

        <div className="bill-prose-details-body">
          {paragraphs.length > 0 ? (
            paragraphs.map((para, i) => (
              <p key={`${head.slug}-p${i}`}>{para}</p>
            ))
          ) : body.length === 0 ? (
            <p className="bill-prose-empty">
              (No body text — this section is a heading only.)
            </p>
          ) : null}

          {body.map((section) => (
            <SectionRenderer key={section.slug} section={section} />
          ))}
        </div>
      </details>
    </section>
  );
}

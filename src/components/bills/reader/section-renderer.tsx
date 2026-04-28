import { Sparkles } from "lucide-react";

import type { ReaderSection } from "./reader-types";

/**
 * Render a single bill section: heading + body paragraphs. Server-
 * rendered, no interactivity. The wrapping `<section>` carries
 * `id={slug}` so deep-link scrolling and the intersection-observer
 * scroll-spy resolve consistently.
 *
 * Heading display strategy:
 *   - Depth 1 (top-level `Section N. Title`): full heading as an <h2>.
 *   - Depth ≥ 2 with a descriptive label (`(a) In general`): the last
 *     path segment only, sized down per depth. Parent context is
 *     provided by visual indentation + the left-border tree guide
 *     (see globals.css `.bill-prose-section[data-section-depth]`).
 *   - Depth ≥ 2 with a bare marker (`(1)`, `(A)`, `(i)`): no heading
 *     element — the marker is inlined as a `<strong>` prefix on the
 *     first paragraph. Matches how legal text actually reads and how
 *     congress.gov presents numeric subclauses.
 *
 * AI captions are NOT rendered inline here. The outline rail and the
 * collapsed-group summary already surface them; duplicating captions
 * in the body crowded the text and interrupted reading flow.
 *
 * The full path stays on `data-section-heading` so the sticky
 * breadcrumb and scroll-spy keep working unchanged.
 */
export function SectionRenderer({ section }: { section: ReaderSection }) {
  const paragraphs = section.content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const lastSegment = lastSegmentOf(section.heading);
  const marker = markerOnlyLabel(lastSegment);
  // Depth 1 always renders a real heading — it's the named Section.
  // Deeper levels collapse to inline markers only when the label is
  // bare (no descriptive text after the parenthetical).
  const inlineMarker = section.depth >= 2 && marker !== null;
  const headingText = section.depth <= 1 ? section.heading : lastSegment;

  return (
    <section
      id={section.slug}
      data-section-slug={section.slug}
      data-section-depth={section.depth}
      data-section-heading={section.heading}
      className="bill-prose-section group/section"
    >
      {inlineMarker ? null : (
        <div className="bill-prose-heading-row">
          {section.depth <= 1 ? (
            <h2 className="bill-prose-heading">{headingText}</h2>
          ) : section.depth === 2 ? (
            <h3 className="bill-prose-heading">{headingText}</h3>
          ) : (
            <h4 className="bill-prose-heading">{headingText}</h4>
          )}

          <button
            type="button"
            data-section-ask-ai="true"
            data-section-slug={section.slug}
            className="bill-prose-ask-ai"
            aria-label={`Ask AI about this section`}
            title="Ask AI about this section"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Ask AI</span>
          </button>
        </div>
      )}

      {paragraphs.length > 0 ? (
        paragraphs.map((para, i) => (
          <p key={`${section.slug}-p${i}`}>
            {inlineMarker && i === 0 ? (
              <>
                <strong className="bill-prose-marker">{marker}</strong> {para}
              </>
            ) : (
              para
            )}
          </p>
        ))
      ) : inlineMarker ? (
        <p>
          <strong className="bill-prose-marker">{marker}</strong>
        </p>
      ) : (
        <p className="bill-prose-empty">
          (No body text — this section is a heading only.)
        </p>
      )}
    </section>
  );
}

/**
 * Extract the deepest segment of a ` > `-joined heading path.
 * `"Section 2. Definitions > (a) In general > (1) Eligible"` → `"(1) Eligible"`.
 */
function lastSegmentOf(heading: string): string {
  const parts = heading.split(" > ");
  return (parts[parts.length - 1] ?? heading).trim();
}

/**
 * If a segment is just a parenthesized marker with no descriptive text
 * (`(1)`, `(A)`, `(i)`, `(iv)`), return the marker. Otherwise null.
 * Used to decide whether to render a heading element or inline the
 * marker into the first paragraph.
 */
function markerOnlyLabel(segment: string): string | null {
  const match = segment.match(/^\(([^)]+)\)\s*$/);
  return match ? `(${match[1]})` : null;
}

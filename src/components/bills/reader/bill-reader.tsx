import dayjs from "dayjs";

import { SectionRenderer } from "./section-renderer";
import { DeepLinkScroller } from "./deep-link-scroller";
import { ScrollSpyProvider } from "./scroll-spy";
import { StickyBreadcrumb } from "./sticky-breadcrumb";
import { OutlineRail } from "./outline-rail";
import { SelectionPopover } from "./selection-popover";
import { ReaderInteractive } from "./reader-interactive";
import type {
  ReaderBillMeta,
  ReaderSection,
  ReaderVersionMeta,
} from "./reader-types";

/**
 * Layout shell for the bill reader. Day 5 scope:
 *   - Sticky breadcrumb at the top tracks the active section path
 *     via `useScrollSpy`.
 *   - Outline rail (desktop only, ≥1024px) shows every section as a
 *     nested list with active-row highlighting + auto-scroll.
 *   - Bill text body in the center, ~72ch measure, Gelasio body.
 *
 * Day 6+ will add: selection-explain popover, mobile bottom action
 * bar + outline sheet, chat drawer reuse.
 */
export function BillReader({
  bill,
  version,
  sections,
  initialSlug,
}: {
  bill: ReaderBillMeta;
  version: ReaderVersionMeta;
  sections: ReaderSection[];
  initialSlug: string | null;
}) {
  const slugsInOrder = sections.map((s) => s.slug);
  const outlineEntries = sections.map((s) => ({
    slug: s.slug,
    heading: s.heading,
    depth: s.depth,
    caption: s.caption,
  }));
  const breadcrumbSections = sections.map((s) => ({
    slug: s.slug,
    heading: s.heading,
  }));
  const minutes = readingMinutes(sections);

  return (
    <ScrollSpyProvider slugsInOrder={slugsInOrder}>
      <DeepLinkScroller initialSlug={initialSlug} />
      <SelectionPopover billId={bill.id} sections={breadcrumbSections} />

      <ReaderInteractive billId={bill.id} outlineEntries={outlineEntries}>
        <div className="bill-prose-page min-h-screen">
          <StickyBreadcrumb
            billId={bill.id}
            billTitle={bill.title}
            sections={breadcrumbSections}
          />

          <div className="mx-auto flex max-w-[1280px] gap-8 px-4 sm:px-6 lg:gap-12">
            <OutlineRail entries={outlineEntries} />

            <main
              id="bill-reader-main"
              className="max-w-[72ch] min-w-0 flex-1 pt-6 pb-32 sm:pt-8 lg:pb-24"
            >
              <header className="mb-10">
                <h1 className="bill-prose-title">{bill.title}</h1>
                <p className="text-muted-foreground bill-prose-meta mt-2 text-sm">
                  {sections.length} section{sections.length === 1 ? "" : "s"} ·{" "}
                  {minutes} min read · {version.versionType} (
                  {dayjs(version.versionDate).format("MMM D, YYYY")})
                </p>
              </header>

              <article
                className="bill-prose"
                aria-label={`Full text of ${bill.title}`}
              >
                {sections.map((section) => (
                  <SectionRenderer key={section.slug} section={section} />
                ))}
              </article>
            </main>
          </div>
        </div>
      </ReaderInteractive>
    </ScrollSpyProvider>
  );
}

/**
 * Rough reading-time estimate. ~250 words/min is the conventional
 * average; legal text reads slower, but this is an orientation cue,
 * not a budget.
 */
function readingMinutes(sections: ReaderSection[]): number {
  const words = sections.reduce(
    (sum, s) => sum + s.content.split(/\s+/).filter(Boolean).length,
    0,
  );
  return Math.max(1, Math.round(words / 250));
}

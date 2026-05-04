import { ExternalLink } from "lucide-react";

import { SectionRenderer } from "./section-renderer";
import { CollapsibleTopSection } from "./collapsible-top-section";
import { ExpandCollapseAll } from "./expand-collapse-all";
import { DeepLinkScroller } from "./deep-link-scroller";
import { ScrollSpyProvider } from "./scroll-spy";
import { StickyBreadcrumb } from "./sticky-breadcrumb";
import { OutlineRail } from "./outline-rail";
import { SelectionPopover } from "./selection-popover";
import { ReaderInteractive } from "./reader-interactive";
import { ReaderHeaderMeta } from "./reader-header-meta";
import { congressGovBillTextUrl } from "@/lib/bills/url";
import type {
  ReaderBillMeta,
  ReaderSection,
  ReaderVersionListEntry,
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
  availableVersions,
  sections,
  initialSlug,
}: {
  bill: ReaderBillMeta;
  version: ReaderVersionMeta;
  availableVersions: ReaderVersionListEntry[];
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
  const groups = groupByTopLevel(sections);
  const autoExpandAll = shouldAutoExpand(sections);
  const congressGovUrl = congressGovBillTextUrl({ billId: bill.billId });
  const govtrackUrl = bill.govtrackUrl;
  // If a deep link targets a specific section, the group containing
  // that section must render open on the server — otherwise a brief
  // flash of collapsed content precedes the client-side expansion.
  const initialOpenGroupSlug = initialSlug
    ? findContainingGroupSlug(groups, initialSlug)
    : null;

  return (
    <ScrollSpyProvider slugsInOrder={slugsInOrder}>
      <DeepLinkScroller initialSlug={initialSlug} />
      <SelectionPopover billId={bill.id} sections={breadcrumbSections} />

      <ReaderInteractive
        billId={bill.id}
        outlineEntries={outlineEntries}
        congressGovUrl={congressGovUrl}
        govtrackUrl={govtrackUrl}
      >
        <div className="bill-prose-page min-h-screen">
          <StickyBreadcrumb
            bill={{ billId: bill.billId, title: bill.title }}
            headline={bill.headline}
            sections={breadcrumbSections}
          />

          <div className="mx-auto flex max-w-[1280px] gap-8 px-4 sm:px-6 lg:gap-12">
            <OutlineRail
              entries={outlineEntries}
              congressGovUrl={congressGovUrl}
              govtrackUrl={govtrackUrl}
            />

            <main
              id="bill-reader-main"
              className="max-w-[72ch] min-w-0 flex-1 pt-6 pb-32 sm:pt-8 lg:pb-24"
            >
              <ReaderHeaderMeta
                bill={bill}
                version={version}
                availableVersions={availableVersions}
                sectionCount={sections.length}
                readingMinutes={minutes}
                expandCollapseSlot={
                  groups.length > 1 ? <ExpandCollapseAll /> : null
                }
              />

              <article
                className="bill-prose"
                aria-label={`Full text of ${bill.headline}`}
              >
                {groups.map((group) => {
                  if (!group.head) {
                    // Orphans: subsections before any depth-1 heading.
                    // Rare, but render flat so content isn't lost.
                    return group.body.map((section) => (
                      <SectionRenderer key={section.slug} section={section} />
                    ));
                  }
                  const defaultOpen =
                    autoExpandAll || initialOpenGroupSlug === group.head.slug;
                  return (
                    <CollapsibleTopSection
                      key={group.head.slug}
                      head={group.head}
                      body={group.body}
                      defaultOpen={defaultOpen}
                    />
                  );
                })}
              </article>

              {(congressGovUrl || govtrackUrl) && (
                <SourceFooter
                  congressGovUrl={congressGovUrl}
                  govtrackUrl={govtrackUrl}
                />
              )}
            </main>
          </div>
        </div>
      </ReaderInteractive>
    </ScrollSpyProvider>
  );
}

/**
 * End-of-article attribution. The most important "Source" placement —
 * when a reader finishes the bill text and asks "where did this come
 * from?", the answer is right there in reading-flow order. The rail
 * Sources block is the always-visible counterpart for in-flight
 * verification.
 */
function SourceFooter({
  congressGovUrl,
  govtrackUrl,
}: {
  congressGovUrl: string | null;
  govtrackUrl: string | null;
}) {
  return (
    <footer
      aria-label="Bill text source"
      className="text-muted-foreground/80 bill-prose-meta border-border/40 mt-12 border-t pt-4 text-xs"
    >
      <p>
        {congressGovUrl ? (
          <>
            Source:{" "}
            <SourceFooterLink href={congressGovUrl} label="Congress.gov" />
          </>
        ) : null}
        {congressGovUrl && govtrackUrl ? " · Also on " : null}
        {!congressGovUrl && govtrackUrl ? "Source: " : null}
        {govtrackUrl ? (
          <SourceFooterLink href={govtrackUrl} label="GovTrack" />
        ) : null}
      </p>
    </footer>
  );
}

function SourceFooterLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-foreground inline-flex items-center gap-1 underline underline-offset-2"
    >
      {label}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">(opens in new tab)</span>
    </a>
  );
}

/**
 * Rough reading-time estimate. ~250 words/min is the conventional
 * average; legal text reads slower, but this is an orientation cue,
 * not a budget.
 */
function readingMinutes(sections: ReaderSection[]): number {
  const words = countWords(sections);
  return Math.max(1, Math.round(words / 250));
}

function countWords(sections: ReaderSection[]): number {
  return sections.reduce(
    (sum, s) => sum + s.content.split(/\s+/).filter(Boolean).length,
    0,
  );
}

interface TopLevelGroup {
  /** The depth-1 "head" section. May be null only when the bill begins
   *  with deeper sections before any depth-1 heading — a parser quirk
   *  we tolerate rather than lose content over. */
  head: ReaderSection | null;
  /** Every subsequent section (any depth ≥ 2, plus any depth-1 content
   *  split across a single logical group isn't supported — each depth-1
   *  starts a new group). */
  body: ReaderSection[];
}

/**
 * Walk the flat section list and partition it into top-level groups.
 * A new group starts at every depth-1 section; subsequent deeper
 * sections get attached to the most recent top-level until the next
 * depth-1 arrives.
 */
function groupByTopLevel(sections: ReaderSection[]): TopLevelGroup[] {
  const groups: TopLevelGroup[] = [];
  for (const section of sections) {
    if (section.depth === 1) {
      groups.push({ head: section, body: [] });
    } else if (groups.length > 0) {
      groups[groups.length - 1].body.push(section);
    } else {
      // Orphan (no depth-1 ancestor yet). Rare; keep content visible.
      groups.push({ head: null, body: [section] });
    }
  }
  return groups;
}

/**
 * Short bills read better fully expanded — the scroll cost is trivial
 * and readers see the whole thing at once. Long bills collapse by
 * default so the page doesn't feel overwhelming; the summary rail and
 * the AI captions on each collapsed group give readers enough to pick
 * what to expand.
 *
 * Thresholds: ≤12 groups OR ≤3,000 words of body text. Either of those
 * tends to mean the bill fits in a few screens at normal reading speed.
 */
function shouldAutoExpand(sections: ReaderSection[]): boolean {
  const topLevelCount = sections.filter((s) => s.depth === 1).length;
  if (topLevelCount === 0) return true;
  if (topLevelCount <= 12) return true;
  return countWords(sections) <= 3000;
}

/**
 * Find the slug of the depth-1 group that contains the given section.
 * Used to force a specific group open on the server when the page
 * loads targeting a nested subsection.
 */
function findContainingGroupSlug(
  groups: TopLevelGroup[],
  targetSlug: string,
): string | null {
  for (const group of groups) {
    if (group.head?.slug === targetSlug) return group.head.slug;
    if (group.body.some((s) => s.slug === targetSlug)) {
      return group.head?.slug ?? null;
    }
  }
  return null;
}

"use client";

import { useEffect, useRef } from "react";

import { useScrollSpy } from "./scroll-spy";

/**
 * Flat-rendered, indented-by-depth list of bill sections. Used by both
 * the desktop `<OutlineRail>` (sticky left sidebar) and the (Day 9)
 * mobile `<OutlineSheet>` bottom sheet — same data, different chrome.
 *
 * Highlights the active section via `useScrollSpy` and auto-scrolls
 * itself to keep the active row visible as the user reads. Click on
 * any row scrolls the page to that section (uses native anchor scroll
 * via `<a href="#slug">` — `scroll-margin-top` on the section keeps
 * the heading clear of the sticky breadcrumb).
 *
 * Visual hierarchy:
 *   - Depth 1 entries render at full prominence (the top-level
 *     Section / Title / Division rows).
 *   - Depth ≥ 2 entries indent progressively, with a faint left
 *     guide line that matches the body reader's tree guide so the
 *     sidebar and the article share the same mental model.
 *   - Marker-only entries (bare `(1)`, `(A)`) render dimmer and
 *     smaller — they're navigation anchors, not content landmarks.
 */
export interface OutlineEntry {
  slug: string;
  heading: string;
  depth: number;
  caption: string | null;
}

export function OutlineTree({
  entries,
  className,
  onItemClick,
}: {
  entries: OutlineEntry[];
  className?: string;
  /** Called after a row is clicked. Mobile use case: the outline
   *  bottom sheet uses this to auto-close after the user picks a
   *  destination so the section they jumped to is visible. */
  onItemClick?: () => void;
}) {
  const { activeSlug } = useScrollSpy();
  const activeRowRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "auto",
    });
  }, [activeSlug]);

  return (
    <nav aria-label="Bill outline" className={className}>
      <ol className="space-y-0.5">
        {entries.map((entry) => {
          const isActive = entry.slug === activeSlug;
          const isMarkerOnly =
            entry.depth >= 2 &&
            /^\([^)]+\)\s*$/.test(lastSegmentOf(entry.heading));
          const indent = depthToIndent(entry.depth);
          const lastSegment = lastSegmentOf(entry.heading);

          return (
            <li key={entry.slug} className="relative">
              {/* Tree guide — a faint vertical bar for depth ≥ 2 so the
                  sidebar shows the same nesting the body does. */}
              {entry.depth >= 2 ? (
                <span
                  aria-hidden
                  className="bg-civic-gold/20 dark:bg-civic-gold/30 absolute top-1 bottom-1 w-px"
                  style={{ left: `${indent - 0.5}rem` }}
                />
              ) : null}
              <a
                ref={isActive ? activeRowRef : undefined}
                href={`#${entry.slug}`}
                className={[
                  "relative block rounded-md py-1 transition-colors",
                  isMarkerOnly ? "text-xs" : "text-sm",
                  isActive
                    ? "bg-civic-gold/15 text-foreground"
                    : isMarkerOnly
                      ? "text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                ].join(" ")}
                style={{ paddingLeft: `${indent}rem`, paddingRight: "0.5rem" }}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onItemClick?.()}
              >
                <span
                  className={[
                    "block truncate",
                    isMarkerOnly ? "font-normal" : "font-medium",
                    entry.depth === 1 ? "font-semibold" : "",
                  ].join(" ")}
                >
                  {lastSegment}
                </span>
                {entry.caption ? (
                  <span className="text-muted-foreground/90 mt-0.5 line-clamp-2 block text-xs leading-snug font-normal italic">
                    {entry.caption}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function depthToIndent(depth: number): number {
  // Stepped indent: each level adds 0.75rem, capped at depth 5 so deep
  // clauses don't run off the 280px rail.
  const cappedDepth = Math.min(depth, 5);
  return 0.75 + (cappedDepth - 1) * 0.75;
}

/**
 * Show the deepest path segment as the visible label. Full path is
 * available in the breadcrumb when the section is active; the rail
 * showing every segment of every depth wastes horizontal space.
 */
function lastSegmentOf(heading: string): string {
  const parts = heading.split(" > ");
  return (parts[parts.length - 1] ?? heading).trim();
}

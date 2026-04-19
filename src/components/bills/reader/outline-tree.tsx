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
 * Captions, when present, render as a smaller subtitle line under
 * each entry's heading. That's the "smart outline" the brief asks for
 * — outline glance answers "what is each section about" without
 * reading anything.
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

  // Auto-scroll the active row into view inside its scroll container.
  // `block: 'nearest'` avoids scrolling the page; `behavior: 'auto'`
  // matches the user's `prefers-reduced-motion` settings (no smooth
  // scroll surprise).
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
          const indent = depthToIndent(entry.depth);
          const lastSegment = lastSegmentOf(entry.heading);

          return (
            <li key={entry.slug}>
              <a
                ref={isActive ? activeRowRef : undefined}
                href={`#${entry.slug}`}
                className={[
                  "block rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-civic-gold/15 text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                ].join(" ")}
                style={{ paddingLeft: `${indent}rem` }}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onItemClick?.()}
              >
                <span className="block truncate font-medium">
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
  // 0.5rem (default) + 0.75rem per level past 1, capped at depth 4
  // so deeply nested clauses don't run off the right edge.
  const cappedDepth = Math.min(depth, 4);
  return 0.5 + (cappedDepth - 1) * 0.75;
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

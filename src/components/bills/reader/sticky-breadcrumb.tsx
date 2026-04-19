"use client";

import Link from "next/link";
import { useMemo } from "react";

import { pathFromHeading } from "@/lib/section-slug";
import { useScrollSpy } from "./scroll-spy";

/**
 * Sticky bar at the top of the reader. Renders the bill title and,
 * once the user has scrolled into a section, the path of that
 * section. Replaces the cognitive load of "where am I in this 200-
 * page bill" with a single always-visible chip.
 *
 * Hydration: the active path is purely client-side (depends on
 * viewport scroll position), so we render the bill title only on
 * the server and let the path fill in on the client. The
 * `suppressHydrationWarning` is scoped to the path text node only,
 * not the whole bar.
 */
export function StickyBreadcrumb({
  billId,
  billTitle,
  sections,
}: {
  billId: number;
  billTitle: string;
  sections: Array<{ slug: string; heading: string }>;
}) {
  const { activeSlug } = useScrollSpy();

  const path = useMemo(() => {
    if (!activeSlug) return [] as string[];
    const active = sections.find((s) => s.slug === activeSlug);
    return active ? pathFromHeading(active.heading) : [];
  }, [activeSlug, sections]);

  return (
    <div className="border-civic-gold/30 bg-civic-cream/85 dark:bg-card/85 supports-[backdrop-filter]:bg-civic-cream/65 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-2.5 sm:px-6">
        <Link
          href={`/bills/${billId}`}
          className="text-muted-foreground hover:text-foreground flex-none rounded-md px-1 text-xs font-medium transition-colors"
          aria-label="Back to bill page"
        >
          ←
        </Link>

        <div className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
          <span className="text-foreground">{billTitle}</span>
          <span className="text-muted-foreground" suppressHydrationWarning>
            {path.length > 0 ? (
              <>
                <span className="mx-2">·</span>
                {path.join(" › ")}
              </>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

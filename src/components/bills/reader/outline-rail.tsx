import { OutlineTree, type OutlineEntry } from "./outline-tree";

/**
 * Desktop-only left rail wrapping the `<OutlineTree>`. Sticky beneath
 * the breadcrumb, scrolls within its own viewport, doesn't compete
 * with the bill body for scroll. Hidden under `lg` (1024px) — at that
 * width the body needs the full measure and the outline lives in the
 * (Day 9) mobile bottom sheet instead.
 *
 * Server component — the sticky positioning and scrollbar handling
 * are pure CSS. The interactive bits (active highlighting, auto
 * scroll) live in the (client) `<OutlineTree>` underneath.
 */
export function OutlineRail({ entries }: { entries: OutlineEntry[] }) {
  return (
    <aside
      className="sticky top-[3.5rem] hidden h-[calc(100vh-3.5rem)] w-[280px] flex-none overflow-y-auto py-6 pr-2 lg:block"
      aria-label="Bill sections"
    >
      <h2 className="text-muted-foreground mb-3 px-2 text-xs font-semibold tracking-[0.15em] uppercase">
        Outline
      </h2>
      <OutlineTree entries={entries} />
    </aside>
  );
}

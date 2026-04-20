"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Two-button toolbar that toggles every `<details data-collapsible-group>`
 * on the page open or closed.
 *
 * Kept as a standalone client island (not lifted into bill-reader or
 * reader-interactive) because the underlying `<details>` elements are
 * server-rendered and the default expanded state is baked in at SSR by
 * `defaultOpen`. Only the "mass toggle" actions need JS.
 *
 * Active state: we track whether "most" groups are currently open so
 * the buttons can dim the already-satisfied action. `useSyncExternalStore`
 * subscribes to each `<details>`'s `toggle` event and re-reads counts
 * on demand, so single-summary clicks keep the toolbar accurate without
 * duplicate state.
 */

interface DetailsCounts {
  open: number;
  total: number;
}

// Cached snapshot so useSyncExternalStore sees a stable reference
// while the DOM state is unchanged. Recomputed only when an event
// fires (or after we mutate open flags programmatically).
let cachedCounts: DetailsCounts = { open: 0, total: 0 };

function readCountsFromDom(): DetailsCounts {
  const groups = document.querySelectorAll<HTMLDetailsElement>(
    "[data-collapsible-group]",
  );
  let open = 0;
  groups.forEach((g) => {
    if (g.open) open += 1;
  });
  return { open, total: groups.length };
}

function equalCounts(a: DetailsCounts, b: DetailsCounts): boolean {
  return a.open === b.open && a.total === b.total;
}

function subscribeToToggles(onChange: () => void): () => void {
  const groups = document.querySelectorAll<HTMLDetailsElement>(
    "[data-collapsible-group]",
  );
  const listener = () => {
    const next = readCountsFromDom();
    if (!equalCounts(next, cachedCounts)) {
      cachedCounts = next;
    }
    onChange();
  };
  groups.forEach((g) => g.addEventListener("toggle", listener));
  // Seed the cache so the first snapshot call returns accurate values.
  cachedCounts = readCountsFromDom();
  onChange();
  return () => {
    groups.forEach((g) => g.removeEventListener("toggle", listener));
  };
}

function getSnapshot(): DetailsCounts {
  return cachedCounts;
}

function getServerSnapshot(): DetailsCounts {
  // SSR can't read DOM; the toolbar hides itself when total===0.
  return cachedCounts;
}

export function ExpandCollapseAll() {
  const { open: expandedCount, total: totalCount } = useSyncExternalStore(
    subscribeToToggles,
    getSnapshot,
    getServerSnapshot,
  );

  const setAll = useCallback((open: boolean) => {
    document
      .querySelectorAll<HTMLDetailsElement>("[data-collapsible-group]")
      .forEach((el) => {
        if (el.open !== open) el.open = open;
      });
    // `<details>` only fires `toggle` when its own state changes, so
    // we're guaranteed a fresh cached snapshot via the subscriber.
  }, []);

  if (totalCount === 0) return null;

  const allOpen = expandedCount === totalCount;
  const allClosed = expandedCount === 0;

  return (
    <div className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <button
        type="button"
        onClick={() => setAll(true)}
        disabled={allOpen}
        className="hover:text-foreground rounded-md px-1.5 py-0.5 font-medium transition-colors disabled:cursor-default disabled:opacity-40"
      >
        Expand all
      </button>
      <span aria-hidden className="opacity-40">
        ·
      </span>
      <button
        type="button"
        onClick={() => setAll(false)}
        disabled={allClosed}
        className="hover:text-foreground rounded-md px-1.5 py-0.5 font-medium transition-colors disabled:cursor-default disabled:opacity-40"
      >
        Collapse all
      </button>
    </div>
  );
}

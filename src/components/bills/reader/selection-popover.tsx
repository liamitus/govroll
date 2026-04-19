"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ExplainPopoverContent } from "./explain-popover-content";

/**
 * The brand-defining surface of the reader: select any passage in
 * the bill body, a small "Explain in plain English" popover floats
 * just above the selection. Tap → 2-second Haiku call → result
 * appears inline. Light-dismiss on tap-outside or scroll.
 *
 * Wiring:
 *   - Subscribes to `document.selectionchange` to detect new
 *     selections.
 *   - Restricts to selections inside `<section data-section-slug=...>`
 *     elements (the bill body) — selections inside the chat drawer
 *     or other surfaces don't trigger.
 *   - Requires a min length to suppress accidental triple-clicks
 *     becoming explain prompts.
 *   - Renders into `document.body` via portal so the popover isn't
 *     clipped by `overflow: hidden` on ancestor containers.
 *
 * iOS Safari gotcha: the native iOS selection menu (Copy / Look Up)
 * still appears alongside ours. We can't suppress it without breaking
 * accessibility; we just live next to it.
 */
const MIN_SELECTION_CHARS = 40;
const POPOVER_OFFSET_PX = 12;
const ESTIMATED_POPOVER_HEIGHT_PX = 56;

interface SelectionState {
  passage: string;
  sectionPath: string[];
  rect: DOMRect;
}

export function SelectionPopover({
  billId,
  sections,
}: {
  billId: number;
  sections: Array<{ slug: string; heading: string }>;
}) {
  const [selection, setSelection] = useState<SelectionState | null>(null);

  // No mounted-flag dance: this is a "use client" component, the
  // selectionchange listener only fires after the client has
  // hydrated, and we only call createPortal once `selection` is set
  // (which can only happen client-side). SSR returns null below.

  // Resolve a selection to a SelectionState, or null if it doesn't
  // qualify (too short, outside the reader, missing section, etc.).
  // Closes over `sections` directly — re-derived (and the
  // selectionchange effect re-subscribes) when the prop changes,
  // which is rare since sections come from the server-rendered tree.
  const resolveSelection = useCallback((): SelectionState | null => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

    const passage = sel.toString().trim().replace(/\s+/g, " ");
    if (passage.length < MIN_SELECTION_CHARS) return null;

    const range = sel.getRangeAt(0);
    const startNode = range.startContainer;
    const startEl =
      startNode.nodeType === Node.TEXT_NODE
        ? startNode.parentElement
        : (startNode as Element);
    const sectionEl = startEl?.closest<HTMLElement>(
      "section[data-section-slug]",
    );
    if (!sectionEl) return null;

    const slug = sectionEl.dataset.sectionSlug ?? "";
    const section = sections.find((s) => s.slug === slug);
    if (!section) return null;

    const sectionPath = section.heading
      .split(" > ")
      .map((s) => s.trim())
      .filter(Boolean);

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;

    return { passage, sectionPath, rect };
  }, [sections]);

  useEffect(() => {
    function onSelectionChange() {
      const next = resolveSelection();
      // Don't clear on every selectionchange — only set when there's a
      // valid selection. The dismiss path (tap-outside / scroll)
      // handles clearing.
      if (next) setSelection(next);
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [resolveSelection]);

  // Dismiss handlers
  useEffect(() => {
    if (!selection) return;

    function onPointerDown(e: PointerEvent) {
      // Don't dismiss if the click was inside the popover itself
      // (e.g. the user clicked the "Explain" button).
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-explain-popover]")) return;

      // Don't dismiss if the click is inside the bill body and the
      // user is making a fresh selection — the selectionchange
      // handler will replace state.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;

      setSelection(null);
    }
    function onScroll() {
      setSelection(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelection(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("keydown", onKey);
    };
  }, [selection]);

  if (!selection) return null;

  const { rect, passage, sectionPath } = selection;
  const viewportPadding = 8;
  const preferredTop =
    rect.top - ESTIMATED_POPOVER_HEIGHT_PX - POPOVER_OFFSET_PX;
  // If we'd render above the viewport, flip below the selection.
  const top =
    preferredTop < viewportPadding
      ? rect.bottom + POPOVER_OFFSET_PX
      : preferredTop;
  const center = rect.left + rect.width / 2;
  const left = Math.min(
    Math.max(viewportPadding, center),
    window.innerWidth - viewportPadding,
  );

  // Re-mount the content on every new selection so its internal
  // request/loading state resets cleanly without a setState-in-effect
  // dance. The key combines billId + passage to handle bill swaps
  // (rare) as well as new selections (common).
  const popoverKey = `${billId}::${passage}`;

  return createPortal(
    <div
      data-explain-popover
      style={{
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        transform: "translateX(-50%)",
        zIndex: 60,
      }}
      className="border-civic-gold/40 bg-card max-w-[min(360px,calc(100vw-1rem))] rounded-lg border p-3 shadow-lg"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <ExplainPopoverContent
        key={popoverKey}
        request={{ billId, passage, sectionPath }}
      />
    </div>,
    document.body,
  );
}

"use client";

import { List, MessageSquare } from "lucide-react";

/**
 * Sticky bottom action bar for the reader on mobile. Contains the
 * Outline and Ask AI triggers — both opened by the parent (`<ReaderInteractive>`)
 * which owns the sheet state. Hidden on `lg` and above; the desktop
 * affordances are the left outline rail and the floating chat button.
 *
 * Always-visible for MVP; auto-hide-on-scroll-down is a v1.5 polish
 * (the plan called it out as a Twitter-style enhancement, not a
 * blocker).
 */
export function ReaderBottomBar({
  onOpenOutline,
  onOpenChat,
}: {
  onOpenOutline: () => void;
  onOpenChat: () => void;
}) {
  return (
    <div
      className="border-rule bg-paper/90 supports-[backdrop-filter]:bg-paper/75 fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 border-t backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      role="toolbar"
      aria-label="Reader actions"
    >
      <button
        type="button"
        onClick={onOpenOutline}
        className="text-ink hover:bg-muted/40 active:bg-muted/60 flex h-14 items-center justify-center gap-2 text-sm font-medium transition-colors"
      >
        <List className="h-4 w-4" aria-hidden />
        Outline
      </button>
      <button
        type="button"
        onClick={onOpenChat}
        className="text-ink hover:bg-muted/40 active:bg-muted/60 border-rule flex h-14 items-center justify-center gap-2 border-l text-sm font-medium transition-colors"
      >
        <MessageSquare className="h-4 w-4" aria-hidden />
        Ask AI
      </button>
    </div>
  );
}

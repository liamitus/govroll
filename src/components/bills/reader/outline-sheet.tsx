"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OutlineTree, type OutlineEntry } from "./outline-tree";

/**
 * Mobile / tablet outline sheet wrapping `<OutlineTree>`. Opened from
 * the `<ReaderBottomBar>` on small screens; desktop (≥lg) gets the
 * persistent `<OutlineRail>` instead.
 *
 * The shared `<Sheet>` primitive renders full-screen on mobile and
 * right-edge slide-over on tablets — both are appropriate for outline
 * browsing. Auto-closes when the user picks a section so the
 * jumped-to heading is visible behind the now-dismissed sheet.
 */
export function OutlineSheet({
  open,
  onOpenChange,
  entries,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: OutlineEntry[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Outline</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <OutlineTree
            entries={entries}
            onItemClick={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

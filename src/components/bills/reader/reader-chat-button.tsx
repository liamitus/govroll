"use client";

import { MessageSquare } from "lucide-react";

/**
 * Floating "Ask AI" button in the reader. Day 8 ships this as a
 * desktop-only floating action button — Day 9's mobile bottom action
 * bar absorbs the trigger and this falls back to desktop-only via
 * the responsive `lg:flex` class.
 *
 * Stateless: parent owns the open state and provides the click
 * handler (`<ReaderChatHost>`).
 */
export function ReaderChatButton({
  onClick,
  label = "Ask AI",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-civic-gold/95 hover:bg-civic-gold focus-visible:ring-civic-gold/40 fixed right-6 bottom-6 z-30 hidden h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white shadow-lg transition-colors focus:outline-none focus-visible:ring-4 lg:flex"
      aria-label={label}
    >
      <MessageSquare className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

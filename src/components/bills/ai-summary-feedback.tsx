"use client";

import { useState } from "react";

interface Props {
  billId: number;
  surface: "explainer" | "change_summary";
}

type State = "idle" | "submitting" | "thanks" | "error";

export function AiSummaryFeedback({ billId, surface }: Props) {
  const [state, setState] = useState<State>("idle");

  async function submit(rating: 1 | -1) {
    if (state === "submitting" || state === "thanks") return;
    setState("submitting");
    try {
      const res = await fetch("/api/ai-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billId, surface, rating }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState("thanks");
    } catch {
      setState("error");
    }
  }

  const disabled = state === "submitting" || state === "thanks";

  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <span>Was this summary helpful?</span>
      <button
        type="button"
        onClick={() => submit(1)}
        disabled={disabled}
        aria-label="Yes, helpful"
        className="hover:bg-accent hover:text-foreground focus-visible:ring-civic-gold/40 inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent transition-colors focus:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <path d="M7 10v12" />
          <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l4.34-9.66a1.93 1.93 0 0 1 3.66.94v4.6Z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => submit(-1)}
        disabled={disabled}
        aria-label="No, not helpful"
        className="hover:bg-accent hover:text-foreground focus-visible:ring-civic-gold/40 inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent transition-colors focus:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden
        >
          <path d="M17 14V2" />
          <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v12l-4.34 9.66a1.93 1.93 0 0 1-3.66-.94v-4.6Z" />
        </svg>
      </button>
      {state === "thanks" && <span>Thanks.</span>}
      {state === "error" && (
        <span className="text-destructive">Couldn&rsquo;t send.</span>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

/**
 * Body of the explain popover. Pure presentational + a single fetch
 * call to `/api/ai/explain-passage`. Selection wiring + positioning
 * lives in `selection-popover.tsx` — this component just gets a
 * passage + section path and renders three states: idle (button),
 * loading (spinner), result (explanation or error).
 *
 * No internal "reset on prop change" effect — the parent re-mounts
 * this component (via `key={passage + billId}`) on every new
 * selection, so we naturally start at INITIAL_STATE each time.
 */
export interface ExplainRequest {
  billId: number;
  passage: string;
  sectionPath: string[];
}

interface State {
  status: "idle" | "loading" | "success" | "error";
  explanation: string | null;
  errorMessage: string | null;
  cached: boolean;
}

const INITIAL_STATE: State = {
  status: "idle",
  explanation: null,
  errorMessage: null,
  cached: false,
};

export function ExplainPopoverContent({
  request,
}: {
  request: ExplainRequest;
}) {
  const [state, setState] = useState<State>(INITIAL_STATE);

  async function handleExplain() {
    if (state.status === "loading") return;
    setState({
      status: "loading",
      explanation: null,
      errorMessage: null,
      cached: false,
    });

    try {
      const res = await fetch("/api/ai/explain-passage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });

      const data = (await res.json().catch(() => ({}))) as {
        explanation?: string;
        cached?: boolean;
        error?: string;
        message?: string;
      };

      if (!res.ok) {
        setState({
          status: "error",
          explanation: null,
          cached: false,
          errorMessage:
            data.message ??
            data.error ??
            `Could not load explanation (${res.status}).`,
        });
        return;
      }

      setState({
        status: "success",
        explanation: data.explanation ?? "",
        cached: data.cached ?? false,
        errorMessage: null,
      });
    } catch (err) {
      setState({
        status: "error",
        explanation: null,
        cached: false,
        errorMessage:
          err instanceof Error ? err.message : "Network error — try again.",
      });
    }
  }

  if (state.status === "idle") {
    return (
      <button
        type="button"
        onClick={handleExplain}
        className="bg-civic-gold/95 hover:bg-civic-gold focus-visible:ring-civic-gold/40 inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
        Explain in plain English
      </button>
    );
  }

  if (state.status === "loading") {
    return (
      <p className="text-muted-foreground inline-flex items-center gap-2 text-xs">
        <span className="border-civic-gold inline-block h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" />
        Asking AI…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="text-destructive max-w-xs space-y-2 text-xs leading-relaxed"
      >
        <p>{state.errorMessage}</p>
        <button
          type="button"
          onClick={handleExplain}
          className="text-civic-gold text-xs font-semibold underline-offset-2 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // success
  return (
    <p
      className="text-foreground max-w-sm text-sm leading-relaxed"
      aria-live="polite"
    >
      {state.explanation}
      {state.cached ? (
        <span className="text-muted-foreground/80 ml-1 text-xs">(cached)</span>
      ) : null}
    </p>
  );
}

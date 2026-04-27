"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface AiChatErrorState {
  title: string;
  detail?: string;
  retryable: boolean;
}

/**
 * Maps a fetch response (or thrown error) to user-facing error copy.
 * The assistant "slot" in the thread should always show something — never
 * let a failure leave the user staring at a blank panel.
 */
export function mapErrorToState(input: {
  status?: number;
  serverMessage?: string;
  isAbort?: boolean;
  isParseError?: boolean;
  isNetworkError?: boolean;
}): AiChatErrorState {
  const { status, serverMessage, isAbort, isParseError, isNetworkError } =
    input;

  if (isAbort) {
    return {
      title: "That took too long",
      detail:
        "The bill may be large or the AI service is slow right now. Try again?",
      retryable: true,
    };
  }

  if (isNetworkError) {
    return {
      title: "Can't reach the AI service",
      detail: "Check your connection and try again.",
      retryable: true,
    };
  }

  switch (status) {
    case 429:
      return {
        title: "Too many questions too quickly",
        detail:
          serverMessage ??
          "You've hit the hourly limit. Wait a bit and try again.",
        retryable: true,
      };
    case 400:
      return {
        title: "Couldn't send that question",
        detail: serverMessage ?? "Please rephrase and try again.",
        retryable: false,
      };
    case 401:
    case 403:
      return {
        title: "Session expired",
        detail: "Sign in again to continue the conversation.",
        retryable: false,
      };
    case 504:
    case 502:
      return {
        title: "The AI took too long to respond",
        detail:
          "This bill may be unusually large. Try a shorter, more specific question.",
        retryable: true,
      };
    case 500:
      return {
        title: "Something went wrong on our end",
        detail: "Try again in a moment.",
        retryable: true,
      };
  }

  if (isParseError) {
    return {
      title: "The response got garbled",
      detail: "The AI service didn't return a complete answer. Try again?",
      retryable: true,
    };
  }

  // When the server bubbles up an actionable message (e.g. provider billing,
  // provider outage) prefer it over the bland generic so the real cause is
  // visible to the user and in screenshots.
  if (serverMessage) {
    return {
      title: "Something went wrong",
      detail: serverMessage,
      retryable: true,
    };
  }

  return {
    title: "Something went wrong",
    detail: "Try again in a moment.",
    retryable: true,
  };
}

/**
 * Inline error bubble rendered in the assistant's "slot" when a chat turn
 * fails. Persistent (not a toast) so the error stays visible as the user
 * scrolls; announced via aria-live="assertive" so screen readers hear it
 * when "Thinking…" vanishes.
 */
export function AiChatError({
  state,
  onRetry,
}: {
  state: AiChatErrorState;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-base"
    >
      <AlertCircle
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-red-700"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-red-800">{state.title}</p>
        {state.detail && (
          <p className="text-sm leading-relaxed text-red-700/80">
            {state.detail}
          </p>
        )}
        {state.retryable && (
          <div className="pt-1">
            <Button
              variant="outline"
              size="xs"
              onClick={onRetry}
              aria-label="Retry last question"
            >
              <RotateCw aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

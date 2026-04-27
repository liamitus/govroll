"use client";

/* eslint-disable react-hooks/refs --
 * The transport's body callback below reads conversationIdRef.current. It's
 * invoked by the transport at request time, not during render — the
 * react-hooks/refs rule doesn't follow callbacks and flags the whole useMemo
 * call. Disabling file-scoped because the access is on a dedicated line and
 * there's no render-time read anywhere else in this file.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowDown, Maximize2, MessageSquare, Send } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  generateId,
  isTextUIPart,
  type UIMessage,
} from "ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { AiPausedPanel } from "@/components/ai-paused-panel";
import {
  AiChatError,
  mapErrorToState,
  type AiChatErrorState,
} from "@/components/chat/ai-chat-error";

const MIN_WIDTH = 380;
const MAX_WIDTH_VW = 0.95;
const DEFAULT_WIDTH = 640;
const WIDTH_STORAGE_KEY = "govroll:ai-chat:width";

/** Message metadata streamed from the server with the `start` part. */
type ChatMetadata = { conversationId?: string };
type ChatMessage = UIMessage<ChatMetadata>;

/** Section permalinks emitted by the AI in reader mode look like
 *  `?section=<slug>`. Intercept those links and do an in-page jump
 *  with a brief highlight; let everything else navigate normally. */
function isReaderCitationHref(href: string | undefined): href is string {
  if (!href) return false;
  if (href.startsWith("?section=")) return true;
  // Some markdown parsers drop the leading "?" — accept both forms.
  if (href.startsWith("section=")) return true;
  return false;
}

function extractSectionSlug(href: string): string | null {
  const match = href.match(/section=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function jumpToSection(slug: string) {
  const target = document.getElementById(slug);
  if (!target) return;

  const url = new URL(window.location.href);
  url.searchParams.set("section", slug);
  window.history.replaceState(null, "", url.toString());

  // Honor reduced-motion: skip the smooth scroll (which can be
  // disorienting for vestibular-sensitive users) and snap.
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  target.scrollIntoView({
    block: "start",
    behavior: reducedMotion ? "auto" : "smooth",
  });

  // Briefly flash the section background so the eye can locate it
  // after the scroll. CSS class drops itself off via animationend.
  // The .is-flashing animation is itself disabled under reduced-motion
  // by the corresponding media query in globals.css.
  target.classList.remove("is-flashing");
  // Force a reflow so the same class can be re-added back-to-back.
  void target.offsetWidth;
  target.classList.add("is-flashing");
  const onEnd = () => {
    target.classList.remove("is-flashing");
    target.removeEventListener("animationend", onEnd);
  };
  target.addEventListener("animationend", onEnd);
}

function AiMessageContent({
  text,
  readerMode = false,
}: {
  text: string;
  readerMode?: boolean;
}) {
  return (
    <ReactMarkdown
      components={{
        blockquote: ({ children }) => (
          <blockquote className="border-civic-gold/60 text-muted-foreground my-2 border-l-2 pl-3 italic">
            {children}
          </blockquote>
        ),
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => (
          <strong className="text-foreground font-semibold">{children}</strong>
        ),
        ul: ({ children }) => (
          <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
        ),
        a: ({ href, children, ...rest }) => {
          if (readerMode && isReaderCitationHref(href)) {
            const slug = extractSectionSlug(href);
            return (
              <a
                href={href}
                className="text-civic-gold font-medium underline-offset-2 hover:underline"
                onClick={(e) => {
                  if (!slug) return;
                  e.preventDefault();
                  jumpToSection(slug);
                }}
              >
                {children}
              </a>
            );
          }
          return (
            <a
              href={href}
              {...rest}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
              className="text-civic-gold underline-offset-2 hover:underline"
            >
              {children}
            </a>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/** Concatenate the text parts of a streamed assistant message. */
function messageText(message: ChatMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((p) => p.text)
    .join("");
}

export interface ChatSectionContext {
  /** Slug of the section the user is asking about (matches the
   *  reader's URL anchor). */
  sectionId: string;
  /** Heading path of the section (e.g. ["Section 5. Funding",
   *  "(a) In general"]). */
  sectionPath: string[];
}

export function AiChatbox({
  billId,
  onSignUp,
  /** Reader mode: emit + intercept section permalink citations,
   *  hide the inline input trigger (the reader provides its own
   *  floating button), enable section-scoped chips. */
  mode = "default",
  /** When provided, the chatbox is "controlled" — the parent owns
   *  the open state. Pass `controlledOpen` and `onOpenChange`
   *  together. The inline trigger is hidden in this mode. */
  controlledOpen,
  onOpenChange,
  /** Pre-scope the next question to a specific section. Sent in
   *  the request body so the chat route biases section selection
   *  and skips the first-turn cache. */
  sectionContext = null,
  /** Called when the user clicks × on the section chip to clear
   *  the scope. If omitted, the × button is hidden. */
  onClearSectionContext,
  /** Optional starter prompts shown above the input when there's no chat
   *  history yet. Click sends the question and opens the full
   *  conversation. */
  suggestedQuestions,
}: {
  billId: number;
  onSignUp?: () => void;
  mode?: "default" | "reader";
  controlledOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  sectionContext?: ChatSectionContext | null;
  onClearSectionContext?: () => void;
  suggestedQuestions?: string[];
}) {
  const { user } = useAuth();
  const userId = user?.id;

  // Latest server-assigned conversation id. Kept in a ref so the transport's
  // body closure always sees the newest value without re-creating the hook.
  const conversationIdRef = useRef<string | null>(null);

  const [aiPaused, setAiPaused] = useState<{
    incomeCents: number;
    spendCents: number;
  } | null>(null);
  const [errorState, setErrorState] = useState<AiChatErrorState | null>(null);
  const [textTier, setTextTier] = useState<
    "full" | "summary" | "title-only" | null
  >(null);

  // Open state — either controlled by the parent (reader use case)
  // or owned internally (detail page use case). The Sheet's
  // onOpenChange always flows through `setOpen` so internal close
  // affordances (Esc, click-outside) propagate up to the parent.
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const inReaderMode = mode === "reader";
  const hideInlineTrigger = inReaderMode || isControlled;
  const [input, setInput] = useState("");
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const stored = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (!stored) return DEFAULT_WIDTH;
    const n = parseInt(stored, 10);
    return Number.isNaN(n) ? DEFAULT_WIDTH : clampWidth(n);
  });
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const { containerRef, contentRef, isPinned, scrollToBottom } =
    useStickToBottom();

  // The body callback is invoked by the transport at request time so it can
  // read the latest conversationId without forcing the transport (and the
  // whole chat) to rebuild whenever that id changes.
  const buildBody = useCallback(
    () => ({
      billId,
      conversationId: conversationIdRef.current,
      sectionContext,
      mode: inReaderMode ? "reader" : undefined,
    }),
    [billId, sectionContext, inReaderMode],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: "/api/ai/chat",
        body: buildBody,
      }),
    [buildBody],
  );

  const { messages, setMessages, sendMessage, regenerate, status, clearError } =
    useChat<ChatMessage>({
      transport,
      onFinish: ({ message }) => {
        const id = (message.metadata as ChatMetadata | undefined)
          ?.conversationId;
        if (id) conversationIdRef.current = id;
      },
      onError: (err) => {
        // Attempt to decode structured server errors (429/503/auth). On
        // success-status streams the error will be a generic transport error
        // and we fall back to the generic mapping.
        const parsed = parseServerError(err);
        if (parsed?.kind === "ai_disabled") {
          setAiPaused({
            incomeCents: parsed.incomeCents,
            spendCents: parsed.spendCents,
          });
          // Drop the user's optimistic message — no answer is coming this month.
          setMessages((prev) => prev.slice(0, -1));
          return;
        }
        setErrorState(
          mapErrorToState({
            status: parsed?.status,
            serverMessage: parsed?.message,
            isNetworkError: !parsed,
          }),
        );
      },
    });

  // Clear any lingering error banner when the user starts a fresh turn.
  useEffect(() => {
    if (status === "submitted" || status === "streaming") {
      setErrorState(null);
    }
  }, [status]);

  // Hydrate the most recent conversation for this bill on mount.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch(`/api/ai/chat?billId=${billId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.messages) return;
        if (data.conversationId)
          conversationIdRef.current = data.conversationId;
        const hydrated: ChatMessage[] = data.messages.map(
          (m: { sender: "user" | "ai"; text: string }) => ({
            id: generateId(),
            role: m.sender === "user" ? "user" : "assistant",
            parts: [{ type: "text" as const, text: m.text }],
          }),
        );
        setMessages(hydrated);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [billId, userId, setMessages]);

  // Probe what AI context is actually available for this bill so we can
  // warn the user upfront if we only have a summary (or just the title).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bills/${billId}/ai-context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.tier) return;
        setTextTier(d.tier);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [billId]);

  // Focus input when sheet opens
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => sheetInputRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
  }, [open]);

  const isBusy = status === "submitted" || status === "streaming";

  const submit = useCallback(
    (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || !user || isBusy) return;
      setInput("");
      setErrorState(null);
      clearError();
      // User just submitted — force-pin so they see their message + the
      // streaming response, even if they were scrolled up reading history.
      scrollToBottom();
      void sendMessage({ text });
    },
    [input, user, isBusy, clearError, sendMessage, scrollToBottom],
  );

  const retryLast = useCallback(() => {
    setErrorState(null);
    clearError();
    void regenerate();
  }, [clearError, regenerate]);

  // Submit from the inline trigger → opens sheet AND sends the message
  const submitFromTrigger = useCallback(() => {
    const text = input.trim();
    if (!text) {
      setOpen(true);
      return;
    }
    setOpen(true);
    submit(text);
  }, [input, submit, setOpen]);

  // Drag-to-resize the sheet
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startX - e.clientX;
    const next = clampWidth(dragRef.current.startWidth + delta);
    setWidth(next);
  };
  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
  };

  if (!user) {
    return (
      <div className="text-muted-foreground text-base">
        <button
          type="button"
          onClick={onSignUp}
          className="hover:text-primary font-medium underline underline-offset-2 transition-colors"
        >
          Sign up
        </button>{" "}
        to ask questions about this bill.
      </div>
    );
  }

  const hasHistory = messages.length > 0;
  // Assistant slot is "thinking" only before the first token arrives.
  const isThinking = status === "submitted";
  // While streaming we're already rendering partial tokens via the last
  // assistant message; no separate indicator needed.

  return (
    <>
      {aiPaused && !hideInlineTrigger && (
        <AiPausedPanel
          incomeCents={aiPaused.incomeCents}
          spendCents={aiPaused.spendCents}
        />
      )}
      {!hideInlineTrigger && (
        <div className="space-y-2">
          {!hasHistory &&
            suggestedQuestions &&
            suggestedQuestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestedQuestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => {
                      setOpen(true);
                      void sendMessage({ text: q });
                    }}
                    className="border-civic-gold/40 text-foreground/80 hover:border-civic-gold hover:bg-civic-cream/60 rounded-full border bg-white px-3 py-1 text-xs font-medium transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitFromTrigger();
                }
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpen(true)}
              aria-label="Open full chat"
              title="Open full chat"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={submitFromTrigger}
              disabled={!input.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>

          {hasHistory && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
            >
              <MessageSquare className="h-3 w-3" />
              Continue conversation ({messages.length}{" "}
              {messages.length === 1 ? "message" : "messages"})
            </button>
          )}
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent width={width}>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panel"
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            className="hover:bg-civic-gold/30 active:bg-civic-gold/60 absolute inset-y-0 left-0 z-20 hidden w-1.5 cursor-col-resize transition-colors sm:block"
          />

          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <svg
                className="text-civic-gold h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              Ask AI About This Bill
            </SheetTitle>
            <SheetDescription>
              {textTier === "title-only"
                ? "Answers based on title and metadata only — full bill text isn't yet in our system."
                : textTier === "summary"
                  ? "Answers based on the nonpartisan CRS summary — full bill text isn't yet in our system."
                  : "Plain-language answers with direct quotes from the bill text."}
            </SheetDescription>
          </SheetHeader>

          <div className="relative flex-1 overflow-hidden">
            <div
              ref={containerRef}
              className="h-full overflow-y-auto overscroll-contain px-5 py-5 [overflow-anchor:none]"
            >
              {aiPaused ? (
                <div className="flex h-full items-center justify-center px-6">
                  <AiPausedPanel
                    incomeCents={aiPaused.incomeCents}
                    spendCents={aiPaused.spendCents}
                  />
                </div>
              ) : messages.length === 0 && !isBusy && !errorState ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <p className="text-foreground mb-1 text-base font-medium">
                    Ask anything about this bill
                  </p>
                  <p className="text-muted-foreground max-w-sm text-sm">
                    Try{" "}
                    {(() => {
                      // Tier-3 bills have no text or CRS summary, so the
                      // high-value answerable questions are about metadata —
                      // who introduced it, where it is in the process — not
                      // "what does it do" which would just get hedged.
                      const suggestions =
                        textTier === "title-only"
                          ? [
                              "Who introduced this bill?",
                              "What's happened on this bill so far?",
                            ]
                          : [
                              "What does this bill actually do?",
                              "Who is most affected?",
                            ];
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => submit(suggestions[0])}
                            className="hover:text-foreground underline"
                          >
                            {suggestions[0]}
                          </button>{" "}
                          or{" "}
                          <button
                            type="button"
                            onClick={() => submit(suggestions[1])}
                            className="hover:text-foreground underline"
                          >
                            {suggestions[1]}
                          </button>
                        </>
                      );
                    })()}
                  </p>
                </div>
              ) : (
                <div ref={contentRef} className="space-y-4">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`text-base ${
                        msg.role === "user"
                          ? "flex justify-end"
                          : "flex justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[88%] rounded-2xl px-4 py-2.5 leading-relaxed ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {msg.role === "assistant" ? (
                          <AiMessageContent
                            text={messageText(msg)}
                            readerMode={inReaderMode}
                          />
                        ) : (
                          messageText(msg)
                        )}
                      </div>
                    </div>
                  ))}
                  {isThinking && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="flex justify-start"
                    >
                      <div className="bg-muted text-muted-foreground rounded-2xl px-4 py-2.5 text-base">
                        <span className="sr-only">Assistant is thinking. </span>
                        <span aria-hidden="true">Thinking…</span>
                      </div>
                    </div>
                  )}
                  {errorState && !isBusy && (
                    <div className="flex justify-start">
                      <div className="max-w-[88%]">
                        <AiChatError state={errorState} onRetry={retryLast} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Jump-to-latest pill — only shows when the user has scrolled
                up away from the bottom, so they can opt back into the
                auto-follow stream without hunting for the edge. */}
            {!isPinned && messages.length > 0 && !aiPaused && (
              <button
                type="button"
                onClick={scrollToBottom}
                aria-label={
                  isBusy ? "Jump to latest response" : "Jump to latest message"
                }
                className="bg-background hover:bg-muted text-foreground absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md transition-colors"
              >
                <ArrowDown className="h-3.5 w-3.5" />
                {isBusy ? "Jump to latest" : "New messages"}
              </button>
            )}
          </div>

          <div className="bg-background border-t px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {sectionContext ? (
              <div className="border-civic-gold/40 bg-civic-gold/10 mb-2 flex items-center justify-between rounded-md px-2 py-1.5 text-xs">
                <span className="text-foreground min-w-0 truncate">
                  <span className="text-muted-foreground">Asking about:</span>{" "}
                  {sectionContext.sectionPath.join(" › ")}
                </span>
                {onClearSectionContext ? (
                  <button
                    type="button"
                    onClick={onClearSectionContext}
                    aria-label="Clear section context"
                    className="text-muted-foreground hover:text-foreground ml-2 flex-none px-1 text-base leading-none"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Input
                ref={sheetInputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                disabled={isBusy}
              />
              <Button
                onClick={() => submit()}
                disabled={isBusy || !input.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function clampWidth(n: number): number {
  const max =
    typeof window !== "undefined" ? window.innerWidth * MAX_WIDTH_VW : 1200;
  return Math.max(MIN_WIDTH, Math.min(max, n));
}

/**
 * Attempt to parse the JSON body that accompanied a non-stream HTTP error.
 * useChat surfaces such errors as `Error` with the body text stringified in
 * `message`; this recovers the status + structured fields so the error bubble
 * can show the right copy and budget-exhausted responses can route to the
 * paused panel.
 */
function parseServerError(
  err: unknown,
):
  | { kind: "ai_disabled"; incomeCents: number; spendCents: number }
  | { kind: "http"; status?: number; message?: string }
  | null {
  if (!(err instanceof Error)) return null;
  const match = err.message.match(/\{[\s\S]*\}$/);
  if (!match) return { kind: "http", message: err.message };
  try {
    const parsed = JSON.parse(match[0]) as {
      error?: string;
      budget?: { incomeCents?: number; spendCents?: number };
    };
    if (parsed?.error === "ai_disabled") {
      return {
        kind: "ai_disabled",
        incomeCents: parsed.budget?.incomeCents ?? 0,
        spendCents: parsed.budget?.spendCents ?? 0,
      };
    }
    return { kind: "http", message: parsed?.error };
  } catch {
    return { kind: "http", message: err.message };
  }
}

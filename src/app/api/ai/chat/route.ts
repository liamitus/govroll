import { NextRequest, NextResponse } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  isTextUIPart,
  type UIMessage,
} from "ai";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserId } from "@/lib/auth";
import {
  streamBillChatResponse,
  selectSectionsForQuestion,
  shouldFilterSections,
  type AiUsageRecord,
  type RepVoteContext,
} from "@/lib/ai";
import { parseSectionsFromFullText } from "@/lib/bill-sections";
import type { BillMetadata } from "@/lib/congress-api";
import { assertAiEnabled, AiDisabledError } from "@/lib/ai-gate";
import { recordSpend } from "@/lib/budget";
import {
  assertUserRateLimit,
  assertUserDailyCostCap,
  RateLimitError,
} from "@/lib/rate-limit";
import { getCachedResponse, setCachedResponse } from "@/lib/ai-cache";
import { reportError } from "@/lib/error-reporting";
import { formatStreamErrorForClient } from "@/lib/ai-chat-stream-errors";
import { hasWhyIntent } from "@/lib/rep-mention";

/** Max characters allowed in a single user message. */
const MAX_MESSAGE_LENGTH = 2000;

/** Max AI chat requests per user per hour. Kept tight while pre-launch
 *  — caps a single bad actor's monthly spend at ~$470/account. Loosen
 *  once there's real traffic data to size against. */
const MAX_CHAT_PER_USER_PER_HOUR = 5;

/** Max AI chat *cost* per user per 24 hours, in cents. The hourly request
 *  cap alone isn't enough — a single chat turn on a 400-min-read omnibus
 *  can cost ~$0.20, so 5 turns/hr × 24h = 120 turns × $0.20 = $24/day for
 *  one motivated user. The cents-based cap is the actual ceiling: 50¢/day
 *  buys ~25 small-bill turns or ~3-5 omnibus turns, plenty for a real
 *  user, painfully limiting for an attacker who specifically targets
 *  expensive bills. Loosen once we see what real engagement looks like. */
const MAX_CHAT_COST_PER_USER_PER_DAY_CENTS = 50;

/**
 * Fluid Compute lets Hobby reach 300s. Bill chat is typically 5–15s end to
 * end; we set the ceiling generously so extremely large bills don't get
 * truncated.
 */
export const maxDuration = 300;

/** Metadata streamed to the client so `useChat` can learn the conversation id. */
interface ChatMessageMetadata {
  conversationId?: string;
}

// ─────────────────────────────────────────────────────────────────────────
//  GET — hydrate the most recent conversation for this bill + user
// ─────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { userId, error } = await getAuthenticatedUserId();
  if (error) return error;

  const billId = request.nextUrl.searchParams.get("billId");

  if (!billId) {
    return NextResponse.json(
      { error: "Missing required query parameter: billId." },
      { status: 400 },
    );
  }

  try {
    const conversation = await prisma.conversation.findFirst({
      where: { billId: parseInt(billId), userId },
      orderBy: { createdAt: "desc" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404 },
      );
    }

    const messages = conversation.messages.map(
      ({ sender, text, createdAt }) => ({
        sender,
        text,
        createdAt,
      }),
    );

    return NextResponse.json({
      conversationId: conversation.id,
      createdAt: conversation.createdAt,
      messages,
    });
  } catch (error) {
    console.error("Error retrieving conversation:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  POST — streaming chat turn (Anthropic API via @ai-sdk/anthropic)
// ─────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { userId, error: authError } = await getAuthenticatedUserId();
  if (authError) return authError;

  let body: {
    messages?: UIMessage[];
    billId?: string | number;
    conversationId?: string | null;
    /** Optional reader-side context: pre-scope the question to a
     *  specific section. Biases section selection in the AI prompt
     *  and disables the first-turn cache (since two askers may have
     *  different scopes for the same passage). */
    sectionContext?: { sectionId: string; sectionPath: string[] } | null;
    /** "reader" → AI emits markdown-link citations the reader can
     *  intercept; otherwise the default human attribution. */
    mode?: "reader" | "default" | null;
    /** When the client's intent detector identified a representative the
     *  user is asking about, the bioguideId is forwarded so the server can
     *  resolve a verified vote fact and inject it into the system prompt.
     *  We never trust client-supplied vote details — the lookup happens
     *  server-side against the same DB the UI reads. */
    mentionedRepBioguideId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }

  const uiMessages = Array.isArray(body.messages) ? body.messages : [];
  const lastMessage = uiMessages[uiMessages.length - 1];
  const userMessageText = lastMessage
    ? lastMessage.parts
        .filter(isTextUIPart)
        .map((p) => p.text)
        .join("")
        .trim()
    : "";

  if (!body.billId || !userMessageText) {
    return NextResponse.json(
      { error: "Missing required fields." },
      { status: 400 },
    );
  }

  if (userMessageText.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` },
      { status: 400 },
    );
  }

  const sectionContext =
    body.sectionContext && Array.isArray(body.sectionContext.sectionPath)
      ? {
          sectionId: String(body.sectionContext.sectionId ?? ""),
          sectionPath: body.sectionContext.sectionPath.filter(
            (s): s is string => typeof s === "string",
          ),
        }
      : null;
  const readerMode = body.mode === "reader";
  const mentionedRepBioguideId =
    typeof body.mentionedRepBioguideId === "string" &&
    body.mentionedRepBioguideId.trim().length > 0
      ? body.mentionedRepBioguideId.trim()
      : null;

  // When section-scoped, prepend a relevance hint to the user message
  // for AI biasing. We keep `userMessageText` as the original (for DB
  // persistence + cache lookup parity) and use `aiUserMessage` only
  // for the AI input.
  const aiUserMessage =
    sectionContext && sectionContext.sectionPath.length > 0
      ? `[Asking about ${sectionContext.sectionPath.join(" > ")}]: ${userMessageText}`
      : userMessageText;

  try {
    // ── Pre-stream gates ───────────────────────────────────────────────
    await assertUserRateLimit(userId, "chat", MAX_CHAT_PER_USER_PER_HOUR);
    await assertUserDailyCostCap(
      userId,
      "chat",
      MAX_CHAT_COST_PER_USER_PER_DAY_CENTS,
    );
    await assertAiEnabled("chat");

    const numericBillId =
      typeof body.billId === "number" ? body.billId : parseInt(body.billId);

    // ── Conversation resolution + user message persistence ─────────────
    let conversation;
    if (body.conversationId) {
      conversation = await prisma.conversation.findUnique({
        where: { id: body.conversationId },
      });
      if (!conversation || conversation.userId !== userId) {
        return NextResponse.json(
          { error: "Conversation not found." },
          { status: 404 },
        );
      }
    } else {
      conversation = await prisma.conversation.create({
        data: { userId, billId: numericBillId },
      });
    }

    // Persist the user message pre-stream so a mid-stream failure still
    // leaves the user's turn in the thread for retry. The intent columns
    // (`mentionedRepBioguideId`, `wasWhyIntent`) are written here even
    // though the verified-vote lookup happens further down — the demand
    // signal we want is "how often did users TRY to ask 'why did X vote'",
    // independent of whether we had a vote on file. That distinction
    // matters when sizing the web-search add-on: a mention with no vote
    // record points at data gaps, not at user intent.
    const wasWhyIntent =
      mentionedRepBioguideId != null && hasWhyIntent(userMessageText);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: "user",
        text: userMessageText,
        mentionedRepBioguideId,
        wasWhyIntent,
      },
    });

    // ── Bill context ───────────────────────────────────────────────────
    // When bill text is missing (tier-2/3), the AI leans heavily on
    // metadata — so pull the action timeline and a cosponsor sample too.
    // Caps below keep the prompt bounded on long-running bills.
    const ACTION_HISTORY_LIMIT = 15;
    const COSPONSOR_ROSTER_LIMIT = 20;

    const [bill, latestVersion] = await Promise.all([
      prisma.bill.findUnique({
        where: { id: numericBillId },
        include: {
          actions: {
            orderBy: { actionDate: "desc" },
            take: ACTION_HISTORY_LIMIT,
          },
          cosponsors: {
            orderBy: { sponsoredAt: "asc" },
            take: COSPONSOR_ROSTER_LIMIT,
            include: { representative: true },
          },
        },
      }),
      prisma.billTextVersion.findFirst({
        where: { billId: numericBillId, fullText: { not: null } },
        orderBy: { versionDate: "desc" },
        select: { fullText: true },
      }),
    ]);

    const rawText = latestVersion?.fullText || bill?.fullText || null;
    const allSections = rawText ? parseSectionsFromFullText(rawText) : null;
    const metadata: BillMetadata | null = bill
      ? {
          sponsor: bill.sponsor,
          cosponsorCount: bill.cosponsorCount,
          cosponsorPartySplit: bill.cosponsorPartySplit,
          policyArea: bill.policyArea,
          latestActionDate: bill.latestActionDate
            ? bill.latestActionDate.toISOString().slice(0, 10)
            : null,
          latestActionText: bill.latestActionText,
          shortText: bill.shortText,
          popularTitle: bill.popularTitle,
          displayTitle: bill.displayTitle,
          shortTitle: bill.shortTitle,
          billType: bill.billType ? bill.billType.toUpperCase() : null,
          chamber: bill.currentChamber,
          introducedDate: bill.introducedDate
            ? bill.introducedDate.toISOString().slice(0, 10)
            : null,
          currentStatus: bill.currentStatus,
          actions: bill.actions
            // Prisma gave us newest-first for the take limit; flip to
            // chronological so the AI reads it as a timeline.
            .slice()
            .reverse()
            .map((a) => ({
              date: a.actionDate.toISOString().slice(0, 10),
              text: a.text,
            })),
          cosponsors: bill.cosponsors.map((c) => {
            const r = c.representative;
            const titleBase = r.chamber === "Senate" ? "Sen." : "Rep.";
            const district =
              r.chamber === "Senate"
                ? r.state
                : r.district
                  ? `${r.state}-${r.district}`
                  : r.state;
            return `${titleBase} ${r.firstName} ${r.lastName} (${r.party}-${district})`;
          }),
        }
      : null;

    // ── Resolve verified vote fact for the mentioned rep ──────────────
    // We look up the rep + their best vote on this bill server-side so the
    // client can never spoof "Rep X voted Yes" into the prompt.
    let repVoteContext: RepVoteContext | null = null;
    if (mentionedRepBioguideId) {
      repVoteContext = await resolveRepVoteContext(
        mentionedRepBioguideId,
        numericBillId,
        userMessageText,
      );
    }

    // ── First-turn cache short-circuit ─────────────────────────────────
    // Previously stored conversation messages (before this turn) count:
    // uiMessages length minus the one we just added. We also skip cache
    // when sectionContext is set — the same question scoped to two
    // different sections may have meaningfully different answers, and
    // collapsing them would surface the wrong one. A rep mention does the
    // same: "why did Sanders vote no" and "why did Kelly vote yes" must
    // not collide on cache.
    const isFirstTurn =
      uiMessages.length <= 1 && !sectionContext && !repVoteContext;
    if (isFirstTurn) {
      const cached = await getCachedResponse(numericBillId, userMessageText);
      if (cached) {
        // Persist AI response row + ledger entry, then synthesize a stream
        // so the client uses a single code path for cache and live paths.
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            sender: "ai",
            text: cached.response,
          },
        });
        try {
          await recordSpend({
            userId,
            feature: "chat",
            model: `${cached.model}:cache-hit`,
            inputTokens: 0,
            outputTokens: 0,
          });
        } catch {
          // non-critical
        }

        return emitSyntheticTextStream({
          text: cached.response,
          conversationId: conversation.id,
        });
      }
    }

    // ── Large-bill pre-filter (non-streaming) ──────────────────────────
    let sectionsToUse = allSections;
    if (allSections && shouldFilterSections(allSections)) {
      const filtered = await selectSectionsForQuestion(
        bill?.title || "Unknown Bill",
        allSections,
        aiUserMessage,
      );
      sectionsToUse = filtered.sections;
      await tryRecordSpend({
        userId,
        feature: "chat",
        usage: filtered.usage,
      });
    }

    // ── Main streaming call ────────────────────────────────────────────
    // Replace the last user UI message with `aiUserMessage` (the
    // section-prefixed version) so the model sees the relevance hint
    // without polluting the user-visible thread. The original text is
    // already persisted to the DB above.
    const aiUiMessages: UIMessage[] =
      sectionContext && uiMessages.length > 0
        ? uiMessages.map((m, i) =>
            i === uiMessages.length - 1
              ? {
                  ...m,
                  parts: [{ type: "text" as const, text: aiUserMessage }],
                }
              : m,
          )
        : uiMessages;

    const streamResult = await streamBillChatResponse({
      billTitle: bill?.title || "Unknown Bill",
      billSections: sectionsToUse,
      metadata,
      uiMessages: aiUiMessages,
      readerMode,
      repVoteContext,
      onBudget: (diagnostics) => {
        // Only emit when something was actually trimmed — the common case
        // is silent. The signal we want is "how often do real users hit
        // truncation on what bills" so we can decide whether 1M-context
        // routing is worth building.
        if (
          diagnostics.sectionsTruncated ||
          diagnostics.sectionsDropped > 0 ||
          diagnostics.sectionsContentTruncated > 0 ||
          diagnostics.historyDropped > 0
        ) {
          console.warn(
            JSON.stringify({
              event: "chat_context_truncated",
              route: "POST /api/ai/chat",
              userId,
              billId: numericBillId,
              billTitle: bill?.title,
              ...diagnostics,
            }),
          );
        }
      },
      onFinish: async ({ text, usage }) => {
        await tryRecordSpend({ userId, feature: "chat", usage });

        if (isFirstTurn) {
          try {
            await setCachedResponse(
              numericBillId,
              userMessageText,
              text,
              usage.model,
            );
          } catch {
            // non-critical — cache write failure shouldn't break the response
          }
        }

        try {
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              sender: "ai",
              text,
            },
          });
        } catch (err) {
          console.error("Failed to persist AI message:", err);
          reportError(err, { route: "POST /api/ai/chat onFinish" });
        }
      },
      onError: ({ error }) => {
        console.error(
          JSON.stringify({
            event: "api_error",
            route: "POST /api/ai/chat stream",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        reportError(error, { route: "POST /api/ai/chat stream" });
      },
    });

    return streamResult.toUIMessageStreamResponse<
      UIMessage<ChatMessageMetadata>
    >({
      messageMetadata: ({ part }) => {
        if (part.type === "start") {
          return { conversationId: conversation.id };
        }
        return undefined;
      },
      // Default is an opaque "An error occurred." — pass an actionable
      // string so the client can surface the real cause (billing, auth,
      // timeout, etc.) rather than a generic "Something went wrong".
      onError: formatStreamErrorForClient,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(error.toJSON(), { status: 429 });
    }
    if (error instanceof AiDisabledError) {
      return NextResponse.json(error.toJSON(), { status: 503 });
    }
    console.error(
      JSON.stringify({
        event: "api_error",
        route: "POST /api/ai/chat",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    reportError(error, { route: "POST /api/ai/chat" });
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────

async function tryRecordSpend(args: {
  userId: string;
  feature: "chat";
  usage: AiUsageRecord;
}) {
  try {
    await recordSpend({
      userId: args.userId,
      feature: args.feature,
      model: args.usage.model,
      inputTokens: args.usage.inputTokens,
      outputTokens: args.usage.outputTokens,
      cache: args.usage.cache,
    });
  } catch (err) {
    console.error("Failed to record AI spend:", err);
  }
}

/**
 * Look up the rep + their best vote on this bill, plus a "why" intent flag
 * derived from the user's message wording. Mirrors the prioritization in
 * `/api/representatives` (passage > uncategorized > procedural) so the
 * vote we surface to the prompt matches the vote shown in the rep card.
 *
 * Returns null when the rep doesn't exist or has no vote on this bill.
 * That keeps the prompt truthful — we'd rather omit the fact than inject
 * a fabricated "did not vote" line.
 */
const PASSAGE_CATEGORIES = new Set([
  "passage",
  "passage_suspension",
  "veto_override",
]);
const NON_PASSAGE_AMENDMENT_LIKE = new Set([
  "amendment",
  "procedural",
  "cloture",
  "nomination",
]);

function normalizeVoteForPrompt(vote: string): string {
  if (vote === "Yea" || vote === "Aye") return "Yes";
  if (vote === "Nay" || vote === "No") return "No";
  return vote;
}

function chamberLabelForPrompt(chamber: string | null): string | null {
  if (!chamber) return null;
  const lower = chamber.toLowerCase();
  if (lower === "house") return "House";
  if (lower === "senate") return "Senate";
  return chamber;
}

async function resolveRepVoteContext(
  bioguideId: string,
  billId: number,
  userMessageText: string,
): Promise<RepVoteContext | null> {
  const rep = await prisma.representative.findUnique({
    where: { bioguideId },
    select: {
      firstName: true,
      lastName: true,
      party: true,
      state: true,
      district: true,
      chamber: true,
    },
  });
  if (!rep) return null;

  type VoteRow = {
    vote: string;
    category: string | null;
    rollCallNumber: number | null;
    chamber: string | null;
    votedAt: Date | null;
  };
  const allVotes = (await prisma.representativeVote.findMany({
    where: { billId, representative: { bioguideId } },
    orderBy: { votedAt: "desc" },
    select: {
      vote: true,
      category: true,
      rollCallNumber: true,
      chamber: true,
      votedAt: true,
    },
  })) as VoteRow[];

  if (allVotes.length === 0) return null;

  // Same prioritization as /api/representatives so the prompt fact and
  // the on-page rep card never disagree.
  const passage = allVotes.find(
    (v: VoteRow) => v.category && PASSAGE_CATEGORIES.has(v.category),
  );
  const uncategorized = allVotes.find((v: VoteRow) => !v.category);
  const other = allVotes.find(
    (v: VoteRow) =>
      v.category &&
      !PASSAGE_CATEGORIES.has(v.category) &&
      !NON_PASSAGE_AMENDMENT_LIKE.has(v.category),
  );
  const amendmentLike = allVotes.find(
    (v: VoteRow) => v.category && NON_PASSAGE_AMENDMENT_LIKE.has(v.category),
  );
  const best = passage ?? uncategorized ?? other ?? amendmentLike ?? null;
  if (!best) return null;

  const titlePrefix = rep.chamber === "Senate" ? "Sen." : "Rep.";
  const districtSuffix =
    rep.chamber === "Senate"
      ? rep.state
      : rep.district
        ? `${rep.state}-${rep.district}`
        : rep.state;
  const partyChar = rep.party?.charAt(0) ?? "";
  const displayName = `${titlePrefix} ${rep.firstName} ${rep.lastName} (${partyChar}-${districtSuffix})`;

  const isWhyIntent = hasWhyIntent(userMessageText);

  return {
    displayName,
    voteLabel: normalizeVoteForPrompt(best.vote),
    voteDate: best.votedAt ? best.votedAt.toISOString().slice(0, 10) : null,
    chamber: chamberLabelForPrompt(best.chamber),
    rollCallNumber: best.rollCallNumber,
    isWhyIntent,
  };
}

/**
 * Produce a minimal UIMessage stream carrying a single pre-computed text
 * payload. Used for cache hits so the client gets an identical streaming
 * shape regardless of whether the answer came from the model or cache.
 */
function emitSyntheticTextStream(args: {
  text: string;
  conversationId: string;
}): Response {
  const stream = createUIMessageStream<UIMessage<ChatMessageMetadata>>({
    execute: ({ writer }) => {
      const id = "cache";
      writer.write({
        type: "start",
        messageMetadata: { conversationId: args.conversationId },
      });
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: args.text });
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

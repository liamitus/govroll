/**
 * AI integration layer — direct Anthropic API via the AI SDK.
 *
 * Calls go straight to Anthropic using `@ai-sdk/anthropic`, authenticated
 * with `ANTHROPIC_API_KEY`. This skips Vercel AI Gateway and its
 * per-event observability charge; per-call usage is still recorded in the
 * local spend ledger via `recordSpend`.
 */

import {
  streamText,
  generateText,
  generateObject,
  type StreamTextResult,
  type ModelMessage,
  type UIMessage,
  convertToModelMessages,
} from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

import type { BillSection } from "./bill-sections";
import { buildSectionIndex, filterSections } from "./bill-sections";
import { sectionSlugFromHeading } from "./section-slug";
import type { BillMetadata } from "./congress-api";
import type { CacheTokenBreakdown } from "./ai-pricing";

/** Canonical usage shape consumed by the spend ledger. */
export interface AiUsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Optional cache breakdown so the cost calc can apply Anthropic's
   *  tiered rates (cheaper reads, slightly pricier writes). Absent for
   *  callers that don't use prompt caching (Haiku filters, change
   *  summaries, etc.). */
  cache?: CacheTokenBreakdown;
}

const SONNET_MODEL = "claude-sonnet-4-20250514";
/** Cheaper model for bounded, structured tasks like section-picking or
 *  diff summarization where hallucination risk is inherently low. */
const HAIKU_MODEL = "claude-haiku-4-5";

/** Above this total section-text size we run a pre-pass to pick sections.
 *  Sonnet 200K-token context ≈ 600K chars; we want the pre-filter to kick
 *  in well before we hit the window, but not so eagerly that typical bills
 *  get aggressively summarized. 400K leaves headroom for metadata, history,
 *  and response tokens while still fitting mid-size legislation uncut. */
const LARGE_BILL_THRESHOLD = 400_000;

/** Cap on sections returned by the pre-filter pass. Raised from 15 because
 *  omnibus bills (NDAA, appropriations) regularly have substantive provisions
 *  spread across far more sections than that; 15 meant user questions about
 *  a specific section frequently missed. */
const MAX_FILTERED_SECTIONS = 60;

/** Fallback section count when the pre-filter JSON parse fails. Raised from
 *  30 for the same reason — keep the answer hit rate up. */
const FALLBACK_SECTION_COUNT = 120;

/** Chars per version passed to the diff-summary model. Raised from 30_000
 *  so a 4 MB NDAA diff captures more than the first ~0.7% of each side. */
const CHANGE_SUMMARY_CHARS = 120_000;

/** Chars of bill text fed to the explainer model. Kept well below Haiku's
 *  context so the CRS summary + metadata also fit comfortably. */
const EXPLAINER_TEXT_CHARS = 120_000;

/** Conservative chars-per-token estimate for legislative text. Real ratio
 *  for English prose is closer to 3.5–4; legislative text is denser
 *  (numbers, citations, defined-term capitalization). We measured 2.66
 *  on HR 7567 (Farm/Food/Defense omnibus) when a 540K-char pack produced
 *  213K real tokens — so we now under-estimate to 2.5 to leave headroom
 *  even on the densest bills. The previous value (3) silently let dense
 *  bills overflow the window. */
const CHARS_PER_TOKEN_BILL = 2.5;

/** Total input-token budget for a chat turn. Sonnet 4's window is 200K;
 *  reserving ~20K for instruction overhead, output (capped at 2048), and
 *  safety margin gives us 180K to split between bill sections and the
 *  conversation transcript. */
const MODEL_INPUT_BUDGET_TOKENS = 180_000;

/** Tokens reserved inside the budget for everything that wraps the
 *  packed sections: the system-prompt frame, citation rules, the
 *  background-knowledge clause, the metadata block (sponsor + cosponsor
 *  sample + 15-row action timeline + CRS short-summary), and any
 *  rep-vote-context block. CRS summaries on large bills can run several
 *  thousand tokens on their own; 15K is a comfortable upper bound that
 *  still leaves most of the budget for actual bill text. Without this
 *  reserve, allocateChatBudget gave the entire window to sections+history
 *  and the metadata pushed total input over 200K (HR 7567 hit 213K). */
const PROMPT_OVERHEAD_RESERVE_TOKENS = 15_000;

/** Per-section token cap. Stops a single mega-section (think an omnibus
 *  appropriations title) from monopolizing the section budget. */
const PER_SECTION_TOKEN_CAP = 30_000;
const PER_SECTION_CHAR_CAP = PER_SECTION_TOKEN_CAP * CHARS_PER_TOKEN_BILL;

/** Floor on section-text tokens, regardless of how long the conversation
 *  gets. A user asking turn-30 questions about a bill still needs the
 *  bill in context; we'd rather drop the oldest history than blind the
 *  model to the bill itself. */
const MIN_SECTION_TOKENS = 50_000;

/** Hard cap on conversation-history tokens. Long sessions on huge bills
 *  used to compound here — a 30-turn chat could pin 60K+ tokens in
 *  history alone, leaving no room for the bill text. Anything older than
 *  this gets dropped before the prompt is built. */
const MAX_HISTORY_TOKENS = 60_000;

/** Marker appended in place of trimmed bill content. Phrased so the model
 *  surfaces the elision to the user rather than answering as if the cut
 *  text never existed. */
const SECTION_TRUNCATION_NOTICE =
  "\n\n[…section continues — truncated to fit context window. Ask a follow-up scoped to this section if more detail is needed.]";

/** Anthropic prompt-cache breakpoint applied to the bill-text-bearing
 *  system message. Multi-turn chats about the same bill within the 5min
 *  TTL hit a 90%-cheaper cache read instead of paying full input rates
 *  for the bill on every turn — a typical 5-turn session drops from
 *  ~$0.95 to ~$0.44 in input cost. */
const SYSTEM_CACHE_OPTIONS = {
  anthropic: { cacheControl: { type: "ephemeral" as const } },
} as const;

// Without this carve-out, "don't invent provisions" suppresses basic background ("what is FISA?") on bills that cite a prior law without defining it.
const BACKGROUND_KNOWLEDGE_CLAUSE = `For short definitional questions about acronyms, agencies, or prior laws referenced by the bill (e.g. "what is FISA?", "what does the EPA do?"), you may answer briefly from general knowledge. Frame these as background context, not as content of this bill, and don't speculate beyond well-established facts.`;

const CITATION_INSTRUCTIONS = `When answering, quote directly from the bill text using markdown blockquotes when it helps. Attribute quotes to the section they came from:

> "exact quote from the bill"
>
> — Section 4(a)

If the user asks about something not covered in the bill sections provided, say so plainly. Do not invent provisions.

${BACKGROUND_KNOWLEDGE_CLAUSE}

Stay factual and neutral.`;

/**
 * Reader-mode citations: same blockquote shape, but the attribution
 * is a markdown link to the section's slug. The reader page intercepts
 * the click, scrolls to the matching section, and applies a brief
 * highlight animation. If the AI omits the link or formats it
 * incorrectly, plain text falls back gracefully.
 */
const CITATION_INSTRUCTIONS_READER = `When answering, quote directly from the bill text using markdown blockquotes when it helps. Attribute each quote with a markdown LINK to the section anchor in the reader. Use the slug shown in brackets after each section's heading, in the form \`?section=<slug>\`:

> "exact quote from the bill"
>
> — [Section 4(a)](?section=sec-4--a)

If the user asks about something not covered in the bill sections provided, say so plainly. Do not invent provisions.

${BACKGROUND_KNOWLEDGE_CLAUSE}

Stay factual and neutral.`;

// ─────────────────────────────────────────────────────────────────────────
//  Prompt builders
// ─────────────────────────────────────────────────────────────────────────

/** Cap on cosponsors listed in the prompt — the count + party split stays
 *  authoritative for totals; this just gives the AI a sample to name. */
const MAX_PROMPT_COSPONSORS = 15;

function formatMetadataForPrompt(metadata: BillMetadata | null): string {
  if (!metadata) return "";
  const lines: string[] = [];
  if (metadata.billType || metadata.chamber) {
    const parts: string[] = [];
    if (metadata.billType) parts.push(metadata.billType);
    if (metadata.chamber) parts.push(`${metadata.chamber} bill`);
    lines.push(`Type: ${parts.join(" — ")}`);
  }
  if (metadata.introducedDate)
    lines.push(`Introduced: ${metadata.introducedDate}`);
  if (metadata.currentStatus)
    lines.push(`Current status: ${metadata.currentStatus}`);
  if (metadata.sponsor) lines.push(`Sponsor: ${metadata.sponsor}`);
  if (metadata.cosponsorCount != null)
    lines.push(`Cosponsors: ${metadata.cosponsorCount}`);
  if (metadata.cosponsorPartySplit)
    lines.push(`Party split: ${metadata.cosponsorPartySplit}`);
  if (metadata.cosponsors && metadata.cosponsors.length > 0) {
    const shown = metadata.cosponsors.slice(0, MAX_PROMPT_COSPONSORS);
    const more = metadata.cosponsors.length - shown.length;
    lines.push(
      `Cosponsor names${more > 0 ? ` (first ${shown.length} of ${metadata.cosponsors.length})` : ""}: ${shown.join("; ")}`,
    );
  }
  if (metadata.policyArea) lines.push(`Policy area: ${metadata.policyArea}`);
  if (metadata.latestActionDate && metadata.latestActionText)
    lines.push(
      `Latest action (${metadata.latestActionDate}): ${metadata.latestActionText}`,
    );
  if (metadata.actions && metadata.actions.length > 0) {
    lines.push("");
    lines.push("Action history (oldest first):");
    for (const a of metadata.actions) lines.push(`- ${a.date}: ${a.text}`);
  }
  if (metadata.shortText) {
    lines.push("");
    lines.push("CRS summary (nonpartisan, introduced version):");
    lines.push(metadata.shortText);
  }
  return lines.join("\n");
}

function formatSectionsForPrompt(
  sections: BillSection[],
  opts: { includeSlugs?: boolean } = {},
): string {
  return sections
    .map((s) => {
      const slugLine = opts.includeSlugs
        ? `\n[slug: ${sectionSlugFromHeading(s.heading)}]`
        : "";
      return `### ${s.heading}${slugLine}\n\n${s.content}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Build the system prompt for a bill chat turn. Extracted so we can test it
 * deterministically and share between streaming and non-streaming paths.
 *
 * `opts.readerMode` switches the citation format from human-readable
 * `— Section 4(a)` to clickable markdown links `[Section 4(a)](?section=sec-4--a)`
 * AND threads each section's slug into the prompt so the AI has the
 * exact link target. The reader page intercepts these clicks for an
 * in-page jump + highlight; on the detail page (default mode) the
 * shorter human attribution is preferred.
 *
 * `opts.repVoteContext` lets the route inject a verified per-rep vote fact
 * when the user's question names a specific representative. Stops the AI
 * from claiming "I don't have voting records" (which it has historically
 * done) and steers the answer toward what *can* be said — what the bill
 * does, what the rep's vote was, plus an explicit acknowledgment that we
 * cannot infer the rep's *reasoning* without their public statements.
 */
export interface RepVoteContext {
  /** Display name, e.g. "Rep. Alexandria Ocasio-Cortez (D-NY-14)". */
  displayName: string;
  /** Normalized vote: "Yes", "No", "Present", "Did not vote". */
  voteLabel: string;
  /** ISO date of the roll call, if known. */
  voteDate: string | null;
  /** Chamber the vote occurred in, e.g. "House" or "Senate". */
  chamber: string | null;
  /** Roll call number for the vote, if known. */
  rollCallNumber: number | null;
  /** Whether the user's wording implies they want a rationale ("why did
   *  X vote nay") — when true, the prompt explicitly tells the model to
   *  acknowledge that it can't read minds and to suggest contacting the
   *  rep's office. When false, we just pin the vote fact. */
  isWhyIntent: boolean;
}

/** Tells the prompt builder that the section list is a vector-retrieved
 *  subset, not the whole bill. Without this, the model sees N
 *  disconnected fragments and reasonably hedges that it "can't see the
 *  complete bill text" — even when it found the right answer. With it,
 *  the framing surfaces that the sections were selected for relevance
 *  and that the user can rephrase to get different ones, so the model
 *  stops hedging unhelpfully. */
export interface RetrievalContext {
  /** Total parsed sections in the bill (regardless of how many were
   *  retrieved this turn). */
  totalSections: number;
  /** Sections actually included in the prompt this turn. */
  retrievedCount: number;
}

export interface BillChatPromptOptions {
  readerMode?: boolean;
  repVoteContext?: RepVoteContext | null;
  retrievalContext?: RetrievalContext | null;
}

function formatRepVoteContextBlock(ctx: RepVoteContext | null | undefined) {
  if (!ctx) return "";
  const lines: string[] = [];
  lines.push("Verified roll call fact (confirmed from our database):");
  const parts = [`${ctx.displayName} voted ${ctx.voteLabel}`];
  if (ctx.chamber) parts.push(`in the ${ctx.chamber}`);
  if (ctx.voteDate) parts.push(`on ${ctx.voteDate}`);
  if (ctx.rollCallNumber != null)
    parts.push(`(roll call #${ctx.rollCallNumber})`);
  lines.push(`- ${parts.join(" ")}.`);
  if (ctx.isWhyIntent) {
    lines.push("");
    lines.push(
      "The user is asking why this representative voted the way they did. You do NOT have access to the representative's public statements, press releases, or floor remarks — only the bill's contents and the verified vote above. Do not claim the voting record is unavailable (it is shown above). Do this in your answer:",
    );
    lines.push(
      '1. State the verified vote up front in plain language (e.g. "Rep. Smith voted No on this bill on March 12, 2026.").',
    );
    lines.push(
      "2. Explain what the bill actually does, drawing only from the bill text or summary above. Note specific provisions a member of that representative's party or constituency might object to or support. Frame these as plausible considerations, not as the representative's stated reasons.",
    );
    lines.push(
      "3. Be explicit about the limit: \"I can't read their reasoning — they haven't put a statement in front of me. The most reliable way to find out is to call their office.\" Do not invent or paraphrase statements you have not been shown.",
    );
  } else {
    lines.push("");
    lines.push(
      "When the user references this representative, ground your answer in the verified vote above and the bill's contents. Do not speculate about the representative's personal motivations.",
    );
  }
  return lines.join("\n");
}

export function buildBillChatSystemPrompt(
  billTitle: string,
  billSections: BillSection[] | null,
  metadata: BillMetadata | null = null,
  opts: BillChatPromptOptions = {},
): string {
  const metadataBlock = formatMetadataForPrompt(metadata);
  const readerMode = opts.readerMode === true;
  const repVoteBlock = formatRepVoteContextBlock(opts.repVoteContext);
  const repVoteSuffix = repVoteBlock ? `\n\n${repVoteBlock}` : "";

  // No sections — answer from title / CRS summary / metadata only.
  if (!billSections || billSections.length === 0) {
    const hasSummary =
      metadata?.shortText != null && metadata.shortText.trim().length > 0;

    if (hasSummary) {
      return `You are a helpful, nonpartisan assistant that helps citizens understand U.S. legislation. You answer questions about bills clearly and accessibly, avoiding jargon where possible.

The bill is titled "${billTitle}".

${metadataBlock}

Your primary source is the nonpartisan Congressional Research Service summary above, which describes the bill as introduced. Answer questions directly from this summary — it is substantive and authoritative. Quote from it using markdown blockquotes when helpful:

> "exact quote from the summary"
>
> — CRS summary

Only say something is not covered if the summary genuinely does not address it. Do not claim you cannot see the bill — you have its official nonpartisan summary. The full bill text may have been amended since introduction; if a user asks about specific provisions, note that the summary describes the introduced version.

${BACKGROUND_KNOWLEDGE_CLAUSE}

Stay factual and neutral.${repVoteSuffix}`;
    }

    return `You are a helpful, nonpartisan assistant that helps citizens understand U.S. legislation. You answer questions about bills clearly and accessibly, avoiding jargon where possible.

The bill is titled "${billTitle}".${metadataBlock ? `\n\nBill information:\n${metadataBlock}` : ""}

Full bill text and CRS summary are not yet available in our system — but the metadata above is accurate and sourced from Congress.gov. Treat it as authoritative.

Factual questions about who introduced the bill, who cosponsored it, its chamber or bill type, when it was introduced, its policy area, or its legislative history (the action timeline above) are all reliably answerable from this metadata — answer them directly without hedging.

For questions about specific substantive provisions of the bill (what it actually does section-by-section, dollar amounts, eligibility criteria, effective dates, enforcement mechanisms): note once at the start of your answer that the full text isn't yet in our system, then reason only from the title, policy area, and any action text — don't invent provisions. Point the user to congress.gov for specifics.

${BACKGROUND_KNOWLEDGE_CLAUSE}

Stay factual and neutral. Do not repeat the "text not available" caveat in every paragraph; one upfront mention is enough, and only when the question actually requires the bill text to answer.${repVoteSuffix}`;
  }

  const billTextBlock = formatSectionsForPrompt(billSections, {
    includeSlugs: readerMode,
  });
  const citationInstructions = readerMode
    ? CITATION_INSTRUCTIONS_READER
    : CITATION_INSTRUCTIONS;

  const retrieval = opts.retrievalContext;
  // RAG path: tell the model up front that what it sees is a relevance-
  // ranked subset, not the whole bill. Two effects we want:
  //   1. The model stops adding "without seeing the complete bill text"
  //      caveats after answers it actually got right from the
  //      retrieved sections.
  //   2. When the user's question genuinely doesn't match the retrieved
  //      sections well, the model can suggest rephrasing instead of
  //      apologizing for a gap it can't fix from inside this turn.
  const sectionsHeader = retrieval
    ? `Here are the ${retrieval.retrievedCount} sections of "${billTitle}" most semantically relevant to the user's question, retrieved from a corpus of ${retrieval.totalSections} parsed sections in this bill. The bill is too long to include in full; treat what's below as the most likely-relevant subset, not the entire bill.`
    : `Here is the text of "${billTitle}", organized by section:`;

  // Citation rules need a different "what to do when something isn't
  // here" clause for RAG vs full-text — full-text means it's not in the
  // bill, RAG means it might be in a section we didn't retrieve.
  const retrievalNotePresent = retrieval
    ? `\n\nIf the user's question doesn't appear to be addressed in the sections above, say so plainly and suggest they rephrase to surface different sections — don't claim the bill is silent unless the question is clearly off-topic for the bill's policy area. Don't add caveats about "not seeing the complete bill" when the retrieved sections actually answer the question.`
    : "";

  return `You are a helpful, nonpartisan assistant that helps citizens understand U.S. legislation. You answer questions clearly and accessibly, prioritizing direct quotes from the bill text.

${metadataBlock ? `Bill information:\n${metadataBlock}\n\n` : ""}${sectionsHeader}

${billTextBlock}

${citationInstructions}${retrievalNotePresent}${repVoteSuffix}`;
}

// ─────────────────────────────────────────────────────────────────────────
//  Section filtering (pre-stream, non-streaming)
// ─────────────────────────────────────────────────────────────────────────

/** Whether a bill is large enough to warrant the pre-filter pass. */
export function shouldFilterSections(billSections: BillSection[]): boolean {
  const totalChars = billSections.reduce(
    (sum, s) => sum + s.heading.length + s.content.length,
    0,
  );
  return totalChars > LARGE_BILL_THRESHOLD;
}

export interface PackSectionsResult {
  sections: BillSection[];
  /** True when at least one section was dropped or truncated. */
  truncated: boolean;
  /** Number of sections dropped entirely (after the budget ran out). */
  droppedCount: number;
  /** Number of sections kept but with trimmed content. */
  truncatedCount: number;
  /** Sum of heading + content chars in the original input. */
  originalChars: number;
  /** Sum of heading + content chars in the packed output. */
  packedChars: number;
  /** Char budget that was applied (so the caller can attribute the cause). */
  budgetChars: number;
}

/**
 * Greedy pack: include sections in order, truncating any single section
 * that exceeds the per-section cap and stopping entirely once the total
 * char budget is exhausted. Preserves the original ordering produced by
 * the parser or relevance filter.
 *
 * `budgetTokens` defaults to the section share of the input window when
 * unspecified; `streamBillChatResponse` passes a smaller value when a
 * long conversation history is competing for room.
 *
 * Returns full diagnostic info; the legacy single-array shape is exposed
 * via `packSectionsToBudget` for the simple cases that don't care.
 */
export function packSectionsToBudgetWithDiagnostics(
  sections: BillSection[],
  budgetTokens: number = MODEL_INPUT_BUDGET_TOKENS -
    MAX_HISTORY_TOKENS -
    PROMPT_OVERHEAD_RESERVE_TOKENS,
): PackSectionsResult {
  const budgetChars = budgetTokens * CHARS_PER_TOKEN_BILL;

  // Per-section overhead beyond raw content: heading text, "### " prefix,
  // optional "[slug: …]" line, "\n\n---\n\n" separator. 80 chars is a
  // comfortable upper bound that still produces a useful budget.
  const PER_SECTION_OVERHEAD = 80;

  const originalChars = sections.reduce(
    (sum, s) =>
      sum + PER_SECTION_OVERHEAD + s.heading.length + s.content.length,
    0,
  );

  let totalCost = 0;
  let needsPacking = false;
  for (const s of sections) {
    if (s.content.length > PER_SECTION_CHAR_CAP) {
      needsPacking = true;
      break;
    }
    totalCost += PER_SECTION_OVERHEAD + s.heading.length + s.content.length;
    if (totalCost > budgetChars) {
      needsPacking = true;
      break;
    }
  }
  if (!needsPacking) {
    return {
      sections,
      truncated: false,
      droppedCount: 0,
      truncatedCount: 0,
      originalChars,
      packedChars: originalChars,
      budgetChars,
    };
  }

  const packed: BillSection[] = [];
  let used = 0;
  let truncatedCount = 0;
  for (const s of sections) {
    const headingCost = PER_SECTION_OVERHEAD + s.heading.length;
    const remaining = budgetChars - used - headingCost;
    // No point including a section we'd render as headline + a few words.
    if (remaining < 2_000) break;

    let content = s.content;
    let wasTrimmed = false;
    if (content.length > PER_SECTION_CHAR_CAP) {
      content =
        content.slice(0, PER_SECTION_CHAR_CAP) + SECTION_TRUNCATION_NOTICE;
      wasTrimmed = true;
    }
    if (content.length > remaining) {
      content = content.slice(0, remaining) + SECTION_TRUNCATION_NOTICE;
      wasTrimmed = true;
    }
    if (wasTrimmed) truncatedCount++;
    packed.push({ ...s, content });
    used += headingCost + content.length;
  }

  return {
    sections: packed,
    truncated: true,
    droppedCount: sections.length - packed.length,
    truncatedCount,
    originalChars,
    packedChars: used,
    budgetChars,
  };
}

/**
 * Convenience wrapper preserving the original return shape — most callers
 * just want the packed sections without diagnostics.
 */
export function packSectionsToBudget(
  sections: BillSection[],
  budgetTokens?: number,
): BillSection[] {
  return packSectionsToBudgetWithDiagnostics(sections, budgetTokens).sections;
}

// ─────────────────────────────────────────────────────────────────────────
//  Token estimation + budget allocation
// ─────────────────────────────────────────────────────────────────────────

/** Rough chars-per-token for chat-style English (user questions + AI
 *  responses, mostly prose). Higher than the bill-text constant because
 *  prose tokenizes denser than legislative text. */
const CHARS_PER_TOKEN_CHAT = 4;

function estimateMessageTokens(message: ModelMessage): number {
  // Each message has fixed framing overhead in the API; ~4 tokens covers
  // role + delimiter + close.
  const FRAMING_TOKENS = 4;
  let chars = 0;
  const content = message.content;
  if (typeof content === "string") {
    chars += content.length;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === "object" && part !== null && "text" in part) {
        const t = (part as { text?: unknown }).text;
        if (typeof t === "string") chars += t.length;
      }
    }
  }
  return FRAMING_TOKENS + Math.ceil(chars / CHARS_PER_TOKEN_CHAT);
}

/**
 * Drop the oldest history turns until the remaining transcript fits the
 * given token budget. Always preserves the final message (the user's
 * current question) and never lets the kept transcript start with an
 * assistant turn — Anthropic rejects assistant-first conversations.
 */
export function truncateHistoryToBudget(
  messages: ModelMessage[],
  budgetTokens: number,
): { messages: ModelMessage[]; droppedCount: number; tokens: number } {
  if (messages.length === 0) {
    return { messages, droppedCount: 0, tokens: 0 };
  }

  const last = messages[messages.length - 1];
  const lastTokens = estimateMessageTokens(last);
  const kept: ModelMessage[] = [last];
  let used = lastTokens;

  // Walk backwards, prepending until the budget is reached.
  for (let i = messages.length - 2; i >= 0; i--) {
    const t = estimateMessageTokens(messages[i]);
    if (used + t > budgetTokens) break;
    kept.unshift(messages[i]);
    used += t;
  }

  // Anthropic requires the first non-system message to be `user`. If
  // truncation left us with [assistant, user, …] at the front, drop the
  // lead assistant — including its tokens in the dropped count.
  while (kept.length > 1 && kept[0].role === "assistant") {
    used -= estimateMessageTokens(kept[0]);
    kept.shift();
  }

  return {
    messages: kept,
    droppedCount: messages.length - kept.length,
    tokens: used,
  };
}

export interface ChatBudgetAllocation {
  /** Token budget the section packer should target. */
  sectionTokens: number;
  /** Token budget the history truncator should target. */
  historyTokens: number;
  /** Estimated history tokens before truncation (for diagnostics). */
  historyTokensRaw: number;
}

/**
 * Decide how to split the model's input budget between bill-text and
 * conversation history for this turn. History gets priority up to a hard
 * cap (`MAX_HISTORY_TOKENS`); whatever's left — minus the
 * `PROMPT_OVERHEAD_RESERVE_TOKENS` carved out for instructions, citation
 * rules, and the metadata block — goes to sections, with a floor
 * (`MIN_SECTION_TOKENS`) so the bill is never starved.
 *
 * The overhead reserve is essential: the system prompt isn't just
 * "instructions plus sections" — it also carries the CRS summary, action
 * timeline, cosponsor sample, citation rules, and (sometimes) a verified
 * rep-vote block. On HR 7567 these collectively ran ~10K tokens, and
 * without the reserve the section pack happily filled the rest of the
 * budget, pushing total input above 200K.
 */
export function allocateChatBudget(
  history: ModelMessage[],
): ChatBudgetAllocation {
  const historyRaw = history.reduce(
    (sum, m) => sum + estimateMessageTokens(m),
    0,
  );
  const historyTokens = Math.min(historyRaw, MAX_HISTORY_TOKENS);
  const sectionTokens = Math.max(
    MIN_SECTION_TOKENS,
    MODEL_INPUT_BUDGET_TOKENS - historyTokens - PROMPT_OVERHEAD_RESERVE_TOKENS,
  );
  return {
    sectionTokens,
    historyTokens,
    historyTokensRaw: historyRaw,
  };
}

/**
 * Ask a cheap model which sections are relevant to the user's question.
 * Returns a trimmed section list plus a usage record for the spend ledger.
 *
 * Bounded classification over a table of contents — Haiku is sufficient and
 * cuts the first-leg latency roughly in half vs. Sonnet.
 */
export async function selectSectionsForQuestion(
  billTitle: string,
  allSections: BillSection[],
  userMessage: string,
): Promise<{ sections: BillSection[]; usage: AiUsageRecord }> {
  const index = buildSectionIndex(allSections);

  const system = `You are a legislative research assistant. Given a table of contents for a bill and a user's question, identify which sections are most likely to contain the answer.

Bill: "${billTitle}"

Table of contents:
${index}

Return ONLY a JSON array of section references that are relevant to the question. Example: ["Section 2", "Section 5(a)"]
Return at most ${MAX_FILTERED_SECTIONS} sections. If unsure, include more rather than fewer.`;

  const result = await generateText({
    model: anthropic(HAIKU_MODEL),
    system,
    messages: [{ role: "user", content: userMessage }],
    maxOutputTokens: 512,
  });

  const usage: AiUsageRecord = {
    model: HAIKU_MODEL,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  };

  try {
    const match = result.text.match(/\[[\s\S]*\]/);
    if (match) {
      const refs: string[] = JSON.parse(match[0]);
      const filtered = filterSections(allSections, refs);
      if (filtered.length > 0) return { sections: filtered, usage };
    }
  } catch {
    // Fall through to the fallback below
  }

  // Fallback: take the first FALLBACK_SECTION_COUNT sections. Better than
  // nothing, and keeps the main call inside a reasonable context budget.
  return {
    sections: allSections.slice(0, FALLBACK_SECTION_COUNT),
    usage,
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  Main chat turn (streaming)
// ─────────────────────────────────────────────────────────────────────────

/** Diagnostics emitted before the stream starts so the route can log when
 *  a turn was forced to drop bill content or transcript. Used to size the
 *  follow-up work (1M-context routing, etc.) — the absence of any
 *  truncation signal across real users means the next phase isn't worth
 *  building yet. */
export interface ChatBudgetDiagnostics {
  sectionsTruncated: boolean;
  sectionsDropped: number;
  sectionsContentTruncated: number;
  sectionsOriginalChars: number;
  sectionsPackedChars: number;
  historyDropped: number;
  historyTokensRaw: number;
  historyTokensKept: number;
  sectionTokenBudget: number;
}

export interface StreamBillChatParams {
  billTitle: string;
  billSections: BillSection[] | null;
  metadata: BillMetadata | null;
  uiMessages: UIMessage[];
  /** When true, citations are emitted as `[Section X](?section=…)` links
   *  the reader page can intercept for in-page jumps. */
  readerMode?: boolean;
  /** Verified per-rep vote fact, when the question names a specific
   *  representative. Resolved by the route from `mentionedRepBioguideId`. */
  repVoteContext?: RepVoteContext | null;
  /** When set, the prompt frames `billSections` as a relevance-
   *  retrieved subset of the bill rather than its full text. Set by
   *  the chat route on the RAG path; left null on the Haiku/passthrough
   *  paths so the existing "here is the bill, organized by section"
   *  framing keeps working. */
  retrievalContext?: RetrievalContext | null;
  /** Fires once budget allocation completes, before the stream starts. */
  onBudget?: (diagnostics: ChatBudgetDiagnostics) => void;
  onFinish?: (event: {
    text: string;
    usage: AiUsageRecord;
  }) => void | Promise<void>;
  onError?: (event: { error: unknown }) => void;
}

/**
 * Kicks off the main chat generation against Sonnet and returns the
 * streamText result. The caller is responsible for piping it to the
 * client — typically via `result.toUIMessageStreamResponse(...)`.
 *
 * Three things happen before the stream starts:
 *  1. The conversation transcript is truncated to a token budget so a long
 *     chat can't crowd out the bill text.
 *  2. The remaining input budget is given to the section packer, which
 *     trims sections (per-section cap + total budget) so an omnibus bill
 *     never overflows Sonnet's 200K window.
 *  3. The system prompt — bill title, metadata, sections, citation rules
 *     — is delivered as a `role: "system"` message marked
 *     `cacheControl: "ephemeral"`. Multi-turn chats about the same bill
 *     within 5 minutes pay 10% input rates for the cached portion. The
 *     turn-specific question still goes in at full rate.
 *
 * `onFinish` reports the cache-aware token breakdown so the spend ledger
 * bills cache reads/writes correctly.
 */
export async function streamBillChatResponse(
  params: StreamBillChatParams,
): Promise<StreamTextResult<Record<string, never>, never>> {
  const {
    billTitle,
    billSections,
    metadata,
    uiMessages,
    readerMode,
    repVoteContext,
    retrievalContext,
    onBudget,
    onFinish,
    onError,
  } = params;

  const rawHistory: ModelMessage[] = await convertToModelMessages(uiMessages);
  const allocation = allocateChatBudget(rawHistory);
  const truncatedHistory = truncateHistoryToBudget(
    rawHistory,
    allocation.historyTokens,
  );

  const packResult = billSections
    ? packSectionsToBudgetWithDiagnostics(
        billSections,
        allocation.sectionTokens,
      )
    : null;
  const packedSections = packResult?.sections ?? null;

  if (onBudget) {
    onBudget({
      sectionsTruncated: packResult?.truncated ?? false,
      sectionsDropped: packResult?.droppedCount ?? 0,
      sectionsContentTruncated: packResult?.truncatedCount ?? 0,
      sectionsOriginalChars: packResult?.originalChars ?? 0,
      sectionsPackedChars: packResult?.packedChars ?? 0,
      historyDropped: truncatedHistory.droppedCount,
      historyTokensRaw: allocation.historyTokensRaw,
      historyTokensKept: truncatedHistory.tokens,
      sectionTokenBudget: allocation.sectionTokens,
    });
  }

  const systemText = buildBillChatSystemPrompt(
    billTitle,
    packedSections,
    metadata,
    { readerMode, repVoteContext, retrievalContext },
  );

  // Cacheable system message + (already-budgeted) conversation. We pass
  // everything through `messages` rather than the top-level `system`
  // field so we can attach `providerOptions.anthropic.cacheControl` to
  // the bill block. The provider groups consecutive system messages into
  // a single API system field, so a future split (e.g. caching the bill
  // separately from per-turn rep-vote context) is an additive change.
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: systemText,
      providerOptions: SYSTEM_CACHE_OPTIONS,
    },
    ...truncatedHistory.messages,
  ];

  return streamText({
    model: anthropic(SONNET_MODEL),
    messages,
    maxOutputTokens: 2048,
    onFinish: onFinish
      ? async (event) => {
          await onFinish({
            text: event.text,
            usage: {
              model: SONNET_MODEL,
              inputTokens: event.usage?.inputTokens ?? 0,
              outputTokens: event.usage?.outputTokens ?? 0,
              cache: {
                cacheReadTokens:
                  event.usage?.inputTokenDetails?.cacheReadTokens ?? 0,
                cacheWriteTokens:
                  event.usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
                cacheTtl: "5m",
              },
            },
          });
        }
      : undefined,
    onError: onError
      ? ({ error }) => {
          onError({ error });
        }
      : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  Change summary (non-streaming, used by the change-summaries cron)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Plain-language explanation of a single user-selected passage from a
 * bill. Powers the reader's "select-to-explain" popover.
 *
 * Bounded task: small input, capped output. Haiku is the right tier;
 * the explanation must stay grounded in the passage itself, not
 * editorialize, and not invent facts. The route layer is responsible
 * for the server-side passage-existence check before this is called.
 */
export async function generateExplainPassage(
  billTitle: string,
  sectionPath: string[],
  passage: string,
): Promise<{ content: string; usage: AiUsageRecord }> {
  const system = `You are explaining one passage from a U.S. federal bill to a citizen reader who is not a lawyer.

Bill: "${billTitle}"
Section: ${sectionPath.length > 0 ? sectionPath.join(" > ") : "Unspecified"}

The user has selected this passage:
> ${passage}

In 2–4 sentences of plain English, explain what this passage means and what its practical effect would be. Do not invent facts not present in the passage. Do not editorialize politically. If the passage is purely procedural or definitional, say so plainly. Avoid hedging phrases like "this provision provides" — describe the actual effect.`;

  const result = await generateText({
    model: anthropic(HAIKU_MODEL),
    system,
    messages: [
      {
        role: "user",
        content: "Explain this passage in 2-4 plain-English sentences.",
      },
    ],
    maxOutputTokens: 220,
  });

  return {
    content: result.text.trim(),
    usage: {
      model: HAIKU_MODEL,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    },
  };
}

/**
 * Plain-language summary of what changed between two bill versions.
 * Bounded diff-description task — Haiku is sufficient.
 */
export async function generateChangeSummary(
  billTitle: string,
  previousText: string,
  currentText: string,
  previousVersionType: string,
  currentVersionType: string,
): Promise<{ content: string; usage: AiUsageRecord[] }> {
  const system =
    'You are a nonpartisan legislative analyst. Compare two versions of a bill and write a 2-3 sentence summary of substantive policy changes — new provisions, removed sections, changed numbers or thresholds, altered scope. Skip procedural and formatting changes. Output plain prose only: no markdown, no headings, no bold, no bullets, and no labels like "Key Changes:". Maximum 70 words. Write for a general audience at an 8th-grade reading level.';

  const userPrompt = `Bill: "${billTitle}"

Previous version (${previousVersionType}):
${previousText.slice(0, CHANGE_SUMMARY_CHARS)}

Current version (${currentVersionType}):
${currentText.slice(0, CHANGE_SUMMARY_CHARS)}

Summarize the substantive changes between these two versions in 2-3 plain sentences.`;

  const result = await generateText({
    model: anthropic(HAIKU_MODEL),
    system,
    messages: [{ role: "user", content: userPrompt }],
    maxOutputTokens: 220,
  });

  return {
    content: result.text,
    usage: [
      {
        model: HAIKU_MODEL,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  Bill explainer — plain-language description + key points
// ─────────────────────────────────────────────────────────────────────────

/** Structured shape returned by the explainer model. Fed through zod so
 *  the AI SDK can enforce schema on Haiku's JSON output. */
const BillExplainerSchema = z.object({
  shortDescription: z
    .string()
    .min(40)
    .max(600)
    .describe(
      "2–3 plain-language sentences describing what the bill does and who it affects. Grade 8–10 reading level. Concrete, not vague. No procedural preamble ('This bill would…') — write in plain declarative voice.",
    ),
  keyPoints: z
    .array(z.string().min(8).max(140))
    .min(2)
    .max(4)
    .describe(
      "2–4 short bullets naming the most important specific provisions. Each ≤ 15 words, starts with a verb, concrete. No duplication of the short description.",
    ),
});

export type BillExplainer = z.infer<typeof BillExplainerSchema>;

/**
 * Generate a plain-language short description + key points for a bill.
 * Shown at the top of the bill detail page so citizens aren't reading CRS
 * legalese first. Regenerated when a new substantive text version lands.
 *
 * Bounded structured-output task over a single bill — Haiku is sufficient
 * and keeps the backfill cost low (the whole corpus is ~12k bills).
 */
export async function generateBillExplainer(args: {
  billTitle: string;
  /** Latest substantive version text when we have it. Passed as-is, truncated. */
  billText: string | null;
  /** Kind of the version the text came from (e.g. "Enrolled Bill"). */
  versionType: string | null;
  /** CRS nonpartisan summary, if available. Useful when billText is missing. */
  crsSummary: string | null;
  /** e.g. "Senate Bill", "House Joint Resolution". */
  billTypeLabel: string;
  /** Human-readable current status headline ("Signed into law", "Failed in Senate"). */
  statusHeadline: string;
}): Promise<{ explainer: BillExplainer; usage: AiUsageRecord }> {
  const system = `You are a nonpartisan legislative analyst helping ordinary citizens understand U.S. federal legislation. Explain bills in clear, concrete plain language at a grade 8–10 reading level. Be accurate, brief, and specific — name what the bill actually does, not generic phrases like "addresses issues" or "provides for". Stay strictly factual; do not editorialize, predict outcomes, or imply political stance.`;

  const parts: string[] = [];
  parts.push(`Bill: "${args.billTitle}"`);
  parts.push(`Type: ${args.billTypeLabel}`);
  parts.push(`Current status: ${args.statusHeadline}`);

  if (args.billText && args.billText.trim().length > 0) {
    parts.push("");
    parts.push(`Current bill text (${args.versionType ?? "latest version"}):`);
    parts.push(args.billText.slice(0, EXPLAINER_TEXT_CHARS));
  } else if (args.crsSummary && args.crsSummary.trim().length > 0) {
    parts.push("");
    parts.push("Congressional Research Service summary (nonpartisan):");
    parts.push(args.crsSummary);
  } else {
    parts.push("");
    parts.push(
      "(No bill text or summary is available yet — base the explainer on the title and type alone, and keep claims minimal and hedged accordingly.)",
    );
  }

  if (args.crsSummary && args.billText && args.crsSummary.trim().length > 0) {
    parts.push("");
    parts.push(
      "Additional CRS summary for context (nonpartisan, may describe an earlier version):",
    );
    parts.push(args.crsSummary);
  }

  parts.push("");
  parts.push(
    "Write the shortDescription so a reader who has never heard of this bill understands, in three sentences or fewer, what it does and who it affects. Write keyPoints as specific provisions — thresholds, groups covered, actions required — not restatements of the description.",
  );

  const result = await generateObject({
    model: anthropic(HAIKU_MODEL),
    system,
    schema: BillExplainerSchema,
    messages: [{ role: "user", content: parts.join("\n") }],
    maxOutputTokens: 600,
  });

  return {
    explainer: result.object,
    usage: {
      model: HAIKU_MODEL,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  Non-streaming bill chat (scripts, tests)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Non-streaming equivalent of `streamBillChatResponse` — convenient for
 * verification scripts and unit tests that want a single string answer.
 * Production code paths should stream via `streamBillChatResponse`.
 */
export async function generateBillChatAnswer(
  billTitle: string,
  billSections: BillSection[] | null,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  metadata: BillMetadata | null = null,
): Promise<{ content: string; usage: AiUsageRecord[] }> {
  const usage: AiUsageRecord[] = [];

  let sectionsToUse = billSections;
  if (billSections && shouldFilterSections(billSections)) {
    const filtered = await selectSectionsForQuestion(
      billTitle,
      billSections,
      userMessage,
    );
    sectionsToUse = filtered.sections;
    usage.push(filtered.usage);
  }

  // Mirror the streaming path: hard-cap section size before prompt build.
  const packedSections = sectionsToUse
    ? packSectionsToBudget(sectionsToUse)
    : null;

  const system = buildBillChatSystemPrompt(billTitle, packedSections, metadata);
  const result = await generateText({
    model: anthropic(SONNET_MODEL),
    system,
    messages: [
      ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userMessage },
    ],
    maxOutputTokens: 2048,
  });

  usage.push({
    model: SONNET_MODEL,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  });

  return { content: result.text, usage };
}

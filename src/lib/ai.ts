/**
 * AI integration layer — wraps Vercel AI Gateway via the AI SDK.
 *
 * All provider calls go through the Gateway using "provider/model" string
 * model IDs. This gives us a single auth surface (AI_GATEWAY_API_KEY locally,
 * OIDC on Vercel), unified observability, and the ability to change providers
 * without touching call sites.
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
import { z } from "zod";

import type { BillSection } from "./bill-sections";
import { buildSectionIndex, filterSections } from "./bill-sections";
import { sectionSlugFromHeading } from "./section-slug";
import type { BillMetadata } from "./congress-api";

/** Canonical usage shape consumed by the spend ledger. */
export interface AiUsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Model IDs routed through Vercel AI Gateway. */
const SONNET_MODEL = "anthropic/claude-sonnet-4-20250514";
/** Cheaper model for bounded, structured tasks like section-picking or
 *  diff summarization where hallucination risk is inherently low. */
const HAIKU_MODEL = "anthropic/claude-haiku-4-5";

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

const CITATION_INSTRUCTIONS = `When answering, quote directly from the bill text using markdown blockquotes when it helps. Attribute quotes to the section they came from:

> "exact quote from the bill"
>
> — Section 4(a)

If the user asks about something not covered in the bill sections provided, say so plainly. Do not invent provisions. Stay factual and neutral.`;

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

If the user asks about something not covered in the bill sections provided, say so plainly. Do not invent provisions. Stay factual and neutral.`;

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
 */
export interface BillChatPromptOptions {
  readerMode?: boolean;
}

export function buildBillChatSystemPrompt(
  billTitle: string,
  billSections: BillSection[] | null,
  metadata: BillMetadata | null = null,
  opts: BillChatPromptOptions = {},
): string {
  const metadataBlock = formatMetadataForPrompt(metadata);
  const readerMode = opts.readerMode === true;

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

Stay factual and neutral.`;
    }

    return `You are a helpful, nonpartisan assistant that helps citizens understand U.S. legislation. You answer questions about bills clearly and accessibly, avoiding jargon where possible.

The bill is titled "${billTitle}".${metadataBlock ? `\n\nBill information:\n${metadataBlock}` : ""}

Full bill text and CRS summary are not yet available in our system — but the metadata above is accurate and sourced from Congress.gov. Treat it as authoritative.

Factual questions about who introduced the bill, who cosponsored it, its chamber or bill type, when it was introduced, its policy area, or its legislative history (the action timeline above) are all reliably answerable from this metadata — answer them directly without hedging.

For questions about specific substantive provisions of the bill (what it actually does section-by-section, dollar amounts, eligibility criteria, effective dates, enforcement mechanisms): note once at the start of your answer that the full text isn't yet in our system, then reason only from the title, policy area, and any action text — don't invent provisions. Point the user to congress.gov for specifics.

Stay factual and neutral. Do not repeat the "text not available" caveat in every paragraph; one upfront mention is enough, and only when the question actually requires the bill text to answer.`;
  }

  const billTextBlock = formatSectionsForPrompt(billSections, {
    includeSlugs: readerMode,
  });
  const citationInstructions = readerMode
    ? CITATION_INSTRUCTIONS_READER
    : CITATION_INSTRUCTIONS;

  return `You are a helpful, nonpartisan assistant that helps citizens understand U.S. legislation. You answer questions clearly and accessibly, prioritizing direct quotes from the bill text.

${metadataBlock ? `Bill information:\n${metadataBlock}\n\n` : ""}Here is the text of "${billTitle}", organized by section:

${billTextBlock}

${citationInstructions}`;
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
    model: HAIKU_MODEL,
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

export interface StreamBillChatParams {
  billTitle: string;
  billSections: BillSection[] | null;
  metadata: BillMetadata | null;
  uiMessages: UIMessage[];
  /** When true, citations are emitted as `[Section X](?section=…)` links
   *  the reader page can intercept for in-page jumps. */
  readerMode?: boolean;
  onFinish?: (event: {
    text: string;
    usage: AiUsageRecord;
  }) => void | Promise<void>;
  onError?: (event: { error: unknown }) => void;
}

/**
 * Kicks off the main chat generation against Sonnet via Gateway and returns
 * the streamText result. The caller is responsible for piping it to the
 * client — typically via `result.toUIMessageStreamResponse(...)`.
 *
 * `onFinish` fires after the full response is generated; record spend, write
 * the assistant Message row, and populate the response cache there.
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
    onFinish,
    onError,
  } = params;

  const system = buildBillChatSystemPrompt(billTitle, billSections, metadata, {
    readerMode,
  });
  const messages: ModelMessage[] = await convertToModelMessages(uiMessages);

  return streamText({
    model: SONNET_MODEL,
    system,
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
    model: HAIKU_MODEL,
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
    "You are a nonpartisan legislative analyst. Given two versions of a bill, provide a clear, plain-language summary of what changed. Focus on substantive policy changes — new provisions, removed sections, changed numbers or thresholds, altered scope. Skip procedural or formatting changes. Write 2-4 sentences maximum. Do not use bullet points. Write for a general audience, not lawyers.";

  const userPrompt = `Bill: "${billTitle}"

Previous version (${previousVersionType}):
${previousText.slice(0, CHANGE_SUMMARY_CHARS)}

Current version (${currentVersionType}):
${currentText.slice(0, CHANGE_SUMMARY_CHARS)}

Summarize the substantive changes between these two versions.`;

  const result = await generateText({
    model: HAIKU_MODEL,
    system,
    messages: [{ role: "user", content: userPrompt }],
    maxOutputTokens: 1024,
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
    model: HAIKU_MODEL,
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

  const system = buildBillChatSystemPrompt(billTitle, sectionsToUse, metadata);
  const result = await generateText({
    model: SONNET_MODEL,
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

/**
 * Section captions — one-sentence plain-English descriptions of each
 * parsed section of a bill. Powers the reader's smart outline. AI is
 * Haiku via the Anthropic API; output is validated and stored on
 * `BillTextVersion.sectionCaptions`.
 *
 * Two callers:
 *   - Next runtime via `after()` from /bills/[id]/read/page.tsx — first
 *     reader visit triggers lazy generation. Page renders captionless;
 *     captions populate the DB row; next visit shows them.
 *   - The /api/cron/generate-section-captions cron, which warms hot
 *     bills (high momentum + null captions) on a 6h cadence.
 *
 * Idempotent — if `sectionCaptions` is already populated, the function
 * returns the stored set without calling AI.
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

import { prisma } from "./prisma";
import { parseSectionsFromFullText, type BillSection } from "./bill-sections";
import { sectionSlugsForBill } from "./section-slug";
import { recordSpend } from "./budget";
import { assertAiEnabled } from "./ai-gate";

// ─────────────────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────────────────

/** Anthropic Haiku model ID. Cheap; bounded task. */
const HAIKU_MODEL = "claude-haiku-4-5";

/** Max sections per AI call. Each caption is ~25 output tokens; 80
 *  sections × 25 = 2000 output tokens, well inside maxOutputTokens.
 *  Larger values would shave latency but raise the worst-case retry
 *  cost on a malformed JSON parse. */
const MAX_SECTIONS_PER_BATCH = 80;

/** Per-section content excerpt fed to the AI. The first ~600 chars of
 *  a section is almost always enough to know what it does — anything
 *  more is just paying for tokens that don't change the caption. */
const CONTENT_PREVIEW_CHARS = 600;

/** Output budget per batch. 80 captions × ~25 tokens + JSON wrapping
 *  comfortably fits in 4K. */
const MAX_OUTPUT_TOKENS = 4096;

/** Validation bounds on caption word count. Loose; rejects single-word
 *  captions and runaway paragraphs. */
const MIN_CAPTION_WORDS = 3;
const MAX_CAPTION_WORDS = 30;

/** Phrases that indicate the model failed to produce a real caption
 *  (refusal, hedge, or boilerplate). Captions matching any of these
 *  are dropped. */
const AI_META_FLAGS = [
  "i don't have",
  "i cannot",
  "as an ai",
  "i'm sorry",
  "i apologize",
  "based on the provided",
  "the section provides",
  "this section provides",
  "the provided text",
];

// ─────────────────────────────────────────────────────────────────────────
//  Public types
// ─────────────────────────────────────────────────────────────────────────

export interface SectionCaption {
  /** Slug ID, matching what `sectionSlugsForBill` produces for the
   *  same parsed sections. The reader looks up captions by this. */
  sectionId: string;
  caption: string;
}

export interface GenerateCaptionsResult {
  captions: SectionCaption[];
  costCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** True if captions were already persisted before this call. */
  cached: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
//  Orchestration
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate captions for one BillTextVersion. Loads the version, parses
 * sections, batches them through Haiku, validates and persists results,
 * and records spend against the monthly AI budget.
 *
 * Throws `AiDisabledError` if the budget gate is closed.
 * Throws `Error` on missing version / missing fullText.
 */
export async function generateSectionCaptions(
  versionId: number,
): Promise<GenerateCaptionsResult> {
  // Budget gate at the top — throws AiDisabledError that the caller
  // (after() or the cron script) can catch and skip on.
  await assertAiEnabled("section_caption");

  const version = await prisma.billTextVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      fullText: true,
      sectionCaptions: true,
      bill: { select: { title: true } },
    },
  });

  if (!version) {
    throw new Error(`BillTextVersion ${versionId} not found`);
  }
  if (!version.fullText) {
    throw new Error(`BillTextVersion ${versionId} has no fullText`);
  }

  // Idempotent — short-circuit on existing captions.
  if (version.sectionCaptions !== null) {
    const existing = version.sectionCaptions as unknown as SectionCaption[];
    return {
      captions: Array.isArray(existing) ? existing : [],
      costCents: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cached: true,
    };
  }

  const sections = parseSectionsFromFullText(version.fullText);

  // Genuinely nothing to caption — persist empty array so we don't
  // re-attempt every cron pass for unparseable text.
  if (sections.length === 0) {
    await persistCaptions(versionId, []);
    return {
      captions: [],
      costCents: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cached: false,
    };
  }

  // Compute the canonical slug for each section once so the caption
  // IDs we send to the AI exactly match what the reader will use as
  // URL anchors. `sectionSlugsForBill` handles collision suffixes
  // deterministically across the whole bill.
  const ids = sectionSlugsForBill(sections);

  const allCaptions: SectionCaption[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostCents = 0;

  const batches = chunkBatches(sections, ids, MAX_SECTIONS_PER_BATCH);
  for (const { sections: batchSections, ids: batchIds } of batches) {
    const result = await generateCaptionsBatch(
      version.bill.title,
      batchSections,
      batchIds,
    );
    allCaptions.push(...result.captions);
    totalInputTokens += result.usage.inputTokens;
    totalOutputTokens += result.usage.outputTokens;

    const costCents = await recordSpend({
      feature: "section_caption",
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    totalCostCents += costCents;
  }

  // If every batch produced zero valid captions, leave sectionCaptions
  // NULL so the cron retries on a later run. Charging the budget for
  // unusable output is unfortunate but bounded.
  if (allCaptions.length === 0) {
    return {
      captions: [],
      costCents: totalCostCents,
      totalInputTokens,
      totalOutputTokens,
      cached: false,
    };
  }

  await persistCaptions(versionId, allCaptions);

  return {
    captions: allCaptions,
    costCents: totalCostCents,
    totalInputTokens,
    totalOutputTokens,
    cached: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  Pure AI call — exported for testing
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate captions for a single batch of sections. Pure AI call —
 * no DB access, no spend recording. Tests can mock the underlying
 * `generateText` to exercise the prompt + parsing without burning
 * tokens.
 *
 * `ids` is parallel to `sections`; each returned caption uses the
 * corresponding `id` so the orchestrator can match captions back to
 * sections without relying on AI to repeat slug strings perfectly.
 */
export async function generateCaptionsBatch(
  billTitle: string,
  sections: BillSection[],
  ids: string[],
): Promise<{
  captions: SectionCaption[];
  usage: { model: string; inputTokens: number; outputTokens: number };
}> {
  if (sections.length !== ids.length) {
    throw new Error(
      `generateCaptionsBatch: sections.length (${sections.length}) ` +
        `!= ids.length (${ids.length})`,
    );
  }

  const sectionsBlock = sections
    .map((s, i) => {
      const preview = s.content.slice(0, CONTENT_PREVIEW_CHARS);
      return `[${i + 1}] id="${ids[i]}" — ${s.heading}\n${preview}`;
    })
    .join("\n\n---\n\n");

  const system = `You are writing one-sentence plain-English captions for sections of a U.S. federal bill, for a citizen reader who is not a lawyer.

Bill: "${billTitle}"

For each section below, write ONE sentence (max 18 words) describing what the section ACTUALLY does in plain English. Be specific. Don't quote the bill. Don't say "this section provides…" — describe the practical effect. If a section is purely a short title or a definitions header, the caption can be brief (e.g. "Names the bill the Fair Housing Act of 2025.").

Return ONLY a JSON array, no surrounding prose. Each object: { "id": "<exact id from input>", "caption": "<sentence>" }. Use the EXACT id string given to you for each section — do not modify it.`;

  const userMessage = `Sections:

${sectionsBlock}`;

  const result = await generateText({
    model: anthropic(HAIKU_MODEL),
    system,
    messages: [{ role: "user", content: userMessage }],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  const usage = {
    model: HAIKU_MODEL,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  };

  const validIds = new Set(ids);
  const captions = parseAndValidateCaptions(result.text, validIds);

  return { captions, usage };
}

// ─────────────────────────────────────────────────────────────────────────
//  Internals — exported only as needed for tests
// ─────────────────────────────────────────────────────────────────────────

export function isValidCaption(caption: string): boolean {
  const trimmed = caption.trim();
  if (!trimmed) return false;

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_CAPTION_WORDS || wordCount > MAX_CAPTION_WORDS) {
    return false;
  }

  // Reject all-caps shouting (8+ letters, every letter capitalized).
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length > 8 && letters === letters.toUpperCase()) return false;

  const lower = trimmed.toLowerCase();
  for (const flag of AI_META_FLAGS) {
    if (lower.includes(flag)) return false;
  }

  return true;
}

function parseAndValidateCaptions(
  text: string,
  validIds: Set<string>,
): SectionCaption[] {
  let parsed: unknown;
  try {
    // Find the first top-level JSON array. Models occasionally wrap
    // output in ```json fences or chatter; tolerate both.
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const out: SectionCaption[] = [];
  const seenIds = new Set<string>();

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : null;
    const caption =
      typeof candidate.caption === "string" ? candidate.caption.trim() : null;

    if (!id || !caption) continue;
    if (!validIds.has(id)) continue;
    if (seenIds.has(id)) continue;
    if (!isValidCaption(caption)) continue;

    seenIds.add(id);
    out.push({ sectionId: id, caption });
  }

  return out;
}

interface Batch {
  sections: BillSection[];
  ids: string[];
}

function chunkBatches(
  sections: BillSection[],
  ids: string[],
  size: number,
): Batch[] {
  const out: Batch[] = [];
  for (let i = 0; i < sections.length; i += size) {
    out.push({
      sections: sections.slice(i, i + size),
      ids: ids.slice(i, i + size),
    });
  }
  return out;
}

async function persistCaptions(
  versionId: number,
  captions: SectionCaption[],
): Promise<void> {
  await prisma.billTextVersion.update({
    where: { id: versionId },
    data: {
      // Prisma's Json type accepts plain JSON values — captions is a
      // simple array of objects, safe to cast through unknown.
      sectionCaptions: captions as unknown as object,
      captionsModel: HAIKU_MODEL,
      captionsCreatedAt: new Date(),
    },
  });
}

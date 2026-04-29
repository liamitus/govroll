/**
 * Tests for bill-embedding helpers. Pipeline-level integration
 * (Anthropic + Voyage + Prisma) is covered by the end-to-end
 * validation step; this file pins the pure helpers and configuration
 * boundaries so a refactor doesn't silently change retrieval behavior.
 */
import { describe, expect, it } from "vitest";

import {
  buildChunkContextPrompt,
  shouldUseRag,
  RAG_BILL_CHAR_THRESHOLD,
  type BillEmbeddingMetadata,
  type ChunkInput,
} from "./bill-embeddings";

const baseMetadata: BillEmbeddingMetadata = {
  title: "Farm, Food, and National Security Act of 2026",
  billType: "HR",
  chamber: "House",
  sponsor: "Rep. Jane Doe (R-IA-1)",
  policyArea: "Agriculture and Food",
  currentStatus: "Introduced",
};

const baseChunk: ChunkInput = {
  sectionRef: "Section 5(a)",
  heading: "Section 5. Pesticide registration > (a) Fast-track review",
  content:
    "The Administrator shall establish a fast-track review process for pesticide registrations submitted by qualified manufacturers. Eligibility is limited to applicants who have maintained continuous registration for at least five years.",
};

describe("buildChunkContextPrompt", () => {
  it("includes the bill title and section reference verbatim", () => {
    const { system, user } = buildChunkContextPrompt(baseMetadata, baseChunk);
    // Pin specific strings the contextual-retrieval workflow depends on.
    // The whole point of this prompt is that the model sees enough bill
    // metadata to write a grounded context line — if any of these
    // identifiers go missing, retrieval quality silently regresses.
    expect(user).toContain("Farm, Food, and National Security Act of 2026");
    expect(user).toContain("Section 5(a)");
    expect(user).toContain(baseChunk.heading);
    expect(user).toContain("fast-track review process");
    expect(system).toContain("single sentence");
    expect(system).toContain("Maximum 30 words");
  });

  it("truncates very large section content before passing to Haiku", () => {
    // The whole-section content can be 30K+ chars on omnibus titles. We
    // cap at 4K so per-chunk Haiku cost stays bounded; the first 4K is
    // enough to write a useful context line.
    const oversized: ChunkInput = {
      ...baseChunk,
      content: "x".repeat(20_000),
    };
    const { user } = buildChunkContextPrompt(baseMetadata, oversized);
    // 20K chars of x's must NOT appear verbatim — only the first 4K.
    expect(user.length).toBeLessThan(20_000);
    // But it must still contain meaningful content from the truncated
    // window — at least one batch of the x's makes it in.
    expect(user).toMatch(/x{1000,}/);
  });

  it("omits optional metadata fields cleanly when null", () => {
    const minimal: BillEmbeddingMetadata = {
      title: "S 1",
      billType: "S",
      chamber: null,
      sponsor: null,
      policyArea: null,
      currentStatus: null,
    };
    const { user } = buildChunkContextPrompt(minimal, baseChunk);
    expect(user).toContain('Bill: "S 1"');
    expect(user).toContain("Type: S");
    // None of the labelled lines for absent fields should appear.
    expect(user).not.toContain("Sponsor:");
    expect(user).not.toContain("Policy area:");
    expect(user).not.toContain("Status:");
    // Chamber suffix on the type line shouldn't appear either.
    expect(user).not.toContain("Type: S (");
  });

  it("renders the section heading and content blocks where the model expects them", () => {
    // Pin the structural skeleton the model has been trained on
    // through the system prompt. If the labels move, the model's
    // output quality degrades — make this break loud.
    const { user } = buildChunkContextPrompt(baseMetadata, baseChunk);
    expect(user).toMatch(/Section: Section 5\(a\)/);
    expect(user).toMatch(/Heading: .+/);
    expect(user).toMatch(/Content:\n/);
    expect(user).toMatch(/Write the one-sentence context\.\s*$/);
  });
});

describe("shouldUseRag", () => {
  it("flips at the documented threshold", () => {
    expect(shouldUseRag(RAG_BILL_CHAR_THRESHOLD - 1)).toBe(false);
    expect(shouldUseRag(RAG_BILL_CHAR_THRESHOLD)).toBe(false);
    expect(shouldUseRag(RAG_BILL_CHAR_THRESHOLD + 1)).toBe(true);
  });

  it("matches the budget logic — bills that fit in the 200K window stay on the cached path", () => {
    // 150K tokens × 2.5 chars/token = 375K-char threshold. Pin so a
    // budget refactor doesn't accidentally change which bills go RAG.
    expect(RAG_BILL_CHAR_THRESHOLD).toBe(375_000);

    // Sanity: a 100K-char bill is comfortably under the threshold and
    // an HR 7567-class 800K-char bill is well over.
    expect(shouldUseRag(100_000)).toBe(false);
    expect(shouldUseRag(800_000)).toBe(true);
  });
});

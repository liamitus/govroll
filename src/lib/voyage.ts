/**
 * Voyage AI client — REST integration for embeddings.
 *
 * Voyage is the embedding provider Anthropic recommends for legal /
 * structured-document retrieval. We use `voyage-3-large` because the
 * domain-specialized variants (e.g. `voyage-law-2`) lag the flagship on
 * recent benchmarks and `voyage-3-large` is what their docs currently
 * push as the default for new builds.
 *
 * No SDK — Voyage's API is small enough that a typed fetch wrapper is
 * cleaner than pulling another dependency. Pattern mirrors the
 * `withRetry()` shape in `lib/congress-api.ts` so one retry policy
 * governs all our outbound calls.
 */
import axios, { AxiosError } from "axios";

const VOYAGE_API_BASE = "https://api.voyageai.com/v1";

/** Read the API key at call time, not module load. Lets tests rotate
 *  the env var between cases (e.g. assert clean failure when unset)
 *  without re-importing the module. */
function getVoyageApiKey(): string | undefined {
  return process.env.VOYAGE_API_KEY;
}

/** Default embedding model. 1024-dim, balanced between cost and recall.
 *  Stored alongside each row so we can detect a model swap and re-embed
 *  cleanly without comparing vectors of different dimensionality. */
export const VOYAGE_EMBED_MODEL = "voyage-3-large";

/** Voyage caps `inputs` arrays at 128 strings per request. We batch at
 *  this number to minimize round trips on full-bill embedding. */
const VOYAGE_BATCH_SIZE = 128;

/** Public token-budget cap per request. Voyage rejects payloads above
 *  120K tokens; staying under 100K leaves margin for the longest
 *  legislative chunks (a single mega-section can run ~30K tokens). */
const VOYAGE_BATCH_TOKEN_CAP = 100_000;

/** Pricing for cost tracking, in cents per million tokens. Voyage's
 *  voyage-3-large is $0.18/Mtok at the time of writing — update this
 *  if their pricing page changes. */
const VOYAGE_3_LARGE_INPUT_CENTS_PER_MTOK = 18;

export class VoyageError extends Error {
  readonly status?: number;
  readonly responseBody?: unknown;
  constructor(message: string, status?: number, responseBody?: unknown) {
    super(message);
    this.name = "VoyageError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

interface VoyageEmbedResponse {
  object: "list";
  data: Array<{ object: "embedding"; embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

export interface EmbedBatchResult {
  /** Vectors in the same order as the input strings. */
  embeddings: number[][];
  /** Voyage-reported total tokens consumed for this batch. */
  totalTokens: number;
  /** Cost contribution in integer cents (rounded up). */
  costCents: number;
}

/**
 * Retry wrapper. Mirrors the linear-backoff shape used by
 * `congress-api.withRetry()` so all outbound integrations age in the
 * same way. Voyage's transient failures are mostly 429s and
 * occasional 5xx; both retry safely.
 */
async function withVoyageRetry<T>(fn: () => Promise<T>): Promise<T> {
  const RETRIES = 3;
  const DELAY_MS = 1500;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isLast = attempt === RETRIES;
      const status = e instanceof AxiosError ? e.response?.status : undefined;
      // Don't retry 4xx other than 429 — they're caller bugs.
      const retryable = status == null || status === 429 || status >= 500;
      if (isLast || !retryable) throw e;
      await new Promise((r) => setTimeout(r, DELAY_MS * (attempt + 1)));
    }
  }
  throw new Error("unreachable");
}

/**
 * Embed a batch of strings using `voyage-3-large`.
 *
 * `inputType: "document"` tells Voyage to optimize the embeddings for
 * the *indexed* side of an asymmetric retrieval setup. At query time
 * the caller should pass `"query"` instead. Asymmetric embedding lifts
 * recall a few points over passing the same type to both sides.
 */
export async function voyageEmbedDocuments(
  texts: string[],
): Promise<EmbedBatchResult> {
  const apiKey = getVoyageApiKey();
  if (!apiKey) {
    throw new VoyageError(
      "VOYAGE_API_KEY is not set in the environment. Embedding paths will fail; set it in Vercel project env (preview + prod).",
    );
  }
  if (texts.length === 0) {
    return { embeddings: [], totalTokens: 0, costCents: 0 };
  }
  if (texts.length > VOYAGE_BATCH_SIZE) {
    throw new VoyageError(
      `Batch size ${texts.length} exceeds Voyage's per-request cap of ${VOYAGE_BATCH_SIZE}. Pre-chunk the input before calling.`,
    );
  }

  const response = await withVoyageRetry(async () => {
    const r = await axios.post<VoyageEmbedResponse>(
      `${VOYAGE_API_BASE}/embeddings`,
      {
        input: texts,
        model: VOYAGE_EMBED_MODEL,
        input_type: "document",
        // 1024 is the default for voyage-3-large; pinned explicitly so a
        // future Voyage default change doesn't silently shift dim and
        // break our pgvector(1024) column.
        output_dimension: 1024,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60_000,
      },
    );
    return r.data;
  });

  // Voyage returns embeddings out of order if any input fails — sort by
  // their `index` field before returning so the caller can zip with the
  // original input array safely.
  const sorted = response.data.slice().sort((a, b) => a.index - b.index);
  const embeddings = sorted.map((d) => d.embedding);

  const tokens = response.usage.total_tokens;
  const costCents = Math.ceil(
    (tokens * VOYAGE_3_LARGE_INPUT_CENTS_PER_MTOK) / 1_000_000,
  );

  return { embeddings, totalTokens: tokens, costCents };
}

/**
 * Embed a single user query for cosine search against indexed
 * documents. Differs from `voyageEmbedDocuments` by `input_type: "query"`,
 * which produces an embedding biased toward retrieval rather than
 * indexing.
 */
export async function voyageEmbedQuery(
  text: string,
): Promise<EmbedBatchResult> {
  const apiKey = getVoyageApiKey();
  if (!apiKey) {
    throw new VoyageError("VOYAGE_API_KEY is not set in the environment.");
  }
  if (text.trim().length === 0) {
    throw new VoyageError("voyageEmbedQuery: empty input.");
  }

  const response = await withVoyageRetry(async () => {
    const r = await axios.post<VoyageEmbedResponse>(
      `${VOYAGE_API_BASE}/embeddings`,
      {
        input: [text],
        model: VOYAGE_EMBED_MODEL,
        input_type: "query",
        output_dimension: 1024,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30_000,
      },
    );
    return r.data;
  });

  const tokens = response.usage.total_tokens;
  const costCents = Math.ceil(
    (tokens * VOYAGE_3_LARGE_INPUT_CENTS_PER_MTOK) / 1_000_000,
  );

  return {
    embeddings: [response.data[0]?.embedding ?? []],
    totalTokens: tokens,
    costCents,
  };
}

/**
 * Greedy batcher — packs strings into batches that fit both the request
 * count and token budget caps. Tokens are estimated cheaply (chars / 3
 * for legalese, matching the chat budget logic) since Voyage doesn't
 * expose a tokenizer. Used by the embedding pipeline so a single call
 * to embedBill() can submit many sections without manual book-keeping.
 */
export function batchTextsForVoyage(texts: string[]): string[][] {
  const CHARS_PER_TOKEN = 3;
  const batches: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const text of texts) {
    const estTokens = Math.ceil(text.length / CHARS_PER_TOKEN);
    const wouldExceedTokens =
      currentTokens + estTokens > VOYAGE_BATCH_TOKEN_CAP;
    const wouldExceedSize = current.length >= VOYAGE_BATCH_SIZE;
    if (current.length > 0 && (wouldExceedTokens || wouldExceedSize)) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(text);
    currentTokens += estTokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

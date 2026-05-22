# AI chat intent router & cross-bill comparison

**Status:** in progress — Layer 1 (classifier + acknowledgment block).
**Owner:** AI chat.
**Trigger:** A user asked the on-bill chat _"Does this bill contain the same language as the Save Our Bacon Act?"_ and got back a literal-string lookup ("I don't see references to a 'Save Our Bacon Act'") instead of a substantive comparison. Root cause: the chat is single-bill scoped with no notion of intent — every question goes through the same direct-RAG path.

This doc covers the long-term fix, not a prompt patch.

---

## Problem

Today every chat POST routes to one Sonnet call grounded only in the _current_ bill's text + metadata. That's the right shape for ~80% of questions ("what does Sec. 4 say?", "who sponsored this?", "is X covered?"). It's the wrong shape for an important and recurring slice:

| Intent           | Example                                     | Current behavior                  | What user wanted                  |
| ---------------- | ------------------------------------------- | --------------------------------- | --------------------------------- |
| `direct`         | "What does Sec. 4 say?"                     | Quotes Sec. 4 ✅                  | —                                 |
| `definitional`   | "What is FISA?"                             | Background-knowledge carve-out ✅ | —                                 |
| `rep_vote`       | "Why did AOC vote no?"                      | Verified vote fact injected ✅    | —                                 |
| **`cross_bill`** | "Is the Save Our Bacon Act folded in here?" | Literal-string lookup ❌          | Topical comparison with citations |
| `cross_version`  | "What changed from the introduced version?" | Single-version answer ❌          | Diff with version anchors         |
| `multi_bill`     | "What other bills cover this?"              | "I can only see this bill" ❌     | Topically-similar bills list      |
| `off_topic`      | "What's the weather?"                       | Hedged refusal                    | Polite redirect                   |

Treating these uniformly produces literal-correct, substantively-wrong answers — the exact failure mode the legal-RAG literature flags as *cross-document confusion*¹.

¹ _Towards Reliable Retrieval in RAG Systems for Large Legal Datasets_, arXiv:2510.06999.

## Goals

1. Stop returning literal-string failures on cross-bill questions.
2. Add structure that generalizes — same router unlocks cross-version + multi-bill questions later.
3. Keep cost increase ≤10% per average user.
4. Reversible — every change is additive; no schema migration in Layer 1.

## Non-goals

- Fetching other bills' text on demand (Layer 2).
- Cross-bill embeddings index, BillMention crawler, BillRelationship materialized view (Layer 3+).
- Tool-calling architecture (deferred — pre-fetched packs cache better; tools are the long-tail answer).

---

## Architecture: classify → route → answer

```
POST /api/ai/chat
      │
      ├─ assertUserRateLimit, assertUserDailyCostCap, assertAiEnabled
      │
      ├─ Promise.all([
      │     classifyChatIntent(lastUserMessage),   ← NEW: Haiku, ~$0.0006
      │     prisma.bill.findUnique(...),
      │     prisma.billTextVersion.findFirst(...),
      │  ])
      │
      ├─ persist user message (+ classified intent in logs)
      │
      ├─ first-turn cache short-circuit (unchanged)
      │
      ├─ section retrieval (unchanged: rag / haiku / passthrough)
      │
      ├─ buildBillChatSystemPrompt(..., { intentContext })   ← NEW: extra block if cross_bill
      │
      └─ streamBillChatResponse (unchanged Sonnet streaming)
```

The classifier is a sibling of the bill fetch — runs in parallel, never on the critical-path latency budget unless the bill fetch is already done. The classifier result threads into `buildBillChatSystemPrompt` via a new optional `intentContext` field.

### Classifier shape

```ts
// src/lib/ai-intent-classifier.ts
export type ChatIntent =
  | "direct" // current single-bill path
  | "definitional" // covered by background-knowledge clause
  | "rep_vote" // covered by repVoteContext
  | "cross_bill" // user names another piece of legislation
  | "cross_version" // user asks about changes between versions of this bill
  | "multi_bill" // user asks "what other bills do X"
  | "off_topic"; // not a legislation question

export interface ChatIntentClassification {
  intent: ChatIntent;
  /** When intent === "cross_bill", the user's verbatim reference. e.g. "Save Our Bacon Act" */
  namedBill: string | null;
  /** Free-text reasoning, ≤120 chars. For telemetry only, never shown to the user. */
  reasoning: string;
}
```

Output is structured via `generateObject` + zod schema. Same pattern used elsewhere in the codebase (`BillExplainerSchema` in `src/lib/ai.ts`).

### Classifier prompt

```
You are a triage classifier for a U.S. legislation Q&A assistant.

You see ONE user message. The user is asking about a specific bill that has been loaded into the assistant's context. Your job is to identify the user's intent so the assistant can route appropriately.

Categories:
- direct: Asking about provisions, sections, sponsors, status, or any substantive fact of THIS bill.
- definitional: Asking what a term/agency/prior law means (e.g., "what is FISA?").
- rep_vote: Asking how a specific representative voted, or why.
- cross_bill: Mentions ANOTHER named bill or Act and wants comparison ("does this contain the Save Our Bacon Act?", "is HR 4673 in here?").
- cross_version: Asks about changes between versions of THIS bill ("what was added since introduction?").
- multi_bill: Asks about OTHER bills in the corpus ("what other bills cover this?").
- off_topic: Not about legislation.

When intent is cross_bill, extract the user's verbatim reference to the other legislation into `namedBill` (e.g. "Save Our Bacon Act", "H.R. 4673", "the EATS Act"). Otherwise namedBill is null.

Output JSON only. reasoning ≤ 15 words.
```

System prompt is `cacheControl: ephemeral` so multi-turn sessions cache it.

### What changes when intent = `cross_bill`

The system prompt gets a new block inserted (after metadata, before citation instructions):

> The user is asking how this bill compares with another piece of legislation:
> **{namedBill}**
>
> We have NOT loaded the text of that other bill. You should:
>
> 1. Briefly explain, from general knowledge about that legislation, what it does in substance — its purpose, main provisions, scope. Frame this as background ("From general knowledge about the [Act]…") so the user understands you can't quote it.
> 2. Identify sections of THIS bill that address the same subject matter. Quote them normally with section citations.
> 3. Be explicit about the limit: you can identify topical overlap but cannot do a literal text comparison without both bills loaded. Point the user to congress.gov for an authoritative side-by-side.
> 4. If you don't recognize the named legislation, say so plainly and ask the user for a bill number (e.g., H.R. 4673) so it can be looked up.

This block deliberately _expands_ the existing `BACKGROUND_KNOWLEDGE_CLAUSE` for this one case — the carve-out was scoped to definitional-only, which is what caused the original failure.

### Other intents in Layer 1

No behavior change. `direct`, `definitional`, `rep_vote`, `off_topic` follow the existing path. `cross_version` and `multi_bill` get logged as "supported but not yet implemented — demand signal" and the model is told to acknowledge the limit honestly.

---

## Cost model

**Haiku 4.5 pricing (May 2026):** $1.00 / $5.00 per Mtok input/output.

**Per-classification:**

- Prompt: ~400 input tokens (instructions + categories), cached after first turn
- User message: ≤2000 chars ≈ 500 tokens
- Output: ~30 tokens
- Cost: **~$0.0006** uncached, **~$0.00015** cached
- p95 latency: 200-400ms

**Per-turn impact at scale (10k turns/day):**

- Classifier: 10k × $0.0006 = $6.00/day
- Negligible against existing Sonnet bill — typical day is several hundred dollars in chat.

**Cross-bill answer (Layer 1):** identical to current Sonnet path. The model uses general knowledge for the named-bill background — no extra retrieval cost.

**Cross-bill answer (Layer 2, future):** roughly 2× a typical chat turn — same Sonnet call with two bills' relevant sections packed. Vector retrieval against the second bill: <$0.0001 query embed. Estimated **$0.15-0.40 per cross-bill turn** at full scope.

## Telemetry

Layer 1 produces three new signals via `recordSpend` and structured console logs:

| Event                                | Fields                                       | Used for                               |
| ------------------------------------ | -------------------------------------------- | -------------------------------------- |
| `intent_classify` AiUsageEvent       | feature, model (Haiku 4.5), token counts     | Cost tracking                          |
| `chat_intent_classified` console log | billId, userId, intent, namedBill, reasoning | Daily aggregation: intent distribution |
| `chat_cross_bill_named` console log  | billId, namedBill                            | Demand signal for Layer 2 priority     |

**Decision gate for Layer 2:** if `cross_bill` ≥5% of turns for 14 days AND ≥30% of named bills resolve against our own bills table (tsvector on `popularTitle/shortTitle/displayTitle`), ship Layer 2. Otherwise Layer 1's improved acknowledgment is sufficient.

## Layer 2 preview (deferred)

When demand justifies:

1. `src/lib/cross-bill-resolve.ts` — given a `namedBill` string, return a `{ billId, score }` or null.
   - First: tsvector match against our `Bill` table on title columns.
   - Fallback: `congress-api.ts` title search.
2. `retrieveRelevantSections(prisma, billId, query)` already accepts a `billId` parameter — extend to allow a second bill ID and pack both into the prompt.
3. `buildBillChatSystemPrompt` gains a `comparisonBill: { title, sections }` option, slotted in next to the primary bill block.

## Layer 3+ explicitly deferred

- `BillMention` table (which bills reference which) — premature; the comparison use case doesn't need explicit edges, just text similarity.
- `BillRelationship` materialized view — same.
- Cross-bill embedding index — our embeddings _are_ already cross-bill compatible (single pgvector index keyed by billId); we just don't query across IDs yet.
- Tool-calling for on-demand congress.gov fetches — adds latency and complicates caching. Reconsider only for bills not in our DB.

## Migration / rollout

1. Ship Layer 1 behind no feature flag — additive only. The classifier is wrapped in try/catch; on failure we fall back to `intent: direct` and the existing path runs unchanged.
2. Watch logs for 7 days. Verify classifier accuracy on a hand-labelled set (~50 questions across all intents).
3. If accuracy <85% on `cross_bill` recall, iterate the classifier prompt. The classifier is one zod schema + one prompt — fast iteration.
4. After 14 days, evaluate the Layer 2 decision gate above.

## Risks

| Risk                                                     | Mitigation                                                                                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classifier misroutes a `direct` question as `cross_bill` | The cross-bill block tells the model to use background knowledge AND quote this bill's sections. False positive cost is one extra paragraph of context, not a wrong answer.                     |
| Classifier latency stalls the stream                     | Classifier runs in parallel with bill fetch. If bill fetch wins, classifier still completes before prompt assembly (~200ms). 3s timeout falls back to `direct`.                                 |
| Model hallucinates content of named bill                 | Block explicitly tells it to caveat ("from general knowledge…") and direct user to congress.gov for verification. Sonnet 4.6 is reliable about acknowledging knowledge limits when prompted to. |
| Cost overrun                                             | Classifier cost is rounding error. If wrong, $0.50/day per-user cap catches it.                                                                                                                 |

## Verification

- [ ] Unit test: classifier returns correct intent for representative inputs.
- [ ] Unit test: cross-bill prompt block is included in system text only when intent is `cross_bill`.
- [ ] Manual test: original failing question ("Does this bill contain the same language as the Save Our Bacon Act?") on a livestock-related bill produces an answer that (a) summarizes Save Our Bacon Act from general knowledge, (b) cites this bill's livestock sections, (c) caveats that we don't have the other bill's text.
- [ ] Telemetry: `intent_classify` events appear in `AiUsageEvent`. Cross-bill events appear in structured console logs.

## References

- [RouteLLM: Cost-Effective LLM Routing — LMSYS 2024](https://www.lmsys.org/blog/2024-07-01-routellm/)
- [Towards Reliable Retrieval in RAG Systems for Large Legal Datasets — arXiv 2510.06999](https://arxiv.org/html/2510.06999v1)
- [Claude API Pricing — official docs](https://platform.claude.com/docs/en/about-claude/pricing)
- [H.R. 4673 — Save Our Bacon Act, 119th Congress](https://www.congress.gov/bill/119th-congress/house-bill/4673/text)

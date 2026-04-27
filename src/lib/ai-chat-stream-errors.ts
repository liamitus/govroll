/**
 * Translate streamText errors into a short, actionable message for the chat
 * client. Passed to `toUIMessageStreamResponse({ onError })` so the UI sees
 * more than the AI SDK's opaque "An error occurred." default.
 *
 * Keep messages short and free of secrets. Raw provider error strings are
 * pattern-matched against well-known conditions; unknown errors fall through
 * to a safe generic.
 */
export function formatStreamErrorForClient(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");

  if (/credit card|billing|payment method/i.test(msg)) {
    return "AI service billing is not configured. Add a payment method on the Anthropic console.";
  }
  if (/rate[- ]?limit|too many requests|429/i.test(msg)) {
    return "AI service rate limit hit. Try again in a moment.";
  }
  if (/unauthori[sz]ed|invalid api key|401|forbidden|403/i.test(msg)) {
    return "AI service authentication failed. Check credentials in the server logs.";
  }
  if (/timed?[- ]?out|timeout|etimedout/i.test(msg)) {
    return "AI service took too long to respond. Try a shorter question.";
  }
  if (/quota|insufficient[_ ]credits/i.test(msg)) {
    return "AI service quota exhausted. See the Anthropic console.";
  }

  return "The AI service returned an error. Try again in a moment.";
}

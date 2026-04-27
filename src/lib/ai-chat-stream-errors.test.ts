import { describe, it, expect } from "vitest";
import { formatStreamErrorForClient } from "./ai-chat-stream-errors";

describe("formatStreamErrorForClient", () => {
  it("flags provider billing errors so devs see the actionable cause", () => {
    const err = new Error(
      "Your credit card was declined. Update your payment method to continue.",
    );
    expect(formatStreamErrorForClient(err)).toMatch(/billing|credit card/i);
  });

  it("flags provider rate-limit errors", () => {
    const err = new Error("Rate limit exceeded. Please retry later.");
    expect(formatStreamErrorForClient(err)).toMatch(/rate limit/i);
  });

  it("flags upstream auth failures", () => {
    const err = new Error("401 Unauthorized — invalid API key");
    expect(formatStreamErrorForClient(err)).toMatch(
      /authentication|credentials/i,
    );
  });

  it("flags upstream timeouts", () => {
    const err = new Error("Request timed out after 30s");
    expect(formatStreamErrorForClient(err)).toMatch(/timeout|too long/i);
  });

  it("returns a safe, retryable generic message for unrecognized errors", () => {
    const msg = formatStreamErrorForClient(new Error("something weird"));
    expect(msg).toMatch(/error|try again/i);
  });

  it("tolerates non-Error throwables", () => {
    expect(() => formatStreamErrorForClient("boom")).not.toThrow();
    expect(() => formatStreamErrorForClient(undefined)).not.toThrow();
    expect(() => formatStreamErrorForClient(null)).not.toThrow();
  });
});

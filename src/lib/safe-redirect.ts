/**
 * Validate a post-auth `next` redirect target supplied via query string.
 *
 * Returns the value only when it is a same-origin absolute path; otherwise
 * falls back to "/". When the result is appended to an origin with no trailing
 * slash (`${origin}${next}`), this prevents redirecting off-site. Specifically
 * it rejects:
 *   - off-site/userinfo tricks ("@evil.com" → parses as userinfo on the origin)
 *   - absolute URLs ("https://evil.com")
 *   - protocol-relative URLs ("//evil.com")
 *   - backslash variants browsers normalize to "//" ("/\\evil.com")
 * by requiring a leading "/" that is not immediately followed by "/" or "\".
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (raw[0] !== "/") return "/";
  if (raw[1] === "/" || raw[1] === "\\") return "/";
  return raw;
}

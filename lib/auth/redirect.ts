const INTERNAL_ORIGIN = "http://localhost";

/**
 * Validates that a post-authentication redirect target is a strictly relative
 * path on the current application origin (never an external URL, protocol-relative
 * URL, credential/userinfo trick like `@evil.com`, or backslash escape).
 */
export function sanitizeRedirectPath(
  input: string | null | undefined,
  fallback = "/"
): string {
  const safeFallback =
    typeof fallback === "string" && fallback.startsWith("/") && !fallback.startsWith("//")
      ? fallback
      : "/";

  if (typeof input !== "string") {
    return safeFallback;
  }

  const trimmed = input.trim();
  if (!trimmed || !trimmed.startsWith("/")) {
    return safeFallback;
  }

  // Reject protocol-relative paths, backslash escapes, userinfo tricks, or control chars
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(trimmed) ||
    /^\/+(?:@|%2f|%5c)/i.test(trimmed)
  ) {
    return safeFallback;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, INTERNAL_ORIGIN);
  } catch {
    return safeFallback;
  }

  if (
    parsed.origin !== INTERNAL_ORIGIN ||
    parsed.protocol !== "http:" ||
    parsed.host !== "localhost" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !parsed.pathname.startsWith("/") ||
    parsed.pathname.startsWith("//") ||
    /%5c/i.test(parsed.pathname)
  ) {
    return safeFallback;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}


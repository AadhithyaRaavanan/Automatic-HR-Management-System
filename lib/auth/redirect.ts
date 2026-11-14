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

  // Reject protocol-relative paths, backslash escapes, tab/newline/whitespace tricks, or control chars
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(trimmed) ||
    /^\/+[\s\u0000-\u001f\u007f]/.test(trimmed) ||
    /^\/+(?:@|%2f|%5c|%09|%0a|%0d)/i.test(trimmed)
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

/**
 * Validates a post-authentication redirect target, returning a strictly relative
 * path (e.g. "/attendance", "/tasks?status=open") or the fallback path.
 * Guarantees a consistent relative path return type across every branch.
 */
export function getSafeRedirectUrl(
  input: string | null | undefined,
  fallback = "/"
): string {
  return sanitizeRedirectPath(input, fallback);
}


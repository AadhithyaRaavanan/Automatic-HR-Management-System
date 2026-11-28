const LOOPBACK_HOST_REGEX = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;

function extractLocalOriginFromRequest(request?: Pick<Request, "headers" | "url">): string | null {
  if (!request) return null;

  try {
    const originHeader = request.headers?.get?.("origin");
    if (originHeader) {
      const parsed = new URL(originHeader);
      if (LOOPBACK_HOST_REGEX.test(parsed.host)) {
        return parsed.origin;
      }
    }
  } catch {}

  try {
    const forwardedHost = request.headers?.get?.("x-forwarded-host");
    const host = (forwardedHost || request.headers?.get?.("host") || "").split(",")[0].trim();
    if (host && LOOPBACK_HOST_REGEX.test(host)) {
      const proto =
        request.headers?.get?.("x-forwarded-proto")?.split(",")[0].trim() || "http";
      return `${proto}://${host}`;
    }
  } catch {}

  try {
    if (request.url) {
      const parsed = new URL(request.url);
      if (LOOPBACK_HOST_REGEX.test(parsed.host)) {
        return parsed.origin;
      }
    }
  } catch {}

  return null;
}

/**
 * Single source of truth for the site/application URL.
 * Prefers NEXT_PUBLIC_SITE_URL, falling back to NEXT_PUBLIC_APP_URL.
 * In non-production, preserves explicit loopback host (127.0.0.1 vs localhost)
 * from the active request so callback verification and subsequent navigation stay
 * on the same cookie host. In production, defaults to https://pulse.zenxea.com.
 */
export function getSiteUrl(request?: Pick<Request, "headers" | "url">): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  const isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    const requestOrigin = extractLocalOriginFromRequest(request);
    if (requestOrigin) {
      return requestOrigin.replace(/\/+$/, "");
    }
  }

  if (envUrl && envUrl.trim()) {
    const cleanUrl = envUrl.trim().replace(/\/+$/, "");
    if (!isProd || !cleanUrl.includes("localhost")) {
      return cleanUrl;
    }
  }

  return isProd ? "https://pulse.zenxea.com" : "http://localhost:3000";
}

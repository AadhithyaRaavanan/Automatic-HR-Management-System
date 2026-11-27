/**
 * Single source of truth for the site/application URL.
 * Prefers NEXT_PUBLIC_SITE_URL, falling back to NEXT_PUBLIC_APP_URL.
 * Falls back to http://localhost:3000 ONLY when NODE_ENV !== 'production'.
 * In production, defaults to https://pulse.zenxea.com.
 * Always returns a clean URL without a trailing slash.
 */
export function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  const isProd = process.env.NODE_ENV === "production";

  if (envUrl && envUrl.trim()) {
    const cleanUrl = envUrl.trim().replace(/\/+$/, "");
    if (!isProd || !cleanUrl.includes("localhost")) {
      return cleanUrl;
    }
  }

  return isProd ? "https://pulse.zenxea.com" : "http://localhost:3000";
}

/**
 * Single source of truth for the site/application URL.
 * Prefers NEXT_PUBLIC_SITE_URL, falling back to NEXT_PUBLIC_APP_URL.
 * Falls back to http://localhost:3000 ONLY when NODE_ENV !== 'production'.
 * In production, defaults to https://pulse.zenxea.com.
 * Always returns a clean URL without a trailing slash.
 */
export function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;

  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }

  return "https://pulse.zenxea.com";
}

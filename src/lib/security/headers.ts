/**
 * Production Security Headers Configuration
 * Adheres to OWASP and CIS benchmarks:
 * - Content-Security-Policy allowing Supabase, Turnstile, Sentry, Tailwind styles
 * - Strict-Transport-Security (HSTS)
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - Permissions-Policy: camera=(), microphone=(), geolocation=()
 */

export const SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; frame-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:* ws://127.0.0.1:* https://*.ingest.sentry.io https://challenges.cloudflare.com https://*.upstash.io;",
  },
];

export function applySecurityHeaders(headers: Headers): void {
  for (const { key, value } of SECURITY_HEADERS) {
    headers.set(key, value);
  }
}

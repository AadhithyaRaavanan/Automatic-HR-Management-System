/**
 * Cloudflare Turnstile CAPTCHA Integration
 *
 * Single Verification Path Architecture:
 * - Client-side: The Turnstile widget (<TurnstileCaptcha />) renders using NEXT_PUBLIC_TURNSTILE_SITE_KEY
 *   and produces a cryptographically signed one-time challenge token.
 * - Server-side & Auth: The Next.js application forwards the token as `captchaToken` directly to
 *   Supabase Auth (`signInWithPassword`, `signInWithOtp`, `verifyOtp`).
 * - Supabase GoTrue verifies the token directly against Cloudflare using the Turnstile Secret Key
 *   configured in the Supabase Dashboard (Authentication -> Bot Detection).
 * - There is zero duplicate server-side verification with TURNSTILE_SECRET_KEY inside the Next.js app.
 */

export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA"; // Cloudflare always-passes test site key
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA"; // Cloudflare always-passes secret key
export const TURNSTILE_ALWAYS_FAILS_KEY = "2x00000000000000000000AB";

export interface TurnstileVerificationResult {
  success: boolean;
  error?: string;
}

/**
 * Helper to inspect if a Turnstile token is present.
 */
export function isTurnstileTokenPresent(token: string | undefined): boolean {
  return typeof token === "string" && token.trim().length > 0;
}

/**
 * Pre-validation helper to verify token presence before forwarding to Supabase.
 */
export function checkTurnstileRequirements(token: string | undefined): { valid: boolean; error?: string } {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && (!token || token.trim() === "")) {
    return {
      valid: false,
      error: "CAPTCHA challenge token required. Please verify that you are human.",
    };
  }
  return { valid: true };
}

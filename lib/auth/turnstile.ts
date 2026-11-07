/**
 * Turnstile & CAPTCHA Verification Module
 *
 * Cloudflare Turnstile tokens are strictly SINGLE-USE: verifying once at the route
 * and again in GoTrue burns the token and causes a duplicate-token rejection.
 *
 * Security Requirement: In production, a CAPTCHA token is required UNCONDITIONALLY
 * (not conditional on TURNSTILE_SECRET_KEY).
 */
export function checkTurnstileRequirements(
  token: string | undefined
): { valid: boolean; error?: string } {
  const isProduction = process.env.NODE_ENV === "production";

  // FAIL CLOSED UNCONDITIONALLY in production if client provided no token
  if (isProduction && !token) {
    return {
      valid: false,
      error: "CAPTCHA challenge token required. Please verify that you are human.",
    };
  }

  return { valid: true };
}

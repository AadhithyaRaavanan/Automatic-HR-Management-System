/**
 * Cloudflare Turnstile Verification Module
 *
 * Provides server-side Turnstile verification for login, forgot-password, and sensitive endpoints.
 * In dev/test environments, accepts standard Cloudflare dummy/test tokens without network calls.
 * In production environments, verifies against Cloudflare's siteverify API.
 */

export const TURNSTILE_TEST_TOKEN = "1x0000000000000000000000000000000AA";
export const TURNSTILE_ALWAYS_FAILS_TOKEN = "2x0000000000000000000000000000000AA";

export interface TurnstileVerificationResult {
  success: boolean;
  error?: string;
}

/**
 * Synchronous requirement checker for backward compatibility and fast pre-checks.
 */
export function checkTurnstileRequirements(
  token: string | undefined
): { valid: boolean; error?: string } {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && (!token || token.trim() === "")) {
    return {
      valid: false,
      error: "CAPTCHA challenge token required. Please verify that you are human.",
    };
  }

  return { valid: true };
}

/**
 * Authoritative Turnstile Token Verification
 *
 * @param token - The response token from the Turnstile widget
 * @param remoteIp - Optional remote client IP address
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp?: string
): Promise<TurnstileVerificationResult> {
  const isProduction = process.env.NODE_ENV === "production";

  // In non-production (dev/test), handle test tokens and permissive local execution
  if (!isProduction) {
    if (token === TURNSTILE_ALWAYS_FAILS_TOKEN) {
      return {
        success: false,
        error: "CAPTCHA challenge failed. Invalid test token.",
      };
    }

    if (token === TURNSTILE_TEST_TOKEN || !process.env.TURNSTILE_SECRET_KEY) {
      return { success: true };
    }
  }

  // In production, token is strictly required
  if (!token || token.trim() === "") {
    return {
      success: false,
      error: "CAPTCHA challenge token required. Please verify that you are human.",
    };
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    if (isProduction) {
      return {
        success: false,
        error: "Turnstile secret key is not configured on the server.",
      };
    }
    return { success: true };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (remoteIp) {
      formData.append("remoteip", remoteIp);
    }

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Turnstile verification gateway responded with status ${response.status}`,
      };
    }

    const data = await response.json();

    if (!data.success) {
      const errorCodes = Array.isArray(data["error-codes"]) ? data["error-codes"].join(", ") : "verification failed";
      return {
        success: false,
        error: `CAPTCHA verification failed (${errorCodes}). Please try again.`,
      };
    }

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: `Turnstile network error: ${err.message || String(err)}`,
    };
  }
}

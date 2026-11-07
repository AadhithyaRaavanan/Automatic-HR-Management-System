import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { Database, EmployeeRole } from "@/types/database.types";
import {
  getRateLimitKey,
  checkRateLimit,
  recordFailure,
  clearRateLimit,
} from "@/lib/auth/rate-limiter";

/**
 * Extract platform-trusted client IP.
 * Vercel Documentation Reference: https://vercel.com/docs/edge-network/headers/request-headers
 * - 'x-vercel-ip': Primary client IP address provided by Vercel's Edge Network.
 * - 'x-real-ip': Standard de facto client IP header forwarded by reverse proxies.
 * - 'x-forwarded-for': Comma-separated proxy chain; the leftmost IP is the originating client.
 *
 * Robust fallback strategy:
 * If 'x-vercel-ip' is absent (e.g. running behind a custom CDN, preview domain, or local Docker proxy),
 * resolves through 'x-real-ip' and the first entry of 'x-forwarded-for'.
 * If all IP headers are missing in production, gracefully falls back to an unknown IP token
 * so authentication is never abruptly blocked, while rate limiting remains strictly enforced by email.
 */
function getPlatformTrustedClientIp(request: NextRequest): string {
  const vercelIp = request.headers.get("x-vercel-ip");
  if (vercelIp && vercelIp.trim()) {
    return vercelIp.trim();
  }

  const nextIp = (request as any).ip;
  if (nextIp && typeof nextIp === "string" && nextIp.trim()) {
    return nextIp.trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor && forwardedFor.trim()) {
    const clientIp = forwardedFor.split(",")[0].trim();
    if (clientIp) return clientIp;
  }

  // Non-production fallback (local development / testing)
  if (process.env.NODE_ENV !== "production") {
    return "127.0.0.1";
  }

  // In production, log a warning and fall back to a fallback token so login does not hard-fail
  console.warn("[SECURITY] No platform client IP header detected on incoming request; using email-scoped rate limit.");
  return "unknown-client-ip";
}

/**
 * Validates presence of Cloudflare Turnstile token for Supabase-Native CAPTCHA.
 * Turnstile tokens are strictly SINGLE-USE: verifying once at the route and again in GoTrue
 * burns the token and causes a duplicate-token rejection.
 *
 * Decision: Supabase-Native CAPTCHA is utilized.
 * GoTrue natively verifies the token against Cloudflare when passed via `signInWithPassword({ options: { captchaToken } })`.
 * This protects both the application route and direct API calls to Supabase Auth without duplicate verification.
 */
function checkTurnstileRequirements(
  token: string | undefined
): { valid: boolean; error?: string } {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const isProduction = process.env.NODE_ENV === "production";

  // FAIL CLOSED in production if Turnstile secret is configured but client provided no token
  if (isProduction && secret && !token) {
    return {
      valid: false,
      error: "CAPTCHA challenge token required. Please verify that you are human.",
    };
  }

  return { valid: true };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, captchaToken } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Invalid email or password. Please verify your credentials and try again." },
        { status: 400 }
      );
    }

    // 1. Resolve Platform-Trusted Client IP
    let clientIp: string;
    try {
      clientIp = getPlatformTrustedClientIp(request);
    } catch {
      return NextResponse.json(
        { error: "Request rejected: trusted client IP could not be verified." },
        { status: 403 }
      );
    }

    const rateKey = getRateLimitKey(clientIp, email);

    // 2. Evaluate Shared Store Rate Limit (Upstash Redis or Supabase Table)
    const limitCheck = await checkRateLimit(rateKey);
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: `Too many failed login attempts. Account login is temporarily locked for security. Please try again in ${Math.ceil(
            limitCheck.retryAfterSeconds / 60
          )} minutes.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(limitCheck.retryAfterSeconds),
          },
        }
      );
    }

    // 3. Evaluate Cloudflare Turnstile CAPTCHA Requirement (Fails Closed in Production)
    const captchaCheck = checkTurnstileRequirements(captchaToken);
    if (!captchaCheck.valid) {
      return NextResponse.json(
        { error: captchaCheck.error || "CAPTCHA challenge required." },
        { status: 400 }
      );
    }

    // Prepare response object to collect auth session cookies
    let response = NextResponse.json({ success: true });

    // 4. Supabase Auth Integration
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
      {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            response.cookies.set({ name, value, ...options });
          },
          remove(name: string, options: CookieOptions) {
            response.cookies.set({ name, value: "", ...options });
          },
        },
      }
    );

    // Pass captchaToken to Supabase options for native Supabase bot protection
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });

    if (authError || !authData.user) {
      // Record failure in shared rate limit store
      await recordFailure(rateKey);

      // Generic authentication error prevents account enumeration
      return NextResponse.json(
        { error: "Invalid email or password. Please verify your credentials and try again." },
        { status: 401 }
      );
    }

    // On successful authentication, clear shared rate limit
    await clearRateLimit(rateKey);

    // 5. Role & Multi-Factor Authentication (MFA) Status Resolution
    let userRole = (authData.user.app_metadata?.user_role) as EmployeeRole | undefined;

    // Check token claims from session minted by custom_access_token_hook
    if (!userRole && authData.session?.access_token) {
      try {
        const payload = JSON.parse(
          Buffer.from(authData.session.access_token.split(".")[1], "base64").toString()
        );
        if (payload.user_role) {
          userRole = payload.user_role as EmployeeRole;
        }
      } catch {}
    }

    // Direct database query fallback to guarantee authoritative role resolution
    if (!userRole) {
      const { data: roleRow } = await (supabase as any)
        .from("user_roles")
        .select("role")
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if ((roleRow as any)?.role) {
        userRole = (roleRow as any).role as EmployeeRole;
      }
    }

    if (!userRole) {
      userRole = "employee";
    }

    // Helper to preserve auth session cookies from createServerClient
    const createSuccessResponse = (payload: any) => {
      const res = NextResponse.json(payload);
      response.cookies.getAll().forEach((cookie) => {
        res.cookies.set(cookie);
      });
      return res;
    };

    if (userRole === "hr" || userRole === "admin") {
      const { data: factorData } = await supabase.auth.mfa.listFactors();
      const hasVerifiedFactor = Boolean(
        factorData?.totp?.some((factor) => factor.status === "verified")
      );

      if (!hasVerifiedFactor) {
        // Privileged user without enrolled MFA -> Route to enrollment page at AAL1
        return createSuccessResponse({
          success: true,
          requireMfa: true,
          mfaDestination: "/mfa-setup",
          role: userRole,
        });
      }

      // Privileged user with enrolled factor -> Route to MFA challenge
      return createSuccessResponse({
        success: true,
        requireMfa: true,
        mfaDestination: "/mfa-challenge",
        role: userRole,
      });
    }

    // Standard employee / manager
    return createSuccessResponse({
      success: true,
      requireMfa: false,
      mfaDestination: "/",
      role: userRole,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred during authentication." },
      { status: 500 }
    );
  }
}

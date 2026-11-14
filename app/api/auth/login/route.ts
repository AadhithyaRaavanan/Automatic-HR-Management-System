import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { Database, EmployeeRole } from "@/types/database.types";
import { generateSync } from "otplib";
import { Client } from "pg";
import {
  getRateLimitKey,
  getEmailRateLimitKey,
  checkRateLimit,
  recordFailure,
  clearRateLimit,
} from "@/lib/auth/rate-limiter";
import { checkTurnstileRequirements } from "@/lib/auth/turnstile";
import { isDemoModeEnabled } from "@/lib/config/demo";

/**
 * Extract platform-trusted client IP.
 * Vercel Documentation Reference: https://vercel.com/docs/edge-network/headers/request-headers
 * Vercel provides:
 * - 'x-forwarded-for': Standard comma-separated client IP proxy chain; leftmost is originating client.
 * - 'x-vercel-forwarded-for': Vercel-specific forwarded header.
 * - 'x-real-ip': Client IP header forwarded by reverse proxies.
 * Note: 'x-vercel-ip-*' headers are geographic headers (city, country, etc.); there is no plain 'x-vercel-ip'.
 *
 * Robust resolution strategy:
 * Checks x-forwarded-for / x-vercel-forwarded-for first, then x-real-ip, then request.ip.
 * In production, if headers are stripped, logs a warning and uses 'unknown-client-ip'
 * while rate limiting remains strictly enforced by the email-only rate limiter.
 */
function getPlatformTrustedClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor && forwardedFor.trim()) {
    const clientIp = forwardedFor.split(",")[0].trim();
    if (clientIp) return clientIp;
  }

  const vercelForwardedFor = request.headers.get("x-vercel-forwarded-for");
  if (vercelForwardedFor && vercelForwardedFor.trim()) {
    const clientIp = vercelForwardedFor.split(",")[0].trim();
    if (clientIp) return clientIp;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }

  const nextIp = (request as any).ip;
  if (nextIp && typeof nextIp === "string" && nextIp.trim()) {
    return nextIp.trim();
  }

  // Non-production fallback (local development / testing)
  if (process.env.NODE_ENV !== "production") {
    return "127.0.0.1";
  }

  console.warn("[SECURITY] No platform client IP header detected on incoming request; using email-scoped rate limit.");
  return "unknown-client-ip";
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

    const ipEmailKey = getRateLimitKey(clientIp, email);
    const emailKey = getEmailRateLimitKey(email);

    // 2. Evaluate Dual Rate Limits: IP+Email AND Email-only counters
    const [ipEmailCheck, emailCheck] = await Promise.all([
      checkRateLimit(ipEmailKey),
      checkRateLimit(emailKey),
    ]);

    if (!ipEmailCheck.allowed || !emailCheck.allowed) {
      const retryAfter = Math.max(
        ipEmailCheck.retryAfterSeconds,
        emailCheck.retryAfterSeconds
      );
      return NextResponse.json(
        {
          error: `Too many failed login attempts. Account login is temporarily locked for security. Please try again in ${Math.ceil(
            retryAfter / 60
          )} minutes.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
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
      // Record failure on both IP+Email AND Email-only rate limit stores
      await Promise.all([
        recordFailure(ipEmailKey),
        recordFailure(emailKey),
      ]);

      // Generic authentication error prevents account enumeration
      return NextResponse.json(
        { error: "Invalid email or password. Please verify your credentials and try again." },
        { status: 401 }
      );
    }

    // On successful authentication, clear both rate limit counters
    await Promise.all([
      clearRateLimit(ipEmailKey),
      clearRateLimit(emailKey),
    ]);

    // Check temporary password expiration (24-hour limit)
    const userMeta = (authData.user.user_metadata || {}) as Record<string, any>;
    if (userMeta.must_change_password) {
      const expiresAt = userMeta.temp_password_expires_at;
      const createdAt = userMeta.temp_password_created_at;
      const isExpired =
        (expiresAt && new Date(expiresAt).getTime() < Date.now()) ||
        (createdAt && Date.now() - new Date(createdAt).getTime() > 24 * 60 * 60 * 1000);

      if (isExpired) {
        await supabase.auth.signOut();
        return NextResponse.json(
          { error: "Temporary password has expired (24-hour limit). Please contact your administrator for a new temporary password." },
          { status: 401 }
        );
      }
    }

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
      const { data: memberRow } = await (supabase as any)
        .from("organization_members")
        .select("role")
        .eq("user_id", authData.user.id)
        .eq("status", "active")
        .maybeSingle();
      if ((memberRow as any)?.role) {
        userRole = (memberRow as any).role as EmployeeRole;
      }
    }

    // Refuse access to accounts with no active organization membership
    if (!userRole) {
      await supabase.auth.signOut();
      return NextResponse.json(
        { error: "Access Denied: No active organization membership found for this account. Please contact your administrator." },
        { status: 403 }
      );
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
      const isDemoMode = isDemoModeEnabled();
      let latestUserFactors: any[] = ((authData.user as any)?.factors as any[]) || [];

      if (isDemoMode) {
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            const { data: factorData, error: listError } = await supabase.auth.mfa.listFactors();
            if (listError) {
              if (attempt === 0) {
                const { data: retryAuth } = await supabase.auth.signInWithPassword({
                  email,
                  password,
                });
                if (retryAuth?.user) {
                  latestUserFactors = ((retryAuth.user as any).factors as any[]) || latestUserFactors;
                }
                continue;
              }
              break;
            }

            let factorId: string | null = null;
            let factorSecret: string | null = null;

            const verifiedFactor = factorData?.totp?.find((f) => f.status === "verified");
            if (verifiedFactor) {
              factorId = verifiedFactor.id;
              const dbUrl =
                process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
              const pgClient = new Client({ connectionString: dbUrl });
              await pgClient.connect();
              try {
                const res = await pgClient.query(
                  "SELECT secret FROM auth.mfa_factors WHERE id = $1 LIMIT 1",
                  [factorId]
                );
                if (res.rows[0]?.secret) factorSecret = res.rows[0].secret;
              } finally {
                await pgClient.end().catch(() => {});
              }
            } else {
              const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
                factorType: "totp",
                issuer: "RemoteHR Demo",
                friendlyName: `RemoteHR-Demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              });
              if (!enrollError && enrollData) {
                factorId = enrollData.id;
                factorSecret = enrollData.totp.secret;
              } else if (attempt === 0) {
                const { data: retryAuth } = await supabase.auth.signInWithPassword({
                  email,
                  password,
                });
                if (retryAuth?.user) {
                  latestUserFactors = ((retryAuth.user as any).factors as any[]) || latestUserFactors;
                }
                continue;
              }
            }

            if (factorId && factorSecret) {
              const code = generateSync({ secret: factorSecret });
              const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
                factorId,
                code,
              });
              if (!verifyError) {
                return createSuccessResponse({
                  success: true,
                  requireMfa: false,
                  mfaDestination: "/",
                  role: userRole,
                });
              }
              if (attempt === 0) {
                const { data: retryAuth } = await supabase.auth.signInWithPassword({
                  email,
                  password,
                });
                if (retryAuth?.user) {
                  latestUserFactors = ((retryAuth.user as any).factors as any[]) || latestUserFactors;
                }
                continue;
              }
            }
          }
        } catch {
          // Fall through to manual MFA if automated demo resolution fails
        }
      }

      const { data: factorData } = await supabase.auth.mfa.listFactors();
      const hasVerifiedFactor = Boolean(
        factorData?.totp?.some((factor) => factor.status === "verified") ||
          latestUserFactors.some(
            (factor) => factor.factor_type === "totp" && factor.status === "verified"
          )
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

    const mustChangePassword = Boolean(userMeta.must_change_password);

    // Standard employee / manager
    return createSuccessResponse({
      success: true,
      requireMfa: false,
      mustChangePassword,
      mfaDestination: mustChangePassword ? "/settings?must_change_password=true" : "/",
      role: userRole,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred during authentication." },
      { status: 500 }
    );
  }
}

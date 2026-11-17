import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { Database, EmployeeRole } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getRateLimitKey,
  getEmailRateLimitKey,
  checkRateLimit,
  recordFailure,
  clearRateLimit,
} from "@/lib/auth/rate-limiter";
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
  let body: any = null;
  try {
    body = await request.json();
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

    // 2. Evaluate Dual Rate Limits: IP+Email AND Email-only counters (bypassed in demo mode)
    if (!isDemoModeEnabled()) {
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
    }

    // 3. Supabase Auth Integration with Native CAPTCHA Verification
    // Captcha secret is configured in Supabase Dashboard; token is forwarded to GoTrue
    let response = NextResponse.json({ success: true });

    // 4. Supabase Auth Integration
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    // Pass captchaToken to Supabase options for native Supabase bot protection
    let { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });

    // In Demo Mode: if demo account doesn't exist yet on remote Supabase, auto-provision it via admin client
    if (authError && isDemoModeEnabled() && password === "DemoPassword123!") {
      try {
        const { ensureDemoAccount } = await import("@/lib/auth/demo-provisioner");
        const provisioned = await ensureDemoAccount(email);
        if (provisioned) {
          const retryResult = await supabase.auth.signInWithPassword({
            email,
            password,
            options: captchaToken ? { captchaToken } : undefined,
          });
          authData = retryResult.data;
          authError = retryResult.error;
        }
      } catch (provisionErr) {
        console.error("[DemoProvisioner] Failed to auto-provision demo account:", provisionErr);
      }
    }

    // If login failed because invited employee email is not confirmed, auto-confirm and retry
    if (
      authError &&
      (authError.message?.toLowerCase().includes("email not confirmed") ||
        (authError as any)?.code === "email_not_confirmed")
    ) {
      try {
        let page = 1;
        let targetUser: any = null;
        while (!targetUser && page <= 5) {
          const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
          if (!listData?.users || listData.users.length === 0) break;
          targetUser = listData.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
          page++;
        }
        if (targetUser) {
          await supabaseAdmin.auth.admin.updateUserById(targetUser.id, { email_confirm: true });
          const retryResult = await supabase.auth.signInWithPassword({
            email,
            password,
            options: captchaToken ? { captchaToken } : undefined,
          });
          if (retryResult.data?.user) {
            authData = retryResult.data;
            authError = retryResult.error;
          }
        }
      } catch (confirmErr) {
        console.error("[Login Auto-Confirm Error]:", confirmErr);
      }
    }

    if (authError || !authData.user) {
      if (!isDemoModeEnabled()) {
        // Record failure on both IP+Email AND Email-only rate limit stores
        await Promise.all([
          recordFailure(ipEmailKey),
          recordFailure(emailKey),
        ]);
      }

      const errorMessage = isDemoModeEnabled()
        ? `Demo Login: ${authError?.message || "Authentication failed. Please verify Supabase URL & keys in Vercel."}`
        : "Invalid email or password. Please verify your credentials and try again.";

      return NextResponse.json(
        { error: errorMessage },
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
      try {
        const { data: memberRow } = await (supabase as any)
          .from("organization_members")
          .select("role")
          .eq("user_id", authData.user.id)
          .eq("status", "active")
          .maybeSingle();
        if ((memberRow as any)?.role) {
          userRole = (memberRow as any).role as EmployeeRole;
        } else if (process.env.NODE_ENV !== "test") {
          const { getAdminClient } = await import("@/lib/supabase/admin");
          const adminClient = getAdminClient();
          const { data: adminMemberRow } = await adminClient
            .from("organization_members")
            .select("role")
            .eq("user_id", authData.user.id)
            .eq("status", "active")
            .maybeSingle();
          if ((adminMemberRow as any)?.role) {
            userRole = (adminMemberRow as any).role as EmployeeRole;
          }
        }
      } catch (err) {
        console.warn("[Login API] Failed to resolve role from database:", err);
      }
    }

    // In demo mode: fallback to preset role from DEMO_ACCOUNTS
    if (!userRole && isDemoModeEnabled()) {
      const { DEMO_ACCOUNTS } = await import("@/lib/auth/demo-provisioner");
      const demoAccount = DEMO_ACCOUNTS[email.toLowerCase().trim()];
      if (demoAccount) {
        userRole = demoAccount.role;
      }
    }

    // Ensure user_role is stored on app_metadata so JWTs carry the role claim
    if (userRole && authData.user?.id && process.env.NODE_ENV !== "test") {
      try {
        const { getAdminClient } = await import("@/lib/supabase/admin");
        await getAdminClient().auth.admin.updateUserById(authData.user.id, {
          app_metadata: {
            ...authData.user.app_metadata,
            user_role: userRole,
          },
        });
      } catch (err) {
        console.warn("[Login API] Failed to sync user_role to app_metadata:", err);
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
      if (userRole) {
        res.cookies.set("remotehr_role", userRole, {
          path: "/",
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 30, // 30 days
        });
      }
      return res;
    };

    if (userRole === "hr" || userRole === "admin") {
      const isDemoMode = isDemoModeEnabled();

      if (isDemoMode) {
        try {
          const { getAdminClient } = await import("@/lib/supabase/admin");
          const adminClient = getAdminClient();
          const { data: factorData } = await supabase.auth.mfa.listFactors();
          const verifiedFactor = factorData?.totp?.find((f) => f.status === "verified");
          if (verifiedFactor && authData.user) {
            await adminClient.auth.admin.mfa.deleteFactor({
              id: verifiedFactor.id,
              userId: authData.user.id,
            }).catch(() => {});
          }
        } catch (mfaDemoErr) {
          console.warn("[Login API] Demo MFA factor cleanup:", mfaDemoErr);
        }

        // Demo mode immediately directs privileged users to the dashboard
        return createSuccessResponse({
          success: true,
          requireMfa: false,
          mfaDestination: "/",
          role: userRole,
        });
      }

      let latestUserFactors: any[] = ((authData.user as any)?.factors as any[]) || [];

      const { data: factorData } = await supabase.auth.mfa.listFactors();
      const hasVerifiedFactor = Boolean(
        factorData?.totp?.some((factor) => factor.status === "verified") ||
          latestUserFactors.some(
            (factor) => factor.factor_type === "totp" && factor.status === "verified"
          )
      );

      if (!hasVerifiedFactor) {
        let reqMfa = true;
        try {
          const { data: memberData } = await (supabase as any)
            .from("organization_members")
            .select("organizations(require_mfa_for_privileged)")
            .eq("user_id", authData.user.id)
            .eq("status", "active")
            .maybeSingle();
          if (memberData?.organizations && typeof memberData.organizations.require_mfa_for_privileged === "boolean") {
            reqMfa = memberData.organizations.require_mfa_for_privileged;
          }
        } catch {}

        if (reqMfa) {
          // MFA required by organization policy -> route unenrolled admin/hr to /mfa-setup
          return createSuccessResponse({
            success: true,
            requireMfa: true,
            mfaDestination: "/mfa-setup",
            role: userRole,
          });
        }

        // 2FA disabled by organization policy -> allow single-factor sign in
        const mustChangePassword = Boolean(userMeta.must_change_password);
        return createSuccessResponse({
          success: true,
          requireMfa: false,
          mustChangePassword,
          mfaDestination: mustChangePassword ? "/settings?must_change_password=true" : "/",
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

    // Check onboarding status for standard employees
    // If the employee has submitted all documents (SUBMITTED, RESUBMITTED, UNDER_REVIEW, VERIFIED, COMPLETED),
    // they are immediately allowed to enter the dashboard to continue working!
    let canAccessDashboard = false;
    if (userMeta.onboarding_completed === true) {
      canAccessDashboard = true;
    } else {
      const { data: onbProf } = await (supabase as any)
        .from("onboarding_profiles")
        .select("onboarding_status, status")
        .eq("user_id", authData.user.id)
        .maybeSingle();

      const onbStatus = (onbProf?.onboarding_status || onbProf?.status || "").toUpperCase();
      if (["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW", "VERIFIED", "COMPLETED"].includes(onbStatus)) {
        canAccessDashboard = true;
      } else {
        const { data: prof } = await (supabase as any)
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", authData.user.id)
          .maybeSingle();

        if (prof?.onboarding_completed === true) {
          canAccessDashboard = true;
        } else {
          const { data: emp } = await (supabase as any)
            .from("employees")
            .select("onboarding_completed")
            .eq("id", authData.user.id)
            .maybeSingle();
          canAccessDashboard = Boolean(emp?.onboarding_completed);
        }
      }
    }

    if (!canAccessDashboard) {
      return createSuccessResponse({
        success: true,
        requireMfa: false,
        onboardingRequired: true,
        destination: "/onboarding",
        mfaDestination: "/onboarding",
        role: userRole,
      });
    }

    // Standard employee / manager with completed onboarding
    return createSuccessResponse({
      success: true,
      requireMfa: false,
      mustChangePassword,
      mfaDestination: mustChangePassword ? "/settings?must_change_password=true" : "/",
      destination: mustChangePassword ? "/settings?must_change_password=true" : "/",
      role: userRole,
    });
  } catch (err: any) {
    if (isDemoModeEnabled()) {
      const emailLower = (body?.email || "").toLowerCase().trim();
      const demoRole =
        emailLower.includes("admin") ? "admin" :
        emailLower.includes("hr") ? "hr" :
        emailLower.includes("manager") ? "manager" : "employee";
      const fallbackRes = NextResponse.json({
        success: true,
        requireMfa: false,
        mfaDestination: "/",
        role: demoRole,
      });
      fallbackRes.cookies.set("remotehr_role", demoRole, {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
      });
      return fallbackRes;
    }
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred during authentication." },
      { status: 500 }
    );
  }
}

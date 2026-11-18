import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { Database, EmployeeRole } from "@/types/database.types";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { applySecurityHeaders } from "@/lib/security/headers";
import { FEATURES } from "@/lib/features";

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Demo routes are strictly restricted to demo mode (non-production + opt-in flag)
  if (pathname === "/gallery" || pathname.startsWith("/gallery/")) {
    if (!isDemoModeEnabled()) {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/auth/demo-totp") && !isDemoModeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 1. Instant Fast-Path for static assets, images, fonts, and public routes that don't need auth checks
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    /\.(svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf|eot|ico)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Feature flag guards: if feature is disabled, redirect server-side to /dashboard
  if (
    (!FEATURES.KPI && (pathname === "/kpi" || pathname.startsWith("/kpi/"))) ||
    (!FEATURES.TASKS && (pathname === "/tasks" || pathname.startsWith("/tasks/"))) ||
    (!FEATURES.LOCATIONS && (pathname === "/admin/locations" || pathname.startsWith("/admin/locations/"))) ||
    (!FEATURES.SHIFTS && (pathname === "/admin/shifts" || pathname.startsWith("/admin/shifts/"))) ||
    (!FEATURES.AUDITS && (pathname === "/admin/audits" || pathname.startsWith("/admin/audits/")))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Standard @supabase/ssr server client with native chunked cookie assembly
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
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  /**
   * Cryptographic JWT Signature & Claims Verification:
   * Uses Supabase's native `supabase.auth.getClaims()`.
   * Standard @supabase/ssr storage automatically stitches chunked cookies (`.0`, `.1`, etc.).
   * - If asymmetric JWKS keys are configured, verifies the signature locally in Web Crypto.
   * - If symmetric HS256 is used (the Supabase default), delegates authoritative verification
   *   to GoTrue via network call without requiring SUPABASE_JWT_SECRET in Vercel.
   * Unverified base64 decoding is never trusted for auth or access control decisions.
   */
  const getVerifiedJwtClaims = async (): Promise<Record<string, any> | null> => {
    try {
      const { data, error } = await supabase.auth.getClaims();
      if (!error && data?.claims) {
        return data.claims;
      }
      return null;
    } catch {
      return null;
    }
  };

  const claims = await getVerifiedJwtClaims();
  const isTokenValid = !!claims && (!claims.exp || claims.exp * 1000 > Date.now());
  const aal = claims?.aal || "aal1";
  const userEmail = (claims?.email || "") as string;
  let userRole = (claims?.user_role ||
    claims?.app_metadata?.user_role ||
    claims?.user_metadata?.role ||
    claims?.user_metadata?.user_role) as EmployeeRole | undefined;

  // In demo mode: if role claim is missing from JWT, resolve dynamically from demo preset email
  if (!userRole && isDemoModeEnabled() && userEmail) {
    const emailLower = userEmail.toLowerCase();
    if (emailLower.includes("admin")) userRole = "admin";
    else if (emailLower.includes("hr")) userRole = "hr";
    else if (emailLower.includes("manager")) userRole = "manager";
    else userRole = "employee";
  }
  userRole = userRole || "employee";

  const isPublicPath =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/mfa-challenge") ||
    pathname.startsWith("/mfa-setup") ||
    pathname.startsWith("/forgot-password") ||
    pathname === "/privacy" ||
    pathname === "/terms";

  // If unauthenticated user tries to access a protected app route
  if (!isTokenValid && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // If authenticated user visits login
  if (isTokenValid && pathname === "/login") {
    // If user has an active enrolled TOTP factor but has not verified AAL2, route to MFA challenge
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.nextLevel === "aal2" && aal !== "aal2") {
      const url = request.nextUrl.clone();
      url.pathname = "/mfa-challenge";
      return NextResponse.redirect(url);
    }

    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Role-Based Route Guards (RBAC) & Multi-Factor Authentication Enforcement
  if (isTokenValid) {
    const userMeta = (claims?.user_metadata || {}) as Record<string, any>;
    const userId = (claims?.sub || claims?.id) as string | undefined;

    // 1. Onboarding Approval Gate (Enforced before General App Access)
    // ADMIN and HR are exempt (always ALLOWED)
    const isPrivilegedAdminOrHr = userRole === "admin" || userRole === "hr";
    let isAllowed = isPrivilegedAdminOrHr;
    let gateStatus: "ALLOWED" | "PENDING_APPROVAL" | "CHANGES_REQUESTED" | "ONBOARDING_REQUIRED" =
      isPrivilegedAdminOrHr ? "ALLOWED" : "ONBOARDING_REQUIRED";

    if (!isPrivilegedAdminOrHr && userId) {
      // Fast-path: check trusted app_metadata claim
      if (claims?.app_metadata?.onboarding_approved === true) {
        isAllowed = true;
        gateStatus = "ALLOWED";
      } else {
        // Fallback: ONE lightweight DB check so a newly approved user is let in without logging out
        try {
          const checkClient = process.env.SUPABASE_SERVICE_ROLE_KEY
            ? createServerClient<Database>(
                process.env.NEXT_PUBLIC_SUPABASE_URL || "",
                process.env.SUPABASE_SERVICE_ROLE_KEY,
                { cookies: { getAll: () => [], setAll: () => {} } }
              )
            : supabase;

          const [onbRes, empRes] = await Promise.all([
            (checkClient as any)
              .from("onboarding_profiles")
              .select("status")
              .eq("user_id", userId)
              .maybeSingle(),
            (checkClient as any)
              .from("employees")
              .select("status, onboarding_completed")
              .eq("id", userId)
              .maybeSingle(),
          ]);

          const profStatus = (onbRes.data?.status || "").toLowerCase();
          const empStatus = (empRes.data?.status || "").toLowerCase();

          if (profStatus === "approved" && empStatus === "active") {
            isAllowed = true;
            gateStatus = "ALLOWED";
          } else if (profStatus === "changes_requested" || profStatus === "rejected") {
            gateStatus = "CHANGES_REQUESTED";
          } else if (profStatus === "submitted") {
            gateStatus = "PENDING_APPROVAL";
          } else {
            gateStatus = "ONBOARDING_REQUIRED";
          }
        } catch {
          gateStatus = "ONBOARDING_REQUIRED";
        }
      }
    }

    // Non-ALLOWED routing enforcement:
    if (!isAllowed) {
      const isWhitelisted =
        pathname === "/login" ||
        pathname.startsWith("/login") ||
        pathname.startsWith("/auth") ||
        pathname === "/403" ||
        pathname.startsWith("/api/auth/signout");

      if (gateStatus === "PENDING_APPROVAL") {
        if (pathname !== "/onboarding/pending" && !isWhitelisted) {
          const url = request.nextUrl.clone();
          url.pathname = "/onboarding/pending";
          url.search = "";
          return NextResponse.redirect(url);
        }
      } else {
        // ONBOARDING_REQUIRED or CHANGES_REQUESTED -> /onboarding
        if (
          pathname !== "/onboarding" &&
          !pathname.startsWith("/onboarding") &&
          !isWhitelisted
        ) {
          const url = request.nextUrl.clone();
          url.pathname = "/onboarding";
          url.search = "";
          return NextResponse.redirect(url);
        }
      }
      return response;
    }

    // If candidate is ALLOWED and visits /onboarding/pending or /onboarding, redirect to dashboard
    if (isAllowed && (pathname === "/onboarding/pending" || pathname === "/onboarding")) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }

    // 2. Enforce temporary password must-change-password and 24-hour expiration (Only after onboarding approval)
    const mustChangePassword = Boolean(claims?.must_change_password || userMeta.must_change_password);

    if (mustChangePassword) {
      const expiresAt = userMeta.temp_password_expires_at;
      const createdAt = userMeta.temp_password_created_at;
      const isExpired =
        (expiresAt && new Date(expiresAt).getTime() < Date.now()) ||
        (createdAt && Date.now() - new Date(createdAt).getTime() > 24 * 60 * 60 * 1000);

      if (isExpired) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("error", "expired_temp_password");
        return NextResponse.redirect(url);
      }

      if (
        pathname !== "/settings" &&
        request.nextUrl.searchParams.get("must_change_password") !== "true" &&
        !pathname.startsWith("/auth") &&
        !pathname.startsWith("/login") &&
        !pathname.startsWith("/api")
      ) {
        const url = request.nextUrl.clone();
        url.pathname = "/settings";
        url.searchParams.set("must_change_password", "true");
        return NextResponse.redirect(url);
      }
    }

    // 3. Multi-Factor Authentication Enforcement:
    // - If user has an enrolled factor and current assurance is not aal2 -> /mfa-challenge
    // - If user is HR/Admin in an organization with require_mfa_for_privileged = TRUE,
    //   and user has NO verified factor -> /mfa-setup
    if (aal !== "aal2") {
      let hasEnrolledFactor = false;
      try {
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        hasEnrolledFactor = aalData?.nextLevel === "aal2";
      } catch {}

      if (hasEnrolledFactor) {
        if (
          !pathname.startsWith("/mfa-challenge") &&
          !pathname.startsWith("/mfa-setup") &&
          !pathname.startsWith("/auth") &&
          !pathname.startsWith("/settings") &&
          !pathname.startsWith("/api")
        ) {
          const url = request.nextUrl.clone();
          url.pathname = "/mfa-challenge";
          url.searchParams.set("redirect", pathname);
          return NextResponse.redirect(url);
        }
      } else if (userRole === "hr" || userRole === "admin") {
        let reqMfa = !isDemoModeEnabled();
        try {
          const orgId = claims?.organization_id || claims?.app_metadata?.organization_id;
          if (orgId) {
            const { data: org } = await (supabase as any)
              .from("organizations")
              .select("require_mfa_for_privileged")
              .eq("id", orgId)
              .maybeSingle();
            if (org && typeof org.require_mfa_for_privileged === "boolean") {
              reqMfa = org.require_mfa_for_privileged;
            }
          }
        } catch {}

        if (reqMfa) {
          const isAllowedUnenrolledPath =
            pathname.startsWith("/mfa-setup") ||
            pathname.startsWith("/api/auth") ||
            pathname.startsWith("/auth") ||
            pathname === "/login" ||
            (pathname.startsWith("/settings") && request.nextUrl.searchParams.get("must_change_password") === "true");

          if (!isAllowedUnenrolledPath) {
            const url = request.nextUrl.clone();
            url.pathname = "/mfa-setup";
            url.searchParams.set("redirect", pathname);
            return NextResponse.redirect(url);
          }
        }
      }
    }

    // EMS route guard (Admin, HR, Manager allowed; Employee denied gets /403)
    if (pathname.startsWith("/ems") || pathname.startsWith("/employees")) {
      if (userRole !== "admin" && userRole !== "hr" && userRole !== "manager") {
        const url = request.nextUrl.clone();
        url.pathname = "/403";
        return NextResponse.redirect(url);
      }
    }

    // Team route guard (Manager+)
    if (pathname.startsWith("/team") && userRole === "employee") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    // Reports route guard (HR+)
    if (
      pathname.startsWith("/reports") &&
      userRole !== "hr" &&
      userRole !== "admin"
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    // HR route guard (HR and Admin only; unauthorized gets /403)
    if (pathname.startsWith("/hr")) {
      if (userRole !== "admin" && userRole !== "hr") {
        const url = request.nextUrl.clone();
        url.pathname = "/403";
        return NextResponse.redirect(url);
      }
    }

    // Admin route guard (Admin only; HR is allowed on /admin/users directory; unauthorized gets /403)
    if (pathname.startsWith("/admin")) {
      if (pathname.startsWith("/admin/users")) {
        if (userRole !== "admin" && userRole !== "hr") {
          const url = request.nextUrl.clone();
          url.pathname = "/403";
          return NextResponse.redirect(url);
        }
      } else {
        if (userRole !== "admin") {
          const url = request.nextUrl.clone();
          url.pathname = "/403";
          return NextResponse.redirect(url);
        }
      }
    }
  }

  return response;
}

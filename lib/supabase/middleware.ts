import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { Database, EmployeeRole } from "@/types/database.types";

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 1. Instant Fast-Path for static assets and public routes that don't need auth checks
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/gallery") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
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
  const userRole = (claims?.user_role || claims?.app_metadata?.user_role || "employee") as EmployeeRole;

  const isPublicPath =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/mfa-challenge") ||
    pathname.startsWith("/mfa-setup");

  // If unauthenticated user tries to access a protected app route
  if (!isTokenValid && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // If authenticated user visits login
  if (isTokenValid && pathname === "/login") {
    // If privileged user has not completed AAL2 MFA, route to MFA flow
    if ((userRole === "hr" || userRole === "admin") && aal !== "aal2") {
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
    // Strict MFA AAL2 Enforcement for HR and Admin roles:
    // HR and Admins CANNOT reach protected application routes until MFA is verified (AAL2).
    // They are permitted on /mfa-challenge and /mfa-setup to complete verification/enrollment.
    if (
      (userRole === "hr" || userRole === "admin") &&
      aal !== "aal2" &&
      !pathname.startsWith("/mfa-challenge") &&
      !pathname.startsWith("/mfa-setup") &&
      !pathname.startsWith("/auth")
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/mfa-challenge";
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
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

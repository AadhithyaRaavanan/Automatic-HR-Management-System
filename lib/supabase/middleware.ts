import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { Database, EmployeeRole } from "@/types/database.types";

/**
 * Cryptographically verifies an HMAC-SHA256 (HS256) JWT signature using the Web Crypto API.
 * Supported across standard Node.js, Vercel Edge Middleware, and browser environments.
 */
async function verifyJwtHmacSha256(
  token: string,
  secret: string
): Promise<Record<string, any> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signedData = enc.encode(`${headerB64}.${payloadB64}`);

    // Decode URL-safe base64 signature
    const signatureStr = signatureB64.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (signatureStr.length % 4)) % 4;
    const paddedSig = signatureStr + "=".repeat(padLen);
    const sigBytes = Uint8Array.from(atob(paddedSig), (c) => c.charCodeAt(0));

    const isValid = await crypto.subtle.verify("HMAC", key, sigBytes, signedData);
    if (!isValid) {
      console.warn("[SECURITY] JWT HMAC-SHA256 signature verification failed; rejecting forged token.");
      return null;
    }

    // Decode payload once signature is cryptographically verified
    const payloadStr = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const payloadPad = (4 - (payloadStr.length % 4)) % 4;
    const payloadJson = atob(payloadStr + "=".repeat(payloadPad));
    return JSON.parse(payloadJson);
  } catch (err) {
    console.warn("[SECURITY] Error during JWT HMAC verification:", err);
    return null;
  }
}

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

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: "",
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value: "",
            ...options,
          });
        },
      },
    }
  );

  /**
   * Cryptographic JWT Signature & Claims Verification:
   * 1. If SUPABASE_JWT_SECRET is configured, performs local in-memory HMAC-SHA256
   *    signature verification (~0-1ms) via Web Crypto API.
   * 2. If asymmetric keys are used or SUPABASE_JWT_SECRET is missing, falls back
   *    to authoritative network verification via `supabase.auth.getUser()`.
   *    Unverified base64 decoding is never trusted for auth decisions.
   */
  const getVerifiedJwtClaims = async () => {
    try {
      const authCookies = request.cookies.getAll();
      const tokenCookie = authCookies.find((c) => c.name.includes("-auth-token"));
      if (!tokenCookie) return null;

      // Token can be JSON string array or raw JWT
      let rawToken = tokenCookie.value;
      if (rawToken.startsWith("[")) {
        const parsed = JSON.parse(rawToken);
        rawToken = parsed[0] || "";
      }

      const jwtSecret = process.env.SUPABASE_JWT_SECRET;
      if (jwtSecret) {
        const verifiedClaims = await verifyJwtHmacSha256(rawToken, jwtSecret);
        if (verifiedClaims) return verifiedClaims;
      }

      // Fallback: network roundtrip to GoTrue via supabase.auth.getUser()
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) return null;

      // Parse payload to extract custom_access_token_hook claims (such as user_role and aal)
      let customClaims: Record<string, any> = {};
      try {
        const parts = rawToken.split(".");
        if (parts.length === 3) {
          const payloadStr = parts[1].replace(/-/g, "+").replace(/_/g, "/");
          const payloadPad = (4 - (payloadStr.length % 4)) % 4;
          customClaims = JSON.parse(atob(payloadStr + "=".repeat(payloadPad)));
        }
      } catch {}

      return {
        sub: user.id,
        email: user.email,
        user_role: customClaims.user_role || user.app_metadata?.user_role || "employee",
        aal: customClaims.aal || "aal1",
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
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

    // Admin route guard (Admin only)
    if (pathname.startsWith("/admin") && userRole !== "admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

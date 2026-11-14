import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import {
  getRateLimitKey,
  getEmailRateLimitKey,
  checkRateLimit,
  recordFailure,
  clearRateLimit,
} from "@/lib/auth/rate-limiter";
import { checkTurnstileRequirements } from "@/lib/auth/turnstile";

function getPlatformTrustedClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor && forwardedFor.trim()) {
    const clientIp = forwardedFor.split(",")[0].trim();
    if (clientIp) return clientIp;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }
  return "127.0.0.1";
}

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const token = typeof body.token === "string" ? body.token.trim().replace(/\s+/g, "") : "";
    const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;

    if (!email || !token) {
      return NextResponse.json(
        { error: "Email and verification code are required." },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(token)) {
      return NextResponse.json(
        { error: "Verification code must be exactly 6 digits." },
        { status: 400 }
      );
    }

    // 1. Turnstile Check
    const turnstileCheck = checkTurnstileRequirements(turnstileToken);
    if (!turnstileCheck.valid) {
      return NextResponse.json(
        { error: turnstileCheck.error || "Turnstile verification failed." },
        { status: 403 }
      );
    }

    // 2. Rate Limiting for verification attempts
    const clientIp = getPlatformTrustedClientIp(request);
    const ipLimitKey = getRateLimitKey(clientIp, email);
    const emailLimitKey = getEmailRateLimitKey(email);

    const [ipLimit, emailLimit] = await Promise.all([
      checkRateLimit(ipLimitKey),
      checkRateLimit(emailLimitKey),
    ]);

    if (!ipLimit.allowed || !emailLimit.allowed) {
      const waitSeconds = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds);
      return NextResponse.json(
        {
          error: "Too many failed verification attempts. Please wait 15 minutes before trying again.",
          retryAfterSeconds: waitSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(waitSeconds) },
        }
      );
    }

    // 3. Supabase Auth verifyOtp
    let response = NextResponse.next();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next();
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: authData, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (verifyError || !authData.user) {
      await Promise.all([
        recordFailure(ipLimitKey),
        recordFailure(emailLimitKey),
      ]);
      return NextResponse.json(
        { error: "Invalid or expired verification code. Please request a new code." },
        { status: 401 }
      );
    }

    // Clear rate limits upon successful OTP verification
    await Promise.all([
      clearRateLimit(ipLimitKey),
      clearRateLimit(emailLimitKey),
    ]);

    // Force must_change_password on user metadata after OTP login
    await supabase.auth.updateUser({
      data: {
        must_change_password: true,
      },
    });

    // Check if user has an enrolled MFA factor
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const hasVerifiedFactor = aalData?.nextLevel === "aal2";

    const createSuccessResponse = (payload: any) => {
      const res = NextResponse.json(payload);
      response.cookies.getAll().forEach((cookie) => {
        res.cookies.set(cookie);
      });
      return res;
    };

    if (hasVerifiedFactor) {
      return createSuccessResponse({
        success: true,
        requireMfa: true,
        mfaDestination: "/mfa-challenge",
        message: "Code verified. Please complete Two-Factor Authentication.",
      });
    }

    return createSuccessResponse({
      success: true,
      requireMfa: false,
      mustChangePassword: true,
      mfaDestination: "/settings?must_change_password=true",
      message: "Logged in successfully. Please set your new password.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred during OTP verification." },
      { status: 500 }
    );
  }
}


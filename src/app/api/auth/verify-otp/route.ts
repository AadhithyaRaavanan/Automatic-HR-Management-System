import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import {
  getRateLimitKey,
  getEmailRateLimitKey,
  checkRateLimit,
  recordFailure,
  clearRateLimit,
} from "@/features/auth/rate-limiter";

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
    const purpose = typeof body.purpose === "string" ? body.purpose.trim().toLowerCase() : "any";
    const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;

    if (!email || !token) {
      return NextResponse.json(
        { error: "Email and verification code are required." },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(token)) {
      return NextResponse.json(
        { error: "Verification code must be 6 digits." },
        { status: 400 }
      );
    }

    // 1. Rate Limiting for verification attempts (isolated from request/resend bucket)
    const clientIp = getPlatformTrustedClientIp(request);
    const ipLimitKey = getRateLimitKey(clientIp, email, "verify_otp");
    const emailLimitKey = getEmailRateLimitKey(email, "verify_otp");

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

    let authData: any = null;
    let verifyError: any = null;
    let verifiedType: "email" | "recovery" | "magiclink" | null = null;

    if (purpose === "password_reset" || purpose === "recovery") {
      const recOtpRes = await supabase.auth.verifyOtp({
        email,
        token,
        type: "recovery",
        options: turnstileToken ? { captchaToken: turnstileToken } : undefined,
      });
      if (!recOtpRes.error && recOtpRes.data.user) {
        authData = recOtpRes.data;
        verifiedType = "recovery";
      } else {
        verifyError = recOtpRes.error;
      }
    } else {
      const emailOtpRes = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email",
        options: turnstileToken ? { captchaToken: turnstileToken } : undefined,
      });

      if (!emailOtpRes.error && emailOtpRes.data.user) {
        authData = emailOtpRes.data;
        verifiedType = "email";
      } else {
        const recOtpRes = await supabase.auth.verifyOtp({
          email,
          token,
          type: "recovery",
          options: turnstileToken ? { captchaToken: turnstileToken } : undefined,
        });

        if (!recOtpRes.error && recOtpRes.data.user) {
          authData = recOtpRes.data;
          verifiedType = "recovery";
        } else {
          const mlOtpRes = await supabase.auth.verifyOtp({
            email,
            token,
            type: "magiclink",
            options: turnstileToken ? { captchaToken: turnstileToken } : undefined,
          });

          if (!mlOtpRes.error && mlOtpRes.data.user) {
            authData = mlOtpRes.data;
            verifiedType = "magiclink";
          } else {
            verifyError = mlOtpRes.error || recOtpRes.error || emailOtpRes.error;
          }
        }
      }
    }

    if (verifyError || !authData?.user) {
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

    // Force must_change_password on user metadata after password recovery OTP login
    if (verifiedType !== "magiclink") {
      await supabase.auth.updateUser({
        data: {
          must_change_password: true,
        },
      });
    }

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


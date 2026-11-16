import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPasswordResetEmail } from "@/lib/email/resend";
import {
  getRateLimitKey,
  getEmailRateLimitKey,
  checkRateLimit,
  recordFailure,
} from "@/lib/auth/rate-limiter";

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
    const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    // 1. Dual IP & Email Rate Limiting
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
          error: "Too many password reset requests. Please wait before trying again.",
          retryAfterSeconds: waitSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(waitSeconds) },
        }
      );
    }

    // 3. Trigger Supabase Auth signInWithOtp with shouldCreateUser: false
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

    // Record request count for rate limiting
    await Promise.all([
      recordFailure(ipLimitKey),
      recordFailure(emailLimitKey),
    ]);

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
    let actionLink: string | undefined = undefined;
    let otpCode: string | undefined = undefined;

    // 1. Generate privileged recovery token & 6-digit OTP from Supabase Admin
    try {
      const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: {
          redirectTo: `${appUrl}/settings?must_change_password=true`,
        },
      });

      if (linkData?.properties) {
        actionLink = linkData.properties.action_link;
        otpCode = linkData.properties.email_otp;
      }
    } catch (linkErr) {
      console.warn("[Forgot Password Link Gen]:", linkErr);
    }

    // 2. Also register via client signInWithOtp for session state
    try {
      await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          captchaToken: turnstileToken,
        },
      });
    } catch {}

    // 3. Dispatch directly via Hostinger SMTP (business@zenxea.com)
    if (actionLink || otpCode) {
      await sendPasswordResetEmail({
        to: email,
        otpCode,
        resetLink: actionLink,
      });
    }

    // 4. Return identical generic response to prevent email enumeration
    const res = NextResponse.json({
      success: true,
      message: "If an account exists for this email, a verification code and reset link have been sent via email.",
    });

    response.cookies.getAll().forEach((cookie) => {
      res.cookies.set(cookie);
    });

    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred." },
      { status: 500 }
    );
  }
}


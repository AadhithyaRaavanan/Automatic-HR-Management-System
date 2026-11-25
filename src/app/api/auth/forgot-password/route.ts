import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/site-url";
import { sendPasswordResetEmail } from "@/lib/email/resend";
import {
  getRateLimitKey,
  getEmailRateLimitKey,
  checkRateLimit,
  recordFailure,
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
    const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    // 1. Dual IP & Email Rate Limiting (isolated to forgot_password scope)
    const clientIp = getPlatformTrustedClientIp(request);
    const ipLimitKey = getRateLimitKey(clientIp, email, "forgot_password");
    const emailLimitKey = getEmailRateLimitKey(email, "forgot_password");

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

    // Record request count for rate limiting
    await Promise.all([
      recordFailure(ipLimitKey),
      recordFailure(emailLimitKey),
    ]);

    const siteUrl = getSiteUrl();
    const confirmRedirect = `${siteUrl}/auth/confirm?redirect=${encodeURIComponent("/settings?must_change_password=true")}`;
    const hasCustomEmailTransport = Boolean(
      (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) ||
      process.env.RESEND_API_KEY
    );

    if (hasCustomEmailTransport) {
      // Custom SMTP/Resend path: generate one authoritative recovery link + OTP and send once
      let actionLink: string | undefined = undefined;
      let otpCode: string | undefined = undefined;

      try {
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email,
          options: {
            redirectTo: confirmRedirect,
          },
        });

        if (linkError) {
          console.warn("[Forgot Password Link Gen Error]:", linkError.message);
        } else if (linkData?.properties) {
          actionLink = linkData.properties.action_link;
          otpCode = linkData.properties.email_otp;
        }
      } catch (linkErr) {
        console.warn("[Forgot Password Link Gen]:", linkErr);
      }

      if (actionLink || otpCode) {
        const sendResult = await sendPasswordResetEmail({
          to: email,
          otpCode,
          resetLink: actionLink,
        });
        if (!sendResult.success) {
          console.error("[Forgot Password Email Error]:", sendResult.error);
          return NextResponse.json(
            { error: "Unable to deliver password reset email right now. Please try again later." },
            { status: 502 }
          );
        }
      }
    } else {
      // No SMTP/Resend configured: use implicit flow so email link works without a server-side PKCE verifier cookie
      const supabase = createSupabaseClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
        {
          auth: {
            flowType: "implicit",
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        }
      );

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: confirmRedirect,
          shouldCreateUser: false,
          captchaToken: turnstileToken,
        },
      });

      if (otpError) {
        const msg = otpError.message || "";
        const isRateLimitError =
          (otpError as any).status === 429 ||
          (otpError as any).code === "over_email_send_rate_limit" ||
          /rate.?limit|over_email_send_rate_limit|after \d+ second|too many/i.test(msg);

        if (isRateLimitError) {
          return NextResponse.json(
            {
              error:
                "Supabase email rate limit reached. Please wait a few minutes before retrying, or configure SMTP/Resend in .env.local.",
            },
            { status: 429 }
          );
        }
        console.warn("[Forgot Password Supabase OTP]:", msg);
      }
    }

    // 4. Return identical generic response to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: "If an account exists for this email, a verification code and reset link have been sent via email.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred." },
      { status: 500 }
    );
  }
}


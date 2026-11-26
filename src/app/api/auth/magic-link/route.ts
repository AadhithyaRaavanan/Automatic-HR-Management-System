import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/site-url";
import { sendMagicLinkEmail } from "@/lib/email/resend";
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
    const redirectPath = typeof body.redirectPath === "string" ? body.redirectPath : "/";
    const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    // 1. Dual IP & Email Rate Limiting (isolated to magic_link scope)
    const clientIp = getPlatformTrustedClientIp(request);
    const ipLimitKey = getRateLimitKey(clientIp, email, "magic_link");
    const emailLimitKey = getEmailRateLimitKey(email, "magic_link");

    const [ipLimit, emailLimit] = await Promise.all([
      checkRateLimit(ipLimitKey),
      checkRateLimit(emailLimitKey),
    ]);

    if (!ipLimit.allowed || !emailLimit.allowed) {
      const waitSeconds = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds);
      return NextResponse.json(
        {
          error: "Too many sign-in link requests. Please wait before trying again.",
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
    const callbackRedirect = `${siteUrl}/auth/confirm?redirect=${encodeURIComponent(redirectPath)}`;
    const hasCustomEmailTransport = Boolean(
      (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) ||
      process.env.RESEND_API_KEY
    );

    if (hasCustomEmailTransport) {
      // Custom SMTP/Resend path: generate one authoritative magic link + OTP and send once
      let actionLink: string | undefined = undefined;
      let otpCode: string | undefined = undefined;

      try {
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: {
            redirectTo: callbackRedirect,
          },
        });

        if (linkError) {
          console.warn("[MagicLink Gen Error]:", linkError.message);
          const isConfigOrAuthError = /invalid api key|unauthorized|jwt|fetch failed/i.test(
            linkError.message || ""
          );
          if (isConfigOrAuthError && process.env.NODE_ENV !== "production") {
            return NextResponse.json(
              { error: `Supabase admin generateLink failed: ${linkError.message}` },
              { status: 500 }
            );
          }
        } else if (linkData?.properties) {
          actionLink = linkData.properties.action_link;
          otpCode = linkData.properties.email_otp;
        }
      } catch (linkErr) {
        console.warn("[MagicLink Gen]:", linkErr);
      }

      if (actionLink || otpCode) {
        const sendResult = await sendMagicLinkEmail({
          to: email,
          otpCode,
          magicLink: actionLink,
        });
        if (!sendResult.success) {
          console.error("[MagicLink Email Error]:", sendResult.error);
          const detail =
            process.env.NODE_ENV !== "production" && sendResult.error
              ? `Unable to deliver sign-in link email: ${sendResult.error}`
              : "Unable to deliver sign-in link email right now. Please try again later.";
          return NextResponse.json({ error: detail }, { status: 502 });
        }
      }
    } else {
      // No SMTP/Resend configured: use implicit flow so magic link works without a server-side PKCE verifier cookie
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
          emailRedirectTo: callbackRedirect,
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
        console.warn("[MagicLink Supabase OTP]:", msg);
      }
    }

    // 4. Return generic safe response
    return NextResponse.json({
      success: true,
      message: "If an account exists for this email, a sign-in link and verification code have been dispatched.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred." },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
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

    const siteUrl = getSiteUrl();
    const callbackRedirect = `${siteUrl}/auth/callback?redirect=${encodeURIComponent(redirectPath)}`;

    let actionLink: string | undefined = undefined;
    let otpCode: string | undefined = undefined;

    // 1. Generate authoritative magiclink from Supabase Admin
    try {
      const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: {
          redirectTo: callbackRedirect,
        },
      });

      if (linkData?.properties) {
        actionLink = linkData.properties.action_link;
        otpCode = linkData.properties.email_otp;
      }
    } catch (linkErr) {
      console.warn("[MagicLink Gen]:", linkErr);
    }

    // 2. Also register client signInWithOtp
    try {
      await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: callbackRedirect,
          shouldCreateUser: false,
          captchaToken: turnstileToken,
        },
      });
    } catch {}

    // 3. Dispatch directly via Hostinger SMTP / Resend fallback
    if (actionLink || otpCode) {
      await sendMagicLinkEmail({
        to: email,
        otpCode,
        magicLink: actionLink,
      });
    }

    // 4. Return generic safe response
    const res = NextResponse.json({
      success: true,
      message: "If an account exists for this email, a sign-in link and verification code have been dispatched.",
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

import { NextRequest, NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/site-url";
import { requestAuthEmail } from "@/features/auth/request-email";
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

    const siteUrl = getSiteUrl(request);
    const confirmRedirect = `${siteUrl}/auth/confirm?redirect=${encodeURIComponent("/settings?must_change_password=true")}`;
    const failure = await requestAuthEmail("forgot-password", email, confirmRedirect, turnstileToken);
    if (failure) return failure;

    // 4. Return identical generic response to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: "If an account exists for this email, check your inbox for your password reset code.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Unable to send email. Please try again later." },
      { status: 500 }
    );
  }
}


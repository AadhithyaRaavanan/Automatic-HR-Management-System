import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { generateRecoveryOtp, createRecoveryProof } from "@/lib/auth/mfa-recovery-store";
import { sendMfaResetEmail } from "@/lib/email/resend";
import { checkRateLimit, recordFailure, getRateLimitKey } from "@/lib/auth/rate-limiter";

export const dynamic = "force-dynamic";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.slice(0, 3)}***@${domain}`;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user || !user.email) {
      return NextResponse.json(
        { error: "Authentication required. Please sign in to request recovery." },
        { status: 401 }
      );
    }

    // Rate limiting
    const forwardedFor = request.headers.get("x-forwarded-for");
    const clientIp = forwardedFor ? forwardedFor.split(",")[0].trim() : "127.0.0.1";
    const ipLimitKey = getRateLimitKey(clientIp, user.email, "mfa_reset");
    const rateCheck = await checkRateLimit(ipLimitKey);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many recovery attempts. Please wait before trying again." },
        { status: 429 }
      );
    }
    await recordFailure(ipLimitKey);

    const isDemo = isDemoModeEnabled();
    const code = generateRecoveryOtp();
    const { proofToken } = createRecoveryProof(user.id, code);

    // Send recovery email
    const emailResult = await sendMfaResetEmail({
      to: user.email,
      otpCode: code,
    });

    if (!emailResult.success && !isDemo) {
      return NextResponse.json(
        { error: emailResult.error || "Failed to deliver recovery email." },
        { status: 500 }
      );
    }

    const response = NextResponse.json({
      success: true,
      message: "Recovery code sent to your registered email.",
      maskedEmail: maskEmail(user.email),
      demoCode: isDemo ? code : undefined,
    });

    // Set signed proof token in HTTP-only cookie for stateless serverless verification
    response.cookies.set("pulse_mfa_proof", proofToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });

    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to initiate recovery." },
      { status: 500 }
    );
  }
}

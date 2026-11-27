import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSafeRedirectUrl } from "@/features/auth/redirect";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const token_hash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const rawTarget = requestUrl.searchParams.get("redirect") || requestUrl.searchParams.get("next");
  const safeRedirect = getSafeRedirectUrl(rawTarget, "/");

  const supabase = createClient();

  // 1. PKCE flow code exchange
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(safeRedirect, requestUrl.origin));
    }
  }

  // 2. Token hash OTP / Magiclink verification
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type,
    });
    if (!error) {
      return NextResponse.redirect(new URL(safeRedirect, requestUrl.origin));
    }
  }

  // Return user to login with error if exchange failed
  return NextResponse.redirect(new URL("/login?error=auth_callback_failed", requestUrl.origin));
}


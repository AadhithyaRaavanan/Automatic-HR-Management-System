import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const safeRedirect = sanitizeRedirectPath(requestUrl.searchParams.get("redirect"), "/");

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(safeRedirect, requestUrl.origin));
    }
  }

  // Return user to login with error if exchange failed
  return NextResponse.redirect(new URL("/login?error=auth_callback_failed", requestUrl.origin));
}


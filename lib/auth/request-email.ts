import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { sendMagicLinkEmail, sendPasswordResetEmail } from "@/lib/email/resend";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Flow = "magic-link" | "forgot-password";

function deliveryFailure() {
  return NextResponse.json({ error: "Email delivery is unavailable. Please try again later." }, { status: 502 });
}

function providerFailure(error: { status?: number; code?: string; message: string }) {
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || /email rate limit/i.test(error.message)) {
    return NextResponse.json({ error: "Email rate limit reached. Please wait before requesting another email." }, { status: 429 });
  }
  // Preserve the same public response for unknown and registered addresses.
  if (error.code === "user_not_found" || error.code === "otp_disabled" ||
      /user not found|signups not allowed for otp/i.test(error.message)) return null;
  return deliveryFailure();
}

export async function requestAuthEmail(flow: Flow, email: string, redirectTo: string, captchaToken?: string) {
  const recovery = flow === "forgot-password";
  const customTransport = process.env.RESEND_API_KEY ||
    (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

  if (customTransport) {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: recovery ? "recovery" : "magiclink",
      email,
      options: { redirectTo },
    });
    if (error) return providerFailure(error);
    const link = data.properties?.action_link;
    if (!link) return deliveryFailure();
    const result = recovery
      ? await sendPasswordResetEmail({ to: email, resetLink: link, otpCode: data.properties.email_otp })
      : await sendMagicLinkEmail({ to: email, magicLink: link });
    return result.success ? null : deliveryFailure();
  }

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = recovery
    ? await client.auth.resetPasswordForEmail(email, { redirectTo, captchaToken })
    : await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false, captchaToken } });
  return error ? providerFailure(error) : null;
}

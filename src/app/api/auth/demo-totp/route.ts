import { NextRequest, NextResponse } from "next/server";
import { generateSync } from "otplib";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isDemoModeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { secret, factorId } = await request.json();

    // 1. Direct secret provided (from /mfa-setup)
    if (secret) {
      const code = generateSync({ secret });
      return NextResponse.json({ code });
    }

    // 2. factorId provided (from /mfa-challenge)
    if (factorId) {
      // Safe, zero-Postgres fallback for Cloud/Vercel:
      // Clear the blocking MFA factor via Supabase Admin API so demo login succeeds immediately
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        try {
          const adminClient = getAdminClient();
          await adminClient.auth.admin.mfa.deleteFactor({
            id: factorId,
            userId: user.id,
          });
        } catch (deleteErr) {
          console.warn("[demo-totp] Supabase admin factor deletion warning:", deleteErr);
        }
      }

      return NextResponse.json({
        success: true,
        bypassed: true,
        message: "Demo 2FA verified successfully",
      });
    }

    return NextResponse.json(
      { error: "Either secret or factorId is required" },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to generate demo TOTP" },
      { status: 500 }
    );
  }
}

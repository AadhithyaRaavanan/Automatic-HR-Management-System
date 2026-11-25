import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { verifyRecoveryProof, clearRecoveryCode } from "@/lib/auth/mfa-recovery-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Authentication required. Please sign in first." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { code, demoReset } = body;
    const isDemo = isDemoModeEnabled();

    // Verification check
    if (demoReset && isDemo) {
      // 1-Click Demo Reset bypass allowed
    } else {
      if (!code || typeof code !== "string") {
        return NextResponse.json(
          { error: "A valid 6-digit recovery code is required." },
          { status: 400 }
        );
      }

      const proofToken = request.cookies.get("pulse_mfa_proof")?.value;
      const isValid = verifyRecoveryProof(user.id, code, proofToken);

      if (!isValid) {
        return NextResponse.json(
          {
            error:
              "Invalid or expired recovery code. Please check your email or request a new code.",
          },
          { status: 400 }
        );
      }
    }

    // Unenroll / delete all MFA factors for this user using Supabase Admin Client
    const admin = getAdminClient();
    const { data: factorsData, error: listError } = await admin.auth.admin.mfa.listFactors({
      userId: user.id,
    });

    if (listError) {
      return NextResponse.json(
        { error: `Failed to retrieve existing factors: ${listError.message}` },
        { status: 500 }
      );
    }

    const factors = factorsData?.factors || [];
    let deletedCount = 0;

    for (const factor of factors) {
      const { error: delError } = await admin.auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: user.id,
      });
      if (!delError) {
        deletedCount++;
      }
    }

    clearRecoveryCode(user.id);

    // Audit log
    try {
      const { data: member } = await admin
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (member?.organization_id) {
        await admin.from("audit_logs").insert({
          organization_id: member.organization_id,
          actor_id: user.id,
          action: "USER_MFA_RESET",
          table_name: "auth.mfa_factors",
          record_id: user.id,
          old_data: { factors_count: factors.length },
          new_data: {
            reason: "LOST_DEVICE_RECOVERY",
            reset_at: new Date().toISOString(),
            deleted_count: deletedCount,
          },
        });
      }
    } catch {}

    const response = NextResponse.json({
      success: true,
      message: "Two-factor authentication has been reset. You can now enroll your new device.",
      deletedCount,
    });

    // Clear proof cookie
    response.cookies.delete("pulse_mfa_proof");
    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to reset authenticator device." },
      { status: 500 }
    );
  }
}

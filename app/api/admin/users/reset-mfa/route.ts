import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const { targetUserId } = await request.json();

    if (!targetUserId) {
      return NextResponse.json(
        { error: "Validation Error: 'targetUserId' is required." },
        { status: 400 }
      );
    }

    // 1. Verify target user belongs to caller's organization
    const { data: member } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", targetUserId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (!member) {
      return NextResponse.json(
        { error: "Target user not found in your organization." },
        { status: 404 }
      );
    }

    // 2. List enrolled MFA factors for user
    const { data: factorsData, error: listError } = await supabaseAdmin.auth.admin.mfa.listFactors({
      userId: targetUserId,
    });

    if (listError) {
      return NextResponse.json(
        { error: `Failed to retrieve MFA factors: ${listError.message}` },
        { status: 400 }
      );
    }

    const factors = factorsData?.factors || [];
    let deletedCount = 0;

    for (const factor of factors) {
      const { error: delError } = await supabaseAdmin.auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: targetUserId,
      });
      if (!delError) {
        deletedCount++;
      }
    }

    // 3. Audit log the reset
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "MFA_RESET",
      table_name: "auth.mfa_factors",
      record_id: targetUserId,
      old_data: { factors_count: factors.length },
      new_data: { reset_at: new Date().toISOString(), deleted_count: deletedCount },
    });

    return NextResponse.json({
      success: true,
      message: `Reset MFA for user ${targetUserId}. ${deletedCount} factor(s) deleted.`,
      deletedCount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Internal Server Error: ${err.message || String(err)}` },
      { status: 500 }
    );
  }
}

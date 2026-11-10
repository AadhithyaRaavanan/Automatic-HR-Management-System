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

    // 2. Force sign-out / revoke sessions in Supabase Auth
    try {
      if (typeof (supabaseAdmin.auth.admin as any).signOut === "function") {
        await (supabaseAdmin.auth.admin as any).signOut(targetUserId, "global");
      }
    } catch (soErr: any) {
      console.warn("Sign out revoke warning:", soErr.message);
    }

    // 3. Audit log the force sign-out
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "USER_FORCE_SIGNED_OUT",
      table_name: "auth.sessions",
      record_id: targetUserId,
      old_data: null,
      new_data: { revoked_at: new Date().toISOString(), by_admin: context.userId },
    });

    return NextResponse.json({
      success: true,
      message: `User ${targetUserId} has been signed out and all active sessions revoked.`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Internal Server Error: ${err.message || String(err)}` },
      { status: 500 }
    );
  }
}


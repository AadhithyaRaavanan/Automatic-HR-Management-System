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

    if (targetUserId === context.userId) {
      return NextResponse.json(
        { error: "Admins cannot deactivate their own account." },
        { status: 400 }
      );
    }

    // 1. Authoritative verification: Target user must belong to caller's organization
    const { data: targetMember } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id, role, status")
      .eq("user_id", targetUserId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (!targetMember) {
      return NextResponse.json(
        { error: "Target user not found in your organization." },
        { status: 404 }
      );
    }

    // 2. Deactivate member in database via admin_deactivate_member RPC
    const { data: rpcData, error: rpcError } = await (supabaseAdmin.rpc as any)(
      "admin_deactivate_member",
      {
        p_user_id: targetUserId,
      }
    );

    if (rpcError) {
      return NextResponse.json(
        { error: `Database deactivation failed: ${rpcError.message}` },
        { status: 400 }
      );
    }

    // 2. Ban user in Supabase Auth (100 years ban)
    try {
      await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
        ban_duration: "876000h",
      });
    } catch (authBanErr: any) {
      console.warn("Auth ban warning:", authBanErr.message);
    }

    // 3. Force sign out and revoke sessions
    try {
      if (typeof (supabaseAdmin.auth.admin as any).signOut === "function") {
        await (supabaseAdmin.auth.admin as any).signOut(targetUserId, "global");
      }
    } catch (signOutErr: any) {
      console.warn("Sign out revoke warning:", signOutErr.message);
    }

    // 4. Write audit row
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "MEMBER_DEACTIVATED",
      table_name: "organization_members",
      record_id: targetUserId,
      old_data: { role: targetMember.role, status: targetMember.status },
      new_data: { status: "inactive", deactivated_at: new Date().toISOString() },
    });

    return NextResponse.json({
      success: true,
      message: `User ${targetUserId} has been deactivated, banned in Auth, and active sessions revoked.`,
      data: rpcData,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Internal Server Error: ${err.message || String(err)}` },
      { status: 500 }
    );
  }
}


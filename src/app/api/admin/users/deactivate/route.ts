import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/features/notifications/notify";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context, supabase } = authResult;

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

    // 2. Deactivate member in database via caller-authenticated admin_deactivate_member RPC
    const { data: rpcData, error: rpcError } = await (supabase.rpc as any)(
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

    // 3. Ban user in Supabase Auth (100 years ban)
    try {
      await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
        ban_duration: "876000h",
      });
    } catch (authBanErr: any) {
      console.warn("Auth ban warning:", authBanErr.message);
    }

    // 4. Force sign out and revoke sessions
    try {
      if (typeof (supabaseAdmin.auth.admin as any).signOut === "function") {
        await (supabaseAdmin.auth.admin as any).signOut(targetUserId, "global");
      }
    } catch (signOutErr: any) {
      console.warn("Sign out revoke warning:", signOutErr.message);
    }

    // Notify user of account deactivation (Security: in-app + email)
    try {
      await notify({
        userIds: [targetUserId],
        type: "security_account_deactivated",
        typeGroup: "security",
        title: "Account Status Changed: Deactivated",
        body: "Your Pulse employee account has been deactivated by an administrator.",
        link: "/login",
        entityType: "users",
        entityId: targetUserId,
        actorId: context.userId,
        forceEmail: true,
      });
    } catch {}

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


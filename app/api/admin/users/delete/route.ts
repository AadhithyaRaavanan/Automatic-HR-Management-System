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
        { error: "Admins cannot delete their own account." },
        { status: 400 }
      );
    }

    // 1. Unlink any manager or lead assignments
    await (supabaseAdmin as any)
      .from("employees")
      .update({ manager_id: null })
      .eq("manager_id", targetUserId);

    await (supabaseAdmin as any)
      .from("departments")
      .update({ department_head_id: null })
      .eq("department_head_id", targetUserId);

    // 2. Cascade delete records tied to this user
    await supabaseAdmin.from("attendance_sessions").delete().eq("employee_id", targetUserId);
    await supabaseAdmin.from("attendance_days").delete().eq("employee_id", targetUserId);
    await supabaseAdmin.from("leave_requests").delete().eq("employee_id", targetUserId);
    await supabaseAdmin.from("regularization_requests").delete().eq("employee_id", targetUserId);

    // 3. Delete from employees & organization_members
    const { error: empDelErr } = await supabaseAdmin
      .from("employees")
      .delete()
      .eq("id", targetUserId);

    if (empDelErr) {
      console.warn("Note during employees delete:", empDelErr.message);
    }

    await supabaseAdmin
      .from("organization_members")
      .delete()
      .eq("user_id", targetUserId);

    // 4. Permanently delete from Supabase Auth
    try {
      await supabaseAdmin.auth.admin.deleteUser(targetUserId);
    } catch (authDelErr: any) {
      console.warn("Note during auth.admin.deleteUser:", authDelErr?.message);
    }

    // 5. Audit log
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "USER_PERMANENTLY_DELETED",
      table_name: "employees",
      record_id: targetUserId,
      old_data: { targetUserId },
      new_data: null,
    });

    return NextResponse.json({
      success: true,
      message: `User ${targetUserId} and all associated records permanently deleted.`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to permanently delete user." },
      { status: 500 }
    );
  }
}

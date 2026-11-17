import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { notify } from "@/lib/notifications/notify";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json();
    const {
      userId,
      departmentId,
      jobTitleId,
      role,
      workMode,
      timezone,
      status,
      shiftStartTime,
      shiftEndTime,
    } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "Validation Error: 'userId' is required." },
        { status: 400 }
      );
    }

    const employeeUpdates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    const memberUpdates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (departmentId !== undefined) {
      employeeUpdates.department_id = departmentId || null;
      memberUpdates.department_id = departmentId || null;
    }

    if (jobTitleId !== undefined) {
      employeeUpdates.job_title_id = jobTitleId || null;
      memberUpdates.job_title_id = jobTitleId || null;
    }

    if (workMode !== undefined) {
      employeeUpdates.work_mode = workMode;
    }

    if (timezone !== undefined) {
      employeeUpdates.timezone = timezone;
    }

    if (status !== undefined) {
      const validStatus = status === "active" ? "active" : "inactive";
      employeeUpdates.status = validStatus;
      memberUpdates.status = validStatus;
    }

    if (shiftStartTime !== undefined && shiftEndTime !== undefined) {
      const startVal = shiftStartTime.length === 5 ? `${shiftStartTime}:00` : shiftStartTime;
      const endVal = shiftEndTime.length === 5 ? `${shiftEndTime}:00` : shiftEndTime;
      employeeUpdates.shift_start_time = startVal;
      employeeUpdates.shift_end_time = endVal;
      memberUpdates.shift_start_time = startVal;
      memberUpdates.shift_end_time = endVal;
    }

    if (role !== undefined && ["employee", "manager", "hr", "admin"].includes(role)) {
      memberUpdates.role = role;
    }

    // 1. Authoritative update to employees
    const { error: empErr } = await (supabaseAdmin.from("employees") as any)
      .update(employeeUpdates)
      .eq("id", userId);

    if (empErr) {
      console.error("Failed to update employees:", empErr.message);
      if (!isDemoModeEnabled()) {
        return NextResponse.json({ error: empErr.message }, { status: 500 });
      }
    }

    // 2. Authoritative update to organization_members
    const { error: memErr } = await (supabaseAdmin.from("organization_members") as any)
      .update(memberUpdates)
      .eq("user_id", userId);

    if (memErr) {
      console.error("Failed to update organization_members:", memErr.message);
      if (!isDemoModeEnabled()) {
        return NextResponse.json({ error: memErr.message }, { status: 500 });
      }
    }

    // 3. Audit Log
    try {
      await (supabaseAdmin.from("audit_logs") as any).insert({
        organization_id: context.organizationId,
        actor_id: context.userId,
        action: "USER_GOVERNANCE_UPDATED",
        table_name: "employees",
        record_id: userId,
        old_data: null,
        new_data: { ...employeeUpdates, ...memberUpdates },
      });
    } catch {}

    // Notify user if role or status was modified
    try {
      if (role !== undefined) {
        await notify({
          userIds: [userId],
          type: "security_role_changed",
          typeGroup: "security",
          title: "Workplace Role Updated",
          body: `Your access role has been updated to "${role}". Log out and back in to apply updated permissions.`,
          link: "/profile",
          entityType: "users",
          entityId: userId,
          actorId: context.userId,
          forceEmail: true,
        });
      } else if (status !== undefined) {
        await notify({
          userIds: [userId],
          type: "security_status_changed",
          typeGroup: "security",
          title: `Account Status Changed: ${status}`,
          body: `Your employee profile status has been marked as ${status}.`,
          link: "/profile",
          entityType: "users",
          entityId: userId,
          actorId: context.userId,
          forceEmail: true,
        });
      }
    } catch {}

    return NextResponse.json({
      success: true,
      message: "User governance updated successfully.",
      updated: { ...employeeUpdates, ...memberUpdates },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error updating user." },
      { status: 500 }
    );
  }
}

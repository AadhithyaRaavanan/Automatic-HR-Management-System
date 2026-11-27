import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminConfigError } from "@/lib/supabase/admin-config";
import { AuthenticatedCallerContext } from "@/features/auth/admin-guard";

export interface DeleteEmployeeResult {
  ok: boolean;
  status: number;
  deletedUserId?: string;
  employeeName?: string | null;
  employeeEmail?: string | null;
  error?: string;
}

function isMissingRelationOrColumnError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || "");
  return (
    err.code === "PGRST204" ||
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    err.code === "42703" ||
    /could not find the table|relation .* does not exist|column .* does not exist|schema cache/i.test(
      msg
    )
  );
}

async function safeDbOp(op: PromiseLike<{ error?: any }>): Promise<{ error?: any }> {
  try {
    const res = await op;
    return res || {};
  } catch (err: any) {
    return { error: err };
  }
}

/**
 * Permanently removes an employee and dependent records within the caller's organization,
 * unlinking/reassigning restrictive foreign keys before deleting `public.employees`
 * and the corresponding Supabase Auth user.
 */
export async function permanentlyDeleteEmployee(
  context: AuthenticatedCallerContext,
  rawTargetId: string
): Promise<DeleteEmployeeResult> {
  const configError = getSupabaseAdminConfigError();
  if (configError) {
    return { ok: false, status: 500, error: configError };
  }

  const cleanId = decodeURIComponent(String(rawTargetId || ""))
    .trim()
    .replace(/\s+/g, "-");
  if (!cleanId) {
    return { ok: false, status: 400, error: "Employee ID is required." };
  }

  const supabaseAdmin = getAdminClient() as any;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);

  let emp: { id: string; organization_id?: string | null; full_name?: string | null; email?: string | null } | null = null;
  if (isUuid) {
    const res = await supabaseAdmin
      .from("employees")
      .select("id, organization_id, full_name, email")
      .eq("id", cleanId)
      .maybeSingle();
    if (res.error && isMissingRelationOrColumnError(res.error)) {
      const starterRes = await supabaseAdmin
        .from("employees")
        .select("id, full_name, email")
        .eq("id", cleanId)
        .maybeSingle();
      emp = starterRes.data || null;
    } else if (res.error) {
      return { ok: false, status: 500, error: `Failed to look up employee: ${res.error.message}` };
    } else {
      emp = res.data || null;
    }
  } else {
    const res = await supabaseAdmin
      .from("employees")
      .select("id, organization_id, full_name, email")
      .ilike("id", `${cleanId}%`)
      .maybeSingle();
    if (res.error && isMissingRelationOrColumnError(res.error)) {
      const starterRes = await supabaseAdmin
        .from("employees")
        .select("id, full_name, email")
        .ilike("id", `${cleanId}%`)
        .maybeSingle();
      emp = starterRes.data || null;
    } else if (res.error) {
      return { ok: false, status: 500, error: `Failed to look up employee: ${res.error.message}` };
    } else {
      emp = res.data || null;
    }
  }

  const targetUserId = emp?.id || cleanId;

  const memberRes = await safeDbOp(
    supabaseAdmin
      .from("organization_members")
      .select("user_id, organization_id")
      .eq("user_id", targetUserId)
      .maybeSingle()
  ) as any;
  const member = memberRes?.data || null;

  if (!emp && !member) {
    return { ok: false, status: 404, error: "Employee record not found." };
  }

  const targetOrgId = emp?.organization_id || member?.organization_id || null;
  if (targetOrgId && context.organizationId && targetOrgId !== context.organizationId) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: You cannot delete an employee from another organization.",
    };
  }

  if (targetUserId === context.userId) {
    return {
      ok: false,
      status: 400,
      error: "Administrators cannot delete their own currently signed-in account.",
    };
  }

  // 1. Unlink nullable foreign-key references across workforce, departments, tasks, and internships
  await Promise.all([
    safeDbOp(supabaseAdmin.from("employees").update({ manager_id: null }).eq("manager_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("departments").update({ department_head_id: null }).eq("department_head_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("tasks").update({ assignee_id: null }).eq("assignee_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("internships").update({ mentor_id: null }).eq("mentor_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("task_events").update({ actor_id: null }).eq("actor_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("task_events").update({ old_assignee_id: null }).eq("old_assignee_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("task_events").update({ new_assignee_id: null }).eq("new_assignee_id", targetUserId)),
  ]);

  // 2. Reassign RESTRICT-constrained task/project ownership to the deleting admin so FKs don't block deletion
  await Promise.all([
    safeDbOp(supabaseAdmin.from("tasks").update({ creator_id: context.userId }).eq("creator_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("projects").update({ created_by: context.userId }).eq("created_by", targetUserId)),
  ]);

  // 3. Remove dependent employee records across optional & core tables
  await Promise.all([
    safeDbOp(supabaseAdmin.from("task_time_logs").delete().eq("employee_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("task_comments").delete().eq("author_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("attendance_sessions").delete().eq("employee_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("attendance_days").delete().eq("employee_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("leave_requests").delete().eq("employee_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("regularization_requests").delete().eq("employee_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("permission_requests").delete().eq("employee_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("internships").delete().eq("employee_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("employee_career_history").delete().eq("employee_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("onboarding_documents").delete().eq("user_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("onboarding_profiles").delete().eq("user_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("notifications").delete().eq("user_id", targetUserId)),
    safeDbOp(supabaseAdmin.from("profiles").delete().eq("id", targetUserId)),
  ]);

  // 4. Delete role, org membership, and employee row
  const urDel = await safeDbOp(supabaseAdmin.from("user_roles").delete().eq("user_id", targetUserId));
  if (urDel.error && !isMissingRelationOrColumnError(urDel.error)) {
    return {
      ok: false,
      status: 500,
      error: `Failed to delete user roles: ${urDel.error.message}`,
    };
  }

  const omDel = await safeDbOp(supabaseAdmin.from("organization_members").delete().eq("user_id", targetUserId));
  if (omDel.error && !isMissingRelationOrColumnError(omDel.error)) {
    return {
      ok: false,
      status: 500,
      error: `Failed to delete organization membership: ${omDel.error.message}`,
    };
  }

  if (emp) {
    const empDel = await safeDbOp(supabaseAdmin.from("employees").delete().eq("id", targetUserId));
    if (empDel.error) {
      return {
        ok: false,
        status: 500,
        error: `Failed to delete employee record: ${empDel.error.message}`,
      };
    }
  }

  // 5. Permanently delete Supabase Auth user (ignore if already absent)
  try {
    const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
    if (
      authDelErr &&
      !/not found|user not found/i.test(String(authDelErr.message || ""))
    ) {
      return {
        ok: false,
        status: 500,
        error: `Failed to delete Supabase Auth user: ${authDelErr.message}`,
      };
    }
  } catch (authErr: any) {
    return {
      ok: false,
      status: 500,
      error: `Failed to delete Supabase Auth user: ${authErr?.message || String(authErr)}`,
    };
  }

  // 6. Best-effort audit log entry
  await safeDbOp(
    supabaseAdmin.from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "USER_PERMANENTLY_DELETED",
      table_name: "employees",
      record_id: targetUserId,
      old_data: {
        id: targetUserId,
        full_name: emp?.full_name || null,
        email: emp?.email || null,
      },
      new_data: null,
    })
  );

  return {
    ok: true,
    status: 200,
    deletedUserId: targetUserId,
    employeeName: emp?.full_name || null,
    employeeEmail: emp?.email || null,
  };
}

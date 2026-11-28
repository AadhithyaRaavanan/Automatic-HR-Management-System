import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireApprovedUser } from "@/features/auth/require-approved-user";
import { getAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import {
  DepartmentHeadShape,
  ProjectAccessShape,
  getHeadedDepartmentIds,
} from "@/features/tasks/project-access";

export interface TaskServerCallerContext {
  userId: string;
  userEmail: string | null;
  role: string;
  orgId: string | null;
  dbClient: any;
  callerSupabase: any;
  departments: DepartmentHeadShape[];
  headedDeptIds: string[];
  isDepartmentHead: boolean;
}

export function isMissingColumnOrRelationError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || "");
  return (
    err.code === "PGRST204" ||
    err.code === "PGRST205" ||
    err.code === "42703" ||
    err.code === "42P01" ||
    /column .* does not exist|could not find|relationship|schema cache|does not exist/i.test(msg)
  );
}

export async function verifyCallerAal2IfPrivileged(
  callerSupabase: any,
  user: any,
  role: string
): Promise<boolean> {
  if (role !== "hr" && role !== "admin") return true;
  if (user?.aal === "aal2") return true;
  try {
    const { data } = await callerSupabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return data?.currentLevel === "aal2";
  } catch {
    return false;
  }
}

export async function resolveTaskCallerContext(
  request: NextRequest
): Promise<TaskServerCallerContext | { response: NextResponse }> {
  const approved = await requireApprovedUser(request);
  if ("response" in approved) {
    return approved;
  }

  const { user, supabase: callerSupabase, role: approvedRole, organizationId } = approved;
  const dbClient: any = isSupabaseAdminConfigured() ? getAdminClient() : callerSupabase;

  const orgId: string | null = organizationId || null;
  const role: string = String(approvedRole || "employee").toLowerCase();

  if (!orgId) {
    return {
      response: NextResponse.json(
        { error: "Forbidden: Active organization context is required." },
        { status: 403 }
      ),
    };
  }

  let departments: DepartmentHeadShape[] = [];
  try {
    let deptQuery = dbClient
      .from("departments")
      .select("id, name, code, department_head_id")
      .order("name", { ascending: true });
    if (orgId) deptQuery = deptQuery.eq("organization_id", orgId);

    let deptRes = await deptQuery;
    if (deptRes?.error && isMissingColumnOrRelationError(deptRes.error)) {
      let fallbackQuery = dbClient
        .from("departments")
        .select("id, name, code")
        .order("name", { ascending: true });
      if (orgId) fallbackQuery = fallbackQuery.eq("organization_id", orgId);
      deptRes = await fallbackQuery;
    }
    departments = (deptRes?.data || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      code: d.code || null,
      department_head_id: d.department_head_id || null,
    }));
  } catch {
    departments = [];
  }

  const headedDeptIds = getHeadedDepartmentIds(user.id, departments);

  return {
    userId: user.id,
    userEmail: user.email || null,
    role,
    orgId,
    dbClient,
    callerSupabase,
    departments,
    headedDeptIds,
    isDepartmentHead: headedDeptIds.length > 0,
  };
}

export async function fetchProjectsResilient(
  dbClient: any,
  orgId: string | null
): Promise<Array<ProjectAccessShape & Record<string, any>>> {
  let query = dbClient
    .from("projects")
    .select(
      "id, organization_id, department_id, department_ids, incharge_id, assignment_type, name, code, description, status, created_by, created_at"
    )
    .order("name", { ascending: true });
  if (orgId) query = query.eq("organization_id", orgId);

  const primaryRes = await query;
  if (!primaryRes?.error && Array.isArray(primaryRes?.data)) {
    return primaryRes.data.map((p: any) => ({
      ...p,
      department_ids: Array.isArray(p.department_ids)
        ? p.department_ids
        : p.department_id
        ? [p.department_id]
        : [],
      incharge_id: p.incharge_id || null,
      assignment_type:
        p.assignment_type || (p.department_id ? "department" : "company"),
    }));
  }

  if (!isMissingColumnOrRelationError(primaryRes?.error)) {
    return [];
  }

  // Fallback when new columns are not yet migrated on remote DB
  let fallbackQuery = dbClient
    .from("projects")
    .select(
      "id, organization_id, department_id, name, code, description, status, created_by, created_at"
    )
    .order("name", { ascending: true });
  if (orgId) fallbackQuery = fallbackQuery.eq("organization_id", orgId);
  const fallbackRes = await fallbackQuery;
  const rows: any[] = fallbackRes?.data || [];

  // Rehydrate assignment metadata from audit_logs if available
  const metaMap = new Map<string, any>();
  try {
    let auditQuery = dbClient
      .from("audit_logs")
      .select("record_id, new_data")
      .eq("table_name", "projects")
      .eq("action", "PROJECT_CREATED");
    if (orgId) auditQuery = auditQuery.eq("organization_id", orgId);
    const { data: logs } = await auditQuery;
    for (const log of logs || []) {
      if (log?.record_id && log?.new_data) {
        metaMap.set(log.record_id, log.new_data);
      }
    }
  } catch {}

  return rows.map((p: any) => {
    const meta = metaMap.get(p.id);
    const deptIds = Array.isArray(meta?.department_ids)
      ? meta.department_ids
      : p.department_id
      ? [p.department_id]
      : [];
    const inchargeId = meta?.incharge_id || null;
    const assignmentType =
      meta?.assignment_type ||
      (inchargeId && deptIds.length === 0
        ? "individual"
        : deptIds.length > 0
        ? "department"
        : "company");

    return {
      ...p,
      department_ids: deptIds,
      incharge_id: inchargeId,
      assignment_type: assignmentType,
    };
  });
}

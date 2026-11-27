import { NextRequest, NextResponse } from "next/server";
import { verifyCallerAal2IfPrivileged } from "@/features/tasks/server-access";
import {
  ProjectAssignmentType,
  resolveDepartmentInchargeLock,
} from "@/features/tasks/project-access";
import {
  isMissingColumnOrRelationError,
  resolveTaskCallerContext,
} from "@/features/tasks/server-access";

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/projects
 * Creates a company-wide, department-scoped (1 or more departments), or
 * individual-incharge project. Automatically locks Incharge to the department
 * head when a selected department already has an assigned head.
 */
export async function POST(request: NextRequest) {
  const ctx = await resolveTaskCallerContext(request);
  if ("response" in ctx) {
    return ctx.response;
  }

  const { userId, role, orgId, dbClient, callerSupabase, departments } = ctx;

  if (!["manager", "hr", "admin"].includes(role)) {
    return NextResponse.json(
      { error: "Forbidden: Only managers, HR, or administrators can create projects." },
      { status: 403 }
    );
  }

  const {
    data: { user },
  } = await callerSupabase.auth.getUser();
  const aalOk = await verifyCallerAal2IfPrivileged(callerSupabase, user, role);
  if (!aalOk) {
    return NextResponse.json(
      { error: "MFA AAL2 verification required for HR/Admin project creation." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  const code = body?.code ? String(body.code).trim() || null : null;
  const description = body?.description ? String(body.description).trim() || null : null;

  if (name.length < 2) {
    return NextResponse.json(
      { error: "Project name must be at least 2 characters." },
      { status: 400 }
    );
  }

  const rawType = String(body?.assignmentType || "").toLowerCase();
  const rawDeptIds: string[] = Array.isArray(body?.departmentIds)
    ? Array.from(new Set(body.departmentIds.map((d: any) => String(d || "").trim()).filter(Boolean)))
    : body?.departmentId
    ? [String(body.departmentId).trim()]
    : [];
  const assignmentType: ProjectAssignmentType =
    rawType === "individual"
      ? "individual"
      : rawType === "department" || rawDeptIds.length > 0
      ? "department"
      : "company";

  let resolvedDeptIds: string[] = [];
  let resolvedPrimaryDeptId: string | null = null;
  let resolvedInchargeId: string | null = body?.inchargeId ? String(body.inchargeId).trim() || null : null;

  if (assignmentType === "department") {
    if (rawDeptIds.length === 0) {
      return NextResponse.json(
        { error: "Select at least one department for a department project." },
        { status: 400 }
      );
    }

    const deptSet = new Set(departments.map((d) => d.id));
    for (const id of rawDeptIds) {
      if (!deptSet.has(id)) {
        return NextResponse.json(
          { error: "Selected department does not belong to your organization." },
          { status: 403 }
        );
      }
    }

    resolvedDeptIds = rawDeptIds;
    resolvedPrimaryDeptId = rawDeptIds[0];

    const lockInfo = resolveDepartmentInchargeLock(resolvedDeptIds, departments);
    if (lockInfo.isLocked && lockInfo.lockedInchargeId) {
      // Automatically enforce the department head as locked Incharge
      resolvedInchargeId = lockInfo.lockedInchargeId;
    } else if (lockInfo.headIds.length > 1) {
      if (!resolvedInchargeId || !lockInfo.headIds.includes(resolvedInchargeId)) {
        resolvedInchargeId = lockInfo.headIds[0];
      }
    }
  } else if (assignmentType === "individual") {
    resolvedDeptIds = [];
    resolvedPrimaryDeptId = null;
    if (!resolvedInchargeId) {
      return NextResponse.json(
        { error: "Select an individual Incharge for an individual project." },
        { status: 400 }
      );
    }
  } else {
    resolvedDeptIds = [];
    resolvedPrimaryDeptId = null;
  }

  // Verify chosen Incharge is an active member of caller organization
  if (resolvedInchargeId) {
    let empCheck = dbClient
      .from("employees")
      .select("id")
      .eq("id", resolvedInchargeId)
      .eq("status", "active");
    if (orgId) empCheck = empCheck.eq("organization_id", orgId);
    const { data: empRow } = await empCheck.maybeSingle();
    if (!empRow) {
      return NextResponse.json(
        { error: "Selected Incharge must be an active member of your organization." },
        { status: 400 }
      );
    }
  }

  const effectiveOrgId = orgId || "00000000-0000-0000-0000-000000000001";

  const fullInsertPayload: Record<string, any> = {
    organization_id: effectiveOrgId,
    department_id: resolvedPrimaryDeptId,
    department_ids: resolvedDeptIds,
    incharge_id: resolvedInchargeId,
    assignment_type: assignmentType,
    name,
    code,
    description,
    created_by: userId,
  };

  let insertRes = await dbClient
    .from("projects")
    .insert(fullInsertPayload)
    .select("*")
    .single();

  if (insertRes?.error && isMissingColumnOrRelationError(insertRes.error)) {
    insertRes = await dbClient
      .from("projects")
      .insert({
        organization_id: effectiveOrgId,
        department_id: resolvedPrimaryDeptId,
        name,
        code,
        description,
        created_by: userId,
      })
      .select("*")
      .single();
  }

  if (insertRes?.error) {
    const status = /duplicate|unique/i.test(insertRes.error.message || "") ? 409 : 400;
    return NextResponse.json(
      { error: insertRes.error.message || "Failed to create project." },
      { status }
    );
  }

  const createdRow = {
    ...insertRes.data,
    department_ids: resolvedDeptIds,
    incharge_id: resolvedInchargeId,
    assignment_type: assignmentType,
  };

  try {
    await dbClient.from("audit_logs").insert({
      organization_id: effectiveOrgId,
      actor_id: userId,
      action: "PROJECT_CREATED",
      table_name: "projects",
      record_id: createdRow.id,
      old_data: null,
      new_data: createdRow,
    });
  } catch {}

  return NextResponse.json({
    success: true,
    project: createdRow,
    projectId: createdRow.id,
  });
}

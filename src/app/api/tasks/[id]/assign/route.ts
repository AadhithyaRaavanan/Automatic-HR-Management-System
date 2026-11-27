import { NextRequest, NextResponse } from "next/server";
import {
  canDepartmentHeadManageTask,
  ProjectAccessShape,
} from "@/features/tasks/project-access";
import {
  fetchProjectsResilient,
  resolveTaskCallerContext,
  verifyCallerAal2IfPrivileged,
} from "@/features/tasks/server-access";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/tasks/[id]/assign
 * Reassigns an existing open task. Allows Department Heads to assign tasks
 * in their department or assigned projects to members of their department.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const ctx = await resolveTaskCallerContext(request);
  if ("response" in ctx) {
    return ctx.response;
  }

  const {
    userId,
    role,
    orgId,
    dbClient,
    callerSupabase,
    headedDeptIds,
    isDepartmentHead,
  } = ctx;

  const {
    data: { user },
  } = await callerSupabase.auth.getUser();
  const aalOk = await verifyCallerAal2IfPrivileged(callerSupabase, user, role);
  if (!aalOk) {
    return NextResponse.json(
      { error: "MFA AAL2 verification required for HR/Admin task assignment." },
      { status: 403 }
    );
  }

  const resolvedParams = await Promise.resolve(params);
  const taskId = resolvedParams?.id;
  if (!taskId) {
    return NextResponse.json({ error: "Task ID is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const newAssigneeId: string | null = body?.assigneeId
    ? String(body.assigneeId).trim() || null
    : null;

  let taskQuery = dbClient.from("tasks").select("*").eq("id", taskId);
  if (orgId) taskQuery = taskQuery.eq("organization_id", orgId);
  const { data: existingTask, error: taskErr } = await taskQuery.maybeSingle();

  if (taskErr || !existingTask) {
    return NextResponse.json(
      { error: "Forbidden: Task not found in caller organization." },
      { status: 403 }
    );
  }

  if (existingTask.status === "done" || existingTask.status === "cancelled") {
    return NextResponse.json(
      { error: `Cannot reassign a task in ${existingTask.status} status.` },
      { status: 400 }
    );
  }

  const isPrivileged = role === "admin" || role === "hr";
  const isRestrictedDeptHead = isDepartmentHead && !isPrivileged;

  if (role === "employee" && !isDepartmentHead) {
    if (!newAssigneeId || newAssigneeId !== userId) {
      return NextResponse.json(
        { error: "Forbidden: Employees can only assign tasks to themselves." },
        { status: 403 }
      );
    }
    if (existingTask.assignee_id !== null) {
      return NextResponse.json(
        { error: "Forbidden: Employees cannot reassign tasks that are already assigned." },
        { status: 403 }
      );
    }
  } else if (isRestrictedDeptHead) {
    const projects = await fetchProjectsResilient(dbClient, orgId);
    const projectMap = new Map<string, ProjectAccessShape>();
    for (const p of projects) {
      if (p.id) projectMap.set(p.id, p);
    }

    const empIdsToCheck = [existingTask.assignee_id, existingTask.creator_id].filter(
      Boolean
    ) as string[];
    const empDeptMap = new Map<string, string | null>();
    if (empIdsToCheck.length > 0) {
      let empsQuery = dbClient
        .from("employees")
        .select("id, department_id, manager_id")
        .in("id", empIdsToCheck);
      if (orgId) empsQuery = empsQuery.eq("organization_id", orgId);
      const { data: relatedEmps } = await empsQuery;
      for (const e of relatedEmps || []) {
        empDeptMap.set(e.id, e.department_id || null);
      }
    }

    const canManage = canDepartmentHeadManageTask(
      existingTask,
      userId,
      headedDeptIds,
      projectMap,
      empDeptMap
    );
    if (!canManage) {
      return NextResponse.json(
        { error: "Forbidden: Department heads can only reassign tasks within their department or assigned projects." },
        { status: 403 }
      );
    }
  } else if (role === "manager") {
    const empIds = [existingTask.assignee_id, existingTask.creator_id].filter(Boolean) as string[];
    const mgrMap = new Map<string, string | null>();
    if (empIds.length > 0) {
      let q = dbClient.from("employees").select("id, manager_id").in("id", empIds);
      if (orgId) q = q.eq("organization_id", orgId);
      const { data: emps } = await q;
      for (const e of emps || []) mgrMap.set(e.id, e.manager_id || null);
    }
    const isTeamTask =
      existingTask.creator_id === userId ||
      existingTask.assignee_id === userId ||
      (existingTask.assignee_id && mgrMap.get(existingTask.assignee_id) === userId) ||
      mgrMap.get(existingTask.creator_id) === userId;
    if (!isTeamTask) {
      return NextResponse.json(
        { error: "Forbidden: Managers can only assign or reassign tasks within their team." },
        { status: 403 }
      );
    }
  }

  if (newAssigneeId) {
    let targetQuery = dbClient
      .from("employees")
      .select("id, manager_id, department_id, status")
      .eq("id", newAssigneeId)
      .eq("status", "active");
    if (orgId) targetQuery = targetQuery.eq("organization_id", orgId);
    const { data: targetEmp } = await targetQuery.maybeSingle();

    if (!targetEmp) {
      return NextResponse.json(
        { error: "Forbidden: Target assignee must be an active member of your organization." },
        { status: 403 }
      );
    }

    if (isRestrictedDeptHead) {
      const headedSet = new Set(headedDeptIds);
      if (newAssigneeId !== userId && (!targetEmp.department_id || !headedSet.has(targetEmp.department_id))) {
        return NextResponse.json(
          { error: "Forbidden: Department heads can only assign tasks to members of their department." },
          { status: 403 }
        );
      }
    } else if (role === "manager" && newAssigneeId !== userId && targetEmp.manager_id !== userId) {
      return NextResponse.json(
        { error: "Forbidden: Managers can only assign tasks to themselves or direct reports." },
        { status: 403 }
      );
    }
  }

  const { data: updatedTask, error: updateErr } = await dbClient
    .from("tasks")
    .update({
      assignee_id: newAssigneeId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .select("*")
    .single();

  if (updateErr || !updatedTask) {
    return NextResponse.json(
      { error: updateErr?.message || "Failed to update task assignee." },
      { status: 400 }
    );
  }

  const effectiveOrgId = existingTask.organization_id || orgId || "00000000-0000-0000-0000-000000000001";

  try {
    await dbClient.from("task_events").insert({
      organization_id: effectiveOrgId,
      task_id: taskId,
      actor_id: userId,
      event_type: "assigned",
      old_assignee_id: existingTask.assignee_id,
      new_assignee_id: newAssigneeId,
      metadata: {
        previous_assignee_id: existingTask.assignee_id,
        new_assignee_id: newAssigneeId,
      },
    });
  } catch {}

  try {
    await dbClient.from("audit_logs").insert({
      organization_id: effectiveOrgId,
      actor_id: userId,
      action: "TASK_ASSIGNED",
      table_name: "tasks",
      record_id: taskId,
      old_data: existingTask,
      new_data: updatedTask,
    });
  } catch {}

  if (newAssigneeId && newAssigneeId !== existingTask.assignee_id && newAssigneeId !== userId) {
    try {
      await dbClient.from("notifications").insert({
        organization_id: effectiveOrgId,
        user_id: newAssigneeId,
        type: "task_assigned",
        title: "Task Assigned to You",
        body: `Task "${updatedTask.title}" has been assigned to you.`,
        link: `/tasks?task=${taskId}`,
        metadata: {
          task_id: taskId,
          assigned_by: userId,
          due_date: updatedTask.due_date,
        },
      });
    } catch {}
  }

  return NextResponse.json({ success: true, task: updatedTask });
}

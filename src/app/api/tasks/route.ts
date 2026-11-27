import { NextRequest, NextResponse } from "next/server";
import { isProjectAssignedToUser } from "@/features/tasks/project-access";
import {
  fetchProjectsResilient,
  isMissingColumnOrRelationError,
  resolveTaskCallerContext,
  verifyCallerAal2IfPrivileged,
} from "@/features/tasks/server-access";

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks
 * Creates a task enforcing Department Head project scoping (only inside assigned
 * projects) and department-only assignment, while preserving HR/Admin/Manager/Employee rules.
 */
export async function POST(request: NextRequest) {
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
      { error: "MFA AAL2 verification required for HR/Admin task creation." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const title = String(body?.title || "").trim();
  if (title.length < 2) {
    return NextResponse.json(
      { error: "Task title must be at least 2 characters." },
      { status: 400 }
    );
  }

  const description = body?.description ? String(body.description).trim() || null : null;
  const priority = String(body?.priority || "medium").toLowerCase();
  if (!["low", "medium", "high", "urgent"].includes(priority)) {
    return NextResponse.json({ error: "Invalid priority value." }, { status: 400 });
  }

  const assigneeId: string | null = body?.assigneeId ? String(body.assigneeId).trim() || null : null;
  const projectId: string | null = body?.projectId ? String(body.projectId).trim() || null : null;
  const parentTaskId: string | null = body?.parentTaskId ? String(body.parentTaskId).trim() || null : null;
  const dueDate: string | null = body?.dueDate ? String(body.dueDate).trim() || null : null;
  const estimatedMinutes: number | null =
    typeof body?.estimatedMinutes === "number" && Number.isFinite(body.estimatedMinutes)
      ? body.estimatedMinutes
      : null;
  const taskTypeId: string | null = body?.taskTypeId ? String(body.taskTypeId).trim() || null : null;
  const recurrenceId: string | null = body?.recurrenceId ? String(body.recurrenceId).trim() || null : null;
  const autoDueSuggested = Boolean(body?.autoDueSuggested);
  const goalId: string | null = body?.goalId ? String(body.goalId).trim() || null : null;

  const isPrivileged = role === "admin" || role === "hr";
  const isRestrictedDeptHead = isDepartmentHead && !isPrivileged;

  if (role === "employee" && !isDepartmentHead && assigneeId && assigneeId !== userId) {
    return NextResponse.json(
      { error: "Forbidden: Employees cannot assign tasks to other employees." },
      { status: 403 }
    );
  }

  const projects = await fetchProjectsResilient(dbClient, orgId);
  const targetProject = projectId ? projects.find((p) => p.id === projectId) : null;

  if (projectId && !targetProject) {
    return NextResponse.json(
      { error: "Forbidden: Project does not belong to caller organization." },
      { status: 403 }
    );
  }

  if (isRestrictedDeptHead) {
    if (!targetProject || !isProjectAssignedToUser(targetProject, userId, headedDeptIds)) {
      return NextResponse.json(
        { error: "Forbidden: Department heads can only create tasks inside projects assigned to them." },
        { status: 403 }
      );
    }
  }

  if (assigneeId) {
    let empQuery = dbClient
      .from("employees")
      .select("id, manager_id, department_id, status")
      .eq("id", assigneeId)
      .eq("status", "active");
    if (orgId) empQuery = empQuery.eq("organization_id", orgId);
    const { data: assigneeEmp } = await empQuery.maybeSingle();

    if (!assigneeEmp) {
      return NextResponse.json(
        { error: "Forbidden: Assignee must be an active member of your organization." },
        { status: 403 }
      );
    }

    if (isRestrictedDeptHead) {
      const headedSet = new Set(headedDeptIds);
      if (assigneeId !== userId && (!assigneeEmp.department_id || !headedSet.has(assigneeEmp.department_id))) {
        return NextResponse.json(
          { error: "Forbidden: Department heads can only assign tasks to members of their department." },
          { status: 403 }
        );
      }
    } else if (role === "manager" && assigneeId !== userId && assigneeEmp.manager_id !== userId) {
      return NextResponse.json(
        { error: "Forbidden: Managers can only assign tasks to themselves or direct reports." },
        { status: 403 }
      );
    }
  }

  const effectiveOrgId = orgId || "00000000-0000-0000-0000-000000000001";
  const isSelfAssign = Boolean(assigneeId && assigneeId === userId);
  const initialStatus = isSelfAssign ? "in_progress" : "todo";

  const basePayload: Record<string, any> = {
    organization_id: effectiveOrgId,
    project_id: projectId,
    parent_task_id: parentTaskId,
    title,
    description,
    creator_id: userId,
    assignee_id: assigneeId,
    status: initialStatus,
    priority,
    due_date: dueDate,
    estimated_minutes: estimatedMinutes,
    started_at: isSelfAssign ? new Date().toISOString() : null,
  };

  const extendedPayload: Record<string, any> = {
    ...basePayload,
    task_type_id: taskTypeId,
    recurrence_id: recurrenceId,
    auto_due_suggested: autoDueSuggested,
    goal_id: goalId,
  };

  let insertRes = await dbClient.from("tasks").insert(extendedPayload).select("*").single();
  if (insertRes?.error && isMissingColumnOrRelationError(insertRes.error)) {
    insertRes = await dbClient.from("tasks").insert(basePayload).select("*").single();
  }

  if (insertRes?.error || !insertRes?.data) {
    return NextResponse.json(
      { error: insertRes?.error?.message || "Failed to create task." },
      { status: 400 }
    );
  }

  const created = insertRes.data;

  try {
    await dbClient.from("task_events").insert({
      organization_id: effectiveOrgId,
      task_id: created.id,
      actor_id: userId,
      event_type: "created",
      to_status: initialStatus,
      new_assignee_id: assigneeId,
      metadata: {
        priority,
        due_date: dueDate,
        task_type_id: taskTypeId,
        recurrence_id: recurrenceId,
        auto_due_suggested: autoDueSuggested,
      },
    });
  } catch {}

  try {
    await dbClient.from("audit_logs").insert({
      organization_id: effectiveOrgId,
      actor_id: userId,
      action: "TASK_CREATED",
      table_name: "tasks",
      record_id: created.id,
      old_data: null,
      new_data: created,
    });
  } catch {}

  if (assigneeId && assigneeId !== userId) {
    try {
      await dbClient.from("notifications").insert({
        organization_id: effectiveOrgId,
        user_id: assigneeId,
        type: "task_assigned",
        title: "New Task Assigned",
        body: `You have been assigned "${title}"${dueDate ? ` (Due ${dueDate})` : ""}.`,
        link: `/tasks?task=${created.id}`,
        metadata: { task_id: created.id, assigned_by: userId, due_date: dueDate },
      });
    } catch {}
  }

  return NextResponse.json({ success: true, task: created, id: created.id });
}

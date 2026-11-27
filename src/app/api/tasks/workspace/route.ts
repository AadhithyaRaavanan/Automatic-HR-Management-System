import { NextRequest, NextResponse } from "next/server";
import {
  canDepartmentHeadManageTask,
  ProjectAccessShape,
} from "@/features/tasks/project-access";
import {
  fetchProjectsResilient,
  isMissingColumnOrRelationError,
  resolveTaskCallerContext,
} from "@/features/tasks/server-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * GET /api/tasks/workspace
 * Returns caller-scoped tasks, org projects (with incharge & department metadata),
 * departments (with department_head_id), and the caller's headed department IDs.
 */
export async function GET(request: NextRequest) {
  const ctx = await resolveTaskCallerContext(request);
  if ("response" in ctx) {
    return ctx.response;
  }

  const { userId, role, orgId, dbClient, departments, headedDeptIds, isDepartmentHead } = ctx;

  const projects = await fetchProjectsResilient(dbClient, orgId);
  const projectMap = new Map<string, ProjectAccessShape>();
  for (const p of projects) {
    if (p.id) projectMap.set(p.id, p);
  }

  // Fetch org employees for manager/department-head visibility resolution
  let empQuery = dbClient
    .from("employees")
    .select("id, manager_id, department_id")
    .eq("status", "active");
  if (orgId) empQuery = empQuery.eq("organization_id", orgId);

  let empRes = await empQuery;
  if (empRes?.error && isMissingColumnOrRelationError(empRes.error)) {
    let fallbackEmpQuery = dbClient.from("employees").select("id, manager_id, department_id");
    if (orgId) fallbackEmpQuery = fallbackEmpQuery.eq("organization_id", orgId);
    empRes = await fallbackEmpQuery;
  }

  const empDeptMap = new Map<string, string | null>();
  const directReportIds = new Set<string>();
  for (const emp of empRes?.data || []) {
    empDeptMap.set(emp.id, emp.department_id || null);
    if (emp.manager_id === userId) {
      directReportIds.add(emp.id);
    }
  }

  // Query org tasks (with clean column fallback for sparse schemas)
  let taskQuery = dbClient
    .from("tasks")
    .select(
      "id, organization_id, project_id, parent_task_id, title, description, creator_id, assignee_id, status, priority, due_date, estimated_minutes, started_at, completed_at, cancelled_at, created_at, updated_at, task_type_id, recurrence_id, auto_due_suggested, goal_id, project:projects(id, name, code)"
    )
    .order("created_at", { ascending: false });
  if (orgId) taskQuery = taskQuery.eq("organization_id", orgId);

  let taskRes = await taskQuery;
  if (taskRes?.error && isMissingColumnOrRelationError(taskRes.error)) {
    let fallbackTaskQuery = dbClient
      .from("tasks")
      .select(
        "id, organization_id, project_id, parent_task_id, title, description, creator_id, assignee_id, status, priority, due_date, estimated_minutes, started_at, completed_at, cancelled_at, created_at, updated_at"
      )
      .order("created_at", { ascending: false });
    if (orgId) fallbackTaskQuery = fallbackTaskQuery.eq("organization_id", orgId);
    taskRes = await fallbackTaskQuery;
  }

  const allTasks: any[] = taskRes?.data || [];

  const visibleTasks = allTasks.filter((t) => {
    if (role === "admin" || role === "hr") return true;
    if (t.creator_id === userId || t.assignee_id === userId) return true;
    if (
      role === "manager" &&
      ((t.assignee_id && directReportIds.has(t.assignee_id)) ||
        (t.creator_id && directReportIds.has(t.creator_id)))
    ) {
      return true;
    }
    if (isDepartmentHead) {
      return canDepartmentHeadManageTask(t, userId, headedDeptIds, projectMap, empDeptMap);
    }
    if (t.project_id) {
      const proj = projectMap.get(t.project_id);
      if (proj?.incharge_id === userId) return true;
    }
    return false;
  });

  return NextResponse.json(
    {
      tasks: visibleTasks,
      projects,
      departments,
      headedDepartmentIds: headedDeptIds,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  );
}

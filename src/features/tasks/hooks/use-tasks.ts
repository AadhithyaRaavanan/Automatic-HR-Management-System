"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { TaskPriority, TaskStatus } from "@/types/database.types";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { TaskType, TaskRecurrence } from "@/features/tasks/types";
import { sanitizeAndDedupeAssignees } from "@/features/tasks/assignees";
import {
  ProjectAssignmentType,
  getHeadedDepartmentIds,
  isProjectAssignedToUser,
  resolveDepartmentInchargeLock,
  resolveTaskSettingsFromProject,
} from "@/features/tasks/project-access";
import {
  getStoredDepartments,
  getStoredProjects,
  getStoredTasks,
  addStoredProject,
  deleteStoredProject,
  addStoredTask,
  updateStoredTask,
  deleteStoredTask,
} from "@/lib/storage/demo-store";

export interface ProjectRecord {
  id: string;
  organization_id: string;
  department_id: string | null;
  department_ids?: string[];
  incharge_id?: string | null;
  assignment_type?: ProjectAssignmentType;
  name: string;
  code: string | null;
  description: string | null;
  status: string;
  created_by: string;
  created_at: string;
}

export interface TaskRecord {
  id: string;
  organization_id: string;
  project_id: string | null;
  department_id?: string | null;
  department_ids?: string[];
  assignment_type?: ProjectAssignmentType;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  creator_id: string;
  assignee_id: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  estimated_minutes: number | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  task_type_id?: string | null;
  recurrence_id?: string | null;
  auto_due_suggested?: boolean;
  goal_id?: string | null;
  project?: {
    id?: string;
    name?: string | null;
    code?: string | null;
  } | null;
}

export interface TaskCommentRecord {
  id: string;
  organization_id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface TaskTimeLogRecord {
  id: string;
  organization_id: string;
  task_id: string;
  employee_id: string;
  work_date: string;
  minutes: number;
  note: string | null;
  created_at: string;
}

export interface TaskEventRecord {
  id: string;
  organization_id: string;
  task_id: string;
  actor_id: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  old_assignee_id: string | null;
  new_assignee_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface VisibleEmployeeOption {
  id: string;
  full_name: string | null;
  email: string;
  manager_id: string | null;
  department_id?: string | null;
  status: string;
  role?: string;
}

export interface DepartmentOption {
  id: string;
  name: string;
  code: string | null;
  department_head_id?: string | null;
}

export type TaskDueState = "overdue" | "due_soon" | "upcoming" | "none";

export function formatEstimatedDuration(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function getTaskDueState(
  dueDate: string | null,
  status: TaskStatus,
  referenceDateIso?: string
): TaskDueState {
  if (!dueDate) return "none";
  if (status === "done" || status === "cancelled") return "upcoming";

  const todayIso = referenceDateIso || new Date().toISOString().slice(0, 10);
  if (dueDate < todayIso) return "overdue";

  const today = new Date(`${todayIso}T00:00:00Z`);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (dueDate <= tomorrow) return "due_soon";

  return "upcoming";
}

export function useTasksData(enabled = true) {
  const supabase = React.useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (!isDemoModeEnabled() || typeof window === "undefined") return;
    const handleStorageChange = () => {
      queryClient.invalidateQueries({ queryKey: ["tasks-workspace"] });
    };
    window.addEventListener("remotehr_storage_change", handleStorageChange);
    return () => {
      window.removeEventListener("remotehr_storage_change", handleStorageChange);
    };
  }, [queryClient]);

  return useQuery<{
    tasks: TaskRecord[];
    projects: ProjectRecord[];
    employees: VisibleEmployeeOption[];
    departments: DepartmentOption[];
    taskTypes: TaskType[];
    recurrences: TaskRecurrence[];
  }>({
    queryKey: ["tasks-workspace"],
    enabled,
    queryFn: async () => {
      let tasksData: any[] = [];
      let projectsData: any[] = [];
      let employeesData: any[] = [];
      let departmentsData: any[] = [];
      let taskTypesData: TaskType[] = [];
      let recurrencesData: TaskRecurrence[] = [];

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          throw new Error("No active Supabase session");
        }

        const currentUser = session.user;
        const currentUserEmail = currentUser?.email || null;
        const currentUserMetaName =
          (currentUser?.user_metadata?.full_name as string | undefined) ||
          (currentUser?.user_metadata?.name as string | undefined) ||
          null;

        let tasksResPromise = supabase
          .from("tasks")
          .select(
            "id, organization_id, project_id, parent_task_id, title, description, creator_id, assignee_id, status, priority, due_date, estimated_minutes, started_at, completed_at, cancelled_at, created_at, updated_at, task_type_id, recurrence_id, auto_due_suggested, project:projects(id, name, code)"
          )
          .order("created_at", { ascending: false });

        const [
          workspaceApiRes,
          tasksResAttempt,
          projectsRes,
          assigneesApiRes,
          departmentsRes,
          typesRes,
          recurrencesRes,
        ] = await Promise.all([
          fetch("/api/tasks/workspace", {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          })
            .then(async (r) => (r.ok ? await r.json() : null))
            .catch(() => null),
          tasksResPromise,
          supabase
            .from("projects")
            .select(
              "id, organization_id, department_id, department_ids, incharge_id, assignment_type, name, code, description, status, created_by, created_at"
            )
            .order("name", { ascending: true }),
          fetch("/api/tasks/assignees", {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          })
            .then(async (r) => (r.ok ? await r.json() : null))
            .catch(() => null),
          supabase
            .from("departments")
            .select("id, name, code, department_head_id")
            .order("name", { ascending: true }),
          fetch("/api/tasks/types")
            .then((r) => (r.ok ? r.json() : { types: [] }))
            .catch(() => ({ types: [] })),
          fetch("/api/tasks/recurrences")
            .then((r) => (r.ok ? r.json() : { recurrences: [] }))
            .catch(() => ({ recurrences: [] })),
        ]);

        let finalTasksRes = tasksResAttempt;
        if (!Array.isArray(workspaceApiRes?.tasks) && tasksResAttempt?.error) {
          finalTasksRes = await supabase
            .from("tasks")
            .select(
              "id, organization_id, project_id, parent_task_id, title, description, creator_id, assignee_id, status, priority, due_date, estimated_minutes, started_at, completed_at, cancelled_at, created_at, updated_at"
            )
            .order("created_at", { ascending: false });
        }

        let finalProjectsRes = projectsRes;
        if (!Array.isArray(workspaceApiRes?.projects) && projectsRes?.error) {
          finalProjectsRes = await supabase
            .from("projects")
            .select(
              "id, organization_id, department_id, name, code, description, status, created_by, created_at"
            )
            .order("name", { ascending: true });
        }

        let finalDepartmentsRes = departmentsRes;
        if (!Array.isArray(workspaceApiRes?.departments) && departmentsRes?.error) {
          finalDepartmentsRes = await supabase
            .from("departments")
            .select("id, name, code")
            .order("name", { ascending: true });
        }

        if (Array.isArray(assigneesApiRes?.assignees)) {
          employeesData = sanitizeAndDedupeAssignees(assigneesApiRes.assignees, {
            userId: currentUser?.id,
            email: currentUserEmail,
            fullName: currentUserMetaName,
          });
        } else {
          // Direct org-scoped browser fallback when /api/tasks/assignees is unavailable (never demo-store mocks)
          const selfMemberRes = currentUser?.id
            ? await supabase
                .from("organization_members")
                .select("organization_id, role")
                .eq("user_id", currentUser.id)
                .eq("status", "active")
                .maybeSingle()
            : { data: null, error: null };

          const callerOrgId: string | null =
            (selfMemberRes?.data as any)?.organization_id ||
            (currentUser?.app_metadata?.organization_id as string | undefined) ||
            (currentUser?.user_metadata?.organization_id as string | undefined) ||
            null;

          let empQuery = supabase
            .from("employees")
            .select("id, full_name, email, manager_id, department_id, status")
            .eq("status", "active")
            .order("full_name", { ascending: true });
          if (callerOrgId) {
            empQuery = empQuery.eq("organization_id", callerOrgId);
          }

          let membersQuery = supabase
            .from("organization_members")
            .select("user_id, role")
            .eq("status", "active");
          if (callerOrgId) {
            membersQuery = membersQuery.eq("organization_id", callerOrgId);
          }

          const [employeesRes, membersRes] = await Promise.all([empQuery, membersQuery]);

          const roleMap = new Map<string, string>();
          if (membersRes?.data) {
            for (const m of membersRes.data as any[]) {
              if (m?.user_id && m?.role) {
                roleMap.set(m.user_id, String(m.role).toLowerCase());
              }
            }
          }

          const rawDbEmployees: VisibleEmployeeOption[] = (employeesRes?.data || []).map((emp: any) => ({
            ...emp,
            role: roleMap.get(emp.id) || "employee",
          }));

          if (currentUser?.id) {
            rawDbEmployees.push({
              id: currentUser.id,
              full_name:
                currentUserMetaName ||
                (currentUserEmail ? currentUserEmail.split("@")[0] : null),
              email: currentUserEmail || "",
              manager_id: null,
              department_id: null,
              status: "active",
              role:
                roleMap.get(currentUser.id) ||
                (currentUser.app_metadata?.user_role as string | undefined) ||
                (currentUser.user_metadata?.user_role as string | undefined) ||
                "employee",
            });
          }

          employeesData = sanitizeAndDedupeAssignees(rawDbEmployees, {
            userId: currentUser?.id,
            email: currentUserEmail,
            fullName: currentUserMetaName,
          });
        }

        if (Array.isArray(workspaceApiRes?.tasks)) {
          tasksData = workspaceApiRes.tasks;
        } else if (finalTasksRes?.data) {
          tasksData = finalTasksRes.data;
        }

        if (Array.isArray(workspaceApiRes?.projects)) {
          projectsData = workspaceApiRes.projects;
        } else if (finalProjectsRes?.data) {
          projectsData = finalProjectsRes.data;
        }

        if (Array.isArray(workspaceApiRes?.departments)) {
          departmentsData = workspaceApiRes.departments;
        } else if (finalDepartmentsRes?.data) {
          departmentsData = finalDepartmentsRes.data;
        }
        if (typesRes?.types) taskTypesData = typesRes.types;
        if (recurrencesRes?.recurrences) recurrencesData = recurrencesRes.recurrences;
      } catch {
        // Fallback gracefully without injecting mock users
      }

      const storedDepts = isDemoModeEnabled() ? getStoredDepartments() : [];
      const storedProjects = isDemoModeEnabled() ? getStoredProjects() : [];
      const storedTasks = isDemoModeEnabled() ? getStoredTasks() : [];

      // Active departments (prioritizes user-created demo store to honor deletions)
      let mergedDepts: DepartmentOption[] = storedDepts.map((d) => ({
        id: d.id,
        name: d.name,
        code: d.code,
        department_head_id: d.headId || null,
      }));
      if (!isDemoModeEnabled()) {
        for (const d of departmentsData) {
          if (!mergedDepts.some((md) => md.id === d.id || md.name === d.name)) {
            mergedDepts.push({
              id: d.id,
              name: d.name,
              code: d.code || null,
              department_head_id: d.department_head_id || null,
            });
          }
        }
      }

      // Merge projects: database is authoritative in production, and preserve DB projects in dev fallback
      const storedProjectItems: ProjectRecord[] = storedProjects.map((p) => ({
        id: p.id,
        organization_id: "",
        department_id: p.department_id || null,
        department_ids: Array.isArray(p.department_ids)
          ? p.department_ids
          : p.department_id
          ? [p.department_id]
          : [],
        incharge_id: p.incharge_id || null,
        assignment_type: p.assignment_type || (p.department_id ? "department" : "company"),
        name: p.name,
        code: p.code,
        description: p.description || null,
        status: p.status || "active",
        created_by: "",
        created_at: p.created_at || new Date().toISOString(),
      }));
      const mergedProjects: ProjectRecord[] = !isDemoModeEnabled()
        ? projectsData || []
        : [
            ...storedProjectItems,
            ...(projectsData || []).filter(
              (dp) => !storedProjectItems.some((sp) => sp.id === dp.id)
            ),
          ];

      // Real active organization members only — never fall back to hardcoded/demo-store placeholder users
      const mergedEmployees: VisibleEmployeeOption[] = employeesData;

      // Merge tasks: database is authoritative in production
      const mergedTasks: TaskRecord[] =
        !isDemoModeEnabled() && tasksData
          ? tasksData
          : [
              ...storedTasks.map((t) => ({
                id: t.id,
                organization_id: "",
                project_id: t.project_id || null,
                department_id: t.department_id || null,
                department_ids: Array.isArray(t.department_ids)
                  ? t.department_ids
                  : t.department_id
                  ? [t.department_id]
                  : [],
                assignment_type: t.assignment_type || (t.department_id ? "department" : "company"),
                parent_task_id: t.parent_task_id || null,
                title: t.title,
                description: t.description || null,
                creator_id: t.creator_id || "",
                assignee_id: t.assignee_id || null,
                status: t.status as TaskStatus,
                priority: t.priority as TaskPriority,
                due_date: t.due_date || null,
                estimated_minutes: t.estimated_minutes || null,
                started_at: t.started_at || null,
                completed_at: t.completed_at || null,
                cancelled_at: t.cancelled_at || null,
                created_at: t.created_at,
                updated_at: t.updated_at || t.created_at,
              })),
            ];

      return {
        tasks: mergedTasks,
        projects: mergedProjects,
        employees: mergedEmployees,
        departments: mergedDepts,
        taskTypes: taskTypesData,
        recurrences: recurrencesData,
      };
    },
  });
}

export function useTaskDetails(taskId: string | null) {
  const supabase = React.useMemo(() => createClient(), []);

  return useQuery<{
    comments: TaskCommentRecord[];
    timeLogs: TaskTimeLogRecord[];
    events: TaskEventRecord[];
  }>({
    queryKey: ["task-details", taskId],
    enabled: Boolean(taskId),
    queryFn: async () => {
      if (!taskId) {
        return { comments: [], timeLogs: [], events: [] };
      }
      const [commentsRes, logsRes, eventsRes] = await Promise.all([
        supabase
          .from("task_comments")
          .select("id, organization_id, task_id, author_id, body, created_at")
          .eq("task_id", taskId)
          .order("created_at", { ascending: true }),
        supabase
          .from("task_time_logs")
          .select("id, organization_id, task_id, employee_id, work_date, minutes, note, created_at")
          .eq("task_id", taskId)
          .order("work_date", { ascending: false }),
        supabase
          .from("task_events")
          .select(
            "id, organization_id, task_id, actor_id, event_type, from_status, to_status, old_assignee_id, new_assignee_id, metadata, created_at"
          )
          .eq("task_id", taskId)
          .order("created_at", { ascending: true }),
      ]);

      if (commentsRes.error) throw commentsRes.error;
      if (logsRes.error) throw logsRes.error;
      if (eventsRes.error) throw eventsRes.error;

      return {
        comments: (commentsRes.data || []) as TaskCommentRecord[],
        timeLogs: (logsRes.data || []) as TaskTimeLogRecord[],
        events: (eventsRes.data || []) as TaskEventRecord[],
      };
    },
  });
}

export function useTaskMutations(
  callerRole?: string | null,
  callerUserId?: string | null,
  canDeleteOverride?: boolean
) {
  const supabase = React.useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  const resolveCallerIdentity = async (): Promise<{
    role: string | null;
    userId: string | null;
  }> => {
    let resolvedRole = callerRole ?? null;
    let resolvedUserId = callerUserId ?? null;

    if (isDemoModeEnabled() && typeof window !== "undefined") {
      try {
        if (!resolvedRole) {
          resolvedRole = localStorage.getItem("remotehr_cached_role");
        }
        if (!resolvedUserId) {
          const rawSession = localStorage.getItem("remotehr_cached_session");
          if (rawSession) {
            const parsed = JSON.parse(rawSession);
            resolvedUserId = parsed?.userId ?? null;
          }
        }
      } catch {
        // Ignore storage errors
      }
      return { role: resolvedRole, userId: resolvedUserId };
    }

    if (!resolvedUserId || !resolvedRole) {
      const { data: userRes } = await supabase.auth.getUser();
      if (!resolvedUserId) {
        resolvedUserId = userRes?.user?.id ?? null;
      }
      if (!resolvedRole && resolvedUserId) {
        const { data: member } = await (supabase as any)
          .from("organization_members")
          .select("role")
          .eq("user_id", resolvedUserId)
          .eq("status", "active")
          .maybeSingle();
        resolvedRole = member?.role ?? null;
      }
    }

    return { role: resolvedRole, userId: resolvedUserId };
  };

  const assertAdminRole = async () => {
    if (typeof canDeleteOverride === "boolean") {
      if (!canDeleteOverride) {
        throw new Error("Only Admins can delete tasks and projects.");
      }
      return;
    }
    if (callerRole) {
      if (callerRole !== "admin") {
        throw new Error("Only Admins can delete tasks and projects.");
      }
      return;
    }
    if (isDemoModeEnabled()) {
      if (typeof window !== "undefined") {
        const cachedRole = localStorage.getItem("remotehr_cached_role");
        if (cachedRole && cachedRole !== "admin") {
          throw new Error("Only Admins can delete tasks and projects.");
        }
      }
      return;
    }
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes?.user) {
      throw new Error("Only Admins can delete tasks and projects.");
    }
    const { data: member } = await (supabase as any)
      .from("organization_members")
      .select("role")
      .eq("user_id", userRes.user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!member || member.role !== "admin") {
      throw new Error("Only Admins can delete tasks and projects.");
    }
  };

  const invalidateAll = (taskId?: string) => {
    queryClient.invalidateQueries({ queryKey: ["tasks-workspace"] });
    queryClient.invalidateQueries({ queryKey: ["my-dashboard-tasks"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    if (taskId) {
      queryClient.invalidateQueries({ queryKey: ["task-details", taskId] });
    }
  };

  const rpcCall = async (fn: string, args: Record<string, unknown>) => {
    const clientWithRpc = supabase as unknown as {
      rpc: (
        name: string,
        params: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await clientWithRpc.rpc(fn, args);
    if (error) {
      if (isDemoModeEnabled()) {
        return { success: true, message: `${fn} executed (demo mode)` };
      }
      throw new Error(error.message || `RPC ${fn} failed`);
    }
    return data;
  };

  const createProject = useMutation({
    mutationFn: async (input: {
      name: string;
      departmentId?: string | null;
      departmentIds?: string[];
      inchargeId?: string | null;
      assignmentType?: ProjectAssignmentType;
      description?: string | null;
      code?: string | null;
      silent?: boolean;
    }) => {
      const normalizedDeptIds = Array.isArray(input.departmentIds)
        ? Array.from(new Set(input.departmentIds.filter(Boolean)))
        : input.departmentId
        ? [input.departmentId]
        : [];
      const assignmentType: ProjectAssignmentType =
        input.assignmentType ||
        (normalizedDeptIds.length > 0
          ? "department"
          : input.inchargeId
          ? "individual"
          : "company");

      let resolvedInchargeId = input.inchargeId || null;
      if (assignmentType === "department" && normalizedDeptIds.length > 0) {
        const cached = queryClient.getQueryData<any>(["tasks-workspace"]);
        const lock = resolveDepartmentInchargeLock(
          normalizedDeptIds,
          cached?.departments || []
        );
        if (lock.isLocked && lock.lockedInchargeId) {
          resolvedInchargeId = lock.lockedInchargeId;
        }
      }

      const storedProj = isDemoModeEnabled()
        ? addStoredProject({
            name: input.name,
            department_id: normalizedDeptIds[0] || null,
            department_ids: normalizedDeptIds,
            incharge_id: resolvedInchargeId,
            assignment_type: assignmentType,
            description: input.description || null,
            code: input.code || input.name.slice(0, 4).toUpperCase(),
          })
        : null;

      if (!isDemoModeEnabled()) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          const resp = await fetch("/api/tasks/projects", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              name: input.name,
              code: input.code || null,
              description: input.description || null,
              assignmentType,
              departmentIds: normalizedDeptIds,
              inchargeId: resolvedInchargeId,
            }),
          });
          if (resp.status !== 404) {
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) {
              throw new Error(json?.error || "Failed to create project");
            }
            return json;
          }
        }
      }

      const res = (await rpcCall("create_project", {
        p_name: input.name,
        p_department_id: normalizedDeptIds[0] || null,
        p_description: input.description || null,
        p_code: input.code || null,
      })) as { success?: boolean; project?: { id?: string } } | null;
      const projectId = res?.project?.id || storedProj?.id;
      return {
        ...(res || {}),
        project: res?.project || storedProj,
        projectId,
      };
    },
    onSuccess: (_, vars) => {
      if (!vars.silent) {
        toast.success("Project created");
      }
      invalidateAll();
    },
    onError: (err: Error, vars) => {
      if (!vars.silent) {
        toast.error(err.message || "Failed to create project");
      }
    },
  });

  const deleteProject = useMutation({
    onMutate: async (projectId: string) => {
      if (callerRole && callerRole !== "admin") {
        return {};
      }
      await queryClient.cancelQueries({ queryKey: ["tasks-workspace"] });
      const previousData = queryClient.getQueryData(["tasks-workspace"]);
      queryClient.setQueryData(["tasks-workspace"], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          projects: (old.projects || []).filter((p: any) => p.id !== projectId),
          tasks: (old.tasks || []).filter((t: any) => t.project_id !== projectId),
        };
      });
      return { previousData };
    },
    mutationFn: async (projectId: string) => {
      await assertAdminRole();

      if (isDemoModeEnabled()) {
        const deletedTasksCount = getStoredTasks().filter(
          (t) => t.project_id === projectId
        ).length;
        deleteStoredProject(projectId);
        return {
          success: true,
          deleted_project_id: projectId,
          deleted_tasks_count: deletedTasksCount,
        };
      }

      const result = await rpcCall("delete_project", { p_project_id: projectId });
      return result;
    },
    onSuccess: (data: any) => {
      const deletedCount =
        typeof data?.deleted_tasks_count === "number" ? data.deleted_tasks_count : null;
      if (deletedCount !== null) {
        toast.success(
          `Project and ${deletedCount} ${deletedCount === 1 ? "task" : "tasks"} permanently deleted`
        );
      } else {
        toast.success("Project and all its tasks permanently deleted");
      }
      invalidateAll();
    },
    onError: (err: Error, _, context: any) => {
      if (context?.previousData) {
        queryClient.setQueryData(["tasks-workspace"], context.previousData);
      }
      toast.error(err.message || "Failed to delete project");
    },
  });

  const createTask = useMutation({
    mutationFn: async (input: {
      title: string;
      description?: string | null;
      assigneeId?: string | null;
      priority?: TaskPriority;
      dueDate?: string | null;
      estimatedMinutes?: number | null;
      projectId?: string | null;
      assignmentType?: ProjectAssignmentType;
      departmentIds?: string[];
      parentTaskId?: string | null;
      isSelfAssign?: boolean;
      taskTypeId?: string | null;
      recurrenceId?: string | null;
      autoDueSuggested?: boolean;
      goalId?: string | null;
      silent?: boolean;
      recurrence?: {
        frequency: "daily" | "weekly" | "monthly" | "every_n_working_days";
        interval_n: number;
        weekday?: number | null;
        day_of_month?: number | null;
        next_run_date?: string;
        end_date?: string | null;
      } | null;
      subtaskTitles?: string[];
    }) => {
      const caller = await resolveCallerIdentity();
      const cachedWorkspace = queryClient.getQueryData<any>(["tasks-workspace"]);
      const cachedDepts = cachedWorkspace?.departments || [];
      const cachedProjects = cachedWorkspace?.projects || [];
      const headedDeptIds = getHeadedDepartmentIds(caller.userId, cachedDepts);
      const isRestrictedDeptHead =
        headedDeptIds.length > 0 && caller.role !== "admin" && caller.role !== "hr";
      const isPureEmployee =
        (caller.role === "employee" || caller.role === "team_lead") &&
        headedDeptIds.length === 0;

      const targetProj = input.projectId
        ? cachedProjects.find((p: any) => p.id === input.projectId)
        : null;

      let resolvedAssignmentType: ProjectAssignmentType =
        input.assignmentType || "company";
      let resolvedDeptIds: string[] = Array.isArray(input.departmentIds)
        ? Array.from(new Set(input.departmentIds.filter(Boolean)))
        : [];
      let resolvedAssigneeId: string | null = input.assigneeId || null;

      if (targetProj) {
        const inherited = resolveTaskSettingsFromProject(targetProj, cachedDepts);
        if (inherited) {
          resolvedAssignmentType = inherited.assignmentType;
          resolvedDeptIds = inherited.departmentIds;
          if (!isRestrictedDeptHead && !isPureEmployee && inherited.isAssigneeLocked && inherited.inchargeId) {
            resolvedAssigneeId = inherited.inchargeId;
          }
        }
      } else if (resolvedAssignmentType === "department" && resolvedDeptIds.length > 0) {
        const lock = resolveDepartmentInchargeLock(resolvedDeptIds, cachedDepts);
        if (lock.isLocked && lock.lockedInchargeId) {
          resolvedAssigneeId = lock.lockedInchargeId;
        }
      }

      if (isRestrictedDeptHead) {
        if (!input.projectId || (targetProj && !isProjectAssignedToUser(targetProj, caller.userId, headedDeptIds))) {
          throw new Error(
            "Department heads can only create tasks inside projects assigned to them"
          );
        }
        if (resolvedAssigneeId && resolvedAssigneeId !== caller.userId) {
          const targetEmp = (cachedWorkspace?.employees || []).find(
            (e: any) => e.id === resolvedAssigneeId
          );
          if (
            targetEmp &&
            (!targetEmp.department_id || !headedDeptIds.includes(targetEmp.department_id))
          ) {
            throw new Error(
              "Department heads can only assign tasks to members of their department"
            );
          }
        }
      } else if (isPureEmployee) {
        if (resolvedAssigneeId && (!caller.userId || resolvedAssigneeId !== caller.userId)) {
          throw new Error("Employees cannot assign tasks to other employees");
        }
      }

      const isSelf = Boolean(
        input.isSelfAssign || (resolvedAssigneeId && resolvedAssigneeId === caller.userId)
      );
      const initialStatus: TaskStatus = isSelf ? "in_progress" : "todo";

      // 1. If recurring task requested, create recurrence record first
      let activeRecurrenceId = input.recurrenceId || null;
      if (input.recurrence && !activeRecurrenceId) {
        try {
          const recRes = await fetch("/api/tasks/recurrences", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              task_type_id: input.taskTypeId || null,
              title: input.title,
              description: input.description || null,
              priority: input.priority || "medium",
              estimate_minutes: input.estimatedMinutes || null,
              assignee_id: resolvedAssigneeId,
              frequency: input.recurrence.frequency,
              interval_n: input.recurrence.interval_n || 1,
              weekday: input.recurrence.weekday ?? null,
              day_of_month: input.recurrence.day_of_month ?? null,
              next_run_date: input.recurrence.next_run_date || input.dueDate || new Date().toISOString().slice(0, 10),
              end_date: input.recurrence.end_date || null,
            }),
          });
          if (recRes.ok) {
            const recJson = await recRes.json();
            activeRecurrenceId = recJson.recurrence?.id || null;
          }
        } catch (recErr) {
          console.warn("Failed to create recurrence record:", recErr);
        }
      }

      if (isDemoModeEnabled()) addStoredTask({
        title: input.title,
        description: input.description || null,
        creator_id: caller.userId || undefined,
        assignee_id: resolvedAssigneeId,
        priority: input.priority || "medium",
        due_date: input.dueDate || null,
        estimated_minutes:
          typeof input.estimatedMinutes === "number" ? input.estimatedMinutes : null,
        project_id: input.projectId || null,
        department_id: resolvedDeptIds[0] || null,
        department_ids: resolvedDeptIds,
        assignment_type: resolvedAssignmentType,
        parent_task_id: input.parentTaskId || null,
        status: initialStatus,
      });

      let res: any = null;
      let createdViaApi = false;
      if (!isDemoModeEnabled()) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          const resp = await fetch("/api/tasks", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              title: input.title,
              description: input.description || null,
              assigneeId: resolvedAssigneeId,
              priority: input.priority || "medium",
              dueDate: input.dueDate || null,
              estimatedMinutes:
                typeof input.estimatedMinutes === "number" ? input.estimatedMinutes : null,
              projectId: input.projectId || null,
              assignmentType: resolvedAssignmentType,
              departmentIds: resolvedDeptIds,
              parentTaskId: input.parentTaskId || null,
              taskTypeId: input.taskTypeId || null,
              recurrenceId: activeRecurrenceId,
              autoDueSuggested: Boolean(input.autoDueSuggested),
              goalId: input.goalId || null,
            }),
          });
          if (resp.status !== 404) {
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) {
              throw new Error(json?.error || "Failed to create task");
            }
            res = json;
            createdViaApi = true;
          }
        }
      }

      if (!createdViaApi) {
        try {
          res = (await rpcCall("create_task", {
            p_title: input.title,
            p_description: input.description || null,
            p_assignee_id: resolvedAssigneeId,
            p_priority: input.priority || "medium",
            p_due_date: input.dueDate || null,
            p_estimated_minutes:
              typeof input.estimatedMinutes === "number" ? input.estimatedMinutes : null,
            p_project_id: input.projectId || null,
            p_parent_task_id: input.parentTaskId || null,
            p_task_type_id: input.taskTypeId || null,
            p_recurrence_id: activeRecurrenceId,
            p_auto_due_suggested: Boolean(input.autoDueSuggested),
          })) as { success?: boolean; task?: { id?: string }; id?: string } | null;
        } catch (err: any) {
          // Fallback to 8-param RPC signature if extended function not active yet
          res = (await rpcCall("create_task", {
            p_title: input.title,
            p_description: input.description || null,
            p_assignee_id: resolvedAssigneeId,
            p_priority: input.priority || "medium",
            p_due_date: input.dueDate || null,
            p_estimated_minutes:
              typeof input.estimatedMinutes === "number" ? input.estimatedMinutes : null,
            p_project_id: input.projectId || null,
            p_parent_task_id: input.parentTaskId || null,
          })) as { success?: boolean; task?: { id?: string }; id?: string } | null;
        }
      }

      const createdTaskId = res?.task?.id || res?.id;

      // 2. Link last_created_task_id on recurrence
      if (activeRecurrenceId && createdTaskId) {
        fetch(`/api/tasks/recurrences/${activeRecurrenceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ last_created_task_id: createdTaskId }),
        }).catch(() => {});
      }

      // 3. Create subtasks from checklist if selected
      if (createdTaskId && Array.isArray(input.subtaskTitles) && input.subtaskTitles.length > 0) {
        const {
          data: { session },
        } = !isDemoModeEnabled() ? await supabase.auth.getSession() : { data: { session: null } };

        for (const subTitle of input.subtaskTitles) {
          if (!subTitle || !subTitle.trim()) continue;
          try {
            if (createdViaApi && session?.access_token) {
              await fetch("/api/tasks", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                  title: subTitle.trim(),
                  description: null,
                  assigneeId: resolvedAssigneeId,
                  priority: input.priority || "medium",
                  dueDate: input.dueDate || null,
                  estimatedMinutes: null,
                  projectId: input.projectId || null,
                  assignmentType: resolvedAssignmentType,
                  departmentIds: resolvedDeptIds,
                  parentTaskId: createdTaskId,
                }),
              });
            } else {
              await rpcCall("create_task", {
                p_title: subTitle.trim(),
                p_description: null,
                p_assignee_id: resolvedAssigneeId,
                p_priority: input.priority || "medium",
                p_due_date: input.dueDate || null,
                p_estimated_minutes: null,
                p_project_id: input.projectId || null,
                p_parent_task_id: createdTaskId,
              });
            }
          } catch (subErr) {
            console.warn("Failed to create checklist subtask:", subTitle, subErr);
          }
        }
      }

      // If self-assigned and created via legacy RPC, advance status to in_progress
      if (isSelf && !createdViaApi) {
        if (createdTaskId) {
          try {
            await rpcCall("update_task_status", {
              p_task_id: createdTaskId,
              p_new_status: "in_progress",
              p_note: "Self-assigned: automatically accepted and placed in progress",
            });
          } catch (e) {
            console.warn("Auto-accept task in progress failed:", e);
          }
        }
      }

      // If goal linked and created via legacy RPC, associate with task
      if (createdTaskId && input.goalId && !createdViaApi) {
        try {
          await (supabase as any).from("tasks").update({ goal_id: input.goalId }).eq("id", createdTaskId);
        } catch (e) {
          console.warn("Failed to set goal_id on task:", e);
        }
      }

      return res;
    },
    onSuccess: (res: any, vars: any) => {
      if (!vars.silent) {
        toast.success("Task created");
      }
      invalidateAll();
      if (vars.assigneeId) {
        fetch("/api/tasks/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "assigned",
            taskId: res?.task?.id || res?.id,
            taskTitle: vars.title,
            assigneeId: vars.assigneeId,
          }),
        }).catch(() => {});
      }
    },
    onError: (err: Error, vars: any) => {
      if (!vars?.silent) {
        toast.error(err.message || "Failed to create task");
      }
    },
  });

  const assignTask = useMutation({
    onMutate: async (vars: {
      taskId: string;
      assigneeId: string | null;
      silent?: boolean;
    }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks-workspace"] });
      const previousData = queryClient.getQueryData(["tasks-workspace"]);
      queryClient.setQueryData(["tasks-workspace"], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          tasks: (old.tasks || []).map((t: any) =>
            t.id === vars.taskId
              ? { ...t, assignee_id: vars.assigneeId || null }
              : t
          ),
        };
      });
      return { previousData };
    },
    mutationFn: async (input: {
      taskId: string;
      assigneeId: string | null;
      silent?: boolean;
    }) => {
      const caller = await resolveCallerIdentity();
      const cachedWorkspace = queryClient.getQueryData<any>(["tasks-workspace"]);
      const headedDeptIds = getHeadedDepartmentIds(
        caller.userId,
        cachedWorkspace?.departments || []
      );
      const isDeptHead = headedDeptIds.length > 0;
      const current = isDemoModeEnabled() ? getStoredTasks() : [];
      const target = current.find((t) => t.id === input.taskId);

      if (!isDeptHead && (caller.role === "employee" || caller.role === "team_lead")) {
        if (!caller.userId || !input.assigneeId || input.assigneeId !== caller.userId) {
          throw new Error("Employees can only assign tasks to themselves");
        }
        let currentAssignee: string | null = target?.assignee_id ?? null;
        if (!target && !isDemoModeEnabled()) {
          const { data: liveRow } = await (supabase as any)
            .from("tasks")
            .select("assignee_id")
            .eq("id", input.taskId)
            .maybeSingle();
          currentAssignee = liveRow?.assignee_id ?? null;
        }
        if (currentAssignee !== null && currentAssignee !== caller.userId) {
          throw new Error("Employees cannot reassign assigned tasks");
        }
      }

      if (target) {
        updateStoredTask({
          ...target,
          assignee_id: input.assigneeId || null,
        });
      }

      if (!isDemoModeEnabled()) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          const resp = await fetch(`/api/tasks/${input.taskId}/assign`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              assigneeId: input.assigneeId || null,
            }),
          });
          if (resp.status !== 404) {
            const json = await resp.json().catch(() => ({}));
            if (!resp.ok) {
              throw new Error(json?.error || "Failed to update task assignee");
            }
            return json;
          }
        }
      }

      return rpcCall("assign_task", {
        p_task_id: input.taskId,
        p_assignee_id: input.assigneeId || null,
      });
    },
    onSuccess: (_, vars) => {
      if (!vars.silent) {
        toast.success("Task assignment updated");
      }
      invalidateAll(vars.taskId);
      if (vars.assigneeId) {
        fetch("/api/tasks/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "assigned",
            taskId: vars.taskId,
            assigneeId: vars.assigneeId,
          }),
        }).catch(() => {});
      }
    },
    onError: (err: Error, vars, context: any) => {
      if (context?.previousData) {
        queryClient.setQueryData(["tasks-workspace"], context.previousData);
      }
      if (!vars.silent) {
        toast.error(err.message || "Failed to update task assignee");
      }
    },
  });

  const updateTaskStatus = useMutation({
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["tasks-workspace"] });
      const previousData = queryClient.getQueryData(["tasks-workspace"]);
      queryClient.setQueryData(["tasks-workspace"], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          tasks: (old.tasks || []).map((t: any) =>
            t.id === vars.taskId ? { ...t, status: vars.status } : t
          ),
        };
      });
      return { previousData };
    },
    mutationFn: async (input: {
      taskId: string;
      status: TaskStatus;
      note?: string;
      silent?: boolean;
    }) => {
      const current = isDemoModeEnabled() ? getStoredTasks() : [];
      const target = current.find((t) => t.id === input.taskId);
      if (target) {
        updateStoredTask({
          ...target,
          status: input.status,
          completed_at: input.status === "done" ? new Date().toISOString() : target.completed_at,
          cancelled_at: input.status === "cancelled" ? new Date().toISOString() : target.cancelled_at,
        });
      }
      if (input.status === "done") {
        return rpcCall("complete_task", {
          p_task_id: input.taskId,
          p_note: input.note || null,
        });
      }
      if (input.status === "cancelled") {
        return rpcCall("cancel_task", {
          p_task_id: input.taskId,
          p_reason: input.note || null,
        });
      }
      return rpcCall("update_task_status", {
        p_task_id: input.taskId,
        p_new_status: input.status,
        p_note: input.note || null,
      });
    },
    onSuccess: (_, vars) => {
      if (!vars.silent) {
        toast.success(`Task moved to ${vars.status.replace("_", " ")}`);
      }
      invalidateAll(vars.taskId);
      fetch("/api/tasks/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "status_changed",
          taskId: vars.taskId,
          newStatus: vars.status,
        }),
      }).catch(() => {});
    },
    onError: (err: Error, vars, context: any) => {
      if (context?.previousData) {
        queryClient.setQueryData(["tasks-workspace"], context.previousData);
      }
      if (!vars.silent) {
        toast.error(err.message || "Failed to update task status");
      }
    },
  });

  const updateTaskDueDate = useMutation({
    onMutate: async (vars: { taskId: string; dueDate: string | null; silent?: boolean }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks-workspace"] });
      const previousData = queryClient.getQueryData(["tasks-workspace"]);
      queryClient.setQueryData(["tasks-workspace"], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          tasks: (old.tasks || []).map((t: any) =>
            t.id === vars.taskId ? { ...t, due_date: vars.dueDate } : t
          ),
        };
      });
      return { previousData };
    },
    mutationFn: async (input: { taskId: string; dueDate: string | null; silent?: boolean }) => {
      const current = isDemoModeEnabled() ? getStoredTasks() : [];
      const target = current.find((t) => t.id === input.taskId);
      if (target) {
        updateStoredTask({
          ...target,
          due_date: input.dueDate,
        });
      }
      const { error } = await (supabase as any)
        .from("tasks")
        .update({ due_date: input.dueDate })
        .eq("id", input.taskId);
      if (error && !isDemoModeEnabled()) {
        throw new Error(error.message || "Failed to update due date");
      }
      return { success: true };
    },
    onSuccess: (_, vars) => {
      if (!vars.silent) {
        toast.success(vars.dueDate ? "Due date updated" : "Due date cleared");
      }
      invalidateAll(vars.taskId);
    },
    onError: (err: Error, vars, context: any) => {
      if (context?.previousData) {
        queryClient.setQueryData(["tasks-workspace"], context.previousData);
      }
      if (!vars.silent) {
        toast.error(err.message || "Failed to update due date");
      }
    },
  });

  const deleteTask = useMutation({
    mutationFn: async (input: string | { taskId: string; silent?: boolean }) => {
      await assertAdminRole();

      const taskId = typeof input === "string" ? input : input.taskId;
      if (isDemoModeEnabled()) {
        deleteStoredTask(taskId);
        return { success: true, deleted_task_id: taskId };
      }

      const result = await rpcCall("delete_task", { p_task_id: taskId });
      return result;
    },
    onSuccess: (_, vars) => {
      const silent = typeof vars === "object" && Boolean(vars.silent);
      if (!silent) {
        toast.success("Task permanently deleted");
      }
      invalidateAll();
    },
    onError: (err: Error, vars) => {
      const silent = typeof vars === "object" && Boolean(vars.silent);
      const isForbidden =
        err.message.includes("Only Admins") ||
        err.message.includes("Only administrators") ||
        err.message.includes("403 Forbidden");
      if (!silent || isForbidden) {
        toast.error(err.message || "Failed to delete task");
      }
    },
  });

  const addComment = useMutation({
    mutationFn: async (input: { taskId: string; body: string }) => {
      return rpcCall("add_task_comment", {
        p_task_id: input.taskId,
        p_body: input.body,
      });
    },
    onSuccess: (_, vars) => {
      toast.success("Comment posted");
      invalidateAll(vars.taskId);
      fetch("/api/tasks/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "comment",
          taskId: vars.taskId,
          commentText: vars.body,
        }),
      }).catch(() => {});
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to post comment");
    },
  });

  const logTime = useMutation({
    mutationFn: async (input: {
      taskId: string;
      workDate: string;
      minutes: number;
      note?: string;
    }) => {
      return rpcCall("log_task_time", {
        p_task_id: input.taskId,
        p_work_date: input.workDate,
        p_minutes: input.minutes,
        p_note: input.note || null,
      });
    },
    onSuccess: (_, vars) => {
      toast.success("Time logged");
      invalidateAll(vars.taskId);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to log time");
    },
  });

  const stopRecurrence = useMutation({
    mutationFn: async (recurrenceId: string) => {
      const res = await fetch(`/api/tasks/recurrences/${recurrenceId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to stop recurring schedule");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Recurring schedule stopped");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to stop recurrence");
    },
  });

  const linkTaskGoal = useMutation({
    mutationFn: async ({ taskId, goalId }: { taskId: string; goalId: string | null }) => {
      const { error } = await (supabase as any)
        .from("tasks")
        .update({ goal_id: goalId })
        .eq("id", taskId);
      if (error) throw new Error(error.message);
      return { taskId, goalId };
    },
    onSuccess: (_, vars) => {
      toast.success(vars.goalId ? "Task linked to goal" : "Task unlinked from goal");
      invalidateAll(vars.taskId);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update linked goal");
    },
  });

  return {
    createProject,
    deleteProject,
    createTask,
    assignTask,
    updateTaskStatus,
    updateTaskDueDate,
    deleteTask,
    addComment,
    logTime,
    stopRecurrence,
    linkTaskGoal,
  };
}

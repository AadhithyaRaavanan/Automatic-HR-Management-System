"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { TaskPriority, TaskStatus } from "@/types/database.types";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";
import {
  getStoredDepartments,
  getStoredProjects,
  getStoredTasks,
  getStoredUsers,
  addStoredProject,
  addStoredTask,
  updateStoredTask,
  deleteStoredTask,
} from "@/lib/storage/demo-store";

export interface ProjectRecord {
  id: string;
  organization_id: string;
  department_id: string | null;
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
  status: string;
  role?: string;
}

export interface DepartmentOption {
  id: string;
  name: string;
  code: string | null;
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
    if (typeof window === "undefined") return;
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
  }>({
    queryKey: ["tasks-workspace"],
    enabled,
    queryFn: async () => {
      let tasksData: any[] = [];
      let projectsData: any[] = [];
      let employeesData: any[] = [];
      let departmentsData: any[] = [];

      try {
        const [tasksRes, projectsRes, employeesRes, departmentsRes, membersRes] = await Promise.all([
          supabase
            .from("tasks")
            .select(
              "id, organization_id, project_id, parent_task_id, title, description, creator_id, assignee_id, status, priority, due_date, estimated_minutes, started_at, completed_at, cancelled_at, created_at, updated_at"
            )
            .order("created_at", { ascending: false }),
          supabase
            .from("projects")
            .select("id, organization_id, department_id, name, code, description, status, created_by, created_at")
            .order("name", { ascending: true }),
          supabase
            .from("employees")
            .select("id, full_name, email, manager_id, status")
            .eq("status", "active")
            .order("full_name", { ascending: true }),
          supabase
            .from("departments")
            .select("id, name, code")
            .order("name", { ascending: true }),
          supabase
            .from("organization_members")
            .select("user_id, role")
            .eq("status", "active"),
        ]);

        const roleMap = new Map<string, string>();
        if (membersRes?.data) {
          for (const m of (membersRes.data as any[])) {
            if (m?.user_id && m?.role) {
              roleMap.set(m.user_id, m.role);
            }
          }
        }

        if (tasksRes?.data) tasksData = tasksRes.data;
        if (projectsRes?.data) projectsData = projectsRes.data;
        if (employeesRes?.data) {
          employeesData = employeesRes.data.map((emp: any) => ({
            ...emp,
            role: roleMap.get(emp.id) || "employee",
          }));
        }
        if (departmentsRes?.data) departmentsData = departmentsRes.data;
      } catch {
        // Fallback gracefully
      }

      const storedDepts = getStoredDepartments();
      const storedProjects = getStoredProjects();
      const storedEmployees = getStoredUsers();
      const storedTasks = getStoredTasks();

      // Active departments (prioritizes user-created demo store to honor deletions)
      let mergedDepts: DepartmentOption[] = storedDepts.map((d) => ({ id: d.id, name: d.name, code: d.code }));
      if (!isDemoModeEnabled()) {
        for (const d of departmentsData) {
          if (!mergedDepts.some((md) => md.id === d.id || md.name === d.name)) {
            mergedDepts.push(d);
          }
        }
      }

      // Merge projects: database is authoritative in production
      const mergedProjects: ProjectRecord[] =
        !isDemoModeEnabled() && projectsData
          ? projectsData
          : [
              ...storedProjects.map((p) => ({
                id: p.id,
                organization_id: "",
                department_id: p.department_id || null,
                name: p.name,
                code: p.code,
                description: p.description || null,
                status: p.status || "active",
                created_by: "",
                created_at: p.created_at || new Date().toISOString(),
              })),
            ];

      // Visible employees: database is authoritative
      const mergedEmployees: VisibleEmployeeOption[] =
        employeesData && employeesData.length > 0
          ? employeesData
          : storedEmployees.map((u) => ({
              id: u.id,
              full_name: u.name,
              email: u.email,
              manager_id: null,
              status: u.status,
              role: u.role || "employee",
            }));

      // Merge tasks: database is authoritative in production
      const mergedTasks: TaskRecord[] =
        !isDemoModeEnabled() && tasksData
          ? tasksData
          : [
              ...storedTasks.map((t) => ({
                id: t.id,
                organization_id: "",
                project_id: t.project_id || null,
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

export function useTaskMutations() {
  const supabase = React.useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

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
      description?: string | null;
      code?: string | null;
    }) => {
      addStoredProject({
        name: input.name,
        department_id: input.departmentId || null,
        description: input.description || null,
        code: input.code || input.name.slice(0, 4).toUpperCase(),
      });
      return rpcCall("create_project", {
        p_name: input.name,
        p_department_id: input.departmentId || null,
        p_description: input.description || null,
        p_code: input.code || null,
      });
    },
    onSuccess: () => {
      toast.success("Project created");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create project");
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
      parentTaskId?: string | null;
      isSelfAssign?: boolean;
    }) => {
      const isSelf = Boolean(input.isSelfAssign);
      const initialStatus: TaskStatus = isSelf ? "in_progress" : "todo";

      addStoredTask({
        title: input.title,
        description: input.description || null,
        assignee_id: input.assigneeId || null,
        priority: input.priority || "medium",
        due_date: input.dueDate || null,
        estimated_minutes:
          typeof input.estimatedMinutes === "number" ? input.estimatedMinutes : null,
        project_id: input.projectId || null,
        parent_task_id: input.parentTaskId || null,
        status: initialStatus,
      });

      const res = (await rpcCall("create_task", {
        p_title: input.title,
        p_description: input.description || null,
        p_assignee_id: input.assigneeId || null,
        p_priority: input.priority || "medium",
        p_due_date: input.dueDate || null,
        p_estimated_minutes:
          typeof input.estimatedMinutes === "number" ? input.estimatedMinutes : null,
        p_project_id: input.projectId || null,
        p_parent_task_id: input.parentTaskId || null,
      })) as { success?: boolean; task?: { id?: string }; id?: string } | null;

      // If self-assigned, automatically advance status to in_progress!
      if (isSelf) {
        const createdTaskId = res?.task?.id || res?.id;
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

      return res;
    },
    onSuccess: () => {
      toast.success("Task created");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create task");
    },
  });

  const assignTask = useMutation({
    mutationFn: async (input: { taskId: string; assigneeId: string | null }) => {
      const current = getStoredTasks();
      const target = current.find((t) => t.id === input.taskId);
      if (target) {
        updateStoredTask({
          ...target,
          assignee_id: input.assigneeId || null,
        });
      }
      return rpcCall("assign_task", {
        p_task_id: input.taskId,
        p_assignee_id: input.assigneeId || null,
      });
    },
    onSuccess: (_, vars) => {
      toast.success("Task assignment updated");
      invalidateAll(vars.taskId);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update task assignee");
    },
  });

  const updateTaskStatus = useMutation({
    mutationFn: async (input: {
      taskId: string;
      status: TaskStatus;
      note?: string;
    }) => {
      const current = getStoredTasks();
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
      toast.success(`Task moved to ${vars.status.replace("_", " ")}`);
      invalidateAll(vars.taskId);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update task status");
    },
  });

  const deleteTask = useMutation({
    mutationFn: async (taskId: string) => {
      deleteStoredTask(taskId);
      try {
        await supabase.from("tasks").delete().eq("id", taskId);
      } catch {}
      return { success: true };
    },
    onSuccess: () => {
      toast.success("Task deleted");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete task");
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

  return {
    createProject,
    createTask,
    assignTask,
    updateTaskStatus,
    deleteTask,
    addComment,
    logTime,
  };
}

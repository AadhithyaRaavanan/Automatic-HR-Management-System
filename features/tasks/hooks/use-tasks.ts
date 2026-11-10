"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { TaskPriority, TaskStatus } from "@/types/database.types";
import { toast } from "sonner";

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
}

export interface DepartmentOption {
  id: string;
  name: string;
  code: string | null;
}

export type TaskDueState = "overdue" | "due_soon" | "upcoming" | "none";

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

  return useQuery<{
    tasks: TaskRecord[];
    projects: ProjectRecord[];
    employees: VisibleEmployeeOption[];
    departments: DepartmentOption[];
  }>({
    queryKey: ["tasks-workspace"],
    enabled,
    queryFn: async () => {
      const [tasksRes, projectsRes, employeesRes, departmentsRes] = await Promise.all([
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
      ]);

      if (tasksRes.error) throw tasksRes.error;

      return {
        tasks: (tasksRes.data || []) as TaskRecord[],
        projects: (projectsRes.data || []) as ProjectRecord[],
        employees: (employeesRes.data || []) as VisibleEmployeeOption[],
        departments: (departmentsRes.data || []) as DepartmentOption[],
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
    }) => {
      return rpcCall("create_task", {
        p_title: input.title,
        p_description: input.description || null,
        p_assignee_id: input.assigneeId || null,
        p_priority: input.priority || "medium",
        p_due_date: input.dueDate || null,
        p_estimated_minutes:
          typeof input.estimatedMinutes === "number" ? input.estimatedMinutes : null,
        p_project_id: input.projectId || null,
        p_parent_task_id: input.parentTaskId || null,
      });
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
    addComment,
    logTime,
  };
}

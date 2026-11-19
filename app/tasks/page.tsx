"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FEATURES } from "@/lib/features";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoCard } from "@/components/bento/bento-card";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import {
  useTasksData,
  useTaskDetails,
  useTaskMutations,
  getTaskDueState,
  formatEstimatedDuration,
  TaskRecord,
} from "@/features/tasks/hooks/use-tasks";
import { formatFriendlyDueState } from "@/lib/date/task-due";
import { TaskPriority, TaskStatus } from "@/types/database.types";
import { cn } from "@/lib/utils";
import {
  CheckSquare,
  Plus,
  LayoutGrid,
  List,
  Search,
  Clock,
  AlertTriangle,
  MessageSquare,
  FolderPlus,
  X,
  Calendar,
  Timer,
  History,
  Send,
  UserCheck,
} from "lucide-react";

const STATUS_COLUMNS: Array<{ key: TaskStatus; label: string; hint: string }> = [
  { key: "todo", label: "To Do", hint: "Queued work" },
  { key: "in_progress", label: "In Progress", hint: "Active execution" },
  { key: "blocked", label: "Blocked", hint: "Needs unblocking" },
  { key: "done", label: "Done", hint: "Completed" },
  { key: "cancelled", label: "Cancelled", hint: "Closed without delivery" },
];

const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "urgent"];

function DueBadge({
  dueDate,
  status,
}: {
  dueDate: string | null;
  status: TaskStatus;
}) {
  if (!dueDate) return null;
  const { label, state, colorClass } = formatFriendlyDueState(dueDate, status);
  if (!label || state === "none") return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]",
        colorClass
      )}
    >
      {state === "overdue" && <AlertTriangle className="w-3 h-3 shrink-0" />}
      {state === "due_today" && <Clock className="w-3 h-3 shrink-0" />}
      {state === "due_tomorrow" && <Clock className="w-3 h-3 shrink-0" />}
      {(state === "due_future" || state === "completed") && <Calendar className="w-3 h-3 shrink-0" />}
      <span>{label}</span>
    </span>
  );
}

function getInitials(name: string): string {
  if (!name || name === "Unassigned") return "—";
  if (name === "You") return "ME";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function TasksWorkspaceContent() {
  const { userId, userRole } = useAppSession();
  const { data, isLoading, refetch } = useTasksData(Boolean(userId));
  const mutations = useTaskMutations();

  const [viewMode, setViewMode] = React.useState<"board" | "list">("board");
  const [scope, setScope] = React.useState<"mine" | "team">(
    userRole === "employee" ? "mine" : "team"
  );
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [priorityFilter, setPriorityFilter] = React.useState<string>("all");
  const [dueFilter, setDueFilter] = React.useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = React.useState<string>("all");
  const [projectFilter, setProjectFilter] = React.useState<string>("all");

  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);
  const [createTaskOpen, setCreateTaskOpen] = React.useState(false);
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);

  // Create task form state
  const [newTitle, setNewTitle] = React.useState("");
  const [newDescription, setNewDescription] = React.useState("");
  const [newAssigneeId, setNewAssigneeId] = React.useState<string>("");
  const [newPriority, setNewPriority] = React.useState<TaskPriority>("medium");
  const [newDueDate, setNewDueDate] = React.useState<string>("");
  const [estHours, setEstHours] = React.useState<string>("");
  const [estMinutes, setEstMinutes] = React.useState<string>("");
  const [newProjectId, setNewProjectId] = React.useState<string>("");

  React.useEffect(() => {
    if (userId && !newAssigneeId) {
      setNewAssigneeId(userId);
    }
  }, [userId, newAssigneeId]);

  // Create project form state
  const [projName, setProjName] = React.useState("");
  const [projCode, setProjCode] = React.useState("");
  const [projDeptId, setProjDeptId] = React.useState("");
  const [projDesc, setProjDesc] = React.useState("");

  // Drawer interactions state
  const [commentBody, setCommentBody] = React.useState("");
  const [timeDate, setTimeDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [timeMinutes, setTimeMinutes] = React.useState("30");
  const [timeNote, setTimeNote] = React.useState("");
  const [cancelReason, setCancelReason] = React.useState("");

  // Open ?task=<id> from notification deep link
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const taskParam = params.get("task");
    if (taskParam) {
      setSelectedTaskId(taskParam);
    }
  }, []);

  React.useEffect(() => {
    if (userRole === "employee") {
      setScope("mine");
    } else if (userRole === "manager" || userRole === "hr" || userRole === "admin") {
      setScope("team");
    }
  }, [userRole]);

  const tasks = React.useMemo(() => data?.tasks || [], [data?.tasks]);
  const projects = React.useMemo(() => data?.projects || [], [data?.projects]);
  const employees = React.useMemo(() => data?.employees || [], [data?.employees]);
  const departments = React.useMemo(() => data?.departments || [], [data?.departments]);

  const employeeNameMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const emp of employees) {
      map.set(emp.id, emp.full_name || emp.email);
    }
    return map;
  }, [employees]);

  const projectNameMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      map.set(p.id, p.code ? `${p.code} · ${p.name}` : p.name);
    }
    return map;
  }, [projects]);

  const formatPerson = (id: string | null) => {
    if (!id) return "Unassigned";
    if (id === userId) return employeeNameMap.get(id) || "You";
    return employeeNameMap.get(id) || "Team Member";
  };

  // Permitted assignee choices for creating/reassigning tasks according to authority hierarchy
  const assignableEmployees = React.useMemo(() => {
    if (userRole === "admin") {
      // Admin has highest authority: can assign to Admin, HR, Manager, Employee
      return employees;
    }
    if (userRole === "hr") {
      // HR can assign to HR (self/peers), Manager, and Employee (cannot assign to admin)
      return employees.filter(
        (e) => e.id === userId || e.role === "employee" || e.role === "hr" || e.role === "manager"
      );
    }
    if (userRole === "manager") {
      // Manager can assign to Manager (self) and Employee (direct reports / employee)
      return employees.filter(
        (e) =>
          e.id === userId ||
          (e.role === "employee" && (!e.manager_id || e.manager_id === userId))
      );
    }
    // Employee can ONLY assign tasks to themselves (self-assignment)
    return employees.filter((e) => e.id === userId);
  }, [employees, userId, userRole]);

  const filteredTasks = React.useMemo(() => {
    return tasks.filter((t) => {
      if (scope === "mine" && userId) {
        if (t.assignee_id !== userId && t.creator_id !== userId) {
          return false;
        }
      }
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (projectFilter !== "all") {
        if (projectFilter === "none" && t.project_id !== null) return false;
        if (projectFilter !== "none" && t.project_id !== projectFilter) return false;
      }
      if (assigneeFilter !== "all") {
        if (assigneeFilter === "unassigned" && t.assignee_id !== null) return false;
        if (assigneeFilter !== "unassigned" && t.assignee_id !== assigneeFilter)
          return false;
      }
      if (dueFilter !== "all") {
        const dueState = getTaskDueState(t.due_date, t.status);
        if (dueFilter !== dueState) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${t.title} ${t.description || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    tasks,
    scope,
    userId,
    statusFilter,
    priorityFilter,
    projectFilter,
    assigneeFilter,
    dueFilter,
    searchQuery,
  ]);

  const summary = React.useMemo(() => {
    const scoped =
      scope === "mine" && userId
        ? tasks.filter((t) => t.assignee_id === userId || t.creator_id === userId)
        : tasks;
    let open = 0;
    let overdue = 0;
    let dueSoon = 0;
    let completed = 0;
    for (const t of scoped) {
      if (t.status === "done") {
        completed += 1;
      } else if (t.status !== "cancelled") {
        open += 1;
        const ds = getTaskDueState(t.due_date, t.status);
        if (ds === "overdue") overdue += 1;
        if (ds === "due_soon") dueSoon += 1;
      }
    }
    return { open, overdue, dueSoon, completed };
  }, [tasks, scope, userId]);

  const selectedTask = React.useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId]
  );

  const detailsQuery = useTaskDetails(selectedTask?.id || null);

  const totalLoggedMinutes = React.useMemo(() => {
    return (detailsQuery.data?.timeLogs || []).reduce(
      (sum, row) => sum + row.minutes,
      0
    );
  }, [detailsQuery.data?.timeLogs]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newTitle.trim().length < 2) return;
    const totalMinutes =
      (parseInt(estHours || "0", 10) * 60) + parseInt(estMinutes || "0", 10);
    const isSelf = Boolean(newAssigneeId && newAssigneeId === userId);

    try {
      await mutations.createTask.mutateAsync({
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        assigneeId: newAssigneeId || null,
        priority: newPriority,
        dueDate: newDueDate || null,
        estimatedMinutes: totalMinutes > 0 ? totalMinutes : null,
        projectId: newProjectId || null,
        isSelfAssign: isSelf,
      });
      setNewTitle("");
      setNewDescription("");
      setNewAssigneeId(userId || "");
      setNewPriority("medium");
      setNewDueDate("");
      setEstHours("");
      setEstMinutes("");
      setNewProjectId("");
      setCreateTaskOpen(false);
    } catch {
      // Toast handled in mutation onError
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (projName.trim().length < 2) return;
    try {
      await mutations.createProject.mutateAsync({
        name: projName.trim(),
        code: projCode.trim() || null,
        departmentId: projDeptId || null,
        description: projDesc.trim() || null,
      });
      setProjName("");
      setProjCode("");
      setProjDeptId("");
      setProjDesc("");
      setCreateProjectOpen(false);
    } catch {
      // Toast handled in mutation onError
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask || !commentBody.trim()) return;
    try {
      await mutations.addComment.mutateAsync({
        taskId: selectedTask.id,
        body: commentBody.trim(),
      });
      setCommentBody("");
    } catch {
      // Toast handled in mutation onError
    }
  };

  const handleLogTime = async (e: React.FormEvent) => {
    e.preventDefault();
    const mins = Number(timeMinutes);
    if (!selectedTask || !timeDate || !Number.isFinite(mins) || mins <= 0) return;
    try {
      await mutations.logTime.mutateAsync({
        taskId: selectedTask.id,
        workDate: timeDate,
        minutes: mins,
        note: timeNote.trim() || undefined,
      });
      setTimeNote("");
    } catch {
      // Toast handled in mutation onError
    }
  };

  const canManageProjects =
    userRole === "manager" || userRole === "hr" || userRole === "admin";

  const canReassignTask = (task: TaskRecord) => {
    if (task.status === "done" || task.status === "cancelled") return false;
    if (userRole === "admin") return true;
    if (userRole === "hr" || userRole === "manager") return true;
    return false; // Employees cannot reassign tasks to others
  };

  const canCancelTask = (task: TaskRecord) => {
    if (task.status === "cancelled" || task.status === "done") return false;
    if (userRole === "manager" || userRole === "hr" || userRole === "admin") {
      return true;
    }
    return task.creator_id === userId;
  };

  const canReopenTask = (task: TaskRecord) => {
    if (task.status !== "done") return false;
    if (userRole === "manager" || userRole === "hr" || userRole === "admin") {
      return true;
    }
    return task.creator_id === userId;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight flex items-center gap-2.5">
            <CheckSquare className="w-7 h-7 text-brand-purple" />
            <span>Tasks &amp; Team Work</span>
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Organize sprint deliverables, track due dates, log effort hours, and monitor team execution.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageProjects && (
            <button
              type="button"
              onClick={() => setCreateProjectOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary transition-colors cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5 text-brand-purple" />
              <span>New Project</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setCreateTaskOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-medium transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New task</span>
          </button>
        </div>
      </section>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <BentoCard title="Open tasks" className="py-4">
          <div className="text-2xl font-semibold text-text-primary tabular-nums">{summary.open}</div>
          <p className="text-xs text-text-tertiary mt-1">
            To do, in progress, or blocked
          </p>
        </BentoCard>
        <BentoCard title="Overdue" className="py-4">
          <div className="text-2xl font-semibold text-status-danger-text tabular-nums">
            {summary.overdue}
          </div>
          <p className="text-xs text-text-tertiary mt-1">Past target due date</p>
        </BentoCard>
        <BentoCard title="Due soon" className="py-4">
          <div className="text-2xl font-semibold text-status-warning-text tabular-nums">
            {summary.dueSoon}
          </div>
          <p className="text-xs text-text-tertiary mt-1">Due today or tomorrow</p>
        </BentoCard>
        <BentoCard title="Completed" className="py-4">
          <div className="text-2xl font-semibold text-status-success-text tabular-nums">
            {summary.completed}
          </div>
          <p className="text-xs text-text-tertiary mt-1">Delivered tasks</p>
        </BentoCard>
      </div>

      {/* Controls & Filters */}
      <div data-tour="tasks-board" className="bg-card rounded-xl p-4 border border-border-light space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Scope Toggle for Manager/HR/Admin */}
            {userRole !== "employee" && (
              <div className="inline-flex rounded-lg bg-card p-1 border border-border-light">
                <button
                  type="button"
                  onClick={() => setScope("mine")}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer",
                    scope === "mine"
                      ? "bg-brand-purple text-white"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  My tasks
                </button>
                <button
                  type="button"
                  onClick={() => setScope("team")}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer",
                    scope === "team"
                      ? "bg-brand-purple text-white"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  {userRole === "manager" ? "Team tasks" : "All org tasks"}
                </button>
              </div>
            )}

            {/* Board / List Toggle */}
            <div className="inline-flex rounded-full bg-card-subtle p-1 border border-border-light">
              <button
                type="button"
                onClick={() => setViewMode("board")}
                aria-label="Board view"
                className={cn(
                  "inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold transition-colors cursor-pointer",
                  viewMode === "board"
                    ? "bg-brand-navy text-white"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Board</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-label="List view"
                className={cn(
                  "inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold transition-colors cursor-pointer",
                  viewMode === "list"
                    ? "bg-brand-navy text-white"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <List className="w-3.5 h-3.5" />
                <span>List</span>
              </button>
            </div>
          </div>

          <div className="relative w-full lg:w-72">
            <Search className="w-4 h-4 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search task title or description..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand-purple"
            />
          </div>
        </div>

        {/* Filter dropdowns */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-1">
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
          >
            <option value="all">All Statuses</option>
            {STATUS_COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
          >
            <option value="all">All Priorities</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                Priority: {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by due state"
            value={dueFilter}
            onChange={(e) => setDueFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
          >
            <option value="all">All Due Dates</option>
            <option value="overdue">Overdue Only</option>
            <option value="due_soon">Due Soon (Today / Tomorrow)</option>
            <option value="upcoming">Upcoming</option>
            <option value="none">No Due Date</option>
          </select>

          <select
            aria-label="Filter by assignee"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
          >
            <option value="all">All Assignees</option>
            <option value="unassigned">Unassigned</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.full_name || emp.email}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by project"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
          >
            <option value="all">All Projects</option>
            <option value="none">No Project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code ? `${p.code} · ${p.name}` : p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-52 rounded-[24px] bg-card animate-pulse border border-border-light"
            />
          ))}
        </div>
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          icon={<CheckSquare className="w-6 h-6" />}
          title="No tasks match your view"
          description="Create a task to get started, or clear active status, priority, and due date filters."
          action={
            <button
              type="button"
              onClick={() => setCreateTaskOpen(true)}
              className="px-4 py-2 rounded-full bg-brand-purple text-white text-xs font-bold cursor-pointer"
            >
              Create First Task
            </button>
          }
        />
      ) : viewMode === "board" ? (
        <div className="grid grid-cols-5 gap-4 items-start">
          {STATUS_COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.key);
            return (
              <div
                key={col.key}
                className="flex flex-col min-h-[220px] max-h-[calc(100vh-220px)] rounded-[24px] bg-card-subtle/70 border border-border-light p-3.5 space-y-3"
              >
                <div className="flex items-center justify-between px-1 shrink-0">
                  <div>
                    <h2 className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
                      {col.label}
                    </h2>
                    <p className="text-[10px] text-text-tertiary">{col.hint}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-card border border-border-light text-text-secondary">
                    {colTasks.length}
                  </span>
                </div>

                <div className="overflow-y-auto space-y-2 pr-1 max-h-[calc(100vh-310px)] min-h-0">
                  {colTasks.length > 0 ? (
                    colTasks.map((task) => {
                      const assigneeName = formatPerson(task.assignee_id);
                      const initials = getInitials(assigneeName);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => setSelectedTaskId(task.id)}
                          className="w-full text-left p-3 rounded-2xl bg-card hover:border-brand-purple/60 hover:shadow-card-hover border border-border-light shadow-xs transition-all cursor-pointer space-y-2 focus-visible:ring-2 focus-visible:ring-brand-purple focus-visible:outline-none"
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <StatusPill status={task.priority} showIcon={false} />
                            {task.project_id && projectNameMap.has(task.project_id) && (
                              <span className="text-[10px] font-bold text-brand-purple truncate max-w-[110px]">
                                {projectNameMap.get(task.project_id)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-bold text-text-primary line-clamp-2 leading-snug">
                            {task.title}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <DueBadge dueDate={task.due_date} status={task.status} />
                            {task.assignee_id && task.creator_id === task.assignee_id && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-purple/10 text-brand-purple border border-brand-purple/20">
                                <UserCheck className="w-2.5 h-2.5" />
                                Self-Assigned
                              </span>
                            )}
                            {task.assignee_id && task.creator_id !== task.assignee_id && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-card-subtle text-text-tertiary">
                                From: {formatPerson(task.creator_id)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between pt-1.5 border-t border-border-light/60 text-[11px] text-text-tertiary gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="w-5 h-5 rounded-full bg-brand-purple/10 text-brand-purple font-bold text-[9px] flex items-center justify-center shrink-0">
                                {initials}
                              </span>
                              <span className="truncate font-medium text-text-secondary">
                                {assigneeName}
                              </span>
                            </div>
                            {task.estimated_minutes != null && (
                              <span className="font-mono font-bold text-brand-purple shrink-0 tabular-nums text-[10px]">
                                {formatEstimatedDuration(task.estimated_minutes)} est
                              </span>
                            )}
                          </div>

                          {/* Subordinate Accept Task Action */}
                          {task.status === "todo" && task.assignee_id === userId && task.creator_id !== userId && (
                            <div className="pt-1">
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  mutations.updateTaskStatus.mutate({
                                    taskId: task.id,
                                    status: "in_progress",
                                    note: "Accepted assigned task",
                                  });
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.stopPropagation();
                                    mutations.updateTaskStatus.mutate({
                                      taskId: task.id,
                                      status: "in_progress",
                                      note: "Accepted assigned task",
                                    });
                                  }
                                }}
                                className="w-full flex items-center justify-center gap-1 py-1.5 px-3 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-[11px] font-bold transition-all shadow-xs cursor-pointer"
                              >
                                <span>✓ Accept Task</span>
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <div className="py-6 px-3 text-center rounded-2xl border border-dashed border-border-light text-[11px] text-text-tertiary">
                      No tasks in {col.label}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-card rounded-[24px] border border-border-light shadow-card overflow-x-auto max-h-[calc(100vh-240px)] overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-card/95 backdrop-blur-xs z-10">
              <tr className="border-b border-border-light bg-card-subtle/80 text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                <th className="py-3 px-4">Task</th>
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">Assignee</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light/60 text-xs">
              {filteredTasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className="hover:bg-card-subtle/50 cursor-pointer transition-colors"
                >
                  <td className="py-3 px-4 font-bold text-text-primary">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>{task.title}</span>
                      {task.assignee_id && task.creator_id === task.assignee_id && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-brand-purple/10 text-brand-purple border border-brand-purple/20">
                          Self-Assigned
                        </span>
                      )}
                    </div>
                    {task.description && (
                      <div className="text-[11px] font-normal text-text-tertiary line-clamp-1">
                        {task.description}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-text-secondary">
                    {task.project_id ? projectNameMap.get(task.project_id) || "Project" : "—"}
                  </td>
                  <td className="py-3 px-4 text-text-primary">
                    <div className="font-semibold">{formatPerson(task.assignee_id)}</div>
                    {task.estimated_minutes != null && (
                      <div className="text-[10px] font-mono font-bold text-brand-purple">
                        {formatEstimatedDuration(task.estimated_minutes)} est
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <StatusPill status={task.priority} />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <StatusPill status={task.status} />
                      {task.status === "todo" && task.assignee_id === userId && task.creator_id !== userId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            mutations.updateTaskStatus.mutate({
                              taskId: task.id,
                              status: "in_progress",
                              note: "Accepted assigned task",
                            });
                          }}
                          className="px-2 py-0.5 rounded-lg bg-brand-purple hover:bg-brand-purple-hover text-white text-[10px] font-bold cursor-pointer"
                        >
                          Accept
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {task.due_date ? (
                      <DueBadge dueDate={task.due_date} status={task.status} />
                    ) : (
                      <span className="text-text-tertiary">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Task Modal */}
      {createTaskOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateTaskOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-task-title"
            className="w-full max-w-lg bg-card rounded-[28px] border border-border-light shadow-shell p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 id="create-task-title" className="text-base font-extrabold text-text-primary">
                Create New Task
              </h2>
              <button
                type="button"
                aria-label="Close create task dialog"
                onClick={() => setCreateTaskOpen(false)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                  Title *
                </label>
                <input
                  required
                  minLength={2}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g., Audit Q4 payroll shifts"
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Acceptance criteria and notes..."
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                    Assignee
                  </label>
                  <select
                    aria-label="Task Assignee"
                    value={newAssigneeId}
                    onChange={(e) => setNewAssigneeId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                  >
                    <option value="">Unassigned</option>
                    {assignableEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name || emp.email} {emp.id === userId ? "(You — Self-Assign)" : ""}
                      </option>
                    ))}
                  </select>

                  {/* Assignee Guidance Badge */}
                  {newAssigneeId && newAssigneeId === userId && (
                    <div className="mt-2 flex items-center gap-2 p-2.5 rounded-xl bg-brand-purple/10 border border-brand-purple/20 text-brand-purple text-[11px] font-bold">
                      <UserCheck className="w-4 h-4 shrink-0" />
                      <span>Self-Assignment: Automatically accepted and placed in <strong>In Progress</strong> immediately.</span>
                    </div>
                  )}
                  {newAssigneeId && newAssigneeId !== userId && (
                    <div className="mt-2 flex items-center gap-2 p-2.5 rounded-xl bg-card-subtle border border-border-light text-text-secondary text-[11px]">
                      <Clock className="w-4 h-4 shrink-0 text-text-tertiary" />
                      <span>Delegating to <strong>{employeeNameMap.get(newAssigneeId) || "team member"}</strong>. Will start in <strong>To Do</strong> awaiting their acceptance.</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                    Priority
                  </label>
                  <select
                    aria-label="Task Priority"
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    aria-label="Due Date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                  />
                </div>

                {/* Duration Picker: Hours and Minutes */}
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-bold uppercase text-text-secondary flex items-center gap-1.5">
                      <Timer className="w-3.5 h-3.5 text-brand-purple" />
                      Estimated Duration
                    </label>
                    {((parseInt(estHours || "0", 10) * 60) + parseInt(estMinutes || "0", 10)) > 0 && (
                      <span className="text-[11px] font-mono font-bold text-brand-purple">
                        Total: {formatEstimatedDuration((parseInt(estHours || "0", 10) * 60) + parseInt(estMinutes || "0", 10))} ({(parseInt(estHours || "0", 10) * 60) + parseInt(estMinutes || "0", 10)} mins)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 flex-1 bg-card-subtle border border-border-light rounded-xl px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        aria-label="Estimated hours"
                        value={estHours}
                        onChange={(e) => setEstHours(e.target.value)}
                        placeholder="0"
                        className="w-16 bg-transparent text-xs font-bold text-text-primary focus:outline-hidden"
                      />
                      <span className="text-xs font-semibold text-text-tertiary">hrs</span>
                    </div>

                    <div className="flex items-center gap-1.5 flex-1 bg-card-subtle border border-border-light rounded-xl px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        max={59}
                        aria-label="Estimated minutes"
                        value={estMinutes}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "" || (parseInt(val, 10) >= 0 && parseInt(val, 10) < 60)) {
                            setEstMinutes(val);
                          }
                        }}
                        placeholder="0"
                        className="w-16 bg-transparent text-xs font-bold text-text-primary focus:outline-hidden"
                      />
                      <span className="text-xs font-semibold text-text-tertiary">mins</span>
                    </div>

                    {(estHours || estMinutes) && (
                      <button
                        type="button"
                        onClick={() => {
                          setEstHours("");
                          setEstMinutes("");
                        }}
                        className="px-2.5 py-1.5 text-text-tertiary hover:text-text-primary text-[11px] font-bold cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {/* Preset chips */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="text-[10px] font-bold uppercase text-text-tertiary mr-1">Presets:</span>
                    {[
                      { label: "30m", h: "", m: "30" },
                      { label: "1h", h: "1", m: "" },
                      { label: "2h", h: "2", m: "" },
                      { label: "4h (Half Day)", h: "4", m: "" },
                      { label: "8h (Full Day)", h: "8", m: "" },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setEstHours(preset.h);
                          setEstMinutes(preset.m);
                        }}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors border bg-card-subtle hover:bg-card-subtle/80 text-text-secondary border-border-light hover:border-brand-purple/40"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {projects.length > 0 && (
                <div>
                  <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                    Project (Optional)
                  </label>
                  <select
                    aria-label="Task Project"
                    value={newProjectId}
                    onChange={(e) => setNewProjectId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                  >
                    <option value="">No Project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code ? `${p.code} · ${p.name}` : p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateTaskOpen(false)}
                  className="px-4 py-2 rounded-full bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutations.createTask.isPending}
                  className="px-5 py-2 rounded-full bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  {mutations.createTask.isPending ? "Creating..." : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Project Modal */}
      {createProjectOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateProjectOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-title"
            className="w-full max-w-md bg-card rounded-[28px] border border-border-light shadow-shell p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 id="create-project-title" className="text-base font-extrabold text-text-primary">
                Create Project Grouping
              </h2>
              <button
                type="button"
                aria-label="Close project modal"
                onClick={() => setCreateProjectOpen(false)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                  Project Name *
                </label>
                <input
                  required
                  minLength={2}
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  placeholder="e.g., Q4 Compliance"
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                    Code
                  </label>
                  <input
                    value={projCode}
                    onChange={(e) => setProjCode(e.target.value)}
                    placeholder="COMP-Q4"
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                    Department
                  </label>
                  <select
                    value={projDeptId}
                    onChange={(e) => setProjDeptId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                  >
                    <option value="">Organization-wide</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateProjectOpen(false)}
                  className="px-4 py-2 rounded-full bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutations.createProject.isPending}
                  className="px-5 py-2 rounded-full bg-brand-purple text-white text-xs font-bold cursor-pointer"
                >
                  {mutations.createProject.isPending ? "Saving..." : "Save Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Task Slide-Over Drawer */}
      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedTaskId(null);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Task Details"
            className="w-full max-w-xl bg-card h-full overflow-y-auto border-l border-border-light shadow-shell p-6 space-y-6"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-border-light">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={selectedTask.status} />
                  <StatusPill status={selectedTask.priority} />
                  <DueBadge
                    dueDate={selectedTask.due_date}
                    status={selectedTask.status}
                  />
                </div>
                <h2 className="text-lg font-extrabold text-text-primary">
                  {selectedTask.title}
                </h2>
                {selectedTask.project_id && (
                  <p className="text-xs font-semibold text-brand-purple">
                    Project: {projectNameMap.get(selectedTask.project_id) || "Assigned Project"}
                  </p>
                )}
              </div>

              <button
                type="button"
                aria-label="Close task drawer"
                onClick={() => setSelectedTaskId(null)}
                className="p-2 rounded-xl text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedTask.description && (
              <div className="p-3.5 rounded-2xl bg-card-subtle border border-border-light text-xs text-text-secondary leading-relaxed">
                {selectedTask.description}
              </div>
            )}

            {/* Status & Assignment Controls */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {selectedTask.status === "todo" && (
                  <button
                    type="button"
                    disabled={mutations.updateTaskStatus.isPending}
                    onClick={() =>
                      mutations.updateTaskStatus.mutate({
                        taskId: selectedTask.id,
                        status: "in_progress",
                        note: selectedTask.assignee_id === userId && selectedTask.creator_id !== userId ? "Accepted assigned task" : undefined,
                      })
                    }
                    className="px-3.5 py-1.5 rounded-full bg-brand-purple text-white text-xs font-bold cursor-pointer"
                  >
                    {selectedTask.assignee_id === userId && selectedTask.creator_id !== userId
                      ? "✓ Accept Task & Start Progress"
                      : "Start Progress"}
                  </button>
                )}

                {selectedTask.status === "in_progress" && (
                  <>
                    <button
                      type="button"
                      disabled={mutations.updateTaskStatus.isPending}
                      onClick={() =>
                        mutations.updateTaskStatus.mutate({
                          taskId: selectedTask.id,
                          status: "done",
                        })
                      }
                      className="px-3.5 py-1.5 rounded-full bg-status-success-dot text-white text-xs font-bold cursor-pointer"
                    >
                      Mark Complete
                    </button>
                    <button
                      type="button"
                      disabled={mutations.updateTaskStatus.isPending}
                      onClick={() =>
                        mutations.updateTaskStatus.mutate({
                          taskId: selectedTask.id,
                          status: "blocked",
                        })
                      }
                      className="px-3.5 py-1.5 rounded-full bg-status-warning-bg text-status-warning-text text-xs font-bold cursor-pointer"
                    >
                      Mark Blocked
                    </button>
                  </>
                )}

                {selectedTask.status === "blocked" && (
                  <button
                    type="button"
                    disabled={mutations.updateTaskStatus.isPending}
                    onClick={() =>
                      mutations.updateTaskStatus.mutate({
                        taskId: selectedTask.id,
                        status: "in_progress",
                      })
                    }
                    className="px-3.5 py-1.5 rounded-full bg-brand-purple text-white text-xs font-bold cursor-pointer"
                  >
                    Resume Progress
                  </button>
                )}

                {selectedTask.status === "todo" && (
                  <button
                    type="button"
                    disabled={mutations.updateTaskStatus.isPending}
                    onClick={() =>
                      mutations.updateTaskStatus.mutate({
                        taskId: selectedTask.id,
                        status: "done",
                      })
                    }
                    className="px-3.5 py-1.5 rounded-full bg-status-success-dot text-white text-xs font-bold cursor-pointer"
                  >
                    Complete Task
                  </button>
                )}

                {canReopenTask(selectedTask) && (
                  <button
                    type="button"
                    disabled={mutations.updateTaskStatus.isPending}
                    onClick={() =>
                      mutations.updateTaskStatus.mutate({
                        taskId: selectedTask.id,
                        status: "in_progress",
                        note: "Reopened from drawer",
                      })
                    }
                    className="px-3.5 py-1.5 rounded-full bg-card-subtle border border-border-light text-xs font-bold text-text-primary cursor-pointer"
                  >
                    Reopen
                  </button>
                )}
              </div>

              {/* Assignee Control */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 rounded-2xl bg-card-subtle border border-border-light">
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-brand-purple" />
                    <span className="font-bold text-text-secondary">Assignee:</span>
                    <span className="font-extrabold text-text-primary">
                      {formatPerson(selectedTask.assignee_id)}
                    </span>
                  </div>
                  {selectedTask.assignee_id && selectedTask.creator_id === selectedTask.assignee_id && (
                    <span className="text-[10px] font-bold text-brand-purple ml-6">
                      • Self-Assigned
                    </span>
                  )}
                  {selectedTask.assignee_id && selectedTask.creator_id !== selectedTask.assignee_id && (
                    <span className="text-[10px] text-text-tertiary ml-6">
                      • Assigned by {formatPerson(selectedTask.creator_id)}
                    </span>
                  )}
                </div>

                {canReassignTask(selectedTask) && (
                  <select
                    aria-label="Reassign task"
                    value={selectedTask.assignee_id || ""}
                    onChange={(e) =>
                      mutations.assignTask.mutate({
                        taskId: selectedTask.id,
                        assigneeId: e.target.value || null,
                      })
                    }
                    className="px-3 py-1.5 rounded-xl bg-card border border-border-light text-xs font-semibold text-text-primary"
                  >
                    <option value="">Unassigned</option>
                    {assignableEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name || emp.email}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {canCancelTask(selectedTask) && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Optional cancellation reason..."
                    className="flex-1 px-3 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                  />
                  <button
                    type="button"
                    disabled={mutations.updateTaskStatus.isPending}
                    onClick={async () => {
                      await mutations.updateTaskStatus.mutateAsync({
                        taskId: selectedTask.id,
                        status: "cancelled",
                        note: cancelReason.trim() || undefined,
                      });
                      setCancelReason("");
                    }}
                    className="px-3 py-1.5 rounded-xl bg-status-danger-bg text-status-danger-text text-xs font-bold cursor-pointer"
                  >
                    Cancel Task
                  </button>
                </div>
              )}
            </div>

            {/* Manual Time Logs */}
            <section className="space-y-3 pt-2 border-t border-border-light">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-text-primary flex items-center gap-1.5">
                  <Timer className="w-4 h-4 text-brand-purple" />
                  <span>Time Logs</span>
                </h3>
                <span className="text-[11px] font-mono text-text-secondary">
                  {totalLoggedMinutes}m logged
                  {selectedTask.estimated_minutes != null
                    ? ` / ${formatEstimatedDuration(selectedTask.estimated_minutes)} est`
                    : ""}
                </span>
              </div>

              {selectedTask.status !== "cancelled" && (
                <form
                  onSubmit={handleLogTime}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2"
                >
                  <input
                    type="date"
                    aria-label="Time log work date"
                    value={timeDate}
                    onChange={(e) => setTimeDate(e.target.value)}
                    className="sm:col-span-4 px-2.5 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs"
                  />
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    aria-label="Time log minutes"
                    value={timeMinutes}
                    onChange={(e) => setTimeMinutes(e.target.value)}
                    className="sm:col-span-2 px-2.5 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs"
                  />
                  <input
                    type="text"
                    aria-label="Time log note"
                    value={timeNote}
                    onChange={(e) => setTimeNote(e.target.value)}
                    placeholder="Work note..."
                    className="sm:col-span-4 px-2.5 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs"
                  />
                  <button
                    type="submit"
                    disabled={mutations.logTime.isPending}
                    className="sm:col-span-2 px-3 py-1.5 rounded-xl bg-brand-navy text-white text-xs font-bold cursor-pointer"
                  >
                    Log
                  </button>
                </form>
              )}

              <div className="space-y-1.5">
                {(detailsQuery.data?.timeLogs || []).length > 0 ? (
                  detailsQuery.data!.timeLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs"
                    >
                      <div>
                        <span className="font-bold text-text-primary">
                          {formatPerson(log.employee_id)}
                        </span>
                        <span className="text-text-tertiary ml-2 font-mono">
                          {log.work_date}
                        </span>
                        {log.note && (
                          <p className="text-[11px] text-text-secondary mt-0.5">
                            {log.note}
                          </p>
                        )}
                      </div>
                      <span className="font-mono font-bold text-brand-purple">
                        {log.minutes}m
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-text-tertiary">
                    No manual time entries logged for this task yet.
                  </p>
                )}
              </div>
            </section>

            {/* Comments */}
            <section className="space-y-3 pt-2 border-t border-border-light">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-text-primary flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-brand-purple" />
                <span>Comments ({detailsQuery.data?.comments.length || 0})</span>
              </h3>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {(detailsQuery.data?.comments || []).length > 0 ? (
                  detailsQuery.data!.comments.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 rounded-2xl bg-card-subtle border border-border-light text-xs"
                    >
                      <div className="flex items-center justify-between text-[11px] text-text-tertiary mb-1">
                        <span className="font-bold text-text-primary">
                          {formatPerson(c.author_id)}
                        </span>
                        <span>{new Date(c.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-text-secondary whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-text-tertiary">
                    No comments yet. Add an update below.
                  </p>
                )}
              </div>

              <form onSubmit={handleAddComment} className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label="Task comment"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Write a comment or status update..."
                  className="flex-1 px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
                <button
                  type="submit"
                  aria-label="Send comment"
                  disabled={mutations.addComment.isPending || !commentBody.trim()}
                  className="p-2 rounded-xl bg-brand-purple text-white cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </section>

            {/* Status & Activity History */}
            <section className="space-y-2 pt-2 border-t border-border-light">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-text-primary flex items-center gap-1.5">
                <History className="w-4 h-4 text-brand-purple" />
                <span>Activity Timeline</span>
              </h3>
              <div className="space-y-1.5">
                {(detailsQuery.data?.events || []).map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-center justify-between text-[11px] px-3 py-1.5 rounded-xl bg-card-subtle/60 border border-border-light/60"
                  >
                    <span className="text-text-secondary">
                      <strong className="text-text-primary">
                        {formatPerson(ev.actor_id)}
                      </strong>{" "}
                      {ev.event_type.replace("_", " ")}
                      {ev.from_status && ev.to_status
                        ? ` (${ev.from_status} -> ${ev.to_status})`
                        : ev.to_status
                        ? ` (${ev.to_status})`
                        : ""}
                    </span>
                    <span className="text-text-tertiary font-mono">
                      {new Date(ev.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

export default function TasksPage() {
  const router = useRouter();

  React.useEffect(() => {
    if (!FEATURES.TASKS) {
      router.replace("/dashboard");
    }
  }, [router]);

  if (!FEATURES.TASKS) {
    return null;
  }

  return (
    <AppShell>
      <TasksWorkspaceContent />
    </AppShell>
  );
}


"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FEATURES } from "@/lib/features";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
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
import { TaskType, TaskRecurrence } from "@/lib/tasks/types";
import { calculateWorkingDaysAhead } from "@/lib/date/working-days";
import { createClient } from "@/lib/supabase/client";
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
  Repeat,
  Sparkles,
  Layers,
  ArrowRight,
} from "lucide-react";

const STATUS_COLUMNS: Array<{ key: TaskStatus; label: string; hint: string }> = [
  { key: "todo", label: "To Do", hint: "Queued work" },
  { key: "in_progress", label: "In Progress", hint: "Active execution" },
  { key: "blocked", label: "Blocked", hint: "Needs unblocking" },
  { key: "done", label: "Done", hint: "Completed" },
  { key: "cancelled", label: "Cancelled", hint: "Closed without delivery" },
];

const PRIORITY_OPTIONS: TaskPriority[] = ["urgent", "high", "medium", "low"];

function DueBadge({
  dueDate,
  status,
}: {
  dueDate: string | null;
  status: TaskStatus;
}) {
  const info = formatFriendlyDueState(dueDate, status);
  if (!info.label) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap",
        info.colorClass
      )}
    >
      <Clock className="w-3 h-3" />
      <span>{info.label}</span>
    </span>
  );
}

function TaskTypeBadge({ typeName }: { typeName: string | null | undefined }) {
  if (!typeName) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#F5F5F5] border border-[#E6E6E6] text-black">
      {typeName}
    </span>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "??";
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
  const [typeFilter, setTypeFilter] = React.useState<string>("all");
  const [recurringFilter, setRecurringFilter] = React.useState<string>("all");

  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);
  const [createTaskOpen, setCreateTaskOpen] = React.useState(false);
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);

  // Active Holidays for working day calculation
  const [holidays, setHolidays] = React.useState<Array<{ date: string }>>([]);
  React.useEffect(() => {
    const supabase = createClient();
    supabase
      .from("holidays")
      .select("date")
      .eq("is_active", true)
      .then(({ data }) => {
        if (data) setHolidays(data);
      });
  }, []);

  // Create task form state
  const [selectedTypeId, setSelectedTypeId] = React.useState<string>("");
  const [newTitle, setNewTitle] = React.useState("");
  const [newDescription, setNewDescription] = React.useState("");
  const [newAssigneeId, setNewAssigneeId] = React.useState<string>("");
  const [newPriority, setNewPriority] = React.useState<TaskPriority>("medium");
  const [newDueDate, setNewDueDate] = React.useState<string>("");
  const [suggestedDueText, setSuggestedDueText] = React.useState<string>("");
  const [autoDueSuggested, setAutoDueSuggested] = React.useState<boolean>(false);
  const [estHours, setEstHours] = React.useState<string>("");
  const [estMinutes, setEstMinutes] = React.useState<string>("");
  const [newProjectId, setNewProjectId] = React.useState<string>("");
  const [selectedChecklist, setSelectedChecklist] = React.useState<string[]>([]);

  // Recurrence form state
  const [isRepeating, setIsRepeating] = React.useState<boolean>(false);
  const [repeatFrequency, setRepeatFrequency] = React.useState<"daily" | "weekly" | "monthly" | "every_n_working_days">("weekly");
  const [repeatInterval, setRepeatInterval] = React.useState<number>(1);
  const [repeatWeekday, setRepeatWeekday] = React.useState<number>(1);
  const [repeatDayOfMonth, setRepeatDayOfMonth] = React.useState<number>(1);
  const [repeatEndDate, setRepeatEndDate] = React.useState<string>("");

  // Edit tracking: only fields the user hasn't edited yet are filled by Type selection
  const editedFields = React.useRef<Set<string>>(new Set());

  // Log Time on Task Completion Prompt State
  const [logTimePromptTask, setLogTimePromptTask] = React.useState<TaskRecord | null>(null);
  const [logTimeMinutes, setLogTimeMinutes] = React.useState<string>("60");
  const [logTimeNote, setLogTimeNote] = React.useState<string>("");

  // Blocked Reason Inline Prompt State
  const [blockingTaskId, setBlockingTaskId] = React.useState<string | null>(null);
  const [blockingReason, setBlockingReason] = React.useState<string>("");

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
  const taskTypes = React.useMemo(() => data?.taskTypes || [], [data?.taskTypes]);
  const recurrences = React.useMemo(() => data?.recurrences || [], [data?.recurrences]);

  const employeeNameMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const emp of employees) {
      map.set(emp.id, emp.full_name || emp.email);
    }
    return map;
  }, [employees]);

  const typeNameMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const tt of taskTypes) {
      map.set(tt.id, tt.name);
    }
    return map;
  }, [taskTypes]);

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
      return employees;
    }
    if (userRole === "hr") {
      return employees.filter(
        (e) => e.id === userId || e.role === "employee" || e.role === "hr" || e.role === "manager"
      );
    }
    if (userRole === "manager") {
      return employees.filter(
        (e) =>
          e.id === userId ||
          (e.role === "employee" && (!e.manager_id || e.manager_id === userId))
      );
    }
    return employees.filter((e) => e.id === userId);
  }, [employees, userId, userRole]);

  // Workload calculations: open tasks and due this week
  const isDueThisWeek = React.useCallback((dueDateStr: string | null) => {
    if (!dueDateStr) return false;
    const now = new Date();
    const day = now.getDay();
    const diffToMon = (day + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMon);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const monStr = monday.toISOString().slice(0, 10);
    const sunStr = sunday.toISOString().slice(0, 10);
    const cleanDue = dueDateStr.slice(0, 10);
    return cleanDue >= monStr && cleanDue <= sunStr;
  }, []);

  const workloadMap = React.useMemo(() => {
    const map = new Map<string, { openCount: number; dueThisWeekCount: number }>();
    for (const emp of employees) {
      const empTasks = tasks.filter(
        (t) => t.assignee_id === emp.id && ["todo", "in_progress", "blocked"].includes(t.status)
      );
      const openCount = empTasks.length;
      const dueThisWeekCount = empTasks.filter((t) => isDueThisWeek(t.due_date)).length;
      map.set(emp.id, { openCount, dueThisWeekCount });
    }
    return map;
  }, [employees, tasks, isDueThisWeek]);

  // Group task types: user's department first, then General, then other departments
  const currentUserEmp = employees.find((e) => e.id === userId);
  const userDeptId = (currentUserEmp as any)?.department_id || null;

  const groupedTaskTypes = React.useMemo(() => {
    const userDept: TaskType[] = [];
    const general: TaskType[] = [];
    const otherDepts: TaskType[] = [];

    for (const t of taskTypes) {
      if (!t.is_active) continue;
      if (t.department_id && userDeptId && t.department_id === userDeptId) {
        userDept.push(t);
      } else if (!t.department_id) {
        general.push(t);
      } else {
        otherDepts.push(t);
      }
    }

    return { userDept, general, otherDepts };
  }, [taskTypes, userDeptId]);

  // Historical estimate suggestion: when at least 5 completed tasks of that type have time logs
  const completedTasksOfType = React.useMemo(() => {
    if (!selectedTypeId) return [];
    return tasks.filter((t) => t.task_type_id === selectedTypeId && t.status === "done");
  }, [tasks, selectedTypeId]);

  const historicalMedianEstimate = React.useMemo(() => {
    if (completedTasksOfType.length < 5) return null;
    const minutesList: number[] = [];
    for (const t of completedTasksOfType) {
      if (t.estimated_minutes && t.estimated_minutes > 0) {
        minutesList.push(t.estimated_minutes);
      }
    }
    if (minutesList.length < 5) return null;
    minutesList.sort((a, b) => a - b);
    const mid = Math.floor(minutesList.length / 2);
    const median = minutesList.length % 2 !== 0 ? minutesList[mid] : Math.round((minutesList[mid - 1] + minutesList[mid]) / 2);
    const h = Math.floor(median / 60);
    const m = median % 60;
    const label = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
    return {
      minutes: median,
      h: h > 0 ? String(h) : "",
      m: m > 0 ? String(m) : "",
      label,
    };
  }, [completedTasksOfType]);

  // Suggested assignees for department-tied type: sorted by fewest open tasks
  const suggestedAssignees = React.useMemo(() => {
    if (!selectedTypeId) return [];
    const typeObj = taskTypes.find((t) => t.id === selectedTypeId);
    if (!typeObj || !typeObj.department_id) return [];

    return assignableEmployees
      .filter((emp: any) => emp.department_id === typeObj.department_id || !emp.department_id)
      .map((emp) => ({
        ...emp,
        openCount: workloadMap.get(emp.id)?.openCount || 0,
      }))
      .sort((a, b) => a.openCount - b.openCount)
      .slice(0, 3);
  }, [selectedTypeId, taskTypes, assignableEmployees, workloadMap]);

  // Handle Type Selection: fills only into unedited fields
  const handleSelectType = (typeId: string) => {
    setSelectedTypeId(typeId);
    if (!typeId || typeId === "other") {
      if (!editedFields.current.has("priority")) setNewPriority("medium");
      if (!editedFields.current.has("estimate")) {
        setEstHours("");
        setEstMinutes("");
      }
      if (!editedFields.current.has("dueDate")) {
        setNewDueDate("");
        setSuggestedDueText("");
        setAutoDueSuggested(false);
      }
      if (!editedFields.current.has("description")) setNewDescription("");
      setSelectedChecklist([]);
      return;
    }

    const t = taskTypes.find((item) => item.id === typeId);
    if (!t) return;

    if (!editedFields.current.has("priority") && t.default_priority) {
      setNewPriority(t.default_priority);
    }

    if (!editedFields.current.has("estimate") && t.default_estimate_minutes) {
      const h = Math.floor(t.default_estimate_minutes / 60);
      const m = t.default_estimate_minutes % 60;
      setEstHours(h > 0 ? String(h) : "");
      setEstMinutes(m > 0 ? String(m) : "");
    }

    if (!editedFields.current.has("dueDate") && t.due_rule_working_days != null && t.due_rule_working_days > 0) {
      const dueInfo = calculateWorkingDaysAhead(t.due_rule_working_days, holidays);
      setNewDueDate(dueInfo.dateStr);
      setSuggestedDueText(dueInfo.displayLabel);
      setAutoDueSuggested(true);
    }

    if (!editedFields.current.has("description") && t.description_template) {
      setNewDescription(t.description_template);
    }

    if (Array.isArray(t.checklist) && t.checklist.length > 0) {
      setSelectedChecklist([...t.checklist]);
    } else {
      setSelectedChecklist([]);
    }
  };

  const filteredTasks = React.useMemo(() => {
    return tasks.filter((t) => {
      if (scope === "mine" && userId) {
        if (t.assignee_id !== userId && t.creator_id !== userId) {
          return false;
        }
      }
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (typeFilter !== "all" && t.task_type_id !== typeFilter) return false;
      if (recurringFilter === "recurring" && !t.recurrence_id) return false;
      if (recurringFilter === "one_time" && t.recurrence_id) return false;
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
    typeFilter,
    recurringFilter,
    projectFilter,
    assigneeFilter,
    dueFilter,
    searchQuery,
  ]);

  const selectedTask = React.useMemo(() => {
    if (!selectedTaskId) return null;
    return tasks.find((t) => t.id === selectedTaskId) || null;
  }, [tasks, selectedTaskId]);

  const parentSubtasks = React.useMemo(() => {
    if (!selectedTask) return [];
    return tasks.filter((t) => t.parent_task_id === selectedTask.id);
  }, [tasks, selectedTask]);

  const allSubtasksDone = React.useMemo(() => {
    if (parentSubtasks.length === 0) return false;
    return parentSubtasks.every((st) => st.status === "done");
  }, [parentSubtasks]);

  const detailsQuery = useTaskDetails(selectedTask?.id || null);

  const totalLoggedMinutes = React.useMemo(() => {
    return (detailsQuery.data?.timeLogs || []).reduce(
      (sum, row) => sum + row.minutes,
      0
    );
  }, [detailsQuery.data?.timeLogs]);

  const handleOpenCreateModal = () => {
    editedFields.current.clear();
    setSelectedTypeId("");
    setNewTitle("");
    setNewDescription("");
    setNewAssigneeId(userId || "");
    setNewPriority("medium");
    setNewDueDate("");
    setSuggestedDueText("");
    setAutoDueSuggested(false);
    setEstHours("");
    setEstMinutes("");
    setNewProjectId("");
    setSelectedChecklist([]);
    setIsRepeating(false);
    setRepeatFrequency("weekly");
    setRepeatInterval(1);
    setRepeatWeekday(1);
    setRepeatDayOfMonth(1);
    setRepeatEndDate("");
    setCreateTaskOpen(true);
  };

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
        taskTypeId: selectedTypeId && selectedTypeId !== "other" ? selectedTypeId : null,
        autoDueSuggested: autoDueSuggested,
        subtaskTitles: selectedChecklist,
        recurrence: isRepeating
          ? {
              frequency: repeatFrequency,
              interval_n: repeatInterval,
              weekday: repeatFrequency === "weekly" ? repeatWeekday : null,
              day_of_month: repeatFrequency === "monthly" ? repeatDayOfMonth : null,
              next_run_date: newDueDate || new Date().toISOString().slice(0, 10),
              end_date: repeatEndDate || null,
            }
          : null,
      });

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
    if (userRole === "admin" || userRole === "hr" || userRole === "manager") return true;
    return false;
  };

  const canCancelTask = (task: TaskRecord) => {
    if (task.status === "cancelled" || task.status === "done") return false;
    if (userRole === "manager" || userRole === "hr" || userRole === "admin") {
      return true;
    }
    return task.creator_id === userId;
  };

  const canReopenTask = (task: TaskRecord) => {
    if (task.status !== "done" && task.status !== "cancelled") return false;
    if (userRole === "admin" || userRole === "hr" || userRole === "manager") return true;
    return task.creator_id === userId;
  };

  const canStopRecurrence = (task: TaskRecord) => {
    if (!task.recurrence_id) return false;
    if (userRole === "admin" || userRole === "hr") return true;
    if (task.creator_id === userId) return true;
    if (userRole === "manager" && task.assignee_id) {
      const assigneeEmp = employees.find((e) => e.id === task.assignee_id);
      if (assigneeEmp?.manager_id === userId) return true;
    }
    return false;
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Header & Controls */}
      <div data-tour="tasks-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-black tracking-tight flex items-center gap-2">
            <span>Tasks & Deliverables</span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#E6E6E6] text-black">
              {filteredTasks.length} {filteredTasks.length === 1 ? "task" : "tasks"}
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-[#808080] mt-0.5">
            Auto-templates, suggested working-day schedules, and recurring team workflows.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canManageProjects && (
            <button
              type="button"
              onClick={() => setCreateProjectOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer shadow-xs transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 text-black" />
              <span>New Project</span>
            </button>
          )}

          <button
            type="button"
            data-tour="create-task-btn"
            onClick={handleOpenCreateModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#A6F000] hover:opacity-90 text-xs font-bold text-black cursor-pointer shadow-xs transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Task</span>
          </button>
        </div>
      </div>

      {/* Scope, View Switcher & Search Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-1.5 rounded-xl bg-card border border-[#E6E6E6]">
        <div className="flex flex-wrap items-center gap-2">
          {/* Scope Filter */}
          <div className="flex items-center p-0.5 rounded-lg bg-[#E6E6E6] border border-[#E6E6E6]">
            <button
              type="button"
              onClick={() => setScope("mine")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer",
                scope === "mine"
                  ? "bg-white text-black shadow-xs"
                  : "text-[#808080] hover:text-black"
              )}
            >
              My Tasks
            </button>
            <button
              type="button"
              onClick={() => setScope("team")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer",
                scope === "team"
                  ? "bg-white text-black shadow-xs"
                  : "text-[#808080] hover:text-black"
              )}
            >
              All Team Tasks
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center p-0.5 rounded-lg bg-[#E6E6E6] border border-[#E6E6E6]">
            <button
              type="button"
              onClick={() => setViewMode("board")}
              aria-label="Board view"
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer",
                viewMode === "board"
                  ? "bg-black text-white shadow-xs"
                  : "text-[#808080] hover:text-black hover:bg-white"
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
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer",
                viewMode === "list"
                  ? "bg-black text-white shadow-xs"
                  : "text-[#808080] hover:text-black hover:bg-white"
              )}
            >
              <List className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
          </div>
        </div>

        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-[#808080] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search task title or description..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black placeholder:text-[#808080] focus:outline-none focus:border-black"
          />
        </div>
      </div>

      {/* Filter Dropdowns Toolbar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 pt-0.5 text-xs">
        {/* Status */}
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none"
        >
          <option value="all">All Statuses</option>
          {STATUS_COLUMNS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>

        {/* Priority */}
        <select
          aria-label="Filter by priority"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none"
        >
          <option value="all">All Priorities</option>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              Priority: {p.charAt(0).toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>

        {/* Type Filter */}
        <select
          aria-label="Filter by type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none"
        >
          <option value="all">All Types</option>
          {taskTypes.map((t) => (
            <option key={t.id} value={t.id}>
              Type: {t.name}
            </option>
          ))}
        </select>

        {/* Recurring Filter */}
        <select
          aria-label="Filter by recurring"
          value={recurringFilter}
          onChange={(e) => setRecurringFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none"
        >
          <option value="all">All Schedules</option>
          <option value="recurring">🔁 Recurring Only</option>
          <option value="one_time">One-Time Only</option>
        </select>

        {/* Due Date */}
        <select
          aria-label="Filter by due state"
          value={dueFilter}
          onChange={(e) => setDueFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none"
        >
          <option value="all">All Due Dates</option>
          <option value="overdue">Overdue Only</option>
          <option value="due_soon">Due Soon</option>
          <option value="upcoming">Upcoming</option>
          <option value="none">No Due Date</option>
        </select>

        {/* Assignee */}
        <select
          aria-label="Filter by assignee"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none"
        >
          <option value="all">All Assignees</option>
          <option value="unassigned">Unassigned</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name || emp.email}
            </option>
          ))}
        </select>

        {/* Project */}
        <select
          aria-label="Filter by project"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none"
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

      {/* Main Board or List Area */}
      {isLoading ? (
        <div className="p-16 text-center text-xs text-[#808080]">Loading workplace tasks...</div>
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          title="No tasks match criteria"
          description="Try broadening filters or create a new automated task deliverable."
          action={
            <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2 text-xs font-bold bg-[#A6F000] text-black rounded hover:opacity-90 cursor-pointer"
            >
              Create New Task
            </button>
          }
        />
      ) : viewMode === "board" ? (
        <div data-tour="tasks-board" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 items-start">
          {STATUS_COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.key);
            return (
              <div
                key={col.key}
                className="flex flex-col min-h-[220px] max-h-[calc(100vh-230px)] rounded-[14px] bg-[#E6E6E6] border border-[#E6E6E6] p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between px-1 shrink-0">
                  <div>
                    <h2 className="text-xs font-bold text-black">{col.label}</h2>
                    <p className="text-[10px] text-[#808080]">{col.hint}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-white border border-[#E6E6E6] text-black">
                    {colTasks.length}
                  </span>
                </div>

                <div className="overflow-y-auto space-y-2 pr-1 max-h-[calc(100vh-310px)] min-h-0">
                  {colTasks.length > 0 ? (
                    colTasks.map((task) => {
                      const assigneeName = formatPerson(task.assignee_id);
                      const initials = getInitials(assigneeName);
                      const typeName = task.task_type_id ? typeNameMap.get(task.task_type_id) : null;

                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => setSelectedTaskId(task.id)}
                          className="w-full text-left p-3 rounded-[12px] bg-white hover:border-black/40 border border-[#E6E6E6] shadow-none transition-all cursor-pointer space-y-2 focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-none"
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <StatusPill status={task.priority} showIcon={true} />
                              {typeName && <TaskTypeBadge typeName={typeName} />}
                              {task.recurrence_id && (
                                <span title="Recurring Task" className="inline-flex items-center text-xs text-black">
                                  <Repeat className="w-3 h-3 text-black" />
                                </span>
                              )}
                            </div>
                            {task.project_id && projectNameMap.has(task.project_id) && (
                              <span className="text-[10px] font-medium text-[#4D4D4D] truncate max-w-[100px]">
                                {projectNameMap.get(task.project_id)}
                              </span>
                            )}
                          </div>

                          <p className="text-xs font-semibold text-black line-clamp-2 leading-snug">
                            {task.title}
                          </p>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <DueBadge dueDate={task.due_date} status={task.status} />
                            {task.assignee_id && task.creator_id === task.assignee_id && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F5F5F5] text-black border border-[#E6E6E6]">
                                <UserCheck className="w-2.5 h-2.5" />
                                Self-Assigned
                              </span>
                            )}
                            {task.assignee_id && task.creator_id !== task.assignee_id && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-normal bg-[#F5F5F5] text-[#808080]">
                                From: {formatPerson(task.creator_id)}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-1.5 border-t border-[#E6E6E6] text-[11px] text-[#808080] gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="w-5 h-5 rounded-full bg-[#E6E6E6] text-black font-semibold text-[9px] flex items-center justify-center shrink-0">
                                {initials}
                              </span>
                              <span className="truncate font-medium text-[#4D4D4D]">
                                {assigneeName}
                              </span>
                            </div>
                            {task.estimated_minutes != null && (
                              <span className="font-mono text-[#808080] shrink-0 tabular-nums text-[10px]">
                                {formatEstimatedDuration(task.estimated_minutes)} est
                              </span>
                            )}
                          </div>

                          {/* Accept action for assigned tasks */}
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
                                className="w-full flex items-center justify-center gap-1 py-1.5 px-3 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-[11px] font-semibold transition-all shadow-xs cursor-pointer"
                              >
                                <span>✓ Accept Task</span>
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <div className="py-6 px-3 text-center rounded-xl border border-dashed border-[#E6E6E6] text-[11px] text-[#808080]">
                      No tasks in {col.label}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="bg-white rounded-xl border border-[#E6E6E6] shadow-sm overflow-x-auto max-h-[calc(100vh-240px)] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-[#F5F5F5] z-10 border-b border-[#E6E6E6]">
              <tr className="text-[11px] font-bold uppercase tracking-wider text-black">
                <th className="py-2.5 px-4">Task</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Project</th>
                <th className="py-2.5 px-3">Assignee</th>
                <th className="py-2.5 px-3">Priority</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E6E6]">
              {filteredTasks.map((task) => {
                const typeName = task.task_type_id ? typeNameMap.get(task.task_type_id) : null;
                return (
                  <tr
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                    className="hover:bg-[#F9F9F9] cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-4 font-bold text-black">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{task.title}</span>
                        {task.recurrence_id && (
                          <span title="Recurring Task">
                            <Repeat className="w-3 h-3 text-black" />
                          </span>
                        )}
                        {task.assignee_id && task.creator_id === task.assignee_id && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#F5F5F5] text-black border border-[#E6E6E6]">
                            Self-Assigned
                          </span>
                        )}
                      </div>
                      {task.description && (
                        <div className="text-[11px] font-normal text-[#808080] line-clamp-1 mt-0.5">
                          {task.description}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {typeName ? <TaskTypeBadge typeName={typeName} /> : <span className="text-[#808080]">—</span>}
                    </td>
                    <td className="py-2.5 px-3 text-[#4D4D4D]">
                      {task.project_id ? projectNameMap.get(task.project_id) || "Project" : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-black">
                      <div className="font-semibold">{formatPerson(task.assignee_id)}</div>
                      {task.estimated_minutes != null && (
                        <div className="text-[10px] font-mono font-bold text-black">
                          {formatEstimatedDuration(task.estimated_minutes)} est
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <StatusPill status={task.priority} />
                    </td>
                    <td className="py-2.5 px-3">
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
                            className="px-2 py-0.5 rounded bg-black hover:bg-[#1A1A1A] text-white text-[10px] font-semibold cursor-pointer shadow-xs"
                          >
                            Accept
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      {task.due_date ? (
                        <DueBadge dueDate={task.due_date} status={task.status} />
                      ) : (
                        <span className="text-[#808080]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
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
            className="w-full max-w-xl bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-6 space-y-4 max-h-[92vh] overflow-y-auto animate-in fade-in duration-150"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#E6E6E6]">
              <h2 id="create-task-title" className="text-base font-bold text-black">
                Create New Task
              </h2>
              <button
                type="button"
                aria-label="Close create task dialog"
                onClick={() => setCreateTaskOpen(false)}
                className="p-1 rounded text-[#808080] hover:text-black cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3.5">
              {/* Type Dropdown (First Field, Grouped by Department) */}
              <div>
                <label className="block text-xs font-bold text-black mb-1">
                  Task Type & Preset
                </label>
                <select
                  value={selectedTypeId}
                  onChange={(e) => handleSelectType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none focus:border-black"
                >
                  <option value="">No Type (Custom / Blank)</option>
                  {groupedTaskTypes.userDept.length > 0 && (
                    <optgroup label="Your Department">
                      {groupedTaskTypes.userDept.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {groupedTaskTypes.general.length > 0 && (
                    <optgroup label="General (All Teams)">
                      {groupedTaskTypes.general.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {groupedTaskTypes.otherDepts.length > 0 && (
                    <optgroup label="Other Teams">
                      {groupedTaskTypes.otherDepts.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <option value="other">Other (Blank structure)</option>
                </select>
                <p className="text-[11px] text-[#808080] mt-1">
                  Selecting a type suggests default priority, duration, description template, and working-day due date into unedited fields.
                </p>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-bold text-black mb-1">
                  Title *
                </label>
                <input
                  required
                  minLength={2}
                  value={newTitle}
                  onChange={(e) => {
                    setNewTitle(e.target.value);
                    editedFields.current.add("title");
                  }}
                  placeholder="e.g. Audit Q4 payroll shifts, Fix login redirect..."
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black focus:outline-none focus:border-black"
                />
              </div>

              {/* Description Template */}
              <div>
                <label className="block text-xs font-bold text-black mb-1">
                  Description / Template
                </label>
                <textarea
                  rows={3}
                  value={newDescription}
                  onChange={(e) => {
                    setNewDescription(e.target.value);
                    editedFields.current.add("description");
                  }}
                  placeholder="Acceptance criteria and notes..."
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black font-sans focus:outline-none focus:border-black"
                />
              </div>

              {/* Checklist under description */}
              {selectedChecklist.length > 0 && (
                <div className="p-3 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] space-y-2">
                  <span className="text-[11px] font-bold text-black flex items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5 text-black" />
                    Sub-Task Checklist (Create these as sub-tasks)
                  </span>
                  <div className="space-y-1.5">
                    {taskTypes.find((t) => t.id === selectedTypeId)?.checklist?.map((item) => (
                      <label key={item} className="flex items-center gap-2 text-xs text-black cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedChecklist.includes(item)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedChecklist((prev) => [...prev, item]);
                            else setSelectedChecklist((prev) => prev.filter((i) => i !== item));
                          }}
                          className="rounded text-black"
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Assignee & Workload Hint */}
              <div>
                <label className="block text-xs font-bold text-black mb-1">
                  Assignee
                </label>
                <select
                  aria-label="Task Assignee"
                  value={newAssigneeId}
                  onChange={(e) => {
                    setNewAssigneeId(e.target.value);
                    editedFields.current.add("assignee");
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none focus:border-black"
                >
                  <option value="">Unassigned</option>
                  {assignableEmployees.map((emp) => {
                    const wl = workloadMap.get(emp.id) || { openCount: 0, dueThisWeekCount: 0 };
                    return (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name || emp.email} {emp.id === userId ? "(You — Self-Assign)" : ""} — {wl.openCount} open ({wl.dueThisWeekCount} due this week)
                      </option>
                    );
                  })}
                </select>

                {/* Assignee Suggestion Chips */}
                {suggestedAssignees.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase text-[#808080]">Suggested:</span>
                    {suggestedAssignees.map((emp) => (
                      <button
                        key={emp.id}
                        type="button"
                        onClick={() => {
                          setNewAssigneeId(emp.id);
                          editedFields.current.add("assignee");
                        }}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F5F5F5] border border-[#E6E6E6] hover:bg-[#E6E6E6] text-black cursor-pointer"
                        title="Fewest open tasks"
                      >
                        {emp.full_name?.split(" ")[0] || emp.email} ({emp.openCount} open)
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Priority & Due Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-black mb-1">
                    Priority
                  </label>
                  <select
                    aria-label="Task Priority"
                    value={newPriority}
                    onChange={(e) => {
                      setNewPriority(e.target.value as TaskPriority);
                      editedFields.current.add("priority");
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none focus:border-black"
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-black mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    aria-label="Due Date"
                    value={newDueDate}
                    onChange={(e) => {
                      setNewDueDate(e.target.value);
                      setAutoDueSuggested(false);
                      setSuggestedDueText("");
                      editedFields.current.add("dueDate");
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black focus:outline-none focus:border-black"
                  />

                  {/* Suggested Due Date Chip */}
                  {suggestedDueText && newDueDate && autoDueSuggested && (
                    <div className="mt-1 flex items-center justify-between text-[11px] text-[#4D4D4D] bg-[#F5F5F5] border border-[#E6E6E6] rounded px-2 py-0.5">
                      <span>Suggested due date: {suggestedDueText}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setNewDueDate("");
                          setSuggestedDueText("");
                          setAutoDueSuggested(false);
                          editedFields.current.add("dueDate");
                        }}
                        className="text-[10px] font-bold text-[#808080] hover:text-black underline ml-2 cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Duration Picker & Historical Estimate Suggestion */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-black flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5 text-black" />
                    Estimated Duration
                  </label>
                  {((parseInt(estHours || "0", 10) * 60) + parseInt(estMinutes || "0", 10)) > 0 && (
                    <span className="text-[11px] font-mono font-bold text-black">
                      Total: {formatEstimatedDuration((parseInt(estHours || "0", 10) * 60) + parseInt(estMinutes || "0", 10))}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 flex-1 bg-white border border-[#E6E6E6] rounded-lg px-3 py-1.5">
                    <input
                      type="number"
                      min={0}
                      max={24}
                      aria-label="Estimated hours"
                      value={estHours}
                      onChange={(e) => {
                        setEstHours(e.target.value);
                        editedFields.current.add("estimate");
                      }}
                      placeholder="0"
                      className="w-16 text-xs font-bold text-black focus:outline-none"
                    />
                    <span className="text-xs font-semibold text-[#808080]">hrs</span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-1 bg-white border border-[#E6E6E6] rounded-lg px-3 py-1.5">
                    <input
                      type="number"
                      min={0}
                      max={59}
                      step={5}
                      aria-label="Estimated minutes"
                      value={estMinutes}
                      onChange={(e) => {
                        setEstMinutes(e.target.value);
                        editedFields.current.add("estimate");
                      }}
                      placeholder="0"
                      className="w-16 text-xs font-bold text-black focus:outline-none"
                    />
                    <span className="text-xs font-semibold text-[#808080]">mins</span>
                  </div>

                  {(estHours || estMinutes) && (
                    <button
                      type="button"
                      onClick={() => {
                        setEstHours("");
                        setEstMinutes("");
                        editedFields.current.add("estimate");
                      }}
                      className="px-2.5 py-1.5 text-[#808080] hover:text-black text-[11px] font-bold cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Historical Estimate Suggestion */}
                {historicalMedianEstimate && (
                  <div className="mt-1 flex items-center justify-between text-[11px] text-[#4D4D4D] bg-[#F5F5F5] border border-[#E6E6E6] rounded px-2.5 py-1">
                    <span>Similar tasks usually take about {historicalMedianEstimate.label}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEstHours(historicalMedianEstimate.h);
                        setEstMinutes(historicalMedianEstimate.m);
                        editedFields.current.add("estimate");
                      }}
                      className="px-2 py-0.5 text-[10px] font-bold bg-[#A6F000] text-black rounded hover:opacity-90 cursor-pointer ml-2"
                    >
                      Use this
                    </button>
                  </div>
                )}
              </div>

              {/* Repeat Schedule Section (Phase 3) */}
              <div className="pt-2 border-t border-[#E6E6E6] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-black flex items-center gap-1.5">
                    <Repeat className="w-3.5 h-3.5 text-black" />
                    Repeat Schedule (Optional)
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-[#4D4D4D] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isRepeating}
                      onChange={(e) => setIsRepeating(e.target.checked)}
                      className="rounded text-black"
                    />
                    <span>Repeating Task</span>
                  </label>
                </div>

                {isRepeating && (
                  <div className="p-3 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-[#808080] mb-1">
                          Frequency
                        </label>
                        <select
                          value={repeatFrequency}
                          onChange={(e) => setRepeatFrequency(e.target.value as any)}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black"
                        >
                          <option value="daily">Daily (Working days only)</option>
                          <option value="weekly">Weekly (Pick weekday)</option>
                          <option value="monthly">Monthly (Pick day of month)</option>
                          <option value="every_n_working_days">Every N Working Days</option>
                        </select>
                      </div>

                      {repeatFrequency === "weekly" && (
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-[#808080] mb-1">
                            Day of Week
                          </label>
                          <select
                            value={repeatWeekday}
                            onChange={(e) => setRepeatWeekday(Number(e.target.value))}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black"
                          >
                            <option value={1}>Monday</option>
                            <option value={2}>Tuesday</option>
                            <option value={3}>Wednesday</option>
                            <option value={4}>Thursday</option>
                            <option value={5}>Friday</option>
                          </select>
                        </div>
                      )}

                      {repeatFrequency === "monthly" && (
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-[#808080] mb-1">
                            Day of Month (Clamped)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={31}
                            value={repeatDayOfMonth}
                            onChange={(e) => setRepeatDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black"
                          />
                        </div>
                      )}

                      {repeatFrequency === "every_n_working_days" && (
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-[#808080] mb-1">
                            Interval (N Working Days)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={repeatInterval}
                            onChange={(e) => setRepeatInterval(Math.max(1, Number(e.target.value) || 1))}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black"
                          />
                        </div>
                      )}

                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold uppercase text-[#808080] mb-1">
                          End Date (Optional)
                        </label>
                        <input
                          type="date"
                          value={repeatEndDate}
                          onChange={(e) => setRepeatEndDate(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Project Grouping */}
              {projects.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-black mb-1">
                    Project (Optional)
                  </label>
                  <select
                    aria-label="Task Project"
                    value={newProjectId}
                    onChange={(e) => setNewProjectId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
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

              {/* Modal Footer */}
              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E6E6]">
                <button
                  type="button"
                  onClick={() => setCreateTaskOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white border border-[#E6E6E6] hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer shadow-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutations.createTask.isPending}
                  className="px-5 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer disabled:opacity-60 shadow-xs"
                >
                  {mutations.createTask.isPending ? "Creating..." : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Time Prompt Modal (Phase 2 Inline Prompt on Completion) */}
      {logTimePromptTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-5 space-y-3 animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-black" />
              <h3 className="text-sm font-bold text-black">Log time for this task?</h3>
            </div>
            <p className="text-xs text-[#4D4D4D]">
              "{logTimePromptTask.title}" has been completed. Would you like to log your work time?
            </p>
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-black">Minutes:</span>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={logTimeMinutes}
                  onChange={(e) => setLogTimeMinutes(e.target.value)}
                  className="flex-1 px-2.5 py-1 rounded border border-[#E6E6E6] text-xs text-black"
                />
              </div>
              <input
                type="text"
                placeholder="Optional work note..."
                value={logTimeNote}
                onChange={(e) => setLogTimeNote(e.target.value)}
                className="w-full px-2.5 py-1 rounded border border-[#E6E6E6] text-xs text-black"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#E6E6E6]">
              <button
                type="button"
                onClick={() => setLogTimePromptTask(null)}
                className="px-3 py-1.5 text-xs font-semibold text-[#808080] hover:text-black cursor-pointer"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={async () => {
                  const mins = Number(logTimeMinutes);
                  if (mins > 0 && logTimePromptTask) {
                    await mutations.logTime.mutateAsync({
                      taskId: logTimePromptTask.id,
                      workDate: new Date().toISOString().slice(0, 10),
                      minutes: mins,
                      note: logTimeNote.trim() || undefined,
                    });
                  }
                  setLogTimePromptTask(null);
                }}
                className="px-4 py-1.5 text-xs font-bold bg-[#A6F000] text-black rounded hover:opacity-90 cursor-pointer"
              >
                Log Time
              </button>
            </div>
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
            className="w-full max-w-md bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 id="create-project-title" className="text-base font-bold text-black">
                Create Project Grouping
              </h2>
              <button
                type="button"
                aria-label="Close project modal"
                onClick={() => setCreateProjectOpen(false)}
                className="p-1 rounded text-[#808080] hover:text-black cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-black mb-1">Project Name *</label>
                <input
                  required
                  minLength={2}
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  placeholder="e.g., Q4 Payroll Modernization"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-black mb-1">Code / Prefix</label>
                <input
                  value={projCode}
                  onChange={(e) => setProjCode(e.target.value)}
                  placeholder="e.g., PAY"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-black mb-1">Department</label>
                <select
                  aria-label="Project Department"
                  value={projDeptId}
                  onChange={(e) => setProjDeptId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
                >
                  <option value="">Company-Wide (All Teams)</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-black mb-1">Description</label>
                <textarea
                  rows={2}
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                  placeholder="Goals and deliverables..."
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E6E6E6]">
                <button
                  type="button"
                  onClick={() => setCreateProjectOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white border border-[#E6E6E6] hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer shadow-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutations.createProject.isPending}
                  className="px-5 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer disabled:opacity-60 shadow-xs"
                >
                  {mutations.createProject.isPending ? "Creating..." : "Create Project"}
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
            className="w-full max-w-xl bg-white h-full overflow-y-auto border-l border-[#E6E6E6] shadow-xl p-6 space-y-5 animate-in slide-in-from-right duration-200"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#E6E6E6]">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={selectedTask.status} />
                  <StatusPill status={selectedTask.priority} />
                  {selectedTask.task_type_id && (
                    <TaskTypeBadge typeName={typeNameMap.get(selectedTask.task_type_id)} />
                  )}
                  <DueBadge
                    dueDate={selectedTask.due_date}
                    status={selectedTask.status}
                  />
                  {selectedTask.recurrence_id && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F5F5F5] border border-[#E6E6E6] text-black">
                      <Repeat className="w-3 h-3 text-black" />
                      Recurring
                    </span>
                  )}
                </div>
                <h2 className="text-lg font-bold text-black">
                  {selectedTask.title}
                </h2>
                {selectedTask.project_id && (
                  <p className="text-xs font-semibold text-black">
                    Project: {projectNameMap.get(selectedTask.project_id) || "Assigned Project"}
                  </p>
                )}
              </div>

              <button
                type="button"
                aria-label="Close task drawer"
                onClick={() => setSelectedTaskId(null)}
                className="p-1 rounded text-[#808080] hover:text-black cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Parent Task Completion Gentle Banner (Phase 4) */}
            {parentSubtasks.length > 0 && allSubtasksDone && selectedTask.status !== "done" && (
              <div className="p-3 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-black shrink-0" />
                  <span className="text-xs font-semibold text-black">
                    All {parentSubtasks.length} sub-tasks are done. Mark this task as done?
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    mutations.updateTaskStatus.mutate({
                      taskId: selectedTask.id,
                      status: "done",
                      note: "Completed all sub-tasks",
                    });
                    setLogTimePromptTask(selectedTask);
                    setLogTimeMinutes(String(selectedTask.estimated_minutes || 60));
                  }}
                  className="px-3 py-1 text-xs font-bold bg-[#A6F000] text-black rounded hover:opacity-90 whitespace-nowrap cursor-pointer"
                >
                  Mark Done
                </button>
              </div>
            )}

            {/* Recurring Task Status Banner & Stop Repeating (Phase 3) */}
            {selectedTask.recurrence_id && (
              <div className="p-3 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-black">
                  <Repeat className="w-4 h-4 text-black shrink-0" />
                  <span>
                    {(() => {
                      const rec = recurrences.find((r) => r.id === selectedTask.recurrence_id);
                      if (!rec) return "Recurring schedule active";
                      if (rec.frequency === "daily") return "Repeats every working day";
                      if (rec.frequency === "weekly") {
                        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                        return `Repeats every ${rec.weekday !== null ? days[rec.weekday] : "week"}`;
                      }
                      if (rec.frequency === "monthly") return `Repeats monthly (day ${rec.day_of_month || 1})`;
                      return `Repeats every ${rec.interval_n} working days`;
                    })()}
                  </span>
                </div>
                {canStopRecurrence(selectedTask) && (
                  <button
                    type="button"
                    onClick={() => mutations.stopRecurrence.mutate(selectedTask.recurrence_id!)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-red-600 border border-red-200 rounded hover:bg-red-50 cursor-pointer"
                  >
                    Stop repeating
                  </button>
                )}
              </div>
            )}

            {/* Description */}
            {selectedTask.description && (
              <div className="p-3.5 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] text-xs text-black leading-relaxed whitespace-pre-wrap">
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
                    className="px-3.5 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer shadow-xs"
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
                      onClick={() => {
                        mutations.updateTaskStatus.mutate({
                          taskId: selectedTask.id,
                          status: "done",
                        });
                        setLogTimePromptTask(selectedTask);
                        setLogTimeMinutes(String(selectedTask.estimated_minutes || 60));
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-[#A6F000] hover:bg-[#95D800] text-black text-xs font-bold cursor-pointer shadow-xs"
                    >
                      Mark Complete
                    </button>

                    {/* Blocked Reason Prompt (Phase 4) */}
                    {blockingTaskId === selectedTask.id ? (
                      <div className="w-full mt-2 p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                        <label className="text-xs font-bold text-amber-900 block">
                          Reason for blocking (Optional)
                        </label>
                        <input
                          type="text"
                          value={blockingReason}
                          onChange={(e) => setBlockingReason(e.target.value)}
                          placeholder="e.g. Waiting on API credentials or customer response..."
                          className="w-full px-3 py-1.5 text-xs bg-white border border-amber-300 rounded focus:outline-none"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setBlockingTaskId(null);
                              setBlockingReason("");
                            }}
                            className="px-2.5 py-1 text-xs text-amber-800 hover:text-black cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await mutations.updateTaskStatus.mutateAsync({
                                taskId: selectedTask.id,
                                status: "blocked",
                                note: blockingReason.trim() || undefined,
                              });
                              if (blockingReason.trim()) {
                                await mutations.addComment.mutateAsync({
                                  taskId: selectedTask.id,
                                  body: `Blocked: ${blockingReason.trim()}`,
                                });
                              }
                              setBlockingTaskId(null);
                              setBlockingReason("");
                            }}
                            className="px-3 py-1 text-xs font-bold bg-amber-800 text-white rounded hover:bg-amber-900 cursor-pointer"
                          >
                            Confirm Blocked
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setBlockingTaskId(selectedTask.id)}
                        className="px-3.5 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold cursor-pointer"
                      >
                        Mark Blocked
                      </button>
                    )}
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
                    className="px-3.5 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer shadow-xs"
                  >
                    Resume Progress
                  </button>
                )}

                {selectedTask.status === "todo" && (
                  <button
                    type="button"
                    disabled={mutations.updateTaskStatus.isPending}
                    onClick={() => {
                      mutations.updateTaskStatus.mutate({
                        taskId: selectedTask.id,
                        status: "done",
                      });
                      setLogTimePromptTask(selectedTask);
                      setLogTimeMinutes(String(selectedTask.estimated_minutes || 60));
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-[#A6F000] hover:bg-[#95D800] text-black text-xs font-bold cursor-pointer shadow-xs"
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
                    className="px-3.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer shadow-xs"
                  >
                    Reopen
                  </button>
                )}
              </div>

              {/* Assignee Control */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6]">
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-black" />
                    <span className="font-semibold text-[#808080]">Assignee:</span>
                    <span className="font-bold text-black">
                      {formatPerson(selectedTask.assignee_id)}
                    </span>
                  </div>
                  {selectedTask.assignee_id && selectedTask.creator_id === selectedTask.assignee_id && (
                    <span className="text-[10px] font-semibold text-black ml-6">
                      • Self-Assigned
                    </span>
                  )}
                  {selectedTask.assignee_id && selectedTask.creator_id !== selectedTask.assignee_id && (
                    <span className="text-[10px] text-[#808080] ml-6">
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
                    className="px-3 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black"
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
                    className="flex-1 px-3 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
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
                    className="px-3 py-1.5 rounded-lg bg-red-50 text-[#F00091] border border-red-200 text-xs font-bold cursor-pointer"
                  >
                    Cancel Task
                  </button>
                </div>
              )}
            </div>

            {/* Subtasks Section */}
            {parentSubtasks.length > 0 && (
              <section className="space-y-2 pt-2 border-t border-[#E6E6E6]">
                <h3 className="text-xs font-bold uppercase tracking-wider text-black flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4 text-black" />
                  <span>Sub-Tasks ({parentSubtasks.filter((s) => s.status === "done").length}/{parentSubtasks.length} Completed)</span>
                </h3>
                <div className="space-y-1.5">
                  {parentSubtasks.map((st) => (
                    <div
                      key={st.id}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => {
                            const next = st.status === "done" ? "todo" : "done";
                            mutations.updateTaskStatus.mutate({ taskId: st.id, status: next });
                          }}
                          className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center shrink-0 cursor-pointer",
                            st.status === "done" ? "bg-[#A6F000] border-black text-black" : "border-[#808080] bg-white"
                          )}
                        >
                          {st.status === "done" && "✓"}
                        </button>
                        <span className={cn("truncate font-medium text-black", st.status === "done" && "line-through text-[#808080]")}>
                          {st.title}
                        </span>
                      </div>
                      <StatusPill status={st.status} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Manual Time Logs */}
            <section className="space-y-3 pt-2 border-t border-[#E6E6E6]">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-black flex items-center gap-1.5">
                  <Timer className="w-4 h-4 text-black" />
                  <span>Time Logs</span>
                </h3>
                <span className="text-[11px] font-mono text-[#808080]">
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
                    className="sm:col-span-4 px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
                  />
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    aria-label="Time log minutes"
                    value={timeMinutes}
                    onChange={(e) => setTimeMinutes(e.target.value)}
                    className="sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
                  />
                  <input
                    type="text"
                    aria-label="Time log note"
                    value={timeNote}
                    onChange={(e) => setTimeNote(e.target.value)}
                    placeholder="Work note..."
                    className="sm:col-span-4 px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
                  />
                  <button
                    type="submit"
                    disabled={mutations.logTime.isPending}
                    className="sm:col-span-2 px-3 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer shadow-xs"
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
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-xs"
                    >
                      <div>
                        <span className="font-bold text-black">
                          {formatPerson(log.employee_id)}
                        </span>
                        <span className="text-[#808080] ml-2 font-mono">
                          {log.work_date}
                        </span>
                        {log.note && (
                          <p className="text-[11px] text-[#4D4D4D] mt-0.5">
                            {log.note}
                          </p>
                        )}
                      </div>
                      <span className="font-mono font-bold text-black">
                        {log.minutes}m
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-[#808080]">No time logs recorded yet.</p>
                )}
              </div>
            </section>

            {/* Comments Thread */}
            <section className="space-y-3 pt-2 border-t border-[#E6E6E6]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-black flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-black" />
                <span>Discussion & Activity</span>
              </h3>

              <div className="space-y-2">
                {(detailsQuery.data?.comments || []).map((comment) => (
                  <div
                    key={comment.id}
                    className="p-3 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-black">
                        {formatPerson(comment.author_id)}
                      </span>
                      <span className="text-[10px] text-[#808080]">
                        {new Date(comment.created_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-[#4D4D4D] leading-relaxed">{comment.body}</p>
                  </div>
                ))}

                {(detailsQuery.data?.comments || []).length === 0 && (
                  <p className="text-[11px] text-[#808080]">No comments yet.</p>
                )}
              </div>

              {selectedTask.status !== "cancelled" && (
                <form onSubmit={handleAddComment} className="flex gap-2">
                  <input
                    type="text"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="Leave an update or blocker note..."
                    className="flex-1 px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
                  />
                  <button
                    type="submit"
                    disabled={mutations.addComment.isPending || !commentBody.trim()}
                    className="px-3.5 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              )}
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
      router.replace("/");
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

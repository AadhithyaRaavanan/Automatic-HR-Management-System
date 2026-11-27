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
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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
  ArrowRight,
  ChevronDown,
  Check,
  Target,
  SlidersHorizontal,
  Filter,
  CheckCircle2,
  Play,
  RotateCcw,
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

function getPresetDateIso(offsetDays: number, timeZone: string = "Asia/Kolkata"): string {
  const now = new Date();
  const kolkataStr = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = kolkataStr.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1, d + offsetDays));
  const ty = target.getUTCFullYear();
  const tm = String(target.getUTCMonth() + 1).padStart(2, "0");
  const td = String(target.getUTCDate()).padStart(2, "0");
  return `${ty}-${tm}-${td}`;
}

function formatDueDateDisplay(dateStr: string): string {
  if (!dateStr) return "";
  const today = getPresetDateIso(0);
  const tomorrow = getPresetDateIso(1);
  const dayAfterTomorrow = getPresetDateIso(2);
  if (dateStr === today) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";
  if (dateStr === dayAfterTomorrow) return "Day after tomorrow";
  try {
    const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  } catch {
    return dateStr;
  }
}

function FilterDropdownMenu({
  label,
  value,
  options,
  onSelect,
  ariaLabel,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (val: string) => void;
  ariaLabel: string;
}) {
  const isFiltered = value !== "all";
  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = isFiltered
    ? selectedOption?.label || value
    : label;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex items-center justify-between gap-1.5 w-full px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer select-none",
            isFiltered
              ? "bg-black text-white border-black font-semibold"
              : "bg-white text-black border-[#E6E6E6] hover:bg-[#F5F5F5]"
          )}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronDown
            className={cn(
              "w-3 h-3 shrink-0",
              isFiltered ? "text-white" : "text-[#808080]"
            )}
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 min-w-[170px] max-w-[280px] max-h-60 overflow-y-auto rounded-xl bg-white border border-[#E6E6E6] p-1 shadow-lg text-xs animate-in fade-in-0 zoom-in-95"
        >
          {options.map((opt) => {
            const isSelected = value === opt.value;
            return (
              <DropdownMenu.Item
                key={opt.value}
                onSelect={() => onSelect(opt.value)}
                className={cn(
                  "flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer select-none outline-none transition-colors",
                  isSelected
                    ? "bg-[#F5F5F5] font-bold text-black"
                    : "text-black hover:bg-[#F5F5F5]"
                )}
              >
                <span className="truncate mr-2">{opt.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-black shrink-0" />}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
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

  // Filters Panel open state
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const filtersTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const filtersPanelRef = React.useRef<HTMLDivElement | null>(null);

  // Focus tracking for drawer & modals
  const lastFocusedCardRef = React.useRef<HTMLElement | null>(null);
  const createTaskTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);
  const [createTaskOpen, setCreateTaskOpen] = React.useState(false);
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);

  // Optional settings accordion in Create Task dialog
  const [showAdvancedOptions, setShowAdvancedOptions] = React.useState<boolean>(false);

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
  const [showCustomDatePicker, setShowCustomDatePicker] = React.useState<boolean>(false);
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

  // Linked Goal State (Phase 5)
  const [newGoalId, setNewGoalId] = React.useState<string>("");
  const [assigneeGoals, setAssigneeGoals] = React.useState<Array<{ id: string; title: string; status: string }>>([]);
  const [drawerGoals, setDrawerGoals] = React.useState<Array<{ id: string; title: string; status: string }>>([]);

  // Fetch active goals for task dialog assignee
  React.useEffect(() => {
    const targetId = newAssigneeId || userId;
    if (!targetId || !FEATURES.KPI) {
      setAssigneeGoals([]);
      return;
    }
    fetch(`/api/kpi/goals?employee_id=${encodeURIComponent(targetId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const active = (data?.goals || []).filter((g: any) => g.status !== "done");
        setAssigneeGoals(active);
      })
      .catch(() => setAssigneeGoals([]));
  }, [newAssigneeId, userId]);

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

    if (!editedFields.current.has("dueDate") && t.due_rule_working_days != null) {
      if (t.due_rule_working_days === 0) {
        setNewDueDate(getPresetDateIso(0));
        setSuggestedDueText("Today");
        setAutoDueSuggested(true);
      } else if (t.due_rule_working_days === 1) {
        setNewDueDate(getPresetDateIso(1));
        setSuggestedDueText("Tomorrow");
        setAutoDueSuggested(true);
      } else if (t.due_rule_working_days === 2) {
        setNewDueDate(getPresetDateIso(2));
        setSuggestedDueText("Day after tomorrow");
        setAutoDueSuggested(true);
      } else {
        const dueInfo = calculateWorkingDaysAhead(t.due_rule_working_days, holidays);
        setNewDueDate(dueInfo.dateStr);
        setSuggestedDueText(dueInfo.displayLabel);
        setAutoDueSuggested(true);
      }
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

  const scopedTasks = React.useMemo(() => {
    return tasks.filter((t) => {
      if (scope === "mine" && userId) {
        if (t.assignee_id !== userId && t.creator_id !== userId) {
          return false;
        }
      }
      return true;
    });
  }, [tasks, scope, userId]);

  const summaryCounts = React.useMemo(() => {
    let open = 0;
    let overdue = 0;
    let dueSoon = 0;
    let completed = 0;

    for (const t of scopedTasks) {
      if (t.status === "done") {
        completed++;
      } else if (t.status !== "cancelled") {
        open++;
        const state = getTaskDueState(t.due_date, t.status);
        if (state === "overdue") overdue++;
        else if (state === "due_soon") dueSoon++;
      }
    }

    return { open, overdue, dueSoon, completed };
  }, [scopedTasks]);

  const handleClearAllFilters = () => {
    setStatusFilter("all");
    setPriorityFilter("all");
    setTypeFilter("all");
    setRecurringFilter("all");
    setDueFilter("all");
    setAssigneeFilter("all");
    setProjectFilter("all");
    setSearchQuery("");
  };

  const activePanelFilterCount = React.useMemo(() => {
    let count = 0;
    if (statusFilter !== "all") count++;
    if (priorityFilter !== "all") count++;
    if (typeFilter !== "all") count++;
    if (recurringFilter !== "all") count++;
    if (dueFilter !== "all") count++;
    if (assigneeFilter !== "all") count++;
    if (projectFilter !== "all") count++;
    return count;
  }, [
    statusFilter,
    priorityFilter,
    typeFilter,
    recurringFilter,
    dueFilter,
    assigneeFilter,
    projectFilter,
  ]);

  const hasActiveFilters =
    activePanelFilterCount > 0 || searchQuery.trim().length > 0;

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

  // Extract blocker reason from events / comments for blocked tasks
  const blockerReason = React.useMemo(() => {
    if (selectedTask?.status !== "blocked") return null;
    const events = detailsQuery.data?.events || [];
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.to_status === "blocked") {
        const note = (ev.metadata as any)?.note;
        if (note && typeof note === "string" && note.trim()) return note.trim();
      }
    }
    const comments = detailsQuery.data?.comments || [];
    for (let i = comments.length - 1; i >= 0; i--) {
      const c = comments[i];
      if (c.body && c.body.toLowerCase().startsWith("blocked:")) {
        return c.body.replace(/^blocked:\s*/i, "").trim();
      }
    }
    return null;
  }, [selectedTask?.status, detailsQuery.data?.events, detailsQuery.data?.comments]);

  // Recurrence schedule display label
  const recurrenceScheduleLabel = React.useMemo(() => {
    if (!selectedTask?.recurrence_id) return null;
    const rec = recurrences.find((r) => r.id === selectedTask.recurrence_id);
    if (!rec) return "Recurring schedule active";
    if (rec.frequency === "daily") return "Repeats every working day";
    if (rec.frequency === "weekly") {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return `Repeats weekly on ${rec.weekday !== null ? days[rec.weekday] : "scheduled day"}`;
    }
    if (rec.frequency === "monthly") return `Repeats monthly on day ${rec.day_of_month || 1}`;
    return `Repeats every ${rec.interval_n} working days`;
  }, [selectedTask?.recurrence_id, recurrences]);

  // Fetch active goals for drawer task assignee or creator
  React.useEffect(() => {
    const empId = selectedTask?.assignee_id || selectedTask?.creator_id;
    if (!selectedTask || !empId || !FEATURES.KPI) {
      setDrawerGoals([]);
      return;
    }
    fetch(`/api/kpi/goals?employee_id=${encodeURIComponent(empId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setDrawerGoals(data?.goals || []))
      .catch(() => setDrawerGoals([]));
  }, [selectedTask?.id, selectedTask?.assignee_id, selectedTask?.creator_id]);

  const handleOpenTask = (taskId: string) => {
    lastFocusedCardRef.current = document.activeElement as HTMLElement;
    setSelectedTaskId(taskId);
  };

  const handleCloseDrawer = () => {
    setSelectedTaskId(null);
    setTimeout(() => {
      lastFocusedCardRef.current?.focus();
    }, 0);
  };

  const handleOpenCreateModal = () => {
    createTaskTriggerRef.current = document.activeElement as HTMLButtonElement;
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
    setNewGoalId("");
    setShowAdvancedOptions(false);
    setCreateTaskOpen(true);
  };

  const handleCloseCreateModal = () => {
    setCreateTaskOpen(false);
    setTimeout(() => {
      createTaskTriggerRef.current?.focus();
    }, 0);
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
        goalId: newGoalId || null,
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

      handleCloseCreateModal();
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
      {/* Header & Primary Actions */}
      <div data-tour="tasks-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-1">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-black tracking-tight flex items-center gap-2">
            <span>Tasks & Team Work</span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#E6E6E6] text-black">
              {filteredTasks.length} {filteredTasks.length === 1 ? "task" : "tasks"}
            </span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canManageProjects && (
            <button
              type="button"
              onClick={() => setCreateProjectOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer shadow-xs transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 text-black" />
              <span>New project</span>
            </button>
          )}

          <button
            ref={createTaskTriggerRef}
            type="button"
            data-tour="create-task-btn"
            aria-label="New Task"
            onClick={handleOpenCreateModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-xs font-semibold text-white cursor-pointer shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-black"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create task</span>
          </button>
        </div>
      </div>

      {/* Slim Summary Strip with Keyboard-Accessible Quick Filters */}
      <div className="flex items-center gap-3 py-1 text-xs text-[#808080] border-b border-[#E6E6E6] flex-wrap">
        <div className="flex items-center gap-1.5 px-1 py-0.5">
          <span className={cn("font-bold font-mono", summaryCounts.open > 0 ? "text-black" : "text-[#808080]")}>
            {summaryCounts.open}
          </span>
          <span>Open</span>
        </div>

        <span className="h-3 w-px bg-[#E6E6E6]" aria-hidden="true" />

        {/* Overdue Quick Filter */}
        <button
          type="button"
          role="button"
          aria-pressed={dueFilter === "overdue"}
          aria-label="Filter overdue tasks"
          onClick={() => setDueFilter(dueFilter === "overdue" ? "all" : "overdue")}
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-md cursor-pointer transition-all border focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-none",
            dueFilter === "overdue"
              ? "bg-[#FF1493]/15 text-[#FF1493] border-[#FF1493]/40 shadow-xs font-bold ring-1 ring-[#FF1493]/30"
              : "border-transparent hover:bg-[#F5F5F5] text-[#808080]"
          )}
        >
          <span
            className={cn(
              "font-bold font-mono text-xs",
              summaryCounts.overdue > 0 ? "text-[#FF1493]" : "text-[#808080]"
            )}
          >
            {summaryCounts.overdue}
          </span>
          <span className={cn("text-xs", summaryCounts.overdue > 0 ? "text-[#FF1493] font-semibold" : "")}>
            Overdue
          </span>
        </button>

        <span className="h-3 w-px bg-[#E6E6E6]" aria-hidden="true" />

        {/* Due Soon Quick Filter */}
        <button
          type="button"
          role="button"
          aria-pressed={dueFilter === "due_soon"}
          aria-label="Filter due soon tasks"
          onClick={() => setDueFilter(dueFilter === "due_soon" ? "all" : "due_soon")}
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-md cursor-pointer transition-all border focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-none",
            dueFilter === "due_soon"
              ? "bg-[#D97706]/15 text-[#D97706] border-[#D97706]/40 shadow-xs font-bold ring-1 ring-[#D97706]/30"
              : "border-transparent hover:bg-[#F5F5F5] text-[#808080]"
          )}
        >
          <span
            className={cn(
              "font-bold font-mono text-xs",
              summaryCounts.dueSoon > 0 ? "text-[#D97706]" : "text-[#808080]"
            )}
          >
            {summaryCounts.dueSoon}
          </span>
          <span className={cn("text-xs", summaryCounts.dueSoon > 0 ? "text-[#D97706] font-semibold" : "")}>
            Due soon
          </span>
        </button>

        <span className="h-3 w-px bg-[#E6E6E6]" aria-hidden="true" />

        <div className="flex items-center gap-1.5 px-1 py-0.5">
          <span className={cn("font-bold font-mono", summaryCounts.completed > 0 ? "text-black" : "text-[#808080]")}>
            {summaryCounts.completed}
          </span>
          <span>Completed</span>
        </div>
      </div>

      {/* Simplified Workspace Toolbar: Scope, View Switcher, Single Filters Panel Trigger & Search */}
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
              {userRole === "admin" ? "All Org Tasks" : "Team Tasks"}
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

          {/* Labeled Filters Panel Toggle */}
          <button
            ref={filtersTriggerRef}
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="tasks-filters-panel"
            onClick={() => setFiltersOpen((prev) => !prev)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer border focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-none select-none",
              filtersOpen || activePanelFilterCount > 0
                ? "bg-black text-white border-black shadow-xs"
                : "bg-white text-black border-[#E6E6E6] hover:bg-[#F5F5F5]"
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filters</span>
            {activePanelFilterCount > 0 && (
              <span
                className={cn(
                  "px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono",
                  filtersOpen || activePanelFilterCount > 0
                    ? "bg-white text-black"
                    : "bg-black text-white"
                )}
              >
                {activePanelFilterCount}
              </span>
            )}
            <ChevronDown
              className={cn(
                "w-3 h-3 transition-transform duration-150",
                filtersOpen && "rotate-180"
              )}
            />
          </button>
        </div>

        {/* Immediate Search Input */}
        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-[#808080] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search task title or description..."
            className="w-full pl-9 pr-8 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black placeholder:text-[#808080] focus:outline-none focus:border-black"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#808080] hover:text-black cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Labeled Filters Panel (Houses the 7 Filter Categories Cleanly) */}
      {filtersOpen && (
        <div
          id="tasks-filters-panel"
          ref={filtersPanelRef}
          role="region"
          aria-label="Task Filters"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setFiltersOpen(false);
              filtersTriggerRef.current?.focus();
            }
          }}
          className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E6E6E6] space-y-3.5 animate-in fade-in-0 duration-150 focus:outline-none"
        >
          <div className="flex items-center justify-between pb-2.5 border-b border-[#E6E6E6]">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-black" />
              <h2 className="text-xs font-bold text-black uppercase tracking-wider">
                Filters
              </h2>
              {activePanelFilterCount > 0 && (
                <span className="text-[11px] font-semibold text-[#808080]">
                  ({activePanelFilterCount} active)
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {activePanelFilterCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllFilters}
                  className="text-xs font-semibold text-[#808080] hover:text-black underline cursor-pointer"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                aria-label="Close filters panel"
                onClick={() => {
                  setFiltersOpen(false);
                  filtersTriggerRef.current?.focus();
                }}
                className="p-1 rounded-md text-[#808080] hover:text-black cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 7 Filter Categories inside the Panel */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
            {/* 1. Status */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#4D4D4D]">
                Status
              </label>
              <FilterDropdownMenu
                label="All Statuses"
                value={statusFilter}
                ariaLabel="Filter by status"
                options={[
                  { value: "all", label: "All Statuses" },
                  ...STATUS_COLUMNS.map((c) => ({ value: c.key, label: c.label })),
                ]}
                onSelect={setStatusFilter}
              />
            </div>

            {/* 2. Priority */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#4D4D4D]">
                Priority
              </label>
              <FilterDropdownMenu
                label="All Priorities"
                value={priorityFilter}
                ariaLabel="Filter by priority"
                options={[
                  { value: "all", label: "All Priorities" },
                  ...PRIORITY_OPTIONS.map((p) => ({
                    value: p,
                    label: `Priority: ${p.charAt(0).toUpperCase() + p.slice(1)}`,
                  })),
                ]}
                onSelect={setPriorityFilter}
              />
            </div>

            {/* 3. Task Type */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#4D4D4D]">
                Task Type
              </label>
              <FilterDropdownMenu
                label="All Types"
                value={typeFilter}
                ariaLabel="Filter by type"
                options={[
                  { value: "all", label: "All Types" },
                  ...taskTypes.map((t) => ({ value: t.id, label: `Type: ${t.name}` })),
                ]}
                onSelect={setTypeFilter}
              />
            </div>

            {/* 4. Schedule (Recurring vs One-time) */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#4D4D4D]">
                Schedule
              </label>
              <FilterDropdownMenu
                label="All Schedules"
                value={recurringFilter}
                ariaLabel="Filter by recurring"
                options={[
                  { value: "all", label: "All Schedules" },
                  { value: "recurring", label: "🔁 Recurring Only" },
                  { value: "one_time", label: "One-Time Only" },
                ]}
                onSelect={setRecurringFilter}
              />
            </div>

            {/* 5. Due Date */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#4D4D4D]">
                Due Date
              </label>
              <FilterDropdownMenu
                label="All Due Dates"
                value={dueFilter}
                ariaLabel="Filter by due state"
                options={[
                  { value: "all", label: "All Due Dates" },
                  { value: "overdue", label: "Overdue Only" },
                  { value: "due_soon", label: "Due Soon" },
                  { value: "upcoming", label: "Upcoming" },
                  { value: "none", label: "No Due Date" },
                ]}
                onSelect={setDueFilter}
              />
            </div>

            {/* 6. Assignee */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#4D4D4D]">
                Assignee
              </label>
              <FilterDropdownMenu
                label="All Assignees"
                value={assigneeFilter}
                ariaLabel="Filter by assignee"
                options={[
                  { value: "all", label: "All Assignees" },
                  { value: "unassigned", label: "Unassigned" },
                  ...employees.map((emp) => ({
                    value: emp.id,
                    label: emp.full_name || emp.email,
                  })),
                ]}
                onSelect={setAssigneeFilter}
              />
            </div>

            {/* 7. Project */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#4D4D4D]">
                Project
              </label>
              <FilterDropdownMenu
                label="All Projects"
                value={projectFilter}
                ariaLabel="Filter by project"
                options={[
                  { value: "all", label: "All Projects" },
                  { value: "none", label: "No Project" },
                  ...projects.map((p) => ({
                    value: p.id,
                    label: p.code ? `${p.code} · ${p.name}` : p.name,
                  })),
                ]}
                onSelect={setProjectFilter}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#E6E6E6]">
            <span className="text-[11px] text-[#808080]">
              Showing {filteredTasks.length} matching tasks
            </span>
            <button
              type="button"
              onClick={() => {
                setFiltersOpen(false);
                filtersTriggerRef.current?.focus();
              }}
              className="px-4 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer shadow-xs"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Active Filter Chips & Clear Filters Action */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
          <span className="text-[11px] text-[#808080] font-medium mr-1">Active filters:</span>
          {statusFilter !== "all" && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E6E6E6] text-black text-[11px] font-medium">
              Status: {STATUS_COLUMNS.find((c) => c.key === statusFilter)?.label}
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className="hover:text-[#FF1493] cursor-pointer"
                aria-label="Remove status filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {priorityFilter !== "all" && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E6E6E6] text-black text-[11px] font-medium">
              Priority: {priorityFilter.charAt(0).toUpperCase() + priorityFilter.slice(1)}
              <button
                type="button"
                onClick={() => setPriorityFilter("all")}
                className="hover:text-[#FF1493] cursor-pointer"
                aria-label="Remove priority filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {typeFilter !== "all" && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E6E6E6] text-black text-[11px] font-medium">
              Type: {taskTypes.find((t) => t.id === typeFilter)?.name || "Selected"}
              <button
                type="button"
                onClick={() => setTypeFilter("all")}
                className="hover:text-[#FF1493] cursor-pointer"
                aria-label="Remove type filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {recurringFilter !== "all" && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E6E6E6] text-black text-[11px] font-medium">
              Schedule: {recurringFilter === "recurring" ? "Recurring" : "One-time"}
              <button
                type="button"
                onClick={() => setRecurringFilter("all")}
                className="hover:text-[#FF1493] cursor-pointer"
                aria-label="Remove schedule filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {dueFilter !== "all" && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E6E6E6] text-black text-[11px] font-medium">
              Due: {dueFilter.replace("_", " ")}
              <button
                type="button"
                onClick={() => setDueFilter("all")}
                className="hover:text-[#FF1493] cursor-pointer"
                aria-label="Remove due filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {assigneeFilter !== "all" && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E6E6E6] text-black text-[11px] font-medium">
              Assignee: {assigneeFilter === "unassigned" ? "Unassigned" : (employees.find((e) => e.id === assigneeFilter)?.full_name || "Assigned")}
              <button
                type="button"
                onClick={() => setAssigneeFilter("all")}
                className="hover:text-[#FF1493] cursor-pointer"
                aria-label="Remove assignee filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {projectFilter !== "all" && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E6E6E6] text-black text-[11px] font-medium">
              Project: {projectFilter === "none" ? "No project" : (projects.find((p) => p.id === projectFilter)?.name || "Project")}
              <button
                type="button"
                onClick={() => setProjectFilter("all")}
                className="hover:text-[#FF1493] cursor-pointer"
                aria-label="Remove project filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {searchQuery.trim() && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E6E6E6] text-black text-[11px] font-medium">
              Search: "{searchQuery}"
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="hover:text-[#FF1493] cursor-pointer"
                aria-label="Remove search query"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={handleClearAllFilters}
            className="text-[11px] font-semibold text-[#808080] hover:text-black underline ml-1 cursor-pointer"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Main Board or List Area */}
      {isLoading ? (
        <div className="p-16 text-center text-xs text-[#808080]">Loading workplace tasks...</div>
      ) : filteredTasks.length === 0 ? (
        tasks.length === 0 ? (
          <EmptyState
            title="No tasks yet"
            description="Create your first task to track work and deliverables."
            action={
              <button
                type="button"
                onClick={handleOpenCreateModal}
                className="px-4 py-2 text-xs font-semibold bg-black hover:bg-[#1A1A1A] text-white rounded-lg cursor-pointer"
              >
                New task
              </button>
            }
          />
        ) : (
          <EmptyState
            title="No tasks match these filters"
            description="Try clearing or adjusting filters to view existing tasks."
            action={
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="px-4 py-2 text-xs font-semibold bg-white border border-[#E6E6E6] hover:bg-[#F5F5F5] text-black rounded-lg cursor-pointer"
              >
                Clear filters
              </button>
            }
          />
        )
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

                      const hasAcceptAction = task.status === "todo" && task.assignee_id === userId && task.creator_id !== userId;

                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => handleOpenTask(task.id)}
                          className="w-full text-left p-3.5 rounded-[12px] bg-white hover:border-black/40 border border-[#E6E6E6] shadow-none transition-all cursor-pointer flex flex-col justify-between h-[160px] min-h-[160px] max-h-[160px] focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-none"
                        >
                          <div className="space-y-2 w-full">
                            <div className="flex items-center justify-between gap-1.5 h-6">
                              <div className="flex items-center gap-1.5 flex-wrap overflow-hidden">
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

                            <p className="text-xs font-semibold text-black line-clamp-2 leading-snug h-[2.25rem] flex items-start overflow-hidden" title={task.title}>
                              {task.title}
                            </p>

                            <div className="flex items-center gap-1.5 h-5 overflow-hidden text-[11px]">
                              {task.due_date ? (
                                <DueBadge dueDate={task.due_date} status={task.status} />
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] text-[#A3A3A3]">
                                  <Calendar className="w-2.5 h-2.5" /> No deadline
                                </span>
                              )}
                              {task.assignee_id && task.creator_id === task.assignee_id && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#F5F5F5] text-black border border-[#E6E6E6] truncate max-w-[100px]">
                                  <UserCheck className="w-2.5 h-2.5" />
                                  Self
                                </span>
                              )}
                              {task.assignee_id && task.creator_id !== task.assignee_id && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-normal bg-[#F5F5F5] text-[#808080] truncate max-w-[120px]">
                                  From: {formatPerson(task.creator_id)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="w-full pt-2 border-t border-[#E6E6E6] mt-auto">
                            <div className="flex items-center justify-between text-[11px] text-[#808080] gap-2 h-6">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="w-4 h-4 rounded-full bg-[#E6E6E6] text-black font-semibold text-[8px] flex items-center justify-center shrink-0">
                                  {initials}
                                </span>
                                <span className="truncate font-medium text-[#4D4D4D] text-[11px]">
                                  {assigneeName}
                                </span>
                              </div>

                              {hasAcceptAction && (
                                <span
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
                                  className="px-2 py-0.5 rounded-md bg-black hover:bg-[#1A1A1A] text-white text-[10px] font-semibold transition-all shrink-0 cursor-pointer shadow-xs"
                                  title="Accept task and move to In Progress"
                                >
                                  ✓ Accept
                                </span>
                              )}
                            </div>
                          </div>
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
                    onClick={() => handleOpenTask(task.id)}
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
            if (e.target === e.currentTarget) handleCloseCreateModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-task-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCloseCreateModal();
            }}
            className="w-full max-w-xl bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-6 space-y-4 max-h-[92vh] overflow-y-auto animate-in fade-in duration-150"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#E6E6E6]">
              <h2 id="create-task-title" className="text-base font-bold text-black text-left">
                Create new task
              </h2>
              <button
                type="button"
                aria-label="Close create task dialog"
                onClick={handleCloseCreateModal}
                className="p-1 rounded text-[#808080] hover:text-black cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3.5 text-left">
              {/* Type Dropdown (First Field, Grouped by Department) */}
              <div>
                <label className="block text-xs font-bold text-black mb-1">
                  Task type & preset
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
                  Task title *
                </label>
                <input
                  required
                  minLength={2}
                  value={newTitle}
                  onChange={(e) => {
                    setNewTitle(e.target.value);
                    editedFields.current.add("title");
                  }}
                  placeholder="e.g., Audit Q4 payroll shifts, Fix login redirect..."
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black focus:outline-none focus:border-black"
                />
              </div>

              {/* Description Template */}
              <div>
                <label className="block text-xs font-bold text-black mb-1">
                  Description / template
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
                    Sub-tasks from checklist (optional)
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

              {/* Priority & Estimated Duration Row */}
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
                    Estimated Duration
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="Hours"
                        value={estHours}
                        onChange={(e) => {
                          setEstHours(e.target.value);
                          editedFields.current.add("estimate");
                        }}
                        className="w-full px-2.5 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
                      />
                      <span className="text-xs text-[#808080]">h</span>
                    </div>
                    <div className="flex-1 flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={59}
                        placeholder="Mins"
                        value={estMinutes}
                        onChange={(e) => {
                          setEstMinutes(e.target.value);
                          editedFields.current.add("estimate");
                        }}
                        className="w-full px-2.5 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
                      />
                      <span className="text-xs text-[#808080]">m</span>
                    </div>
                  </div>
                  {historicalMedianEstimate && (
                    <button
                      type="button"
                      onClick={() => {
                        setEstHours(historicalMedianEstimate.h);
                        setEstMinutes(historicalMedianEstimate.m);
                        editedFields.current.add("estimate");
                      }}
                      className="mt-1 text-[10px] text-[#4D4D4D] hover:text-black underline cursor-pointer"
                    >
                      History suggests ~{historicalMedianEstimate.label}
                    </button>
                  )}
                </div>
              </div>

              {/* Due Date Presets: Today, Tomorrow, Day After Tomorrow, Custom Date */}
              <div className="space-y-2 p-3.5 rounded-xl bg-[#F9F9F9] border border-[#E6E6E6]">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-black flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-black" />
                    Due date
                  </label>
                  {newDueDate ? (
                    <span className="text-[11px] font-medium text-black">
                      Deadline: <span className="font-bold underline">{formatDueDateDisplay(newDueDate)}</span> ({newDueDate})
                    </span>
                  ) : (
                    <span className="text-[11px] text-[#808080]">Optional deadline</span>
                  )}
                </div>

                {/* Preset Buttons */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNewDueDate(getPresetDateIso(0));
                      setShowCustomDatePicker(false);
                      setAutoDueSuggested(false);
                      setSuggestedDueText("");
                      editedFields.current.add("dueDate");
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer",
                      newDueDate === getPresetDateIso(0)
                        ? "bg-black text-white border-black shadow-xs"
                        : "bg-white hover:bg-[#F5F5F5] border-[#E6E6E6] text-black"
                    )}
                  >
                    Today
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setNewDueDate(getPresetDateIso(1));
                      setShowCustomDatePicker(false);
                      setAutoDueSuggested(false);
                      setSuggestedDueText("");
                      editedFields.current.add("dueDate");
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer",
                      newDueDate === getPresetDateIso(1)
                        ? "bg-black text-white border-black shadow-xs"
                        : "bg-white hover:bg-[#F5F5F5] border-[#E6E6E6] text-black"
                    )}
                  >
                    Tomorrow
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setNewDueDate(getPresetDateIso(2));
                      setShowCustomDatePicker(false);
                      setAutoDueSuggested(false);
                      setSuggestedDueText("");
                      editedFields.current.add("dueDate");
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer",
                      newDueDate === getPresetDateIso(2)
                        ? "bg-black text-white border-black shadow-xs"
                        : "bg-white hover:bg-[#F5F5F5] border-[#E6E6E6] text-black"
                    )}
                  >
                    Day after tomorrow
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomDatePicker(!showCustomDatePicker);
                      editedFields.current.add("dueDate");
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer",
                      Boolean(
                        newDueDate &&
                          newDueDate !== getPresetDateIso(0) &&
                          newDueDate !== getPresetDateIso(1) &&
                          newDueDate !== getPresetDateIso(2)
                      )
                        ? "bg-black text-white border-black shadow-xs"
                        : "bg-white hover:bg-[#F5F5F5] border-[#E6E6E6] text-black"
                    )}
                  >
                    <Calendar className="w-3 h-3" />
                    <span>
                      {Boolean(
                        newDueDate &&
                          newDueDate !== getPresetDateIso(0) &&
                          newDueDate !== getPresetDateIso(1) &&
                          newDueDate !== getPresetDateIso(2)
                      )
                        ? `Custom: ${newDueDate}`
                        : "Custom date..."}
                    </span>
                  </button>

                  {newDueDate && (
                    <button
                      type="button"
                      onClick={() => {
                        setNewDueDate("");
                        setShowCustomDatePicker(false);
                        setAutoDueSuggested(false);
                        setSuggestedDueText("");
                        editedFields.current.add("dueDate");
                      }}
                      className="px-2 py-1 text-[11px] font-bold text-[#808080] hover:text-black cursor-pointer ml-auto"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Custom Date Input */}
                {(showCustomDatePicker ||
                  Boolean(
                    newDueDate &&
                      newDueDate !== getPresetDateIso(0) &&
                      newDueDate !== getPresetDateIso(1) &&
                      newDueDate !== getPresetDateIso(2)
                  )) && (
                  <div className="pt-1.5 flex items-center gap-2">
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
                      className="px-3 py-1.5 rounded-lg bg-white border border-black text-xs font-semibold text-black focus:outline-none"
                    />
                    <span className="text-[11px] text-[#808080]">
                      Pick any specific calendar deadline
                    </span>
                  </div>
                )}

                {/* Suggested Due Date Chip from Type Preset */}
                {suggestedDueText && newDueDate && autoDueSuggested && (
                  <div className="mt-1 flex items-center justify-between text-[11px] text-[#4D4D4D] bg-white border border-[#E6E6E6] rounded px-2.5 py-1">
                    <span>Preset suggested due date: <strong>{suggestedDueText}</strong></span>
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

              {/* Grouped Optional Settings Accordion: Recurrence, Projects & KPI Goals */}
              <div className="pt-1 border-t border-[#E6E6E6]">
                <button
                  type="button"
                  onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                  className="flex items-center justify-between w-full py-2 text-xs font-bold text-[#4D4D4D] hover:text-black cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Repeat className="w-3.5 h-3.5 text-[#808080]" />
                    <span>Additional options (Schedule, Project, Performance Goal)</span>
                    {(isRepeating || newProjectId || newGoalId) && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-black text-white ml-1">
                        Active
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 transition-transform duration-150 text-[#808080]",
                      (showAdvancedOptions || isRepeating || newProjectId || newGoalId) && "rotate-180"
                    )}
                  />
                </button>

                {(showAdvancedOptions || isRepeating || newProjectId || newGoalId) && (
                  <div className="p-3.5 rounded-xl bg-[#FAFAFA] border border-[#E6E6E6] space-y-3.5 mt-1 animate-in fade-in-0 duration-150">
                    {/* Repeat Schedule */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-black flex items-center gap-1.5">
                          <Repeat className="w-3.5 h-3.5 text-black" />
                          Repeat schedule
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-[#4D4D4D] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isRepeating}
                            onChange={(e) => setIsRepeating(e.target.checked)}
                            className="rounded text-black"
                          />
                          <span>Repeating task</span>
                        </label>
                      </div>

                      {isRepeating && (
                        <div className="p-3 rounded-xl bg-white border border-[#E6E6E6] space-y-3">
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
                                  Day of week
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
                                  Day of month (clamped)
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
                                  Interval (N working days)
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
                                End date (optional)
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
                          Project
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

                    {/* Linked KPI Goal (Phase 5) */}
                    {FEATURES.KPI && assigneeGoals.length > 0 && (
                      <div>
                        <label className="block text-xs font-bold text-black mb-1">
                          Performance goal
                        </label>
                        <select
                          aria-label="Link to KPI Goal"
                          value={newGoalId}
                          onChange={(e) => setNewGoalId(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none focus:border-black"
                        >
                          <option value="">No Goal Linked</option>
                          {assigneeGoals.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.title} ({g.status.replace("_", " ")})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E6E6]">
                <button
                  type="button"
                  onClick={handleCloseCreateModal}
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

      {/* Log Time Prompt Modal */}
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
                className="px-4 py-1.5 text-xs font-semibold bg-black hover:bg-[#1A1A1A] text-white rounded-lg cursor-pointer"
              >
                Log time
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
                  {mutations.createProject.isPending ? "Creating..." : "Save Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Task Slide-Over Drawer: Clarified with Title, Status, Assignee & Due Date First */}
      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseDrawer();
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Task Details"
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCloseDrawer();
            }}
            className="w-full max-w-xl bg-white h-full overflow-y-auto border-l border-[#E6E6E6] shadow-xl p-6 space-y-4 animate-in slide-in-from-right duration-200 focus:outline-none"
          >
            {/* Header: Title, Close Button & Badges First */}
            <div className="space-y-3 pb-3 border-b border-[#E6E6E6]">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-extrabold text-black tracking-tight leading-snug">
                  {selectedTask.title}
                </h2>
                <button
                  type="button"
                  aria-label="Close task drawer"
                  onClick={handleCloseDrawer}
                  className="p-1.5 rounded-lg text-[#808080] hover:text-black hover:bg-[#F5F5F5] cursor-pointer shrink-0 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Status and Category Badges */}
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill status={selectedTask.status} />
                <StatusPill status={selectedTask.priority} />
                {selectedTask.task_type_id && (
                  <TaskTypeBadge typeName={typeNameMap.get(selectedTask.task_type_id)} />
                )}
                {selectedTask.project_id && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F5F5F5] border border-[#E6E6E6] text-[#4D4D4D]">
                    Project: {projectNameMap.get(selectedTask.project_id) || "Assigned Project"}
                  </span>
                )}
                {selectedTask.recurrence_id && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F5F5F5] border border-[#E6E6E6] text-black">
                    <Repeat className="w-3 h-3 text-black" />
                    Recurring
                  </span>
                )}
              </div>
            </div>

            {/* Primary Attributes Card: Assignee & Due Date First */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#FAFAFA] border border-[#E6E6E6] text-xs">
              {/* Assignee Details & Quick Reassignment */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#808080] flex items-center gap-1">
                  <UserCheck className="w-3 h-3 text-black" />
                  Assignee
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-black text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                    {getInitials(formatPerson(selectedTask.assignee_id))}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-black truncate">
                      {formatPerson(selectedTask.assignee_id)}
                    </p>
                    <p className="text-[10px] text-[#808080]">
                      {selectedTask.assignee_id && selectedTask.creator_id === selectedTask.assignee_id
                        ? "Self-Assigned"
                        : `Assigned by ${formatPerson(selectedTask.creator_id)}`}
                    </p>
                  </div>
                </div>

                {canReassignTask(selectedTask) && (
                  <div className="pt-1">
                    <select
                      aria-label="Reassign task"
                      value={selectedTask.assignee_id || ""}
                      onChange={(e) =>
                        mutations.assignTask.mutate({
                          taskId: selectedTask.id,
                          assigneeId: e.target.value || null,
                        })
                      }
                      className="w-full px-2 py-1 rounded-md bg-white border border-[#E6E6E6] text-[11px] font-semibold text-black"
                    >
                      <option value="">Unassigned</option>
                      {assignableEmployees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.full_name || emp.email}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Due Date Details */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#808080] flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-black" />
                  Due Date
                </span>
                <div>
                  {selectedTask.due_date ? (
                    <div className="space-y-1">
                      <DueBadge dueDate={selectedTask.due_date} status={selectedTask.status} />
                      <p className="font-semibold text-black text-xs">
                        {formatDueDateDisplay(selectedTask.due_date)} ({selectedTask.due_date})
                      </p>
                    </div>
                  ) : (
                    <span className="text-xs text-[#808080] italic">No deadline set</span>
                  )}
                </div>
              </div>
            </div>

            {/* Surface Blocker Reason prominently when task is blocked */}
            {selectedTask.status === "blocked" && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs space-y-1.5 animate-in fade-in-0 duration-150">
                <div className="flex items-center gap-1.5 font-bold text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Task is currently blocked</span>
                </div>
                <p className="text-amber-800 leading-relaxed font-medium pl-5.5">
                  {blockerReason ? (
                    <>
                      <strong className="text-amber-950 font-bold">Reason:</strong> {blockerReason}
                    </>
                  ) : (
                    "This task is marked as blocked and waiting for resolution before execution can resume."
                  )}
                </p>
              </div>
            )}

            {/* Permitted Next Action Toolbar with Clear Context-Specific Labels */}
            <div className="space-y-2 pt-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                {/* 1. To Do State Next Actions */}
                {selectedTask.status === "todo" && (
                  <>
                    <button
                      type="button"
                      disabled={mutations.updateTaskStatus.isPending}
                      onClick={() =>
                        mutations.updateTaskStatus.mutate({
                          taskId: selectedTask.id,
                          status: "in_progress",
                          note:
                            selectedTask.assignee_id === userId &&
                            selectedTask.creator_id !== userId
                              ? "Accepted assigned task"
                              : undefined,
                        })
                      }
                      className="px-3.5 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer shadow-xs inline-flex items-center gap-1.5"
                    >
                      <Play className="w-3 h-3 fill-white" />
                      <span>
                        {selectedTask.assignee_id === userId &&
                        selectedTask.creator_id !== userId
                          ? "Accept task"
                          : "Start progress"}
                      </span>
                    </button>

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
                      className="px-3 py-1.5 rounded-lg bg-white border border-[#E6E6E6] hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer shadow-xs inline-flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Complete task</span>
                    </button>
                  </>
                )}

                {/* 2. In Progress State Next Actions */}
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
                      className="px-3.5 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer shadow-xs inline-flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {selectedTask.recurrence_id
                          ? "Complete this occurrence"
                          : "Mark complete"}
                      </span>
                    </button>

                    {/* Blocked Reason Prompt */}
                    {blockingTaskId === selectedTask.id ? (
                      <div className="w-full mt-2 p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                        <label className="text-xs font-bold text-amber-900 block">
                          Reason for blocking (Optional)
                        </label>
                        <input
                          type="text"
                          value={blockingReason}
                          onChange={(e) => setBlockingReason(e.target.value)}
                          placeholder="e.g. Waiting on API credentials, customer sign-off..."
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
                        className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold cursor-pointer hover:bg-amber-100"
                      >
                        Mark Blocked
                      </button>
                    )}
                  </>
                )}

                {/* 3. Blocked State Next Actions */}
                {selectedTask.status === "blocked" && (
                  <button
                    type="button"
                    disabled={mutations.updateTaskStatus.isPending}
                    onClick={() =>
                      mutations.updateTaskStatus.mutate({
                        taskId: selectedTask.id,
                        status: "in_progress",
                        note: "Resumed progress from blocked status",
                      })
                    }
                    className="px-4 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer shadow-xs inline-flex items-center gap-1.5"
                  >
                    <Play className="w-3 h-3 fill-white" />
                    <span>Resume progress</span>
                  </button>
                )}

                {/* 4. Done / Cancelled State: Reopen */}
                {canReopenTask(selectedTask) && (
                  <button
                    type="button"
                    disabled={mutations.updateTaskStatus.isPending}
                    onClick={() =>
                      mutations.updateTaskStatus.mutate({
                        taskId: selectedTask.id,
                        status: "in_progress",
                        note: "Reopened task",
                      })
                    }
                    className="px-3.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer shadow-xs inline-flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reopen task</span>
                  </button>
                )}
              </div>
            </div>

            {/* Recurring Task Distinction: Distinguish single occurrence vs stopping series */}
            {selectedTask.recurrence_id && (
              <div className="p-3.5 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-black">
                    <Repeat className="w-4 h-4 text-black shrink-0" />
                    <span>{recurrenceScheduleLabel}</span>
                  </div>
                  {canStopRecurrence(selectedTask) && (
                    <button
                      type="button"
                      onClick={() => mutations.stopRecurrence.mutate(selectedTask.recurrence_id!)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-red-600 border border-red-200 rounded hover:bg-red-50 cursor-pointer"
                    >
                      Stop series permanently
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[#808080]">
                  Completing this task finishes only the current occurrence. Future occurrences will continue according to schedule unless the series is stopped.
                </p>
              </div>
            )}

            {/* Parent Task Gentle Completion Banner */}
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
                  className="px-3 py-1 text-xs font-semibold bg-black hover:bg-[#1A1A1A] text-white rounded-lg whitespace-nowrap cursor-pointer"
                >
                  Mark done
                </button>
              </div>
            )}

            {/* Description */}
            {selectedTask.description && (
              <div className="p-3.5 rounded-xl bg-[#F9F9F9] border border-[#E6E6E6] text-xs text-black leading-relaxed whitespace-pre-wrap">
                {selectedTask.description}
              </div>
            )}

            {/* Linked KPI Goal (Phase 5) */}
            {FEATURES.KPI && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6]">
                <div className="flex items-center gap-2 text-xs">
                  <Target className="w-4 h-4 text-black" />
                  <span className="font-semibold text-[#808080]">Linked goal:</span>
                  <span className="font-bold text-black truncate max-w-[180px]">
                    {drawerGoals.find((g) => g.id === selectedTask.goal_id)?.title || (selectedTask.goal_id ? "Active goal" : "None")}
                  </span>
                </div>

                <select
                  aria-label="Link task to KPI goal"
                  value={selectedTask.goal_id || ""}
                  onChange={(e) =>
                    mutations.linkTaskGoal.mutate({
                      taskId: selectedTask.id,
                      goalId: e.target.value || null,
                    })
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black max-w-[220px]"
                >
                  <option value="">No goal linked</option>
                  {drawerGoals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Cancellation Option */}
            {canCancelTask(selectedTask) && (
              <div className="flex items-center gap-2 pt-1">
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
                  className="px-3 py-1.5 rounded-lg bg-red-50 text-[#FF1493] border border-red-200 text-xs font-bold cursor-pointer"
                >
                  Cancel Task
                </button>
              </div>
            )}

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
                            st.status === "done" ? "bg-[#B7FF00] border-black text-black" : "border-[#808080] bg-white"
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
                    aria-label="Task comment"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="Leave an update or blocker note..."
                    className="flex-1 px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
                  />
                  <button
                    type="submit"
                    aria-label="Send comment"
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

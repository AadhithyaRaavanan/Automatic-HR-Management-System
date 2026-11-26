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
import { formatFriendlyDueState } from "@/features/tasks/task-due";
import { TaskPriority, TaskStatus } from "@/types/database.types";
import { TaskType, TaskRecurrence } from "@/features/tasks/types";
import { calculateWorkingDaysAhead } from "@/lib/date/working-days";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
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
  Layers,
  ArrowRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Check,
  Target,
  Users,
  Download,
  Trash2,
} from "lucide-react";

const STATUS_COLUMNS: Array<{ key: TaskStatus; label: string; hint: string }> = [
  { key: "todo", label: "To Do", hint: "Queued work" },
  { key: "in_progress", label: "In Progress", hint: "Active execution" },
  { key: "blocked", label: "Blocked", hint: "Needs unblocking" },
  { key: "done", label: "Completed", hint: "Finished work" },
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
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold max-w-full",
        info.colorClass
      )}
    >
      <Clock className="w-2.5 h-2.5 shrink-0" />
      <span className="truncate">{info.label}</span>
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
  const stripped = name.replace(/^You\s*\(([^)]+)\)$/i, "$1").trim();
  const parts = stripped.split(/\s+/);
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
            "inline-flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer select-none",
            isFiltered
              ? "bg-black text-white border-black"
              : "bg-white text-black border-[#E6E6E6] hover:bg-[#F5F5F5]"
          )}
        >
          <span className="truncate max-w-[125px]">{displayLabel}</span>
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

type TableSortColumn = "title" | "assignee" | "status" | "priority" | "due_date";

const STATUS_SORT_ORDER: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 1,
  blocked: 2,
  done: 3,
  cancelled: 4,
};

const PRIORITY_SORT_ORDER: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};

function SortableTableHeader({
  label,
  column,
  activeColumn,
  direction,
  onSort,
}: {
  label: string;
  column: TableSortColumn;
  activeColumn: TableSortColumn | null;
  direction: "asc" | "desc";
  onSort: (col: TableSortColumn) => void;
}) {
  const isActive = activeColumn === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider cursor-pointer select-none transition-colors",
        isActive ? "text-black" : "text-[#4D4D4D] hover:text-black"
      )}
    >
      <span>{label}</span>
      {isActive ? (
        direction === "asc" ? (
          <ArrowUp className="w-3 h-3 text-black shrink-0" />
        ) : (
          <ArrowDown className="w-3 h-3 text-black shrink-0" />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3 text-[#A3A3A3] shrink-0" />
      )}
    </button>
  );
}

interface TaskTableRowProps {
  task: TaskRecord;
  assigneeName: string;
  initials: string;
  typeName: string | null | undefined;
  projectName: string | null | undefined;
  userId: string | null;
  canManageProjects: boolean;
  isSelected: boolean;
  isStatusPending: boolean;
  onToggleSelect: (taskId: string) => void;
  onSelect: (taskId: string) => void;
  onUpdateStatus: (taskId: string, status: TaskStatus, note?: string) => void;
  onRejectTask: (task: TaskRecord) => void;
  onCompleteTask: (task: TaskRecord) => void;
}

/**
 * Compact enterprise table row shared across flat and assignee-grouped List views.
 */
function TaskTableRow({
  task,
  assigneeName,
  initials,
  typeName,
  projectName,
  userId,
  canManageProjects,
  isSelected,
  isStatusPending,
  onToggleSelect,
  onSelect,
  onUpdateStatus,
  onRejectTask,
  onCompleteTask,
}: TaskTableRowProps) {
  const canAcceptOrReject =
    task.status === "todo" && task.assignee_id === userId;
  const canActInProgress =
    task.status === "in_progress" &&
    (task.assignee_id === userId || canManageProjects);

  return (
    <tr
      onClick={() => onSelect(task.id)}
      className={cn(
        "hover:bg-gray-50 cursor-pointer transition-colors",
        isSelected && "bg-[#F5F5F5]"
      )}
    >
      <td
        className="py-2.5 px-3 w-10 align-middle"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isSelected}
          aria-label={`Select task ${task.title}`}
          onChange={() => onToggleSelect(task.id)}
          className="h-3.5 w-3.5 rounded border-[#B3B3B3] accent-black cursor-pointer align-middle"
        />
      </td>
      <td className="py-2.5 px-3 min-w-[220px] max-w-[340px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={cn(
              "font-semibold text-xs text-black",
              task.status === "cancelled" && "line-through text-[#808080]"
            )}
          >
            {task.title}
          </span>
          {task.assignee_id && task.creator_id === task.assignee_id && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#F5F5F5] text-black border border-[#E6E6E6]">
              Self
            </span>
          )}
        </div>
        {projectName && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F5F5F5] border border-[#E6E6E6] text-[#4D4D4D] truncate max-w-[200px]">
              {projectName}
            </span>
          </div>
        )}
      </td>
      <td className="py-2.5 px-3 whitespace-nowrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-full bg-[#E6E6E6] text-black font-semibold text-[10px] flex items-center justify-center shrink-0">
            {initials}
          </span>
          <span className="text-xs font-medium text-black truncate max-w-[160px]">
            {assigneeName}
          </span>
        </div>
      </td>
      <td
        className="py-2.5 px-3 whitespace-nowrap"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5">
          <StatusPill
            status={task.status}
            label={task.status === "done" ? "Completed" : undefined}
          />
          {canAcceptOrReject && (
            <>
              <button
                type="button"
                disabled={isStatusPending}
                onClick={() => onUpdateStatus(task.id, "in_progress", "Accepted assigned task")}
                className="px-2 py-1 rounded bg-black hover:bg-[#1A1A1A] text-white text-[10px] font-semibold cursor-pointer shadow-xs disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={isStatusPending}
                onClick={() => onRejectTask(task)}
                className="px-2 py-1 rounded border border-[#E6E6E6] bg-white hover:bg-red-50 hover:text-[#FF1493] hover:border-red-200 text-[#4D4D4D] text-[10px] font-semibold cursor-pointer disabled:opacity-50"
              >
                Reject
              </button>
            </>
          )}
          {canActInProgress && (
            <>
              <button
                type="button"
                aria-pressed="true"
                disabled={isStatusPending}
                onClick={() => {
                  if (task.status !== "in_progress") {
                    onUpdateStatus(task.id, "in_progress");
                  }
                }}
                className="px-2 py-1 rounded bg-[#B7FF00]/30 border border-[#84CC16] text-black text-[10px] font-semibold cursor-pointer disabled:opacity-50"
              >
                In Progress
              </button>
              <button
                type="button"
                disabled={isStatusPending}
                onClick={() => onCompleteTask(task)}
                className="px-2 py-1 rounded bg-black hover:bg-[#1A1A1A] text-white text-[10px] font-semibold cursor-pointer shadow-xs disabled:opacity-50"
              >
                Completed
              </button>
            </>
          )}
        </div>
      </td>
      <td className="py-2.5 px-3 whitespace-nowrap">
        <StatusPill status={task.priority} />
      </td>
      <td className="py-2.5 px-3 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {typeName ? (
            <TaskTypeBadge typeName={typeName} />
          ) : (
            <span className="text-xs text-[#808080]">—</span>
          )}
          {task.recurrence_id && (
            <span
              title="Recurring Task"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F5F5F5] border border-[#E6E6E6] text-black"
            >
              <Repeat className="w-2.5 h-2.5" />
              Recurring
            </span>
          )}
        </div>
      </td>
      <td className="py-2.5 px-3 whitespace-nowrap">
        {task.due_date ? (
          <DueBadge dueDate={task.due_date} status={task.status} />
        ) : (
          <span className="text-xs text-[#808080]">—</span>
        )}
      </td>
    </tr>
  );
}

interface KanbanTaskCardProps {
  task: TaskRecord;
  assigneeName: string;
  creatorName: string;
  initials: string;
  typeName: string | null | undefined;
  projectName: string | null | undefined;
  onSelect: (taskId: string) => void;
}

/**
 * Always-expanded Kanban task card with priority pill, read-only status pill, due badge, and assignee row.
 */
function KanbanTaskCard({
  task,
  assigneeName,
  creatorName,
  initials,
  typeName,
  projectName,
  onSelect,
}: KanbanTaskCardProps) {
  const isCancelled = task.status === "cancelled";

  return (
    <button
      type="button"
      draggable={false}
      onClick={() => onSelect(task.id)}
      className={cn(
        "w-full min-w-0 text-left p-2.5 rounded-[12px] border border-[#E6E6E6] shadow-none transition-all cursor-pointer flex flex-col justify-between gap-2.5 shrink-0 focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-none",
        isCancelled
          ? "bg-white/90 hover:bg-white hover:border-black/30 opacity-75 hover:opacity-100"
          : "bg-white hover:border-black/40"
      )}
    >
      <div className="space-y-2 w-full min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-1.5 min-h-[22px] w-full min-w-0">
          <StatusPill
            status={task.priority}
            showIcon={true}
            className="shrink-0 whitespace-nowrap"
          />
          <StatusPill
            status={task.status}
            label={task.status === "done" ? "Completed" : undefined}
            className="shrink-0 whitespace-nowrap"
          />
        </div>

        {(typeName || task.recurrence_id || projectName) && (
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {typeName && <TaskTypeBadge typeName={typeName} />}
            {task.recurrence_id && (
              <span title="Recurring Task" className="inline-flex items-center text-xs text-black">
                <Repeat className="w-3 h-3 text-black" />
              </span>
            )}
            {projectName && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F5F5F5] border border-[#E6E6E6] text-[#4D4D4D] truncate max-w-full">
                {projectName}
              </span>
            )}
          </div>
        )}

        <p
          className={cn(
            "block w-full text-xs font-semibold leading-snug line-clamp-2",
            isCancelled
              ? "text-[#4D4D4D] line-through decoration-[#B3B3B3]"
              : "text-black"
          )}
          title={task.title}
        >
          {task.title}
        </p>

        <div className="flex items-center flex-wrap gap-1.5 min-h-[22px] text-[11px] w-full min-w-0">
          {task.due_date ? (
            <DueBadge dueDate={task.due_date} status={task.status} />
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-[#A3A3A3]">
              <Calendar className="w-2.5 h-2.5" /> No deadline
            </span>
          )}
          {task.assignee_id && task.creator_id === task.assignee_id && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#F5F5F5] text-black border border-[#E6E6E6] truncate max-w-full">
              <UserCheck className="w-2.5 h-2.5" />
              Self
            </span>
          )}
          {task.assignee_id && task.creator_id !== task.assignee_id && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-normal bg-[#F5F5F5] text-[#808080] truncate max-w-full">
              From: {creatorName}
            </span>
          )}
        </div>
      </div>

      <div className="w-full pt-2 border-t border-[#E6E6E6]">
        <div className="flex items-center gap-1.5 min-h-[22px] min-w-0 w-full">
          <span className="w-5 h-5 rounded-full bg-[#E6E6E6] text-black font-semibold text-[9px] flex items-center justify-center shrink-0">
            {initials}
          </span>
          <span className="truncate font-medium text-[#4D4D4D] text-[11px] flex-1 min-w-0">
            {assigneeName}
          </span>
        </div>
      </div>
    </button>
  );
}

function TasksWorkspaceContent() {
  const {
    userId,
    userRole,
    fullName: currentUserName,
    userEmail: currentUserEmail,
  } = useAppSession();
  const { data, isLoading, refetch } = useTasksData(Boolean(userId));
  const mutations = useTaskMutations(userRole, userId);
  const isRegularEmployee = userRole === "employee" || userRole === "team_lead";

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
  const [selectedTaskIds, setSelectedTaskIds] = React.useState<Set<string>>(() => new Set());
  const [tableSortBy, setTableSortBy] = React.useState<TableSortColumn | null>(null);
  const [tableSortDir, setTableSortDir] = React.useState<"asc" | "desc">("asc");
  const [groupByAssignee, setGroupByAssignee] = React.useState<boolean>(false);
  const [groupByProject, setGroupByProject] = React.useState<boolean>(false);
  const [collapsedAssigneeGroups, setCollapsedAssigneeGroups] = React.useState<Record<string, boolean>>({});
  const [expandedProjectIds, setExpandedProjectIds] = React.useState<Record<string, boolean>>({});
  const [tablePage, setTablePage] = React.useState<number>(1);
  const [isBulkUpdating, setIsBulkUpdating] = React.useState<boolean>(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = React.useState<boolean>(false);
  const [bulkDueDateOpen, setBulkDueDateOpen] = React.useState<boolean>(false);
  const [bulkCustomDueDate, setBulkCustomDueDate] = React.useState<string>("");
  const [expandedColumn, setExpandedColumn] = React.useState<string | null>(null);
  const boardContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [createTaskOpen, setCreateTaskOpen] = React.useState(false);
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);
  const [projectToDelete, setProjectToDelete] = React.useState<{
    id: string;
    name: string;
  } | null>(null);
  const [taskToDelete, setTaskToDelete] = React.useState<TaskRecord | null>(null);
  const [rejectingTask, setRejectingTask] = React.useState<TaskRecord | null>(null);
  const [rejectReason, setRejectReason] = React.useState("");
  const [dueDateError, setDueDateError] = React.useState("");

  const toggleColumnAccordion = React.useCallback((statusId: string) => {
    setExpandedColumn((prev) => (prev === statusId ? null : statusId));
  }, []);

  React.useEffect(() => {
    if (!expandedColumn) return;

    const handleOutsideMouseDown = (event: MouseEvent) => {
      if (
        selectedTaskId ||
        createTaskOpen ||
        createProjectOpen ||
        projectToDelete ||
        taskToDelete ||
        rejectingTask
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!target || !boardContainerRef.current) return;

      // Keep column open when interacting inside a column or switching between columns
      if (target.closest("[data-kanban-column='true']")) {
        return;
      }

      setExpandedColumn(null);
    };

    document.addEventListener("mousedown", handleOutsideMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideMouseDown);
    };
  }, [
    expandedColumn,
    selectedTaskId,
    createTaskOpen,
    createProjectOpen,
    projectToDelete,
    taskToDelete,
    rejectingTask,
  ]);

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
  const [projInitialTasks, setProjInitialTasks] = React.useState<
    Array<{ localId: string; title: string; assigneeId: string | null; dueDate: string }>
  >([]);
  const [projTaskDraftTitle, setProjTaskDraftTitle] = React.useState("");
  const [projTaskDraftAssignee, setProjTaskDraftAssignee] = React.useState("");
  const [projTaskDraftDueDate, setProjTaskDraftDueDate] = React.useState(() =>
    getPresetDateIso(0)
  );
  const [isCreatingProjectWithTasks, setIsCreatingProjectWithTasks] = React.useState(false);

  const handleAddInitialProjectTask = React.useCallback(() => {
    const trimmed = projTaskDraftTitle.trim();
    if (!trimmed || !projTaskDraftDueDate) return;
    setProjInitialTasks((prev) => [
      ...prev,
      {
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: trimmed,
        assigneeId: isRegularEmployee ? userId || null : projTaskDraftAssignee || null,
        dueDate: projTaskDraftDueDate,
      },
    ]);
    setProjTaskDraftTitle("");
    setProjTaskDraftAssignee("");
    setProjTaskDraftDueDate(getPresetDateIso(0));
  }, [projTaskDraftTitle, projTaskDraftAssignee, projTaskDraftDueDate, isRegularEmployee, userId]);

  // Drawer interactions state
  const [commentBody, setCommentBody] = React.useState("");
  const [timeDate, setTimeDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [timeMinutes, setTimeMinutes] = React.useState("30");
  const [timeNote, setTimeNote] = React.useState("");

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

  const currentUserEmp = React.useMemo(() => {
    if (!userId && !currentUserName && !currentUserEmail) return undefined;
    const byId = userId ? employees.find((e) => e.id === userId) : undefined;
    if (byId) return byId;
    const targetName = currentUserName?.trim().toLowerCase();
    if (targetName && targetName !== "you") {
      const byName = employees.find(
        (e) => e.full_name?.trim().toLowerCase() === targetName
      );
      if (byName) return byName;
    }
    const targetEmail = currentUserEmail?.trim().toLowerCase();
    if (targetEmail) {
      return employees.find(
        (e) => e.email?.trim().toLowerCase() === targetEmail
      );
    }
    return undefined;
  }, [employees, userId, currentUserName, currentUserEmail]);

  const actualCurrentUserName = React.useMemo(() => {
    const empName = currentUserEmp?.full_name?.trim();
    if (empName && empName !== "You") return empName;
    const sessionName = currentUserName?.trim();
    if (sessionName && sessionName !== "You") return sessionName;
    const emailSource = currentUserEmp?.email || currentUserEmail || "";
    if (emailSource.includes("@")) return emailSource.split("@")[0];
    if (emailSource) return emailSource;
    return null;
  }, [currentUserEmp, currentUserName, currentUserEmail]);

  const isCurrentUserEmployee = React.useCallback(
    (emp: { id: string; full_name?: string | null; email?: string | null }) => {
      if (userId && emp.id === userId) return true;
      const empName = emp.full_name?.trim().toLowerCase();
      if (
        actualCurrentUserName &&
        empName &&
        empName === actualCurrentUserName.trim().toLowerCase()
      ) {
        return true;
      }
      const empEmail = emp.email?.trim().toLowerCase();
      if (
        currentUserEmail &&
        empEmail &&
        empEmail === currentUserEmail.trim().toLowerCase()
      ) {
        return true;
      }
      return false;
    },
    [userId, actualCurrentUserName, currentUserEmail]
  );

  const formatPerson = (id: string | null) => {
    if (!id) return "Unassigned";
    const empMatch = employees.find((e) => e.id === id);
    if (id === userId || (empMatch && isCurrentUserEmployee(empMatch))) {
      const mapName = employeeNameMap.get(id)?.trim();
      const resolved =
        (mapName && mapName !== "You" ? mapName : null) || actualCurrentUserName;
      return resolved ? `You (${resolved})` : "You";
    }
    return employeeNameMap.get(id) || "Team Member";
  };

  const formatAssigneeOptionLabel = (emp: {
    id: string;
    full_name: string | null;
    email: string;
  }) => {
    if (!isCurrentUserEmployee(emp)) {
      return emp.full_name || emp.email || "Team Member";
    }
    const empName = emp.full_name?.trim();
    const resolved =
      (empName && empName !== "You" ? empName : null) ||
      actualCurrentUserName ||
      (emp.email ? emp.email.split("@")[0] : null);
    return resolved ? `You (${resolved})` : "You";
  };

  // Permitted assignee choices for creating/reassigning tasks according to authority hierarchy
  const assignableEmployees = React.useMemo(() => {
    let list: typeof employees;
    if (userRole === "admin") {
      list = employees;
    } else if (userRole === "hr") {
      list = employees.filter(
        (e) =>
          isCurrentUserEmployee(e) ||
          e.role === "employee" ||
          e.role === "hr" ||
          e.role === "manager"
      );
    } else if (userRole === "manager") {
      list = employees.filter(
        (e) =>
          isCurrentUserEmployee(e) ||
          (e.role === "employee" && (!e.manager_id || e.manager_id === userId))
      );
    } else {
      list = employees.filter((e) => isCurrentUserEmployee(e));
    }

    const deduped: typeof employees = [];
    let seenSelf = false;
    for (const emp of list) {
      if (isCurrentUserEmployee(emp)) {
        if (seenSelf) continue;
        seenSelf = true;
      }
      deduped.push(emp);
    }

    if (userId && !seenSelf) {
      const existingSelf = employees.find((e) => isCurrentUserEmployee(e));
      const selfOption = existingSelf || {
        id: userId,
        full_name: actualCurrentUserName || currentUserEmail || "Current User",
        email: currentUserEmail || "",
        manager_id: null,
        status: "active",
        role: userRole,
      };
      return [selfOption, ...deduped];
    }

    return deduped;
  }, [
    employees,
    userId,
    userRole,
    actualCurrentUserName,
    currentUserEmail,
    isCurrentUserEmployee,
  ]);

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
      if (statusFilter === "open") {
        if (t.status === "done" || t.status === "cancelled") return false;
      } else if (statusFilter !== "all" && t.status !== statusFilter) {
        return false;
      }
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

  const handleSortTableColumn = React.useCallback(
    (column: TableSortColumn) => {
      if (tableSortBy === column) {
        setTableSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setTableSortBy(column);
        setTableSortDir("asc");
      }
    },
    [tableSortBy]
  );

  const toggleTableTaskSelection = React.useCallback((taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const toggleAssigneeGroup = React.useCallback((groupKey: string) => {
    setCollapsedAssigneeGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  }, []);

  const toggleProjectGroup = React.useCallback((projectKey: string) => {
    setExpandedProjectIds((prev) => ({
      ...prev,
      [projectKey]: !(prev[projectKey] ?? true),
    }));
  }, []);

  React.useEffect(() => {
    if (projectFilter !== "all") {
      const targetKey = projectFilter === "none" ? "__no_project__" : projectFilter;
      setExpandedProjectIds((prev) =>
        prev[targetKey] === true ? prev : { ...prev, [targetKey]: true }
      );
    }
  }, [projectFilter]);

  React.useEffect(() => {
    setTablePage(1);
  }, [
    scope,
    statusFilter,
    priorityFilter,
    typeFilter,
    recurringFilter,
    dueFilter,
    assigneeFilter,
    projectFilter,
    searchQuery,
    tableSortBy,
    tableSortDir,
    groupByAssignee,
    groupByProject,
  ]);

  React.useEffect(() => {
    setSelectedTaskIds((prev) => {
      if (prev.size === 0) return prev;
      const visibleIds = new Set(filteredTasks.map((t) => t.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visibleIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [filteredTasks]);

  const runBulkTaskBatch = React.useCallback(
    async (
      runItem: (taskId: string) => Promise<unknown>,
      formatSuccess: (count: number) => string,
      errorPrefix: string
    ) => {
      const targetIds = Array.from(selectedTaskIds);
      if (targetIds.length === 0 || isBulkUpdating) return;
      setIsBulkUpdating(true);
      try {
        const results = await Promise.allSettled(targetIds.map((id) => runItem(id)));
        const failedIds = new Set<string>();
        results.forEach((res, idx) => {
          if (res.status === "rejected") failedIds.add(targetIds[idx]);
        });
        const succeeded = targetIds.length - failedIds.size;
        if (failedIds.size === 0) {
          setSelectedTaskIds(new Set());
          toast.success(formatSuccess(succeeded));
        } else {
          setSelectedTaskIds(failedIds);
          toast.error(
            succeeded > 0
              ? `Updated ${succeeded} tasks, ${failedIds.size} failed`
              : `${errorPrefix} for ${failedIds.size} ${failedIds.size === 1 ? "task" : "tasks"}`
          );
        }
      } finally {
        setIsBulkUpdating(false);
      }
    },
    [selectedTaskIds, isBulkUpdating]
  );

  const handleBulkDueDateChange = React.useCallback(
    async (dueDate: string | null) => {
      setBulkDueDateOpen(false);
      setBulkCustomDueDate("");
      await runBulkTaskBatch(
        (taskId) =>
          mutations.updateTaskDueDate.mutateAsync({
            taskId,
            dueDate,
            silent: true,
          }),
        (count) =>
          dueDate
            ? `Updated due date for ${count} ${count === 1 ? "task" : "tasks"}`
            : `Cleared due date for ${count} ${count === 1 ? "task" : "tasks"}`,
        "Failed to update due date"
      );
    },
    [runBulkTaskBatch, mutations.updateTaskDueDate]
  );

  const handleBulkAssign = React.useCallback(
    async (assigneeId: string | null) => {
      await runBulkTaskBatch(
        (taskId) =>
          mutations.assignTask.mutateAsync({
            taskId,
            assigneeId,
            silent: true,
          }),
        (count) => `Reassigned ${count} ${count === 1 ? "task" : "tasks"}`,
        "Failed to reassign"
      );
    },
    [runBulkTaskBatch, mutations.assignTask]
  );

  const handleBulkDelete = React.useCallback(async () => {
    setBulkDeleteConfirmOpen(false);
    await runBulkTaskBatch(
      (taskId) =>
        mutations.deleteTask.mutateAsync({
          taskId,
          silent: true,
        }),
      (count) => `Deleted ${count} ${count === 1 ? "task" : "tasks"}`,
      "Failed to delete"
    );
  }, [runBulkTaskBatch, mutations.deleteTask]);

  const handleBulkExportCsv = React.useCallback(() => {
    const selectedTasks = filteredTasks.filter((t) => selectedTaskIds.has(t.id));
    if (selectedTasks.length === 0) return;

    const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;
    const statusLabelMap = new Map(STATUS_COLUMNS.map((c) => [c.key, c.label]));
    const headers = ["Title", "Assignee", "Status", "Priority", "Project", "Due Date"];
    const rows = selectedTasks.map((t) => [
      escapeCsv(t.title),
      escapeCsv(formatPerson(t.assignee_id)),
      escapeCsv(statusLabelMap.get(t.status) || t.status),
      escapeCsv(t.priority),
      escapeCsv(t.project_id ? projectNameMap.get(t.project_id) || "Project" : ""),
      escapeCsv(t.due_date || ""),
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `tasks-export-${getPresetDateIso(0)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${selectedTasks.length} ${selectedTasks.length === 1 ? "task" : "tasks"} to CSV`);
  }, [filteredTasks, selectedTaskIds, formatPerson, projectNameMap]);

  const TABLE_PAGE_SIZE = 20;

  const sortedListTasks = React.useMemo(() => {
    if (!tableSortBy) return filteredTasks;
    const copy = [...filteredTasks];
    const dir = tableSortDir === "asc" ? 1 : -1;

    copy.sort((a, b) => {
      if (tableSortBy === "title") {
        return a.title.localeCompare(b.title) * dir;
      }
      if (tableSortBy === "assignee") {
        const aName = formatPerson(a.assignee_id);
        const bName = formatPerson(b.assignee_id);
        return aName.localeCompare(bName) * dir;
      }
      if (tableSortBy === "status") {
        return (STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]) * dir;
      }
      if (tableSortBy === "priority") {
        return (PRIORITY_SORT_ORDER[a.priority] - PRIORITY_SORT_ORDER[b.priority]) * dir;
      }
      if (tableSortBy === "due_date") {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return a.due_date.localeCompare(b.due_date) * dir;
      }
      return 0;
    });

    return copy;
  }, [filteredTasks, tableSortBy, tableSortDir, formatPerson]);

  const totalListTasks = sortedListTasks.length;
  const totalTablePages = Math.max(1, Math.ceil(totalListTasks / TABLE_PAGE_SIZE));
  const safeTablePage = Math.min(tablePage, totalTablePages);
  const tableStartIndex = (safeTablePage - 1) * TABLE_PAGE_SIZE;
  const paginatedListTasks = React.useMemo(
    () => sortedListTasks.slice(tableStartIndex, tableStartIndex + TABLE_PAGE_SIZE),
    [sortedListTasks, tableStartIndex]
  );

  const groupedPaginatedTasks = React.useMemo(() => {
    const groups = new Map<
      string,
      { key: string; name: string; initials: string; tasks: TaskRecord[] }
    >();
    for (const task of paginatedListTasks) {
      const key = task.assignee_id || "__unassigned__";
      const existing = groups.get(key);
      if (existing) {
        existing.tasks.push(task);
      } else {
        const name = formatPerson(task.assignee_id);
        groups.set(key, {
          key,
          name,
          initials: getInitials(name),
          tasks: [task],
        });
      }
    }
    return Array.from(groups.values());
  }, [paginatedListTasks, formatPerson]);

  const groupedByProjectTasks = React.useMemo(() => {
    const projectLookup = new Map(projects.map((p) => [p.id, p]));
    const groups = new Map<
      string,
      { key: string; code: string | null; label: string; isUnassignedProject: boolean; tasks: TaskRecord[] }
    >();

    for (const task of paginatedListTasks) {
      const key = task.project_id || "__no_project__";
      const existing = groups.get(key);
      if (existing) {
        existing.tasks.push(task);
      } else if (task.project_id) {
        const proj = projectLookup.get(task.project_id);
        groups.set(key, {
          key,
          code: proj?.code || null,
          label: proj ? (proj.code ? `${proj.code} · ${proj.name}` : proj.name) : "Project",
          isUnassignedProject: false,
          tasks: [task],
        });
      } else {
        groups.set(key, {
          key,
          code: null,
          label: "No Project",
          isUnassignedProject: true,
          tasks: [task],
        });
      }
    }

    const allSortedProjectIds = new Set(
      sortedListTasks.map((t) => t.project_id).filter(Boolean) as string[]
    );

    if (safeTablePage === totalTablePages) {
      for (const proj of projects) {
        if (
          (projectFilter === "all" || projectFilter === proj.id) &&
          !allSortedProjectIds.has(proj.id) &&
          !groups.has(proj.id)
        ) {
          groups.set(proj.id, {
            key: proj.id,
            code: proj.code || null,
            label: proj.code ? `${proj.code} · ${proj.name}` : proj.name,
            isUnassignedProject: false,
            tasks: [],
          });
        }
      }
    }

    const list = Array.from(groups.values());
    // Ensure "No Project" always appears at the bottom
    return list.sort((a, b) => {
      if (a.isUnassignedProject === b.isUnassignedProject) return 0;
      return a.isUnassignedProject ? 1 : -1;
    });
  }, [paginatedListTasks, sortedListTasks, projects, projectFilter, safeTablePage, totalTablePages]);

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

  const handleSelectStatusFilter = React.useCallback(
    (nextStatus: string) => {
      setExpandedColumn(null);
      setStatusFilter(nextStatus);
      if (
        (nextStatus === "done" || nextStatus === "cancelled") &&
        (dueFilter === "overdue" || dueFilter === "due_soon")
      ) {
        setDueFilter("all");
      }
    },
    [dueFilter]
  );

  const handleSelectDueFilter = React.useCallback(
    (nextDue: string) => {
      setExpandedColumn(null);
      setDueFilter(nextDue);
      if (
        (nextDue === "overdue" || nextDue === "due_soon") &&
        (statusFilter === "done" || statusFilter === "cancelled")
      ) {
        setStatusFilter("all");
      }
    },
    [statusFilter]
  );

  const handleToggleSummaryMetric = React.useCallback(
    (metric: "open" | "overdue" | "due_soon" | "completed") => {
      setExpandedColumn(null);
      if (metric === "open") {
        if (statusFilter === "open") {
          setStatusFilter("all");
        } else {
          setStatusFilter("open");
          setDueFilter("all");
        }
        return;
      }
      if (metric === "completed") {
        if (statusFilter === "done") {
          setStatusFilter("all");
        } else {
          setStatusFilter("done");
          setDueFilter("all");
        }
        return;
      }
      if (dueFilter === metric) {
        setDueFilter("all");
      } else {
        setDueFilter(metric);
        if (statusFilter === "done" || statusFilter === "cancelled") {
          setStatusFilter("all");
        }
      }
    },
    [statusFilter, dueFilter]
  );

  const handleClearAllFilters = () => {
    setExpandedColumn(null);
    setStatusFilter("all");
    setPriorityFilter("all");
    setTypeFilter("all");
    setRecurringFilter("all");
    setDueFilter("all");
    setAssigneeFilter("all");
    setProjectFilter("all");
    setSearchQuery("");
  };

  const hasActiveFilters =
    statusFilter !== "all" ||
    priorityFilter !== "all" ||
    typeFilter !== "all" ||
    recurringFilter !== "all" ||
    dueFilter !== "all" ||
    assigneeFilter !== "all" ||
    projectFilter !== "all" ||
    searchQuery.trim().length > 0;

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

  const handleOpenCreateModal = (defaultProjectId?: string | React.MouseEvent) => {
    const resolvedProjectId =
      typeof defaultProjectId === "string" ? defaultProjectId : "";
    editedFields.current.clear();
    setSelectedTypeId("");
    setNewTitle("");
    setNewDescription("");
    setNewAssigneeId(userId || "");
    setNewPriority("medium");
    setNewDueDate(getPresetDateIso(0));
    setDueDateError("");
    setSuggestedDueText("");
    setAutoDueSuggested(false);
    setEstHours("");
    setEstMinutes("");
    setNewProjectId(resolvedProjectId);
    setSelectedChecklist([]);
    setIsRepeating(false);
    setRepeatFrequency("weekly");
    setRepeatInterval(1);
    setRepeatWeekday(1);
    setRepeatDayOfMonth(1);
    setRepeatEndDate("");
    setNewGoalId("");
    setCreateTaskOpen(true);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newTitle.trim().length < 2) return;
    if (!newDueDate.trim()) {
      setDueDateError("Due date is required");
      return;
    }
    setDueDateError("");
    const totalMinutes =
      (parseInt(estHours || "0", 10) * 60) + parseInt(estMinutes || "0", 10);
    const effectiveAssigneeId = isRegularEmployee
      ? userId || null
      : newAssigneeId || null;
    const isSelf = Boolean(effectiveAssigneeId && effectiveAssigneeId === userId);

    try {
      await mutations.createTask.mutateAsync({
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        assigneeId: effectiveAssigneeId,
        priority: newPriority,
        dueDate: newDueDate,
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

      setCreateTaskOpen(false);
    } catch {
      // Toast handled in mutation onError
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (projName.trim().length < 2 || isCreatingProjectWithTasks) return;

    const queuedTasks = projInitialTasks;
    setIsCreatingProjectWithTasks(true);
    try {
      const projRes = await mutations.createProject.mutateAsync({
        name: projName.trim(),
        code: projCode.trim() || null,
        departmentId: projDeptId || null,
        description: projDesc.trim() || null,
        silent: queuedTasks.length > 0,
      });

      const createdProjectId = projRes?.projectId || projRes?.project?.id || null;

      if (queuedTasks.length > 0) {
        const results = await Promise.allSettled(
          queuedTasks.map((item) =>
            mutations.createTask.mutateAsync({
              title: item.title,
              assigneeId: item.assigneeId,
              priority: "medium",
              dueDate: item.dueDate || getPresetDateIso(0),
              projectId: createdProjectId,
              isSelfAssign: false,
              silent: true,
            })
          )
        );
        const succeeded = results.filter((r) => r.status === "fulfilled").length;
        const failed = results.length - succeeded;

        if (failed === 0) {
          toast.success(
            `Project created with ${succeeded} ${succeeded === 1 ? "task" : "tasks"}`
          );
        } else {
          toast.error(
            `Project created, but ${failed} initial ${failed === 1 ? "task" : "tasks"} failed to create`
          );
        }
      }

      setProjName("");
      setProjCode("");
      setProjDeptId("");
      setProjDesc("");
      setProjInitialTasks([]);
      setProjTaskDraftTitle("");
      setProjTaskDraftAssignee("");
      setProjTaskDraftDueDate(getPresetDateIso(0));
      setCreateProjectOpen(false);
    } catch {
      // Toast handled in mutation onError
    } finally {
      setIsCreatingProjectWithTasks(false);
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

  const isAdmin = userRole === "admin";
  const canManageProjects =
    userRole === "manager" || userRole === "hr" || userRole === "admin";

  const canReassignTask = (task: TaskRecord) => {
    if (task.status === "done" || task.status === "cancelled") return false;
    if (userRole === "admin" || userRole === "hr" || userRole === "manager") return true;
    return false;
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
    <div className="space-y-3 pb-4 w-full min-w-0">
      {/* Header & Controls */}
      <div data-tour="tasks-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-1">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-black tracking-tight flex items-center gap-2">
            <span>Tasks</span>
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
            type="button"
            data-tour="create-task-btn"
            onClick={handleOpenCreateModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-xs font-semibold text-white cursor-pointer shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create task</span>
          </button>
        </div>
      </div>

      {/* Slim Summary Strip */}
      <div className="flex flex-wrap items-center gap-2 py-1 text-xs text-[#808080] border-b border-[#E6E6E6]">
        <button
          type="button"
          aria-pressed={statusFilter === "open"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleToggleSummaryMetric("open")}
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-semibold cursor-pointer transition-colors",
            statusFilter === "open"
              ? "bg-white border-black text-black underline underline-offset-2"
              : "border-transparent hover:bg-[#E6E6E6]/60 hover:text-black"
          )}
        >
          <span
            className={cn(
              "font-bold font-mono",
              statusFilter === "open" || summaryCounts.open > 0
                ? "text-black"
                : "text-[#808080]"
            )}
          >
            {summaryCounts.open}
          </span>
          <span>Open</span>
        </button>
        <span className="h-3 w-px bg-[#E6E6E6]" aria-hidden="true" />
        <button
          type="button"
          aria-pressed={dueFilter === "overdue"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleToggleSummaryMetric("overdue")}
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-semibold cursor-pointer transition-colors",
            dueFilter === "overdue"
              ? "bg-red-50 border-[#FF1493] text-[#FF1493] underline underline-offset-2"
              : "border-transparent hover:bg-[#E6E6E6]/60 hover:text-black"
          )}
        >
          <span
            className={cn(
              "font-bold font-mono",
              dueFilter === "overdue" || summaryCounts.overdue > 0
                ? "text-[#FF1493]"
                : "text-[#808080]"
            )}
          >
            {summaryCounts.overdue}
          </span>
          <span
            className={cn(
              (dueFilter === "overdue" || summaryCounts.overdue > 0) &&
                "text-[#FF1493]"
            )}
          >
            Overdue
          </span>
        </button>
        <span className="h-3 w-px bg-[#E6E6E6]" aria-hidden="true" />
        <button
          type="button"
          aria-pressed={dueFilter === "due_soon"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleToggleSummaryMetric("due_soon")}
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-semibold cursor-pointer transition-colors",
            dueFilter === "due_soon"
              ? "bg-amber-50 border-amber-500 text-[#D97706] underline underline-offset-2"
              : "border-transparent hover:bg-[#E6E6E6]/60 hover:text-black"
          )}
        >
          <span
            className={cn(
              "font-bold font-mono",
              dueFilter === "due_soon" || summaryCounts.dueSoon > 0
                ? "text-[#D97706]"
                : "text-[#808080]"
            )}
          >
            {summaryCounts.dueSoon}
          </span>
          <span
            className={cn(
              (dueFilter === "due_soon" || summaryCounts.dueSoon > 0) &&
                "text-[#D97706]"
            )}
          >
            Due soon
          </span>
        </button>
        <span className="h-3 w-px bg-[#E6E6E6]" aria-hidden="true" />
        <button
          type="button"
          aria-pressed={statusFilter === "done"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleToggleSummaryMetric("completed")}
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-semibold cursor-pointer transition-colors",
            statusFilter === "done"
              ? "bg-white border-black text-black underline underline-offset-2"
              : "border-transparent hover:bg-[#E6E6E6]/60 hover:text-black"
          )}
        >
          <span
            className={cn(
              "font-bold font-mono",
              statusFilter === "done" || summaryCounts.completed > 0
                ? "text-black"
                : "text-[#808080]"
            )}
          >
            {summaryCounts.completed}
          </span>
          <span>Completed</span>
        </button>
      </div>

      {/* Scope, View Switcher & Search Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-1.5 rounded-xl bg-card border border-[#E6E6E6]">
        <div className="flex flex-wrap items-center gap-2">
          {/* Scope Filter */}
          <div className="flex items-center p-0.5 rounded-lg bg-[#E6E6E6] border border-[#E6E6E6]">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setExpandedColumn(null);
                setSelectedTaskIds(new Set());
                setBulkDeleteConfirmOpen(false);
                setScope("mine");
              }}
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
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setExpandedColumn(null);
                setSelectedTaskIds(new Set());
                setBulkDeleteConfirmOpen(false);
                setScope("team");
              }}
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
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setExpandedColumn(null);
                setSelectedTaskIds(new Set());
                setBulkDeleteConfirmOpen(false);
                setViewMode("board");
              }}
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
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setExpandedColumn(null);
                setSelectedTaskIds(new Set());
                setBulkDeleteConfirmOpen(false);
                setViewMode("list");
              }}
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
            onChange={(e) => {
              setExpandedColumn(null);
              setSearchQuery(e.target.value);
            }}
            placeholder="Search task title or description..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black placeholder:text-[#808080] focus:outline-none focus:border-black"
          />
        </div>
      </div>

      {/* Filter Menus Toolbar */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
        <FilterDropdownMenu
          label="All Statuses"
          value={statusFilter}
          ariaLabel="Filter by status"
          options={[
            { value: "all", label: "All Statuses" },
            { value: "open", label: "Open (Active)" },
            ...STATUS_COLUMNS.map((c) => ({ value: c.key, label: c.label })),
          ]}
          onSelect={handleSelectStatusFilter}
        />
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
          onSelect={(val) => {
            setExpandedColumn(null);
            setPriorityFilter(val);
          }}
        />
        <FilterDropdownMenu
          label="All Types"
          value={typeFilter}
          ariaLabel="Filter by type"
          options={[
            { value: "all", label: "All Types" },
            ...taskTypes.map((t) => ({ value: t.id, label: `Type: ${t.name}` })),
          ]}
          onSelect={(val) => {
            setExpandedColumn(null);
            setTypeFilter(val);
          }}
        />
        <FilterDropdownMenu
          label="All Schedules"
          value={recurringFilter}
          ariaLabel="Filter by recurring"
          options={[
            { value: "all", label: "All Schedules" },
            { value: "recurring", label: "Recurring Only" },
            { value: "one_time", label: "One-Time Only" },
          ]}
          onSelect={(val) => {
            setExpandedColumn(null);
            setRecurringFilter(val);
          }}
        />
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
          onSelect={handleSelectDueFilter}
        />
        <FilterDropdownMenu
          label="All Assignees"
          value={assigneeFilter}
          ariaLabel="Filter by assignee"
          options={[
            { value: "all", label: "All Assignees" },
            { value: "unassigned", label: "Unassigned" },
            ...(userId && !employees.some((e) => isCurrentUserEmployee(e))
              ? [
                  {
                    value: userId,
                    label: actualCurrentUserName ? `You (${actualCurrentUserName})` : "You",
                  },
                ]
              : []),
            ...employees.map((emp) => ({
              value: emp.id,
              label: formatAssigneeOptionLabel(emp),
            })),
          ]}
          onSelect={(val) => {
            setExpandedColumn(null);
            setAssigneeFilter(val);
          }}
        />
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
          onSelect={(val) => {
            setExpandedColumn(null);
            setProjectFilter(val);
          }}
        />
        {isAdmin && projectFilter !== "all" && projectFilter !== "none" && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const targetProj = projects.find((p) => p.id === projectFilter);
              if (targetProj) {
                setProjectToDelete({
                  id: targetProj.id,
                  name: targetProj.code
                    ? `${targetProj.code} · ${targetProj.name}`
                    : targetProj.name,
                });
              }
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-semibold text-[#FF1493] cursor-pointer transition-colors"
            title="Delete selected project"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Project</span>
          </button>
        )}
      </div>

      {/* Active Filter Chips & Clear Filters (fixed-height slot prevents board shift) */}
      <div
        aria-hidden={!hasActiveFilters}
        className={cn(
          "min-h-[36px] flex flex-wrap items-center gap-1.5 text-xs",
          !hasActiveFilters && "invisible pointer-events-none select-none"
        )}
      >
        {hasActiveFilters ? (
          <>
            <span className="text-[11px] text-[#808080] font-medium mr-1">Active filters:</span>
            {statusFilter !== "all" && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E6E6E6] text-black text-[11px] font-medium">
                Status:{" "}
                {statusFilter === "open"
                  ? "Open (Active)"
                  : STATUS_COLUMNS.find((c) => c.key === statusFilter)?.label}
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
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClearAllFilters}
              className="text-[11px] font-semibold text-[#808080] hover:text-black underline ml-1 cursor-pointer"
            >
              Clear filters
            </button>
          </>
        ) : (
          <span className="text-[11px] py-0.5">&nbsp;</span>
        )}
      </div>

      {/* Main Board or List Area */}
      <div className="w-full min-w-0 h-[calc(100vh-245px)] overflow-hidden">
      {isLoading ? (
        <div className="w-full h-full flex items-center justify-center text-xs text-[#808080]">
          Loading workplace tasks...
        </div>
      ) : filteredTasks.length === 0 &&
        !(
          viewMode === "list" &&
          groupByProject &&
          projectFilter === "all" &&
          !hasActiveFilters &&
          projects.length > 0
        ) ? (
        <div className="w-full h-full flex items-center justify-center">
          {projectFilter !== "all" && projectFilter !== "none" ? (
            (() => {
              const activeProject = projects.find((p) => p.id === projectFilter);
              const activeProjectName = activeProject?.name || "this project";
              return (
                <EmptyState
                  title={`No tasks in ${activeProjectName} yet`}
                  description="Add tasks to this project to start tracking progress."
                  action={
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenCreateModal(projectFilter)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-black hover:bg-[#1A1A1A] text-white rounded-lg cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add task to {activeProjectName}</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={handleClearAllFilters}
                        className="px-4 py-2 text-xs font-semibold bg-white border border-[#E6E6E6] hover:bg-[#F5F5F5] text-black rounded-lg cursor-pointer"
                      >
                        Clear filters
                      </button>
                    </div>
                  }
                />
              );
            })()
          ) : tasks.length === 0 ? (
            <EmptyState
              title="No tasks yet"
              description="Create your first task to track work and deliverables."
              action={
                <button
                  type="button"
                  onClick={() => handleOpenCreateModal()}
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
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleClearAllFilters}
                  className="px-4 py-2 text-xs font-semibold bg-white border border-[#E6E6E6] hover:bg-[#F5F5F5] text-black rounded-lg cursor-pointer"
                >
                  Clear filters
                </button>
              }
            />
          )}
        </div>
      ) : viewMode === "board" ? (
        <div
          ref={boardContainerRef}
          className="w-full min-w-0 h-full overflow-hidden"
        >
          <div
            data-tour="tasks-board"
            className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2.5 w-full min-w-0 h-full items-start overflow-y-auto lg:overflow-hidden pb-1"
          >
            {STATUS_COLUMNS.map((col) => {
              const colTasks = filteredTasks.filter((t) => t.status === col.key);
              const isCancelledCol = col.key === "cancelled";
              const isExpanded = expandedColumn === col.key;
              const isCollapsed = !isExpanded;

              return (
                <div
                  key={col.key}
                  data-kanban-column="true"
                  className={cn(
                    "flex flex-col min-w-0 w-full max-h-full rounded-[14px] border overflow-x-hidden transition-colors duration-200 border-[#E6E6E6]",
                    isExpanded && "min-h-[220px]",
                    isCancelledCol ? "bg-[#EFEFEF]" : "bg-[#E6E6E6]"
                  )}
                >
                  <div
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggleColumnAccordion(col.key)}
                    className={cn(
                      "flex items-center justify-between p-2.5 shrink-0 gap-1.5 cursor-pointer select-none transition-colors",
                      isCollapsed
                        ? "rounded-[14px] hover:bg-black/[0.04]"
                        : "pb-1.5 rounded-t-[14px]"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold text-black truncate leading-tight" title={col.label}>
                        {col.label}
                      </h2>
                      <p className="truncate text-xs text-gray-500 leading-tight" title={col.hint}>
                        {col.hint}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-white border border-[#E6E6E6] text-black">
                        {colTasks.length}
                      </span>
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? `Collapse ${col.label} column` : `Expand ${col.label} column`}
                        title={isExpanded ? `Collapse ${col.label}` : `Expand ${col.label}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleColumnAccordion(col.key);
                        }}
                        className="p-1 rounded-lg text-[#4D4D4D] hover:text-black hover:bg-white/80 transition-colors cursor-pointer"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="flex flex-col gap-2.5 p-2 pb-3 max-h-full overflow-y-auto overflow-x-hidden min-h-0 min-w-0 flex-1">
                      {colTasks.length > 0 ? (
                        colTasks.map((task) => {
                          const assigneeName = formatPerson(task.assignee_id);
                          return (
                            <KanbanTaskCard
                              key={task.id}
                              task={task}
                              assigneeName={assigneeName}
                              creatorName={formatPerson(task.creator_id)}
                              initials={getInitials(assigneeName)}
                              typeName={task.task_type_id ? typeNameMap.get(task.task_type_id) : null}
                              projectName={task.project_id ? projectNameMap.get(task.project_id) : null}
                              onSelect={setSelectedTaskId}
                            />
                          );
                        })
                      ) : (
                        <div className="py-6 px-2.5 text-center rounded-xl border border-dashed border-[#E6E6E6] text-[11px] text-[#808080]">
                          No tasks in {col.label}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Enterprise List / Table View */
        <div className="w-full min-w-0 h-full bg-white rounded-xl border border-[#E6E6E6] shadow-xs flex flex-col overflow-hidden">
          {/* Table Controls Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[#E6E6E6] bg-[#FAFAFA] shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={groupByAssignee}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setGroupByAssignee((prev) => {
                    const next = !prev;
                    if (next) setGroupByProject(false);
                    return next;
                  });
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer transition-colors",
                  groupByAssignee
                    ? "bg-black text-white border-black"
                    : "bg-white text-black border-[#E6E6E6] hover:bg-[#F5F5F5]"
                )}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Group by Assignee</span>
              </button>

              <button
                type="button"
                aria-pressed={groupByProject}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setGroupByProject((prev) => {
                    const next = !prev;
                    if (next) setGroupByAssignee(false);
                    return next;
                  });
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer transition-colors",
                  groupByProject
                    ? "bg-black text-white border-black"
                    : "bg-white text-black border-[#E6E6E6] hover:bg-[#F5F5F5]"
                )}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Group by Project</span>
              </button>

              {selectedTaskIds.size > 0 && (
                <>
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#B7FF00]/25 border border-[#B7FF00]/60 text-xs font-semibold text-black">
                    <span>{selectedTaskIds.size} selected</span>
                    <button
                      type="button"
                      disabled={isBulkUpdating}
                      onClick={() => setSelectedTaskIds(new Set())}
                      className="text-[11px] font-semibold text-[#4D4D4D] hover:text-black underline cursor-pointer disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </div>

                  {/* Bulk Action Toolbar */}
                  <div className="flex flex-wrap items-center gap-1.5 pl-1 border-l border-[#E6E6E6]">
                    {/* Change Due Date */}
                    <DropdownMenu.Root open={bulkDueDateOpen} onOpenChange={setBulkDueDateOpen}>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          disabled={isBulkUpdating}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <Calendar className="w-3.5 h-3.5 text-[#4D4D4D]" />
                          <span>Due Date</span>
                          <ChevronDown className="w-3 h-3 text-[#808080]" />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          align="start"
                          sideOffset={4}
                          className="z-50 w-56 rounded-xl bg-white border border-[#E6E6E6] p-1.5 shadow-lg text-xs space-y-1 animate-in fade-in-0 zoom-in-95"
                        >
                          <DropdownMenu.Item
                            onSelect={() => handleBulkDueDateChange(getPresetDateIso(0))}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-black hover:bg-[#F5F5F5] cursor-pointer outline-none font-medium"
                          >
                            <span>Today</span>
                            <span className="text-[10px] text-[#808080]">{getPresetDateIso(0)}</span>
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            onSelect={() => handleBulkDueDateChange(getPresetDateIso(1))}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-black hover:bg-[#F5F5F5] cursor-pointer outline-none font-medium"
                          >
                            <span>Tomorrow</span>
                            <span className="text-[10px] text-[#808080]">{getPresetDateIso(1)}</span>
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            onSelect={() => handleBulkDueDateChange(getPresetDateIso(7))}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-black hover:bg-[#F5F5F5] cursor-pointer outline-none font-medium"
                          >
                            <span>Next Week</span>
                            <span className="text-[10px] text-[#808080]">{getPresetDateIso(7)}</span>
                          </DropdownMenu.Item>
                          <div className="pt-1 mt-1 border-t border-[#E6E6E6] px-1.5 pb-1 space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-[#808080] block">
                              Custom Date
                            </label>
                            <div className="flex items-center gap-1">
                              <input
                                type="date"
                                aria-label="Bulk custom due date"
                                value={bulkCustomDueDate}
                                onChange={(e) => {
                                  const dateVal = e.target.value;
                                  setBulkCustomDueDate(dateVal);
                                  if (dateVal) {
                                    handleBulkDueDateChange(dateVal);
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="flex-1 min-w-0 px-2 py-1 rounded border border-[#E6E6E6] text-[11px] text-black focus:outline-none focus:border-black"
                              />
                            </div>
                          </div>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>

                    {/* Reassign */}
                    {!isRegularEmployee && (
                      <select
                        aria-label="Bulk assign to employee"
                        value=""
                        disabled={isBulkUpdating}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) {
                            handleBulkAssign(val === "__unassigned__" ? null : val);
                          }
                        }}
                        className="max-w-[165px] px-2.5 py-1 rounded-lg border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-black"
                      >
                        <option value="">Assign to...</option>
                        <option value="__unassigned__">Unassigned</option>
                        {assignableEmployees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {formatAssigneeOptionLabel(emp)}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Export CSV */}
                    <button
                      type="button"
                      disabled={isBulkUpdating}
                      onClick={handleBulkExportCsv}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 text-[#4D4D4D]" />
                      <span>Export CSV</span>
                    </button>

                    {/* Delete (Admin only) */}
                    {isAdmin && (
                      <button
                        type="button"
                        disabled={isBulkUpdating}
                        onClick={() => setBulkDeleteConfirmOpen(true)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-semibold text-[#FF1493] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{isBulkUpdating ? "Updating..." : "Delete"}</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="text-[11px] font-medium text-[#808080]">
              Showing {totalListTasks === 0 ? 0 : tableStartIndex + 1}–
              {Math.min(tableStartIndex + paginatedListTasks.length, totalListTasks)} of{" "}
              {totalListTasks} {totalListTasks === 1 ? "task" : "tasks"}
            </div>
          </div>

          {/* Scrollable Sticky-Header Table */}
          <div className="flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable]">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="sticky top-0 bg-[#F5F5F5] z-10 border-b border-[#E6E6E6]">
                <tr>
                  <th className="py-2.5 px-3 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all visible tasks"
                      checked={
                        paginatedListTasks.length > 0 &&
                        paginatedListTasks.every((t) => selectedTaskIds.has(t.id))
                      }
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedTaskIds((prev) => {
                          const next = new Set(prev);
                          for (const t of paginatedListTasks) {
                            if (checked) next.add(t.id);
                            else next.delete(t.id);
                          }
                          return next;
                        });
                      }}
                      className="h-3.5 w-3.5 rounded border-[#B3B3B3] accent-black cursor-pointer align-middle"
                    />
                  </th>
                  <th className="py-2.5 px-3">
                    <SortableTableHeader
                      label="Task Title"
                      column="title"
                      activeColumn={tableSortBy}
                      direction={tableSortDir}
                      onSort={handleSortTableColumn}
                    />
                  </th>
                  <th className="py-2.5 px-3">
                    <SortableTableHeader
                      label="Assignee"
                      column="assignee"
                      activeColumn={tableSortBy}
                      direction={tableSortDir}
                      onSort={handleSortTableColumn}
                    />
                  </th>
                  <th className="py-2.5 px-3">
                    <SortableTableHeader
                      label="Status"
                      column="status"
                      activeColumn={tableSortBy}
                      direction={tableSortDir}
                      onSort={handleSortTableColumn}
                    />
                  </th>
                  <th className="py-2.5 px-3">
                    <SortableTableHeader
                      label="Priority"
                      column="priority"
                      activeColumn={tableSortBy}
                      direction={tableSortDir}
                      onSort={handleSortTableColumn}
                    />
                  </th>
                  <th className="py-2.5 px-3 text-[11px] font-bold uppercase tracking-wider text-[#4D4D4D] whitespace-nowrap">
                    Type / Schedule
                  </th>
                  <th className="py-2.5 px-3">
                    <SortableTableHeader
                      label="Due Date"
                      column="due_date"
                      activeColumn={tableSortBy}
                      direction={tableSortDir}
                      onSort={handleSortTableColumn}
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E6E6]">
                {(() => {
                  const renderTaskTableRow = (task: TaskRecord) => {
                    const assigneeName = formatPerson(task.assignee_id);
                    return (
                      <TaskTableRow
                        key={task.id}
                        task={task}
                        assigneeName={assigneeName}
                        initials={getInitials(assigneeName)}
                        typeName={
                          task.task_type_id ? typeNameMap.get(task.task_type_id) : null
                        }
                        projectName={
                          task.project_id ? projectNameMap.get(task.project_id) : null
                        }
                        userId={userId}
                        canManageProjects={canManageProjects}
                        isSelected={selectedTaskIds.has(task.id)}
                        isStatusPending={mutations.updateTaskStatus.isPending}
                        onToggleSelect={toggleTableTaskSelection}
                        onSelect={setSelectedTaskId}
                        onUpdateStatus={(taskId, status, note) =>
                          mutations.updateTaskStatus.mutate({
                            taskId,
                            status,
                            note,
                          })
                        }
                        onRejectTask={(targetTask) => {
                          setRejectingTask(targetTask);
                          setRejectReason("");
                        }}
                        onCompleteTask={(targetTask) => {
                          mutations.updateTaskStatus.mutate({
                            taskId: targetTask.id,
                            status: "done",
                          });
                          setLogTimePromptTask(targetTask);
                          setLogTimeMinutes(String(targetTask.estimated_minutes || 60));
                        }}
                      />
                    );
                  };

                  if (groupByAssignee) {
                    return groupedPaginatedTasks.map((group) => {
                      const isGroupCollapsed = Boolean(collapsedAssigneeGroups[group.key]);
                      return (
                        <React.Fragment key={group.key}>
                          <tr
                            onClick={() => toggleAssigneeGroup(group.key)}
                            className="bg-[#FAFAFA] hover:bg-[#F2F2F2] cursor-pointer transition-colors"
                          >
                            <td colSpan={7} className="py-2 px-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  {isGroupCollapsed ? (
                                    <ChevronRight className="w-3.5 h-3.5 text-[#4D4D4D]" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5 text-[#4D4D4D]" />
                                  )}
                                  <span className="w-5 h-5 rounded-full bg-[#E6E6E6] text-black font-semibold text-[9px] flex items-center justify-center shrink-0">
                                    {group.initials}
                                  </span>
                                  <span className="text-xs font-bold text-black">
                                    {group.name}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white border border-[#E6E6E6] text-[#4D4D4D]">
                                    {group.tasks.length}{" "}
                                    {group.tasks.length === 1 ? "task" : "tasks"}
                                  </span>
                                </div>
                              </div>
                            </td>
                          </tr>
                          {!isGroupCollapsed && group.tasks.map(renderTaskTableRow)}
                        </React.Fragment>
                      );
                    });
                  }

                  if (groupByProject) {
                    return groupedByProjectTasks.map((group) => {
                      const isExpanded = expandedProjectIds[group.key] ?? true;
                      return (
                        <React.Fragment key={group.key}>
                          <tr
                            onClick={() => toggleProjectGroup(group.key)}
                            className="bg-[#FAFAFA] hover:bg-[#F2F2F2] cursor-pointer transition-colors"
                          >
                            <td colSpan={7} className="py-2 px-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-[#4D4D4D]" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-[#4D4D4D]" />
                                  )}
                                  <span className="w-5 h-5 rounded-md bg-[#E6E6E6] text-black flex items-center justify-center shrink-0">
                                    <Layers className="w-3 h-3" />
                                  </span>
                                  <span
                                    className={cn(
                                      "text-xs font-bold",
                                      group.isUnassignedProject ? "text-[#808080]" : "text-black"
                                    )}
                                  >
                                    {group.label}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white border border-[#E6E6E6] text-[#4D4D4D]">
                                    {group.tasks.length}{" "}
                                    {group.tasks.length === 1 ? "task" : "tasks"}
                                  </span>
                                </div>
                                {!group.isUnassignedProject && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      aria-label={`Add task to ${group.label}`}
                                      title={`Add task to ${group.label}`}
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenCreateModal(group.key);
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-[11px] font-semibold text-black transition-colors cursor-pointer shrink-0"
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>Add task</span>
                                    </button>
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        aria-label={`Delete project ${group.label}`}
                                        title={`Delete project ${group.label}`}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setProjectToDelete({
                                            id: group.key,
                                            name: group.label,
                                          });
                                        }}
                                        className="p-1 rounded-md text-[#808080] hover:text-[#FF1493] hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isExpanded &&
                            (group.tasks.length > 0 ? (
                              group.tasks.map(renderTaskTableRow)
                            ) : (
                              <tr className="bg-white">
                                <td colSpan={7} className="py-3 px-4">
                                  <div className="flex items-center justify-between gap-3 text-xs text-[#808080]">
                                    <span>No tasks in this project yet.</span>
                                    {!group.isUnassignedProject && (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenCreateModal(group.key)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#E6E6E6] bg-[#F5F5F5] hover:bg-[#E6E6E6] text-[11px] font-semibold text-black cursor-pointer transition-colors"
                                      >
                                        <Plus className="w-3 h-3" />
                                        <span>Add task</span>
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                        </React.Fragment>
                      );
                    });
                  }

                  return paginatedListTasks.map(renderTaskTableRow);
                })()}
              </tbody>
            </table>
          </div>

          {/* Client-Side Pagination Footer */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-[#E6E6E6] bg-[#FAFAFA] text-xs shrink-0">
            <span className="text-[#808080] font-medium">
              Showing {totalListTasks === 0 ? 0 : tableStartIndex + 1}–
              {Math.min(tableStartIndex + paginatedListTasks.length, totalListTasks)} of{" "}
              {totalListTasks} {totalListTasks === 1 ? "task" : "tasks"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safeTablePage <= 1}
                onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-black font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
              <span className="text-[11px] font-semibold text-[#4D4D4D]">
                Page {safeTablePage} of {totalTablePages}
              </span>
              <button
                type="button"
                disabled={safeTablePage >= totalTablePages}
                onClick={() => setTablePage((p) => Math.min(totalTablePages, p + 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-black font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

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
              <h2 id="create-task-title" className="text-base font-bold text-black text-left">
                Create new task
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
                  placeholder="e.g. Audit Q4 payroll shifts, Fix login redirect..."
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
                {isRegularEmployee ? (
                  <div
                    aria-label="Task Assignee"
                    className="w-full px-3 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-semibold text-black flex items-center justify-between gap-2"
                  >
                    <span>
                      {actualCurrentUserName ? `You (${actualCurrentUserName})` : "You"}
                    </span>
                    <span className="text-[10px] font-medium text-[#808080]">
                      Self-assigned only
                    </span>
                  </div>
                ) : (
                  <>
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
                            {formatAssigneeOptionLabel(emp)} — {wl.openCount} open ({wl.dueThisWeekCount} due this week)
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
                  </>
                )}
              </div>

              {/* Priority */}
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

              {/* Due Date Presets: Today, Tomorrow, Day After Tomorrow, Custom Date */}
              <div className="space-y-2 p-3.5 rounded-xl bg-[#F9F9F9] border border-[#E6E6E6]">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-black flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-black" />
                    Due date *
                  </label>
                  {newDueDate ? (
                    <span className="text-[11px] font-medium text-black">
                      Deadline: <span className="font-bold underline">{formatDueDateDisplay(newDueDate)}</span> ({newDueDate})
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-[#FF1493]">Required</span>
                  )}
                </div>

                {/* Preset Buttons */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNewDueDate(getPresetDateIso(0));
                      setDueDateError("");
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
                      setDueDateError("");
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
                      setDueDateError("");
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
                      required
                      aria-label="Custom Due Date"
                      value={newDueDate}
                      onChange={(e) => {
                        setNewDueDate(e.target.value);
                        if (e.target.value.trim()) setDueDateError("");
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

                {dueDateError && (
                  <p className="text-[11px] font-semibold text-[#FF1493]">
                    {dueDateError}
                  </p>
                )}

                {/* Suggested Due Date Chip from Type Preset */}
                {suggestedDueText && newDueDate && autoDueSuggested && (
                  <div className="mt-1 flex items-center justify-between text-[11px] text-[#4D4D4D] bg-white border border-[#E6E6E6] rounded px-2.5 py-1">
                    <span>Preset suggested due date: <strong>{suggestedDueText}</strong></span>
                  </div>
                )}
              </div>

              {/* Repeat Schedule Section (Phase 3) */}
              <div className="pt-2 border-t border-[#E6E6E6] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-black flex items-center gap-1.5">
                    <Repeat className="w-3.5 h-3.5 text-black" />
                    Repeat schedule (optional)
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
              <div>
                <label className="block text-xs font-bold text-black mb-1">
                  Project (optional)
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

              {/* Linked KPI Goal (Phase 5) */}
              {FEATURES.KPI && assigneeGoals.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-black mb-1">
                    Performance goal (optional)
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
                  {mutations.createTask.isPending ? "Creating..." : "Create task"}
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
            if (e.target === e.currentTarget && !isCreatingProjectWithTasks) {
              setCreateProjectOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-title"
            className="w-full max-w-lg bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 id="create-project-title" className="text-base font-bold text-black">
                Create Project Grouping
              </h2>
              <button
                type="button"
                aria-label="Close project modal"
                disabled={isCreatingProjectWithTasks}
                onClick={() => setCreateProjectOpen(false)}
                className="p-1 rounded text-[#808080] hover:text-black cursor-pointer disabled:opacity-50"
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

              {/* Initial Tasks (Optional) Multi-Task Builder */}
              <div className="pt-2 border-t border-[#E6E6E6] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-black">
                    Initial Tasks (Optional)
                  </label>
                  {projInitialTasks.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F5F5F5] border border-[#E6E6E6] text-black">
                      {projInitialTasks.length} queued
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="text"
                    aria-label="Initial task title"
                    value={projTaskDraftTitle}
                    onChange={(e) => setProjTaskDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddInitialProjectTask();
                      }
                    }}
                    placeholder="Task title..."
                    className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black focus:outline-none focus:border-black"
                  />
                  {isRegularEmployee ? (
                    <span
                      aria-label="Initial task assignee"
                      className="max-w-[160px] truncate px-2.5 py-1.5 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-semibold text-black"
                    >
                      {actualCurrentUserName ? `You (${actualCurrentUserName})` : "You"}
                    </span>
                  ) : (
                    <select
                      aria-label="Initial task assignee"
                      value={projTaskDraftAssignee}
                      onChange={(e) => setProjTaskDraftAssignee(e.target.value)}
                      className="max-w-[130px] px-2 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black focus:outline-none focus:border-black"
                    >
                      <option value="">Unassigned</option>
                      {assignableEmployees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {formatAssigneeOptionLabel(emp)}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="date"
                    aria-label="Initial task due date"
                    required
                    value={projTaskDraftDueDate}
                    onChange={(e) => setProjTaskDraftDueDate(e.target.value)}
                    className="px-2 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black focus:outline-none focus:border-black"
                  />
                  <button
                    type="button"
                    onClick={handleAddInitialProjectTask}
                    disabled={
                      !projTaskDraftTitle.trim() ||
                      !projTaskDraftDueDate ||
                      isCreatingProjectWithTasks
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-[#E6E6E6] bg-[#F5F5F5] hover:bg-[#E6E6E6] text-xs font-semibold text-black cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 transition-colors"
                  >
                    + Add
                  </button>
                </div>

                {projInitialTasks.length > 0 && (
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-0.5">
                    {projInitialTasks.map((item) => (
                      <div
                        key={item.localId}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-xs"
                      >
                        <span className="truncate font-medium text-black flex-1" title={item.title}>
                          {item.title}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-white border border-[#E6E6E6] text-[10px] font-medium text-[#4D4D4D] shrink-0">
                          {item.dueDate}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-white border border-[#E6E6E6] text-[10px] font-medium text-[#4D4D4D] shrink-0 max-w-[120px] truncate">
                          {item.assigneeId ? formatPerson(item.assigneeId) : "Unassigned"}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${item.title}`}
                          disabled={isCreatingProjectWithTasks}
                          onClick={() =>
                            setProjInitialTasks((prev) =>
                              prev.filter((t) => t.localId !== item.localId)
                            )
                          }
                          className="p-0.5 rounded text-[#808080] hover:text-[#FF1493] cursor-pointer shrink-0 disabled:opacity-40"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E6E6E6]">
                <button
                  type="button"
                  disabled={isCreatingProjectWithTasks}
                  onClick={() => setCreateProjectOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white border border-[#E6E6E6] hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer shadow-xs disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingProjectWithTasks || mutations.createProject.isPending}
                  className="px-5 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer disabled:opacity-60 shadow-xs"
                >
                  {isCreatingProjectWithTasks || mutations.createProject.isPending
                    ? "Creating..."
                    : "Create Project"}
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
                  <StatusPill
                    status={selectedTask.status}
                    label={selectedTask.status === "done" ? "Completed" : undefined}
                  />
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
            {parentSubtasks.length > 0 && allSubtasksDone && selectedTask.status === "in_progress" && (
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
                {selectedTask.status === "todo" && selectedTask.assignee_id === userId && (
                  <>
                    <button
                      type="button"
                      disabled={mutations.updateTaskStatus.isPending}
                      onClick={() =>
                        mutations.updateTaskStatus.mutate({
                          taskId: selectedTask.id,
                          status: "in_progress",
                          note: "Accepted assigned task",
                        })
                      }
                      className="px-3.5 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer shadow-xs"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={mutations.updateTaskStatus.isPending}
                      onClick={() => {
                        setRejectingTask(selectedTask);
                        setRejectReason("");
                      }}
                      className="px-3.5 py-1.5 rounded-lg border border-[#E6E6E6] bg-white hover:bg-red-50 hover:text-[#FF1493] hover:border-red-200 text-xs font-semibold text-[#4D4D4D] cursor-pointer"
                    >
                      Reject
                    </button>
                  </>
                )}

                {selectedTask.status === "in_progress" &&
                  (selectedTask.assignee_id === userId || canManageProjects) && (
                    <>
                      <button
                        type="button"
                        aria-pressed="true"
                        disabled={mutations.updateTaskStatus.isPending}
                        onClick={() => {
                          if (selectedTask.status !== "in_progress") {
                            mutations.updateTaskStatus.mutate({
                              taskId: selectedTask.id,
                              status: "in_progress",
                            });
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-[#B7FF00]/30 border border-[#84CC16] text-black text-xs font-semibold cursor-pointer"
                      >
                        In Progress
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
                        className="px-3.5 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer shadow-xs"
                      >
                        Completed
                      </button>
                    </>
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
                  {selectedTask.assignee_id &&
                    selectedTask.creator_id &&
                    selectedTask.creator_id !== selectedTask.assignee_id && (
                      <span className="text-[10px] text-[#808080] ml-6">
                        • Assigned by {formatPerson(selectedTask.creator_id)}
                      </span>
                    )}
                </div>

                {!isRegularEmployee && canReassignTask(selectedTask) ? (
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
                        {formatAssigneeOptionLabel(emp)}
                      </option>
                    ))}
                  </select>
                ) : (
                  isRegularEmployee &&
                  !selectedTask.assignee_id &&
                  selectedTask.status !== "done" &&
                  selectedTask.status !== "cancelled" &&
                  userId && (
                    <button
                      type="button"
                      disabled={mutations.assignTask.isPending}
                      onClick={() =>
                        mutations.assignTask.mutate({
                          taskId: selectedTask.id,
                          assigneeId: userId,
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      Assign to me
                    </button>
                  )
                )}
              </div>

              {/* Linked KPI Goal (Phase 5) */}
              {FEATURES.KPI && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6]">
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

              {isAdmin && (
                <div className="flex items-center justify-end pt-1">
                  <button
                    type="button"
                    disabled={mutations.deleteTask.isPending}
                    onClick={() => setTaskToDelete(selectedTask)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-[#FF1493] border border-red-200 text-xs font-semibold cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Task</span>
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

      {/* Bulk Delete Confirmation Modal (Admin only) */}
      {isAdmin && bulkDeleteConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isBulkUpdating) {
              setBulkDeleteConfirmOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-delete-title"
            className="w-full max-w-md bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-6 space-y-4 animate-in fade-in duration-150"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-[#FF1493]" />
              </div>
              <div className="space-y-1">
                <h2 id="bulk-delete-title" className="text-sm font-bold text-black">
                  Delete {selectedTaskIds.size} selected{" "}
                  {selectedTaskIds.size === 1 ? "task" : "tasks"}? This cannot be undone.
                </h2>
                <p className="text-xs text-[#4D4D4D] leading-relaxed">
                  Selected tasks and their board entries will be permanently removed.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isBulkUpdating}
                onClick={() => setBulkDeleteConfirmOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBulkUpdating}
                onClick={handleBulkDelete}
                className="px-3.5 py-1.5 rounded-lg bg-[#FF1493] hover:bg-[#E01182] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {isBulkUpdating ? "Deleting..." : "Delete Tasks"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Task Delete Confirmation Modal (Admin only) */}
      {isAdmin && taskToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget && !mutations.deleteTask.isPending) {
              setTaskToDelete(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-single-task-title"
            className="w-full max-w-md bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-6 space-y-4 animate-in fade-in duration-150"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-[#FF1493]" />
              </div>
              <div className="space-y-1">
                <h2 id="delete-single-task-title" className="text-sm font-bold text-black">
                  Delete task &apos;{taskToDelete.title}&apos;?
                </h2>
                <p className="text-xs text-[#4D4D4D] leading-relaxed">
                  This task will be permanently removed. This cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={mutations.deleteTask.isPending}
                onClick={() => setTaskToDelete(null)}
                className="px-3.5 py-1.5 rounded-lg border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={mutations.deleteTask.isPending}
                onClick={async () => {
                  const deletingTaskId = taskToDelete.id;
                  try {
                    await mutations.deleteTask.mutateAsync({ taskId: deletingTaskId });
                    if (selectedTaskId === deletingTaskId) {
                      setSelectedTaskId(null);
                    }
                    setTaskToDelete(null);
                  } catch {
                    // Error toast handled by deleteTask mutation
                  }
                }}
                className="px-3.5 py-1.5 rounded-lg bg-[#FF1493] hover:bg-[#E01182] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {mutations.deleteTask.isPending ? "Deleting..." : "Delete Task"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Project Confirmation Modal (Admin only) */}
      {isAdmin && projectToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget && !mutations.deleteProject.isPending) {
              setProjectToDelete(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            className="w-full max-w-md bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-6 space-y-4 animate-in fade-in duration-150"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-[#FF1493]" />
              </div>
              <div className="space-y-1">
                <h2 id="delete-project-title" className="text-sm font-bold text-black">
                  Are you sure?
                </h2>
                <p className="text-xs text-[#4D4D4D] leading-relaxed">
                  {(() => {
                    const projectTaskCount = tasks.filter(
                      (t) => t.project_id === projectToDelete.id
                    ).length;
                    return (
                      <>
                        Are you sure? Deleting &apos;{projectToDelete.name}&apos; will also permanently delete all{" "}
                        {projectTaskCount} {projectTaskCount === 1 ? "task" : "tasks"} inside it. This action cannot be undone.
                      </>
                    );
                  })()}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={mutations.deleteProject.isPending}
                onClick={() => setProjectToDelete(null)}
                className="px-3.5 py-1.5 rounded-lg border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={mutations.deleteProject.isPending}
                onClick={async () => {
                  const deletingId = projectToDelete.id;
                  const deletedTaskIds = new Set(
                    tasks
                      .filter((t) => t.project_id === deletingId)
                      .map((t) => t.id)
                  );
                  try {
                    await mutations.deleteProject.mutateAsync(deletingId);
                    if (projectFilter === deletingId) {
                      setProjectFilter("all");
                    }
                    if (newProjectId === deletingId) {
                      setNewProjectId("");
                    }
                    if (selectedTaskId && deletedTaskIds.has(selectedTaskId)) {
                      setSelectedTaskId(null);
                    }
                    if (deletedTaskIds.size > 0) {
                      setSelectedTaskIds((prev) => {
                        const next = new Set(prev);
                        deletedTaskIds.forEach((tid) => next.delete(tid));
                        return next;
                      });
                    }
                    setProjectToDelete(null);
                  } catch {
                    // Error toast handled by deleteProject mutation
                  }
                }}
                className="px-3.5 py-1.5 rounded-lg bg-[#FF1493] hover:bg-[#E01182] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {mutations.deleteProject.isPending ? "Deleting..." : "Delete Project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Assigned Task Confirmation Modal */}
      {rejectingTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget && !mutations.updateTaskStatus.isPending) {
              setRejectingTask(null);
              setRejectReason("");
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-task-title"
            className="w-full max-w-md bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-6 space-y-4 animate-in fade-in duration-150"
          >
            <div className="space-y-1">
              <h2 id="reject-task-title" className="text-sm font-bold text-black">
                Reject &apos;{rejectingTask.title}&apos;?
              </h2>
              <p className="text-xs text-[#4D4D4D] leading-relaxed">
                This will move the task to Cancelled. You can optionally include a brief reason for your manager.
              </p>
            </div>

            <input
              type="text"
              aria-label="Rejection reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejecting (optional)..."
              className="w-full px-3 py-2 rounded-lg border border-[#E6E6E6] text-xs text-black focus:outline-none focus:border-black"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={mutations.updateTaskStatus.isPending}
                onClick={() => {
                  setRejectingTask(null);
                  setRejectReason("");
                }}
                className="px-3.5 py-1.5 rounded-lg border border-[#E6E6E6] bg-white hover:bg-[#F5F5F5] text-xs font-semibold text-black cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={mutations.updateTaskStatus.isPending}
                onClick={async () => {
                  await mutations.updateTaskStatus.mutateAsync({
                    taskId: rejectingTask.id,
                    status: "cancelled",
                    note: rejectReason.trim() || "Rejected assigned task",
                  });
                  setRejectingTask(null);
                  setRejectReason("");
                }}
                className="px-3.5 py-1.5 rounded-lg bg-[#FF1493] hover:bg-[#E01182] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {mutations.updateTaskStatus.isPending ? "Rejecting..." : "Confirm Reject"}
              </button>
            </div>
          </div>
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

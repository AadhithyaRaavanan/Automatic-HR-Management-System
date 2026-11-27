"use client";

import { StatusPill } from "@/components/shared/status-pill";
import { TaskRecord } from "@/features/tasks/hooks/use-tasks";
import { formatFriendlyDueState } from "@/features/tasks/task-due";
import { TaskPriority, TaskStatus } from "@/types/database.types";
import { cn } from "@/lib/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { List, Clock, Calendar, UserCheck, Repeat, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, Check } from "lucide-react";

export function DueBadge({
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

export function TaskTypeBadge({ typeName }: { typeName: string | null | undefined }) {
  if (!typeName) return null;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#F5F5F5] border border-[#E6E6E6] text-black max-w-full truncate">
      <span className="truncate">{typeName}</span>
    </span>
  );
}

export function getInitials(name: string): string {
  const stripped = name.replace(/^You\s*\(([^)]+)\)$/i, "$1").trim();
  const parts = stripped.split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function FilterDropdownMenu({
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

export type TableSortColumn = "title" | "assignee" | "status" | "priority" | "due_date";

export const STATUS_SORT_ORDER: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 1,
  blocked: 2,
  done: 3,
  cancelled: 4,
};

export const PRIORITY_SORT_ORDER: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
};

export function SortableTableHeader({
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
        "inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap",
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
  isAssignedToCurrentUser: boolean;
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
export function TaskTableRow({
  task,
  assigneeName,
  initials,
  typeName,
  projectName,
  isAssignedToCurrentUser,
  isSelected,
  isStatusPending,
  onToggleSelect,
  onSelect,
  onUpdateStatus,
  onRejectTask,
  onCompleteTask,
}: TaskTableRowProps) {
  const canActOnTask =
    Boolean(task.assignee_id) &&
    isAssignedToCurrentUser &&
    task.status !== "done" &&
    task.status !== "cancelled";
  const canAcceptOrReject = canActOnTask && task.status === "todo";
  const canActInProgress = canActOnTask && task.status === "in_progress";

  return (
    <tr
      onClick={() => onSelect(task.id)}
      className={cn(
        "hover:bg-gray-50 cursor-pointer transition-colors",
        isSelected && "bg-[#F5F5F5]"
      )}
    >
      <td
        className="py-2.5 px-2.5 w-9 align-middle"
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
      <td className="py-2.5 px-3 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            className={cn(
              "font-semibold text-xs text-black truncate text-left",
              task.status === "cancelled" && "line-through text-[#808080]"
            )}
            title={task.title}
          >
            {task.title}
          </button>
          {task.assignee_id && task.creator_id === task.assignee_id && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#F5F5F5] text-black border border-[#E6E6E6] shrink-0">
              Self
            </span>
          )}
        </div>
        {projectName && (
          <div className="mt-0.5 flex items-center gap-1 min-w-0">
            <span
              title={projectName}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F5F5F5] border border-[#E6E6E6] text-[#4D4D4D] truncate max-w-full"
            >
              {projectName}
            </span>
          </div>
        )}
      </td>
      <td className="py-2.5 px-2.5 w-[136px] whitespace-nowrap">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-5 h-5 rounded-full bg-[#E6E6E6] text-black font-semibold text-[9px] flex items-center justify-center shrink-0">
            {initials}
          </span>
          <span className="text-xs font-medium text-black truncate" title={assigneeName}>
            {assigneeName}
          </span>
        </div>
      </td>
      <td
        className="py-2.5 px-2.5 w-[196px] whitespace-nowrap"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1 flex-wrap">
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
                className="px-1.5 py-0.5 rounded bg-black hover:bg-[#1A1A1A] text-white text-[10px] font-semibold cursor-pointer shadow-xs disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={isStatusPending}
                onClick={() => onRejectTask(task)}
                className="px-1.5 py-0.5 rounded border border-[#E6E6E6] bg-white hover:bg-red-50 hover:text-[#FF1493] hover:border-red-200 text-[#4D4D4D] text-[10px] font-semibold cursor-pointer disabled:opacity-50"
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
                className="px-1.5 py-0.5 rounded bg-[#B7FF00]/30 border border-[#84CC16] text-black text-[10px] font-semibold cursor-pointer disabled:opacity-50"
              >
                In Progress
              </button>
              <button
                type="button"
                disabled={isStatusPending}
                onClick={() => onCompleteTask(task)}
                className="px-1.5 py-0.5 rounded bg-black hover:bg-[#1A1A1A] text-white text-[10px] font-semibold cursor-pointer shadow-xs disabled:opacity-50"
              >
                Completed
              </button>
            </>
          )}
        </div>
      </td>
      <td className="py-2.5 px-2.5 w-[92px] whitespace-nowrap">
        <StatusPill status={task.priority} />
      </td>
      <td className="py-2.5 px-2.5 w-[116px] whitespace-nowrap">
        <div className="flex items-center gap-1 min-w-0">
          {typeName ? (
            <TaskTypeBadge typeName={typeName} />
          ) : (
            <span className="text-xs text-[#808080]">—</span>
          )}
          {task.recurrence_id && (
            <span
              title="Recurring Task"
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-medium bg-[#F5F5F5] border border-[#E6E6E6] text-black shrink-0"
            >
              <Repeat className="w-2.5 h-2.5" />
            </span>
          )}
        </div>
      </td>
      <td className="py-2.5 px-3 w-[126px] whitespace-nowrap">
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
export function KanbanTaskCard({
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

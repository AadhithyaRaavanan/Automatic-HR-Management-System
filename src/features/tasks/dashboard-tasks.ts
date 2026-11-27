import type { TaskRecord } from "@/features/tasks/hooks/use-tasks";

export type DashboardTaskTab = "assigned" | "team";

const OPEN_STATUSES = new Set(["todo", "in_progress", "blocked"]);

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function getTodayIsoDate(referenceDate: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(referenceDate);
}

export function getDashboardTaskUrgencyRank(
  task: Pick<TaskRecord, "due_date" | "status">,
  todayIso: string
): number {
  const dueDate = task.due_date?.slice(0, 10) || null;
  if (!dueDate) return 3;
  if (dueDate < todayIso) return 0; // Overdue
  if (dueDate === todayIso) return 1; // Due today
  return 2; // Upcoming
}

export function sortDashboardTasksByUrgency(
  tasks: TaskRecord[],
  todayIso: string = getTodayIsoDate()
): TaskRecord[] {
  return [...tasks].sort((a, b) => {
    const rankA = getDashboardTaskUrgencyRank(a, todayIso);
    const rankB = getDashboardTaskUrgencyRank(b, todayIso);
    if (rankA !== rankB) return rankA - rankB;

    const dueA = a.due_date?.slice(0, 10) || "";
    const dueB = b.due_date?.slice(0, 10) || "";
    if (dueA && dueB && dueA !== dueB) {
      return dueA.localeCompare(dueB);
    }

    const priA = PRIORITY_WEIGHT[(a.priority || "medium").toLowerCase()] ?? 2;
    const priB = PRIORITY_WEIGHT[(b.priority || "medium").toLowerCase()] ?? 2;
    if (priA !== priB) return priA - priB;

    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}

export function partitionDashboardTasks(
  tasks: TaskRecord[],
  currentUserId: string | null | undefined,
  todayIso: string = getTodayIsoDate()
): {
  assignedToMe: TaskRecord[];
  teamDelegated: TaskRecord[];
} {
  const openTasks = (Array.isArray(tasks) ? tasks : []).filter(
    (t) => t && OPEN_STATUSES.has(t.status)
  );

  const assignedRaw = currentUserId
    ? openTasks.filter((t) => t.assignee_id === currentUserId)
    : [];

  const teamRaw = openTasks.filter((t) => {
    const isSelfAssigned = Boolean(currentUserId && t.assignee_id === currentUserId);
    if (isSelfAssigned) return false;

    const createdByAdmin = Boolean(currentUserId && t.creator_id === currentUserId);
    const isUnassigned = !t.assignee_id;
    const dueDate = t.due_date?.slice(0, 10) || null;
    const isDueTodayOrOverdue = Boolean(dueDate && dueDate <= todayIso);

    return createdByAdmin || isUnassigned || isDueTodayOrOverdue;
  });

  return {
    assignedToMe: sortDashboardTasksByUrgency(assignedRaw, todayIso),
    teamDelegated: sortDashboardTasksByUrgency(teamRaw, todayIso),
  };
}

export function formatTaskStatusLabel(status: string): string {
  switch (status) {
    case "in_progress":
      return "In Progress";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
    case "cancelled":
      return "Cancelled";
    case "todo":
    default:
      return "To Do";
  }
}

export function formatTaskPriorityLabel(priority: string): string {
  const clean = (priority || "medium").trim().toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function formatAdminTeamTasksSummary(
  teamDelegated: Pick<TaskRecord, "assignee_id">[]
): string | null {
  if (!Array.isArray(teamDelegated) || teamDelegated.length === 0) {
    return null;
  }

  let unassignedCount = 0;
  let delegatedCount = 0;
  for (const task of teamDelegated) {
    if (!task.assignee_id) unassignedCount += 1;
    else delegatedCount += 1;
  }

  if (unassignedCount > 0 && delegatedCount > 0) {
    return `${unassignedCount} unassigned and ${delegatedCount} delegated ${
      delegatedCount === 1 ? "task" : "tasks"
    } open on the board`;
  }
  if (unassignedCount > 0) {
    return `${unassignedCount} unassigned ${
      unassignedCount === 1 ? "task" : "tasks"
    } open on the board`;
  }
  return `${delegatedCount} delegated ${
    delegatedCount === 1 ? "task" : "tasks"
  } open on the board`;
}

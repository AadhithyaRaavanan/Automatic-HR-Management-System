"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CheckSquare, Folder } from "lucide-react";
import { BentoCard } from "@/components/bento/bento-card";
import { EmptyState } from "@/components/shared/empty-state";
import { useTasksData } from "@/features/tasks/hooks/use-tasks";
import {
  formatTaskPriorityLabel,
  formatTaskStatusLabel,
  getTodayIsoDate,
  partitionDashboardTasks,
} from "@/features/tasks/dashboard-tasks";

interface DashboardTasksCardProps {
  userId: string | null;
  userRole?: string | null;
}

const MAX_VISIBLE_ROWS = 3;

function formatProjectLabel(project?: { name?: string | null; code?: string | null } | null): string | null {
  const name = project?.name?.trim();
  const code = project?.code?.trim();
  if (code && name) return `${code} · ${name}`;
  return name || code || null;
}

export function DashboardTasksCard({ userId }: DashboardTasksCardProps) {
  const { data, isLoading } = useTasksData(Boolean(userId));

  const todayIso = React.useMemo(() => getTodayIsoDate(), []);

  const { assignedToMe } = React.useMemo(
    () => partitionDashboardTasks(data?.tasks || [], userId, todayIso),
    [data?.tasks, userId, todayIso]
  );

  const projectMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const p of data?.projects || []) {
      if (!p?.id) continue;
      const label = formatProjectLabel(p);
      if (label) map.set(p.id, label);
    }
    return map;
  }, [data?.projects]);

  const visibleTasks = assignedToMe.slice(0, MAX_VISIBLE_ROWS);

  return (
    <BentoCard
      title="My Tasks"
      subtitle="Open assignments and upcoming deadlines"
      action={
        <Link
          href="/tasks"
          className="text-black hover:underline text-xs font-semibold flex items-center gap-1"
        >
          <span>Open Tasks Board</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
      }
      className="lg:col-span-12"
    >
      {isLoading ? (
        <div className="divide-y divide-neutral-100">
          {[0, 1].map((idx) => (
            <div key={idx} className="py-3 flex items-center justify-between gap-3">
              <div className="h-3.5 w-48 rounded bg-neutral-100 animate-pulse" />
              <div className="h-3 w-24 rounded bg-neutral-100 animate-pulse" />
            </div>
          ))}
        </div>
      ) : visibleTasks.length > 0 ? (
        <div className="divide-y divide-neutral-100">
          {visibleTasks.map((task) => {
            const status = task.status || "todo";
            const priorityLabel = formatTaskPriorityLabel(task.priority || "medium");
            const dueDate = task.due_date?.slice(0, 10) || null;
            const dueOrStatus = !dueDate
              ? formatTaskStatusLabel(status)
              : dueDate < todayIso
                ? `Overdue (${dueDate})`
                : dueDate === todayIso
                  ? "Due today"
                  : `Due ${dueDate}`;
            const projectLabel =
              formatProjectLabel(task.project) ||
              (task.project_id ? projectMap.get(task.project_id) || null : null);

            return (
              <Link
                key={task.id}
                href={`/tasks?task=${task.id}`}
                className="py-3 first:pt-1 last:pb-1 flex items-center justify-between gap-4 hover:bg-neutral-50/70 -mx-2 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <span
                    className="block text-sm font-medium text-neutral-900 truncate"
                    title={task.title || "Untitled Task"}
                  >
                    {task.title || "Untitled Task"}
                  </span>
                  {projectLabel && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500 truncate">
                      <Folder className="w-3 h-3 shrink-0 text-neutral-400" />
                      <span className="truncate">{projectLabel}</span>
                    </span>
                  )}
                </div>
                <span className="text-xs text-neutral-500 shrink-0 whitespace-nowrap">
                  {dueOrStatus} · {priorityLabel}
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState
          className="py-6 border-dashed shadow-none bg-card-subtle/40"
          icon={<CheckSquare className="w-5 h-5" />}
          title="No open tasks assigned"
          description="Visit the Tasks board to track assignments or create a new deliverable."
          action={
            <Link
              href="/tasks"
              className="px-4 py-1.5 rounded-lg bg-black text-white text-xs font-semibold"
            >
              Go to Tasks
            </Link>
          }
        />
      )}
    </BentoCard>
  );
}

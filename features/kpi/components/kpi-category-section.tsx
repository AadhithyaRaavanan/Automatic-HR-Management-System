"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  getStatusDisplay,
  getAttendanceReasonSentence,
  getTasksReasonSentence,
} from "@/lib/kpi/plain-language";

export interface MetricItemData {
  key: string;
  label: string;
  category: "attendance" | "hours" | "tasks";
  value: number | null;
  target: number | null;
  unit: string;
  status: "on_track" | "at_risk" | "behind" | "no_data";
  displayValue: string;
  breakdown?: string;
  details?: string;
  adjusted?: boolean;
  adjustmentReason?: string;
  originalValue?: number | null;
}

interface CategorySparklineProps {
  data: (number | null)[];
}

function MiniSparkline({ data }: CategorySparklineProps) {
  const valid = data.filter((v): v is number => typeof v === "number");
  if (valid.length < 2) return null;

  const w = 54;
  const h = 18;
  const pts = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * w;
    const y = val != null ? h - (Math.min(100, Math.max(0, val)) / 100) * (h - 4) - 2 : h / 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible" aria-hidden="true">
      <polyline
        fill="none"
        stroke="#808080"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts.join(" ")}
      />
    </svg>
  );
}

interface KpiSimplifiedCardsProps {
  currentMetrics: {
    on_time_check_in_rate: MetricItemData;
    days_worked_vs_expected: MetricItemData;
    worked_hours_vs_target: MetricItemData;
    tasks_completed_vs_assigned: MetricItemData;
    task_on_time_rate: MetricItemData;
    early_check_outs?: MetricItemData;
    auto_closed_check_outs?: MetricItemData;
    regularization_requests?: MetricItemData;
    task_average_cycle_time?: MetricItemData;
    task_overdue_count?: MetricItemData;
  };
  attendanceHistory?: (number | null)[];
  tasksHistory?: (number | null)[];
  onOpenMetric: (key: string, label: string) => void;
  className?: string;
}

export function KpiCategorySection({
  currentMetrics,
  attendanceHistory = [],
  tasksHistory = [],
  onOpenMetric,
  className,
}: KpiSimplifiedCardsProps) {
  // 1. Attendance card numbers & status
  const attOnTime = currentMetrics?.on_time_check_in_rate;
  const attDays = currentMetrics?.days_worked_vs_expected;
  const attHours = currentMetrics?.worked_hours_vs_target;

  // Composite attendance score
  const attValues = [attOnTime?.value, attDays?.value, attHours?.value].filter(
    (v): v is number => typeof v === "number"
  );
  const compositeAttendanceScore =
    attValues.length > 0 ? Math.round(attValues.reduce((a, b) => a + b, 0) / attValues.length) : null;

  const attStatusKey =
    compositeAttendanceScore != null
      ? compositeAttendanceScore >= 90
        ? "on_track"
        : compositeAttendanceScore >= 80
        ? "at_risk"
        : "behind"
      : "no_data";

  const attStatus = getStatusDisplay(attStatusKey);
  const attReason = getAttendanceReasonSentence(attDays, attOnTime);

  // 2. Tasks card numbers & status
  const tasksComp = currentMetrics?.tasks_completed_vs_assigned;
  const tasksOnTime = currentMetrics?.task_on_time_rate;

  const taskValues = [tasksComp?.value, tasksOnTime?.value].filter(
    (v): v is number => typeof v === "number"
  );
  const compositeTasksScore =
    taskValues.length > 0 ? Math.round(taskValues.reduce((a, b) => a + b, 0) / taskValues.length) : null;

  const tasksStatusKey =
    tasksComp?.value != null
      ? compositeTasksScore != null && compositeTasksScore >= 85
        ? "on_track"
        : compositeTasksScore != null && compositeTasksScore >= 70
        ? "at_risk"
        : "behind"
      : "no_data";

  const tasksStatus = getStatusDisplay(tasksStatusKey);
  const tasksReason = getTasksReasonSentence(tasksComp, tasksOnTime);

  return (
    <div
      data-tour="kpi-metrics-grid"
      className={cn("grid grid-cols-1 md:grid-cols-2 gap-4", className)}
    >
      {/* CARD 1: Attendance (Consolidates Days worked & Worked hours into two lines) */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenMetric("days_worked_vs_expected", "Attendance & Working Hours")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenMetric("days_worked_vs_expected", "Attendance & Working Hours");
          }
        }}
        className="p-5 rounded-2xl bg-card border border-border-light shadow-card hover:border-black/30 hover:shadow-card-hover transition-all cursor-pointer flex flex-col justify-between space-y-4 group select-none"
      >
        <div className="space-y-2">
          {/* Top row: Status Dot + Text and subtle Sparkline */}
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold">
              <span className={cn("w-2 h-2 rounded-full", attStatus.dotColor)} aria-hidden="true" />
              <span className={attStatus.textColor}>{attStatus.label}</span>
            </div>

            <MiniSparkline data={attendanceHistory} />
          </div>

          {/* Title & Big Number */}
          <div className="flex items-baseline justify-between gap-2 pt-1">
            <h3 className="text-base font-bold text-text-primary group-hover:text-black transition-colors">
              Attendance
            </h3>
            <span className="text-2xl font-black tabular-nums text-text-primary">
              {compositeAttendanceScore != null ? `${compositeAttendanceScore}%` : "—"}
            </span>
          </div>

          {/* ONE short reason sentence */}
          <p className="text-xs text-text-secondary leading-relaxed font-medium">
            {attReason}
          </p>
        </div>

        {/* Two clean lines: Days present and Hours logged */}
        <div className="pt-3 border-t border-border-light/70 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Days present</span>
            <span className="font-semibold text-text-primary tabular-nums">
              {attDays?.displayValue && attDays.displayValue !== "No data"
                ? attDays.displayValue
                : "No days logged"}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Hours logged</span>
            <span className="font-semibold text-text-primary tabular-nums">
              {attHours?.displayValue && attHours.displayValue !== "No data"
                ? attHours.displayValue
                : "No hours logged"}
            </span>
          </div>
        </div>
      </div>

      {/* CARD 2: Tasks Delivery */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenMetric("tasks_completed_vs_assigned", "Task Delivery & Execution")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenMetric("tasks_completed_vs_assigned", "Task Delivery & Execution");
          }
        }}
        className="p-5 rounded-2xl bg-card border border-border-light shadow-card hover:border-black/30 hover:shadow-card-hover transition-all cursor-pointer flex flex-col justify-between space-y-4 group select-none"
      >
        <div className="space-y-2">
          {/* Top row: Status Dot + Text and subtle Sparkline */}
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold">
              <span className={cn("w-2 h-2 rounded-full", tasksStatus.dotColor)} aria-hidden="true" />
              <span className={tasksStatus.textColor}>{tasksStatus.label}</span>
            </div>

            <MiniSparkline data={tasksHistory} />
          </div>

          {/* Title & Big Number */}
          <div className="flex items-baseline justify-between gap-2 pt-1">
            <h3 className="text-base font-bold text-text-primary group-hover:text-black transition-colors">
              Tasks
            </h3>
            <span className="text-2xl font-black tabular-nums text-text-primary">
              {compositeTasksScore != null ? `${compositeTasksScore}%` : "—"}
            </span>
          </div>

          {/* ONE short reason sentence */}
          <p className="text-xs text-text-secondary leading-relaxed font-medium">
            {tasksReason}
          </p>
        </div>

        {/* Two clean lines: Tasks completed and On-time delivery */}
        <div className="pt-3 border-t border-border-light/70 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Tasks completed</span>
            <span className="font-semibold text-text-primary tabular-nums">
              {tasksComp?.displayValue && tasksComp.displayValue !== "No data"
                ? tasksComp.displayValue
                : "None assigned"}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-text-secondary">On-time delivery</span>
            <span className="font-semibold text-text-primary tabular-nums">
              {tasksOnTime?.displayValue && tasksOnTime.displayValue !== "No data"
                ? tasksOnTime.displayValue
                : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

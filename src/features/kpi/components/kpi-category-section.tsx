"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  getStatusDisplay,
  getAttendanceReasonSentence,
  getTasksReasonSentence,
} from "@/features/kpi/plain-language";

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
  // 1. Attendance card lines & status
  const attOnTime = currentMetrics?.on_time_check_in_rate;
  const attDays = currentMetrics?.days_worked_vs_expected;
  const attHours = currentMetrics?.worked_hours_vs_target;

  // Weakest line determines Attendance card status
  const attLinesStatus = [
    attOnTime?.status || "no_data",
    attDays?.status || "no_data",
    attHours?.status || "no_data",
  ];
  const attCardStatusKey =
    attLinesStatus.includes("behind")
      ? "behind"
      : attLinesStatus.includes("at_risk")
      ? "at_risk"
      : attLinesStatus.every((s) => s === "on_track")
      ? "on_track"
      : "no_data";

  const attStatus = getStatusDisplay(attCardStatusKey);
  const attReason = getAttendanceReasonSentence(attDays, attOnTime);

  // Status displays for the 3 individual attendance lines
  const onTimeStatus = getStatusDisplay(attOnTime?.status);
  const daysStatus = getStatusDisplay(attDays?.status);
  const hoursStatus = getStatusDisplay(attHours?.status);

  // Formatted values for 3 lines matching requirement:
  // "On-time check-ins 100%", "Days present 13 of 15 (87%)", "Hours logged 104.0h of 120.0h (87%)"
  const onTimeText =
    attOnTime?.value != null ? `${attOnTime.value}%` : "No data";

  let daysText = "No data";
  if (attDays?.value != null) {
    const raw = attDays.displayValue || "";
    const m = raw.match(/(\d+)\s+of\s+(\d+)/);
    daysText = m ? `${m[1]} of ${m[2]} (${attDays.value}%)` : raw;
  }

  let hoursText = "No data";
  if (attHours?.value != null) {
    const raw = attHours.displayValue || "";
    const m = raw.match(/([\d.]+)h\s*\/\s*([\d.]+)h/);
    hoursText = m ? `${m[1]}h of ${m[2]}h (${attHours.value}%)` : raw;
  }

  // 2. Tasks card numbers & status
  const tasksComp = currentMetrics?.tasks_completed_vs_assigned;
  const tasksOnTime = currentMetrics?.task_on_time_rate;

  const hasNoTasks =
    !tasksComp ||
    tasksComp.value == null ||
    tasksComp.status === "no_data" ||
    tasksComp.displayValue === "0 / 0" ||
    tasksComp.displayValue === "No data";

  const taskValues = [tasksComp?.value, tasksOnTime?.value].filter(
    (v): v is number => typeof v === "number"
  );
  const compositeTasksScore =
    taskValues.length > 0 ? Math.round(taskValues.reduce((a, b) => a + b, 0) / taskValues.length) : null;

  const tasksStatusKey =
    !hasNoTasks && tasksComp?.value != null
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
      {/* CARD 1: Attendance (Three distinct lines, card status reflects weakest line, no blended number) */}
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
          {/* Top row: Weakest status Dot + Text and subtle Sparkline */}
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold">
              <span className={cn("w-2 h-2 rounded-full", attStatus.dotColor)} aria-hidden="true" />
              <span className={attStatus.textColor}>{attStatus.label}</span>
            </div>

            <MiniSparkline data={attendanceHistory} />
          </div>

          {/* Title */}
          <div className="pt-1">
            <h3 className="text-base font-bold text-text-primary group-hover:text-black transition-colors">
              Attendance
            </h3>
          </div>

          {/* ONE short reason sentence */}
          <p className="text-xs text-text-secondary leading-relaxed font-medium">
            {attReason}
          </p>
        </div>

        {/* Three lines: On-time check-ins, Days present, Hours logged */}
        <div className="pt-3 border-t border-border-light/70 space-y-2 text-xs">
          {/* Line 1: On-time check-ins */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-secondary">On-time check-ins</span>
            <div className="flex items-center gap-1.5 tabular-nums">
              <span className="font-semibold text-text-primary">{onTimeText}</span>
              <span className={cn("w-1.5 h-1.5 rounded-full", onTimeStatus.dotColor)} aria-hidden="true" />
              <span className={cn("text-[11px]", onTimeStatus.textColor)}>{onTimeStatus.label}</span>
            </div>
          </div>

          {/* Line 2: Days present */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-secondary">Days present</span>
            <div className="flex items-center gap-1.5 tabular-nums">
              <span className="font-semibold text-text-primary">{daysText}</span>
              <span className={cn("w-1.5 h-1.5 rounded-full", daysStatus.dotColor)} aria-hidden="true" />
              <span className={cn("text-[11px]", daysStatus.textColor)}>{daysStatus.label}</span>
            </div>
          </div>

          {/* Line 3: Hours logged */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-secondary">Hours logged</span>
            <div className="flex items-center gap-1.5 tabular-nums">
              <span className="font-semibold text-text-primary">{hoursText}</span>
              <span className={cn("w-1.5 h-1.5 rounded-full", hoursStatus.dotColor)} aria-hidden="true" />
              <span className={cn("text-[11px]", hoursStatus.textColor)}>{hoursStatus.label}</span>
            </div>
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
        {hasNoTasks ? (
          /* When no tasks: one compact row, no dash lines */
          <div className="space-y-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-bold text-text-primary group-hover:text-black transition-colors">
                Tasks
              </h3>
              <span className="text-xs text-text-tertiary font-medium">Not counted</span>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed font-medium">
              No tasks assigned this period, so they&apos;re not counted.
            </p>
          </div>
        ) : (
          <>
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
                  {tasksComp?.displayValue || "None assigned"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-text-secondary">On-time delivery</span>
                <span className="font-semibold text-text-primary tabular-nums">
                  {tasksOnTime?.displayValue || "None delivered"}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

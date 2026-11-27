"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronRight, Clock } from "lucide-react";
import { KPI_CONFIG, getCategoryWeights } from "@/features/kpi/config";
import { formatScoredMetricRow, getStatusDisplay } from "@/features/kpi/plain-language";
import type { KpiHoursBreakdown } from "@/features/kpi/compute";

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
  customWeights?: Record<string, number>;
  hoursBreakdown?: KpiHoursBreakdown;
  taskPopulationNote?: string;
  attendanceHistory?: (number | null)[];
  tasksHistory?: (number | null)[];
  onOpenMetric: (key: string, label: string) => void;
  className?: string;
}

export function KpiCategorySection({
  currentMetrics,
  customWeights,
  hoursBreakdown,
  taskPopulationNote,
  onOpenMetric,
  className,
}: KpiSimplifiedCardsProps) {
  const weights = getCategoryWeights(customWeights || KPI_CONFIG.weights);

  const attendanceRows = [
    formatScoredMetricRow("on_time_check_in_rate", currentMetrics?.on_time_check_in_rate, currentMetrics),
    formatScoredMetricRow("days_worked_vs_expected", currentMetrics?.days_worked_vs_expected, currentMetrics),
    formatScoredMetricRow("worked_hours_vs_target", currentMetrics?.worked_hours_vs_target, currentMetrics),
  ];

  const taskRows = [
    formatScoredMetricRow("tasks_completed_vs_assigned", currentMetrics?.tasks_completed_vs_assigned, currentMetrics),
    formatScoredMetricRow("task_on_time_rate", currentMetrics?.task_on_time_rate, currentMetrics),
  ];

  const contextMeasures = [
    {
      key: "early_check_outs",
      label: "Early check-outs",
      metric: currentMetrics?.early_check_outs,
    },
    {
      key: "auto_closed_check_outs",
      label: "Forgot to check out",
      metric: currentMetrics?.auto_closed_check_outs,
    },
    {
      key: "regularization_requests",
      label: "Correction requests",
      metric: currentMetrics?.regularization_requests,
    },
    {
      key: "task_average_cycle_time",
      label: "Avg task cycle time",
      metric: currentMetrics?.task_average_cycle_time,
    },
    {
      key: "task_overdue_count",
      label: "Overdue tasks",
      metric: currentMetrics?.task_overdue_count,
    },
  ];

  const renderMetricRow = (row: ReturnType<typeof formatScoredMetricRow>) => {
    const rawMetric = (currentMetrics as Record<string, any>)?.[row.key];
    const numericVal = typeof rawMetric?.value === "number" ? Math.min(100, Math.max(0, rawMetric.value)) : 0;
    const targetPct = typeof rawMetric?.target === "number" ? Math.min(99, Math.max(1, rawMetric.target)) : 90;

    return (
      <button
        key={row.key}
        type="button"
        onClick={() => onOpenMetric(row.key, row.label)}
        className="w-full px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-left hover:bg-card-subtle/70 transition-colors cursor-pointer group focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-black"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-text-primary group-hover:text-black">
              {row.label}
            </span>
            {row.adjusted && (
              <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">
                Adjusted
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-text-secondary tabular-nums">
            {row.actualText}
          </p>
        </div>

        {/* Visual Progress Bar with Lime Target Tick (reference bento style) */}
        <div className="hidden md:flex items-center gap-2.5 w-32 shrink-0" aria-hidden="true">
          <div className="relative h-2 flex-1 rounded-full bg-[#EFEFEF] overflow-visible">
            {row.hasData && (
              <div
                className="h-full rounded-full bg-black transition-all duration-300"
                style={{ width: `${numericVal}%` }}
              />
            )}
            <div
              className="absolute -top-1 -bottom-1 w-0.5 bg-[#86C300] rounded-full"
              style={{ left: `${targetPct}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
          <span className="text-[11px] font-semibold text-text-tertiary tabular-nums">
            {row.targetText}
          </span>

          <span
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] min-w-[96px] justify-center",
              row.status.badgeBg
            )}
          >
            <span
              className={cn("w-1.5 h-1.5 rounded-full shrink-0", row.status.dotColor)}
              aria-hidden="true"
            />
            <span className={row.status.textColor}>{row.status.label}</span>
          </span>

          <ChevronRight
            className="w-4 h-4 text-text-tertiary group-hover:text-black transition-colors shrink-0"
            aria-hidden="true"
          />
        </div>
      </button>
    );
  };

  return (
    <div data-tour="kpi-metrics-grid" className={cn("space-y-4", className)}>
      {/* Scored Breakdown Groups (full-width stacked inside bento column so rows stay on one clean horizontal line) */}
      <div className="grid grid-cols-1 gap-4">
        {/* Group 1: Attendance & hours */}
        <section
          aria-label="Attendance and hours breakdown"
          className="rounded-2xl bg-card border border-border-light shadow-card overflow-hidden flex flex-col"
        >
          <div className="px-4 py-3 border-b border-border-light bg-card-subtle/40 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                Attendance &amp; hours
              </h2>
              <p className="text-[11px] text-text-secondary">
                Affects your score · {weights.attendance + weights.hours}% combined weight
              </p>
            </div>
            <span className="text-[11px] font-semibold text-text-tertiary">
              Click a row for dates
            </span>
          </div>

          <div className="divide-y divide-border-light">
            {attendanceRows.map(renderMetricRow)}
          </div>

          {hoursBreakdown && (
            <div className="px-4 py-2.5 border-t border-border-light bg-card-subtle/30 flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-secondary">
              <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
                <Clock className="w-3.5 h-3.5 text-black shrink-0" aria-hidden="true" />
                <span className="font-bold text-text-primary">
                  {(hoursBreakdown.effectiveMinutes / 60).toFixed(1)}h of {(hoursBreakdown.targetMinutes / 60).toFixed(1)}h target
                </span>
                <span>
                  ({(hoursBreakdown.workedMinutes / 60).toFixed(1)}h worked
                  {hoursBreakdown.leaveCreditMinutes > 0
                    ? ` + ${(hoursBreakdown.leaveCreditMinutes / 60).toFixed(1)}h leave credit`
                    : ""}
                  {hoursBreakdown.holidayCreditMinutes > 0
                    ? ` + ${(hoursBreakdown.holidayCreditMinutes / 60).toFixed(1)}h holiday`
                    : ""}
                  )
                </span>
              </div>
              {hoursBreakdown.hasLiveSession && (
                <span className="px-2 py-0.5 rounded-full bg-[#B7FF00] text-black text-[10px] font-bold">
                  Live shift active
                </span>
              )}
            </div>
          )}
        </section>

        {/* Group 2: Task delivery */}
        <section
          aria-label="Task delivery breakdown"
          className="rounded-2xl bg-card border border-border-light shadow-card overflow-hidden flex flex-col"
        >
          <div className="px-4 py-3 border-b border-border-light bg-card-subtle/40 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                Task delivery
              </h2>
              <p className="text-[11px] text-text-secondary">
                {taskRows[0].hasData
                  ? `Affects your score · ${weights.tasks}% combined weight`
                  : "Not counted in score until tasks are assigned"}
              </p>
            </div>
            <span className="text-[11px] font-semibold text-text-tertiary">
              Click a row for tasks
            </span>
          </div>

          <div className="divide-y divide-border-light">
            {taskRows.map(renderMetricRow)}
          </div>

          {taskPopulationNote && (
            <div className="px-4 py-2.5 border-t border-border-light bg-card-subtle/30 text-[11px] text-text-secondary mt-auto">
              {taskPopulationNote}
            </div>
          )}
        </section>
      </div>

      {/* Tracked for context (0% weight - clearly distinguished from scored measures) */}
      <section
        aria-label="Measures tracked for context"
        className="rounded-2xl bg-card border border-border-light shadow-xs p-3.5 space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-text-primary">
              Tracked for context
            </h3>
            <span className="px-2 py-0.5 rounded-full bg-card-subtle border border-border-light text-[10px] font-semibold text-text-secondary">
              Does not reduce your score
            </span>
          </div>
          <span className="text-[11px] text-text-tertiary">
            Select any item to inspect records
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {contextMeasures.map(({ key, label, metric }) => {
            const valText = metric?.displayValue || "No data";
            const st = getStatusDisplay(metric?.status);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onOpenMetric(key, label)}
                className="p-2.5 rounded-xl bg-card-subtle/60 hover:bg-card-subtle border border-border-light/80 text-left transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-black"
              >
                <span className="text-[11px] font-semibold text-text-secondary block truncate">
                  {label}
                </span>
                <div className="flex items-center justify-between gap-1 mt-1">
                  <span className="text-xs font-bold text-text-primary tabular-nums">
                    {valText}
                  </span>
                  <span
                    className={cn("w-2 h-2 rounded-full shrink-0", st.dotColor)}
                    title={st.label}
                    aria-label={st.label}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

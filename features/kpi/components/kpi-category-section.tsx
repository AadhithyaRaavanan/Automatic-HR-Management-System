"use client";

import * as React from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Edit3,
  HelpCircle,
  Info,
} from "lucide-react";

export interface MetricItemData {
  key: string;
  label: string;
  category: "attendance" | "hours" | "tasks";
  value: number | null;
  target: number | null;
  unit: string;
  status: "on_track" | "at_risk" | "behind" | "no_data";
  displayValue: string;
  adjusted?: boolean;
  adjustmentReason?: string;
  originalValue?: number | null;
}

const METRIC_CALC_TOOLTIPS: Record<string, string> = {
  on_time_check_in_rate:
    "Percentage of check-ins completed on or before your scheduled shift start time. Shift grace allowances are included.",
  days_worked_vs_expected:
    "Actual days attended vs scheduled working weekdays. Approved leaves and official public holidays count as met and are not penalized.",
  early_check_outs:
    "Count of departures prior to scheduled shift end. Early departures without approved supervisor coverage are recorded for timesheet compliance.",
  auto_closed_check_outs:
    "Count of forgotten punches auto-closed by the system at midnight. Can be regularized under Requests.",
  regularization_requests:
    "Total attendance correction requests submitted. Approved regularizations restore official punch accuracy.",
  worked_hours_vs_target:
    "Productive shift hours logged vs scheduled expectations. Approved leave and public holidays credit standard 8h shift hours toward your target.",
  tasks_completed_vs_assigned:
    "Ratio of sprint tasks completed vs total assigned. Self-assigned tasks placed in progress count toward execution.",
  task_on_time_rate:
    "Percentage of completed tasks delivered on or before their specified due date.",
  task_average_cycle_time:
    "Average elapsed hours from starting a task to completion.",
  task_overdue_count:
    "Count of open tasks that have passed their target due date without completion.",
};

const METRIC_HINTS: Record<string, string> = {
  on_time_check_in_rate: "No check-in punches recorded",
  days_worked_vs_expected: "No attended days logged",
  early_check_outs: "No early departure events",
  auto_closed_check_outs: "No forgotten punches auto-closed",
  regularization_requests: "No regularization requests filed",
  worked_hours_vs_target: "No productive shift hours recorded",
  tasks_completed_vs_assigned: "No sprint tasks assigned or completed",
  task_on_time_rate: "No completed tasks to evaluate on-time delivery",
  task_average_cycle_time: "No cycle time history yet",
  task_overdue_count: "No overdue deliverables",
};

function formatMetricValues(m: MetricItemData): { primary: string; secondary: string | null } {
  if (m.value == null || m.status === "no_data") {
    return {
      primary: "No data",
      secondary: METRIC_HINTS[m.key] || "No activity recorded in this period",
    };
  }

  // Hours
  if (m.key === "worked_hours_vs_target") {
    const match = m.displayValue.match(/^([\d.]+h)\s*\/\s*([\d.]+h)/);
    if (match) {
      return {
        primary: match[1],
        secondary: `of ${match[2]} target (${m.value}%)`,
      };
    }
    return {
      primary: `${m.value}%`,
      secondary: m.displayValue,
    };
  }

  // Days worked vs expected
  if (m.key === "days_worked_vs_expected") {
    const match = m.displayValue.match(/^(\d+)\s*\/\s*(\d+)\s*days/);
    if (match) {
      return {
        primary: `${m.value}%`,
        secondary: `${match[1]} of ${match[2]} scheduled days`,
      };
    }
    return {
      primary: `${m.value}%`,
      secondary: m.displayValue,
    };
  }

  // On-time check-in rate
  if (m.key === "on_time_check_in_rate") {
    const match = m.displayValue.match(/\(([^)]+)\)/);
    return {
      primary: `${m.value}%`,
      secondary: match ? `${match[1]} punctual punches` : "On-time check-ins",
    };
  }

  // Tasks completed vs assigned
  if (m.key === "tasks_completed_vs_assigned") {
    const match = m.displayValue.match(/^(\d+)\s*\/\s*(\d+)/);
    if (match) {
      return {
        primary: `${m.value}%`,
        secondary: `${match[1]} of ${match[2]} tasks completed`,
      };
    }
    return {
      primary: `${m.value}%`,
      secondary: m.displayValue,
    };
  }

  // Task on-time completion
  if (m.key === "task_on_time_rate") {
    const match = m.displayValue.match(/\(([^)]+)\)/);
    return {
      primary: `${m.value}%`,
      secondary: match ? `${match[1]} on-time completions` : "Delivered by due date",
    };
  }

  // Count metrics
  if (m.unit === "count") {
    const count = m.value;
    const labelMap: Record<string, string> = {
      early_check_outs: count === 1 ? "early departure recorded" : "early departures recorded",
      auto_closed_check_outs: count === 1 ? "forgotten punch auto-closed" : "forgotten punches auto-closed",
      regularization_requests: count === 1 ? "correction request filed" : "correction requests filed",
      task_overdue_count: count === 1 ? "overdue task" : "overdue tasks",
    };
    return {
      primary: String(count),
      secondary: labelMap[m.key] || "events recorded",
    };
  }

  // Task average cycle time
  if (m.key === "task_average_cycle_time") {
    return {
      primary: `${m.value}h`,
      secondary: "average completion turnaround",
    };
  }

  // Fallback
  const match = m.displayValue.match(/^([^(]+)(\(.*\))?$/);
  return {
    primary: match ? match[1].trim() : m.displayValue,
    secondary: match && match[2] ? match[2].trim().replace(/^\(|\)$/g, "") : null,
  };
}

interface KpiCategorySectionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  categoryHint: string;
  metrics: MetricItemData[];
  previousMetricsMap?: Record<string, MetricItemData>;
  isManagerOrAdmin: boolean;
  onAdjustMetric: (metric: MetricItemData) => void;
}

export function KpiCategorySection({
  title,
  description,
  icon,
  categoryHint,
  metrics,
  previousMetricsMap,
  isManagerOrAdmin,
  onAdjustMetric,
}: KpiCategorySectionProps) {
  // Count metrics that actually have data
  const trackedCount = metrics.filter(
    (m) => m.value != null && m.status !== "no_data"
  ).length;

  return (
    <section className="space-y-4">
      {/* Category Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-card-subtle flex items-center justify-center shrink-0">
              {icon}
            </div>
            <h3 className="text-base font-extrabold text-text-primary tracking-tight">
              {title}
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-card-subtle border border-border-light text-text-secondary">
              {trackedCount} of {metrics.length} tracked
            </span>
          </div>
          <p className="text-xs text-text-secondary font-medium pl-9.5">
            {description}
          </p>
        </div>
      </div>

      {/* Case 1: ALL metrics in this section have no data -> ONE compact row */}
      {trackedCount === 0 ? (
        <div className="p-4.5 rounded-2xl bg-card border border-dashed border-border-light flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-text-secondary">
            <Info className="w-4 h-4 text-brand-purple shrink-0" />
            <span className="font-semibold">
              No data yet for this period.
            </span>
            <span className="text-text-muted hidden md:inline">
              {categoryHint}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-text-tertiary text-[11px]">
            <span>Included:</span>
            {metrics.map((m, idx) => (
              <span key={m.key} className="font-medium text-text-secondary">
                {m.label}
                {idx < metrics.length - 1 ? " •" : ""}
              </span>
            ))}
          </div>
        </div>
      ) : (
        /* Case 2: 3-Column spacious Grid for Desktop */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {metrics.map((m) => {
            const hasData = m.value != null && m.status !== "no_data";
            const prev = previousMetricsMap?.[m.key];
            const trendDiff =
              hasData && prev?.value != null ? m.value! - prev.value : null;

            const tooltip =
              METRIC_CALC_TOOLTIPS[m.key] ||
              "Leave, holidays, and approved corrections are not counted against the person.";

            const { primary, secondary } = formatMetricValues(m);

            const targetText =
              m.target != null
                ? `Target: ${m.target}${m.unit === "%" ? "%" : m.unit === "count" ? "" : ` ${m.unit}`}`
                : null;

            return (
              <div
                key={m.key}
                className={cn(
                  "p-5 rounded-2xl border transition-all flex flex-col justify-between min-h-[156px] space-y-3",
                  hasData
                    ? "bg-card border-border-light shadow-card hover:border-brand-purple/40 hover:shadow-card-hover"
                    : "bg-card-subtle/50 border-dashed border-border-light text-text-tertiary"
                )}
              >
                <div className="space-y-2.5">
                  {/* Top: Full title without truncation + Tooltip + StatusBadge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 pr-1">
                      <span className="text-[13px] font-bold text-text-primary leading-snug">
                        {m.label}
                      </span>
                      <span
                        className="shrink-0 text-text-tertiary hover:text-brand-purple transition-colors cursor-help"
                        title={tooltip}
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                      </span>
                    </div>
                    <StatusBadge status={m.status} />
                  </div>

                  {/* Middle: Big Value & Target on row 1, Subtext on row 2 */}
                  <div className="space-y-1 pt-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            "text-3xl font-black tabular-nums tracking-tight",
                            hasData ? "text-text-primary" : "text-text-tertiary text-xl font-bold"
                          )}
                        >
                          {primary}
                        </span>

                        {hasData && trendDiff != null && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                              trendDiff > 0
                                ? "bg-emerald-500/10 text-emerald-600"
                                : trendDiff < 0
                                ? "bg-rose-500/10 text-rose-600"
                                : "bg-card-subtle text-text-tertiary"
                            )}
                            title="Compared to previous period"
                          >
                            {trendDiff > 0 ? (
                              <TrendingUp className="w-2.5 h-2.5" />
                            ) : trendDiff < 0 ? (
                              <TrendingDown className="w-2.5 h-2.5" />
                            ) : (
                              <Minus className="w-2.5 h-2.5" />
                            )}
                            <span>
                              {trendDiff > 0 ? `+${trendDiff}%` : `${trendDiff}%`}
                            </span>
                          </span>
                        )}
                      </div>

                      {hasData && targetText && (
                        <span className="text-[11px] font-mono font-bold text-text-tertiary tabular-nums shrink-0">
                          {targetText}
                        </span>
                      )}
                    </div>

                    {secondary && (
                      <p className="text-xs font-semibold text-text-secondary leading-snug">
                        {secondary}
                      </p>
                    )}
                  </div>

                  {/* Mini Progress Bar for Percentage Metrics */}
                  {hasData && m.unit === "%" && m.value != null && (
                    <div className="pt-1.5">
                      <div className="h-1.5 w-full bg-card-subtle rounded-full overflow-hidden">
                        <div
                          style={{ width: `${Math.min(100, Math.max(0, m.value))}%` }}
                          className="h-full rounded-full transition-all duration-500 bg-brand-purple"
                        />
                      </div>
                    </div>
                  )}

                  {/* Adjustment Badge Indicator */}
                  {m.adjusted && (
                    <div
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-purple/10 text-brand-purple border border-brand-purple/20 cursor-help"
                      title={`Adjusted: ${m.adjustmentReason}`}
                    >
                      <Edit3 className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate max-w-[200px]">
                        Adjusted: {m.adjustmentReason}
                      </span>
                    </div>
                  )}
                </div>

                {/* Adjust Action for Manager/Admin */}
                {isManagerOrAdmin && (
                  <div className="pt-2.5 border-t border-border-light/60 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onAdjustMetric(m)}
                      className="text-[11px] font-bold text-brand-purple hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Adjust</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

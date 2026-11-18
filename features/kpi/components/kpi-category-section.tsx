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
    <section className="space-y-3.5">
      {/* Category Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-card-subtle flex items-center justify-center shrink-0">
              {icon}
            </div>
            <h3 className="text-sm font-extrabold text-text-primary tracking-tight">
              {title}
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-card-subtle border border-border-light text-text-secondary">
              {trackedCount} of {metrics.length} tracked
            </span>
          </div>
          <p className="text-xs text-text-secondary font-medium pl-8">
            {description}
          </p>
        </div>
      </div>

      {/* Case 1: ALL metrics in this section have no data -> ONE compact row */}
      {trackedCount === 0 ? (
        <div className="p-4 rounded-2xl bg-card border border-dashed border-border-light flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-text-secondary">
            <Info className="w-4 h-4 text-brand-purple shrink-0" />
            <span className="font-semibold">
              No data yet for this period.
            </span>
          </div>
          <span className="text-[11px] text-text-tertiary font-medium">
            {categoryHint} • Approved leave and public holidays never penalize your score.
          </span>
        </div>
      ) : (
        /* Case 2: Responsive Grid with auto-fit/minmax so nothing is orphaned */
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
          {metrics.map((m) => {
            const hasData = m.value != null && m.status !== "no_data";
            const prev = previousMetricsMap?.[m.key];
            const trendDiff =
              hasData && prev?.value != null ? m.value! - prev.value : null;

            const tooltip =
              METRIC_CALC_TOOLTIPS[m.key] ||
              "Leave, holidays, and approved corrections are not counted against the person.";

            if (hasData) {
              const match = m.displayValue.match(/^([^(]+)(\(.*\))?$/);
              const primaryVal = match ? match[1].trim() : m.displayValue;
              const secondaryVal = match && match[2] ? match[2].trim() : null;

              /* Full Metric Card */
              return (
                <div
                  key={m.key}
                  className="p-4 rounded-2xl bg-card border border-border-light shadow-card hover:border-brand-purple/40 hover:shadow-card-hover transition-all flex flex-col justify-between min-h-[148px] space-y-3"
                >
                  <div className="space-y-2">
                    {/* Top: 2-line wrapped full title, no truncation */}
                    <div className="flex items-start justify-between gap-2 min-h-[34px]">
                      <div className="flex items-center gap-1.5 min-w-0 pr-1">
                        <span className="text-xs font-bold text-text-primary leading-snug line-clamp-2">
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

                    {/* Middle: Big Value & Target */}
                    <div className="flex flex-wrap items-baseline justify-between pt-1 gap-2">
                      <div className="flex items-baseline flex-wrap gap-1.5 min-w-0">
                        <span className="text-2xl font-black text-text-primary tabular-nums tracking-tight">
                          {primaryVal}
                        </span>
                        {secondaryVal && (
                          <span className="text-xs font-semibold text-text-secondary">
                            {secondaryVal}
                          </span>
                        )}

                        {trendDiff != null && (
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

                      {m.target != null && (
                        <span className="text-[11px] font-mono font-bold text-text-tertiary tabular-nums shrink-0">
                          Target: {m.target}
                          {m.unit ? ` ${m.unit}` : ""}
                        </span>
                      )}
                    </div>

                    {/* Mini Progress Bar for Percentage Metrics */}
                    {m.unit === "%" && m.value != null && (
                      <div className="h-1.5 w-full bg-card-subtle rounded-full overflow-hidden">
                        <div
                          style={{ width: `${Math.min(100, Math.max(0, m.value))}%` }}
                          className="h-full rounded-full transition-all duration-500 bg-brand-purple"
                        />
                      </div>
                    )}

                    {/* Adjustment Badge Indicator */}
                    {m.adjusted && (
                      <div
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-purple/10 text-brand-purple border border-brand-purple/20 cursor-help"
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
                    <div className="pt-2 border-t border-border-light/60 flex justify-end">
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
            }

            /* Compact Neutral Card for Metric with No Data */
            return (
              <div
                key={m.key}
                className="p-3.5 rounded-2xl bg-card-subtle/50 border border-border-light/80 space-y-2 flex flex-col justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-text-secondary leading-snug line-clamp-2">
                      {m.label}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-card border border-border-light text-text-tertiary shrink-0">
                      No data
                    </span>
                  </div>

                  <p className="text-[11px] text-text-muted italic">
                    {METRIC_HINTS[m.key] || "No activity recorded in this period"}
                  </p>
                </div>

                {isManagerOrAdmin && (
                  <div className="pt-1.5 border-t border-border-light/40 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onAdjustMetric(m)}
                      className="text-[10px] font-bold text-brand-purple hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 className="w-2.5 h-2.5" />
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

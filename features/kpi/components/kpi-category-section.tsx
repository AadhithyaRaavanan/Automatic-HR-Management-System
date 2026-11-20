"use client";

import * as React from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  MoreVertical,
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
  breakdown?: string;
  details?: string;
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
    "Count of departures prior to scheduled shift end. Diagnostic only: does not impact your score.",
  auto_closed_check_outs:
    "Count of forgotten punches auto-closed by the system at midnight. Can be regularized under Requests.",
  regularization_requests:
    "Total attendance correction requests submitted. Approved regularizations restore official punch accuracy.",
  worked_hours_vs_target:
    "Productive shift hours logged vs scheduled expectations. Approved leave and public holidays credit standard 8h shift hours toward your target.",
  tasks_completed_vs_assigned:
    "Ratio of tasks completed vs total assigned. Self-assigned tasks placed in progress count toward execution.",
  task_on_time_rate:
    "Percentage of completed tasks delivered on or before their specified due date.",
  task_average_cycle_time:
    "Average elapsed hours from starting a task to completion. Diagnostic only.",
  task_overdue_count:
    "Count of open tasks that have passed their target due date without completion. Diagnostic only.",
};

const DIAGNOSTIC_KEYS = new Set([
  "early_check_outs",
  "auto_closed_check_outs",
  "regularization_requests",
  "task_average_cycle_time",
  "task_overdue_count",
]);

interface KpiCategorySectionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  categoryHint: string;
  metrics: MetricItemData[];
  previousMetricsMap?: Record<string, MetricItemData>;
  isManagerOrAdmin?: boolean;
  isSelfView?: boolean;
  onAdjustMetric?: (metric: MetricItemData) => void;
  onSelectMetric?: (metricKey: string, metricLabel: string) => void;
}

export function KpiCategorySection({
  title,
  description,
  icon,
  categoryHint,
  metrics,
  previousMetricsMap,
  isManagerOrAdmin = false,
  isSelfView = true,
  onAdjustMetric,
  onSelectMetric,
}: KpiCategorySectionProps) {
  // Separate scored metrics vs diagnostic metrics
  const scoredMetrics = metrics.filter((m) => !DIAGNOSTIC_KEYS.has(m.key));
  const diagnosticMetrics = metrics.filter((m) => DIAGNOSTIC_KEYS.has(m.key));

  // Count scored metrics that actually have data
  const scoredWithDataCount = scoredMetrics.filter(
    (m) => m.value != null && m.status !== "no_data"
  ).length;

  const [activeMenuKey, setActiveMenuKey] = React.useState<string | null>(null);

  // Close adjust menu on click outside
  React.useEffect(() => {
    const handleOutside = () => setActiveMenuKey(null);
    window.addEventListener("click", handleOutside);
    return () => window.removeEventListener("click", handleOutside);
  }, []);

  const canAdjust = isManagerOrAdmin && !isSelfView;

  return (
    <section className="space-y-3.5">
      {/* Category Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-card-subtle flex items-center justify-center shrink-0">
              {icon}
            </div>
            <h3 className="text-base font-bold text-text-primary tracking-tight">
              {title}
            </h3>
            {/* Show count ONLY when some are missing */}
            {scoredWithDataCount < scoredMetrics.length && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-800 border border-amber-500/20">
                {scoredMetrics.length - scoredWithDataCount} missing data
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary font-medium pl-9.5">
            {description}
          </p>
        </div>
      </div>

      {/* Case 1: ALL scored metrics in this section have no data -> ONE compact row */}
      {scoredWithDataCount === 0 ? (
        <div className="p-4 rounded-xl bg-card border border-dashed border-border-light flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-text-secondary">
            <Info className="w-4 h-4 text-black shrink-0" />
            <span className="font-semibold text-black">
              {scoredMetrics.some((m) => m.category === "tasks")
                ? "No tasks assigned or completed in this period."
                : "No data yet for this period."}
            </span>
            {!scoredMetrics.some((m) => m.category === "tasks") && categoryHint && (
              <span className="text-text-muted hidden md:inline">
                {categoryHint}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-text-tertiary text-[11px]">
            <span>Evaluated metrics:</span>
            {scoredMetrics.map((m, idx) => (
              <span key={m.key} className="font-medium text-text-secondary">
                {m.label}
                {idx < scoredMetrics.length - 1 ? " •" : ""}
              </span>
            ))}
          </div>
        </div>
      ) : (
        /* Case 2: Scored Metrics in Clean Grid (No orphan rows, single card capped) */
        <div className={cn(
          "grid grid-cols-1 gap-4",
          scoredMetrics.length === 1 ? "max-w-xl" : "md:grid-cols-2"
        )}>
          {scoredMetrics.map((m) => {
            const hasData = m.value != null && m.status !== "no_data";
            const prev = previousMetricsMap?.[m.key];
            const trendDiff =
              hasData && prev?.value != null ? m.value! - prev.value : null;

            const tooltip =
              METRIC_CALC_TOOLTIPS[m.key] ||
              "Leave, holidays, and approved corrections are not counted against the person.";

            return (
              <div
                key={m.key}
                onClick={() => onSelectMetric?.(m.key, m.label)}
                className={cn(
                  "p-5 rounded-2xl border transition-all flex flex-col justify-between min-h-[156px] space-y-3 cursor-pointer group select-none",
                  hasData
                    ? "bg-card border-border-light shadow-card hover:border-black/30 hover:shadow-card-hover"
                    : "bg-card-subtle/40 border-dashed border-border-light text-text-tertiary"
                )}
              >
                <div className="space-y-2">
                  {/* Top: Title + Status + '...' Menu */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 pr-1">
                      <span className="text-[13px] font-bold text-text-primary leading-snug group-hover:text-black transition-colors">
                        {m.label}
                      </span>
                      <span
                        className="shrink-0 text-text-tertiary hover:text-black transition-colors cursor-help"
                        title={tooltip}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <StatusBadge status={m.status} />

                      {/* Small '...' menu per card for supervisor adjustment */}
                      {canAdjust && (
                        <div className="relative">
                          <button
                            type="button"
                            aria-label={`Options for ${m.label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuKey((prev) => (prev === m.key ? null : m.key));
                            }}
                            className="p-1 rounded-lg text-text-tertiary hover:text-black hover:bg-card-subtle transition-colors cursor-pointer"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>

                          {activeMenuKey === m.key && (
                            <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-[#E6E6E6] rounded-xl shadow-lg z-30 py-1 text-xs">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveMenuKey(null);
                                  onAdjustMetric?.(m);
                                }}
                                className="w-full px-3 py-1.5 text-left text-xs font-semibold text-black hover:bg-[#F5F5F5] transition-colors"
                              >
                                Adjust metric
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Main Value Display */}
                  <div>
                    {hasData ? (
                      <div className="space-y-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl sm:text-3xl font-extrabold text-text-primary tabular-nums tracking-tight">
                            {m.value != null && m.unit === "%" ? `${m.value}%` : m.displayValue}
                          </span>

                          {/* Trend pill: hide when 0, no -0% */}
                          {trendDiff != null && trendDiff !== 0 && (
                            <span
                              className={cn(
                                "inline-flex items-center gap-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums border",
                                trendDiff > 0
                                  ? "text-black bg-[#B7FF00]/20 border-[#B7FF00]/40"
                                  : "text-rose-700 bg-rose-50 border-rose-200"
                              )}
                            >
                              {trendDiff > 0 ? (
                                <TrendingUp className="w-3 h-3 text-black" />
                              ) : (
                                <TrendingDown className="w-3 h-3 text-rose-600" />
                              )}
                              <span>
                                {trendDiff > 0 ? `+${trendDiff}%` : `${trendDiff}%`}
                              </span>
                            </span>
                          )}
                        </div>

                        {/* Breakdown detail in smaller grey underneath */}
                        {(m.breakdown || (m.displayValue && m.displayValue.includes("("))) && (
                          <p className="text-xs text-[#808080] font-medium">
                            {m.breakdown || m.displayValue.replace(/^[0-9]+%\s*\((.*)\)$/, "$1")}
                          </p>
                        )}

                        {/* Slim progress bar with tick at target */}
                        {m.target != null && (
                          <div className="relative w-full h-1.5 bg-[#E6E6E6] rounded-full overflow-visible mt-2.5 mb-1">
                            <div
                              className="h-full bg-black rounded-full transition-all"
                              style={{ width: `${Math.min(100, Math.max(0, m.value ?? 0))}%` }}
                            />
                            <div
                              className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-[#808080]"
                              style={{ left: `${Math.min(100, Math.max(0, m.target))}%` }}
                              title={`Target: ${m.target}%`}
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="py-2">
                        <span className="text-xs font-semibold text-[#808080]">
                          No data recorded in this period
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer: Target & Adjusted Indicator */}
                <div className="pt-2 border-t border-border-light/60 flex items-center justify-between text-[11px] text-text-tertiary">
                  <span className="tabular-nums font-medium">
                    {m.target != null ? `Target: ${m.target}${m.unit === "%" ? "%" : ` ${m.unit}`}` : "Benchmark metric"}
                  </span>

                  {m.adjusted && (
                    <span
                      className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-800 border border-amber-500/20"
                      title={m.adjustmentReason || "Adjusted by supervisor"}
                    >
                      Adjusted
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Slim Diagnostics Strip: Label, Value, small status dot, clickable */}
      {diagnosticMetrics.length > 0 && (
        <div className="p-3 rounded-xl bg-card border border-border-light shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
              Diagnostics:
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:gap-5">
            {diagnosticMetrics.map((d) => {
              const hasVal = d.value != null && d.status !== "no_data";
              const isBehind = d.status === "behind" || d.status === "at_risk";

              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => onSelectMetric?.(d.key, d.label)}
                  className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-black transition-colors cursor-pointer group"
                >
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      !hasVal
                        ? "bg-[#808080]"
                        : isBehind
                        ? "bg-rose-500"
                        : "bg-[#B7FF00]"
                    )}
                    aria-hidden="true"
                  />
                  <span className="font-medium group-hover:underline">
                    {d.label}:
                  </span>
                  <span className="font-bold text-text-primary tabular-nums">
                    {hasVal ? d.displayValue : "No data"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

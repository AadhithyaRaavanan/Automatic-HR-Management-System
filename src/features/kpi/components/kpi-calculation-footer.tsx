"use client";

import * as React from "react";
import { KPI_CONFIG } from "@/features/kpi/config";
import { cn } from "@/lib/utils";
import { ChevronDown, HelpCircle, AlertCircle } from "lucide-react";

interface AdjustedMetricNote {
  key: string;
  label: string;
  originalValue?: number | null;
  value?: number | null;
  unit?: string;
  adjustmentReason?: string;
}

interface KpiCalculationFooterProps {
  employeeType?: string;
  configEffectiveDate?: string | null;
  configVersionReason?: string | null;
  customWeights?: Record<string, number> | null;
  currentMetrics?: Record<string, any> | null;
  adjustedMetrics?: AdjustedMetricNote[];
  onOpenBreakdown?: () => void;
  className?: string;
}

const PLAIN_WEIGHT_LABELS: Record<string, string> = {
  on_time_check_in_rate: "On-time check-ins",
  days_worked_vs_expected: "Days present (scheduled workdays)",
  worked_hours_vs_target: "Hours logged (vs shift target)",
  tasks_completed_vs_assigned: "Tasks completed",
  task_on_time_rate: "Task on-time delivery",
};

export function KpiCalculationFooter({
  employeeType = "full_time",
  configEffectiveDate,
  configVersionReason,
  customWeights,
  currentMetrics,
  adjustedMetrics = [],
  className,
}: KpiCalculationFooterProps) {
  const normType = (employeeType || KPI_CONFIG.defaultType).toLowerCase();
  const currentTargets =
    KPI_CONFIG.employeeTypes[normType] ||
    KPI_CONFIG.employeeTypes[KPI_CONFIG.defaultType];

  const weights = customWeights || KPI_CONFIG.weights;
  const effectiveLabel = configEffectiveDate
    ? new Date(`${configEffectiveDate}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "Default policy";

  return (
    <details
      className={cn(
        "group rounded-2xl bg-card border border-border-light shadow-xs overflow-hidden",
        className
      )}
    >
      <summary className="list-none [&::-webkit-details-marker]:hidden w-full p-4 flex items-center justify-between text-left hover:bg-card-subtle/50 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-black">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-black text-[#B7FF00] flex items-center justify-center shrink-0">
            <HelpCircle className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-text-primary tracking-tight">
                How my score is calculated
              </span>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-card-subtle border border-border-light text-text-tertiary">
                Effective {effectiveLabel}
              </span>
              {adjustedMetrics.length > 0 && (
                <span className="px-2 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 border border-amber-200 text-amber-900">
                  {adjustedMetrics.length} supervisor adjustment{adjustedMetrics.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-[11px] text-text-secondary font-medium">
              Weights, effective dates, score adjustments, and calculation rules
            </p>
          </div>
        </div>

        <ChevronDown
          className="w-4 h-4 text-text-tertiary transition-transform duration-200 group-open:rotate-180 shrink-0"
          aria-hidden="true"
        />
      </summary>

      <div className="p-4 pt-3 space-y-4 border-t border-border-light/70 text-xs">
        {adjustedMetrics.length > 0 && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-xs">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
              <span>Supervisor adjustments applied in this period</span>
            </div>
            <ul className="space-y-1 text-xs">
              {adjustedMetrics.map((adj) => (
                <li key={adj.key}>
                  <strong>{adj.label}:</strong>{" "}
                  {adj.originalValue != null ? `${adj.originalValue}${adj.unit || ""}` : "No data"} →{" "}
                  <strong>
                    {adj.value}
                    {adj.unit || ""}
                  </strong>
                  {adj.adjustmentReason ? ` — "${adj.adjustmentReason}"` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* 1. Component Weights */}
          <div className="space-y-2 p-3.5 rounded-xl bg-card-subtle border border-border-light">
            <span className="text-[11px] font-bold text-text-primary block">
              Scored metric weights
            </span>
            <div className="space-y-1.5 divide-y divide-border-light/60">
              {Object.entries(weights).map(([key, weight]) => {
                const metricObj = currentMetrics?.[key];
                const isExcluded = metricObj && metricObj.value == null;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 pt-1.5 first:pt-0"
                  >
                    <span className="font-medium text-text-primary">
                      {PLAIN_WEIGHT_LABELS[key] || key}
                      {isExcluded && (
                        <span className="text-[10px] text-text-tertiary ml-1">(no data · skipped)</span>
                      )}
                    </span>
                    <span className="tabular-nums font-bold text-black shrink-0">
                      {Math.round(Number(weight) * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-text-tertiary pt-1">
              Policy effective: {effectiveLabel}
              {configVersionReason ? ` (${configVersionReason})` : ""}
            </p>
          </div>

          {/* 2. Target Expectations */}
          <div className="space-y-2 p-3.5 rounded-xl bg-card-subtle border border-border-light">
            <span className="text-[11px] font-bold text-text-primary block">
              Targets ({normType.replace("_", " ")})
            </span>
            <div className="space-y-1.5 text-xs text-text-secondary">
              <div className="flex justify-between">
                <span>On-time check-ins</span>
                <span className="font-bold text-text-primary tabular-nums">
                  {currentTargets.onTimeTargetRate}%
                </span>
              </div>
              <div className="flex justify-between">
                <span>Days present</span>
                <span className="font-bold text-text-primary tabular-nums">
                  {currentTargets.daysWorkedTargetRate}%
                </span>
              </div>
              <div className="flex justify-between">
                <span>Hours logged</span>
                <span className="font-bold text-text-primary tabular-nums">
                  {currentTargets.hoursTargetRate}% ({currentTargets.hoursPerDay}h/day)
                </span>
              </div>
              <div className="flex justify-between">
                <span>Tasks completed</span>
                <span className="font-bold text-text-primary tabular-nums">
                  {currentTargets.taskCompletionTargetRate}%
                </span>
              </div>
              <div className="flex justify-between">
                <span>Task on-time delivery</span>
                <span className="font-bold text-text-primary tabular-nums">
                  {currentTargets.taskOnTimeTargetRate}%
                </span>
              </div>
            </div>
          </div>

          {/* 3. Calculation Rules */}
          <div className="space-y-2 p-3.5 rounded-xl bg-card-subtle border border-border-light">
            <span className="text-[11px] font-bold text-text-primary block">
              Calculation rules
            </span>
            <ul className="space-y-1.5 text-[11px] text-text-secondary leading-relaxed list-disc pl-4">
              <li>
                Overall score is the weighted average of active scored measures (capped at 100% per metric), compared against the {KPI_CONFIG.overallTarget}% target.
              </li>
              <li>
                Missing data (such as zero assigned tasks or zero completed tasks) is excluded and re-normalized instead of forced to 0%.
              </li>
              <li>
                Holidays and approved leaves credit scheduled days and shift hours so time off does not penalize your score.
              </li>
              <li>
                Measures under Tracked for context (early check-outs, auto-closed check-outs, corrections, cycle time, overdue tasks) carry 0% score weight.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </details>
  );
}

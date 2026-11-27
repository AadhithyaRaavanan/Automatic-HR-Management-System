"use client";

import * as React from "react";
import { KPI_CONFIG, getKpiBand } from "@/features/kpi/config";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, Calendar, CheckSquare } from "lucide-react";
import {
  getScoreSummaryInfo,
  getScoreTrendSentence,
  getStatusDisplay,
} from "@/features/kpi/plain-language";

interface KpiHeroCardProps {
  overallScore: number | null;
  trend?: number | null;
  previousPeriodComparable?: boolean;
  target?: number;
  currentMetrics?: any;
  previousMetrics?: any;
  customWeights?: Record<string, number>;
  onOpenBreakdown?: () => void;
  isSelfView?: boolean;
  subjectName?: string;
  userRole?: string;
  previousPeriodLabel?: string;
  periodType?: string;
  className?: string;
}

export function KpiHeroCard({
  overallScore,
  trend,
  previousPeriodComparable = false,
  target = KPI_CONFIG.overallTarget || 90,
  currentMetrics,
  customWeights,
  isSelfView = true,
  subjectName = "Employee",
  userRole = "employee",
  previousPeriodLabel = "prior period",
  className,
}: KpiHeroCardProps) {
  const isManagerOrAdmin = userRole === "manager" || userRole === "hr" || userRole === "admin";
  const showBand = !isSelfView && isManagerOrAdmin;
  const band = getKpiBand(overallScore);

  const summary = getScoreSummaryInfo({
    overallScore,
    target,
    currentMetrics,
    customWeights,
    isSelfView,
    subjectName,
  });

  const statusInfo = getStatusDisplay(summary.statusKey);
  const trendText =
    previousPeriodComparable && trend != null
      ? getScoreTrendSentence(trend, previousPeriodLabel)
      : "";

  // Extract Attendance and Task snapshot counts without fabricating data
  const daysMetric = currentMetrics?.days_worked_vs_expected;
  const daysMatch = daysMetric?.displayValue?.match(/(\d+)\s+of\s+(\d+)/);
  const workedDays = daysMatch ? parseInt(daysMatch[1], 10) : null;
  const expectedDays = daysMatch ? parseInt(daysMatch[2], 10) : null;

  const taskMetric = currentMetrics?.tasks_completed_vs_assigned;
  const taskMatch = taskMetric?.displayValue?.match(/(\d+)\s*\/\s*(\d+)/);
  const doneTasks = taskMatch ? parseInt(taskMatch[1], 10) : null;
  const totalTasks = taskMatch ? parseInt(taskMatch[2], 10) : null;

  const progressPct =
    overallScore != null ? Math.min(100, Math.max(0, overallScore)) : 0;

  return (
    <section
      data-tour="kpi-overview"
      aria-label="Performance score summary"
      className={cn("grid grid-cols-1 lg:grid-cols-12 gap-3.5", className)}
    >
      {/* Primary Compact Score Summary */}
      <div className="lg:col-span-7 rounded-2xl bg-card border border-border-light shadow-card p-5 flex flex-col justify-between gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs",
                statusInfo.badgeBg
              )}
            >
              <span
                className={cn("w-2 h-2 rounded-full", statusInfo.dotColor)}
                aria-hidden="true"
              />
              <span className={statusInfo.textColor}>{statusInfo.label}</span>
            </span>

            {showBand && band && (
              <span
                className={cn(
                  "px-2.5 py-0.5 rounded-full text-[11px] font-bold border",
                  band.badgeClass
                )}
              >
                {band.label}
              </span>
            )}
          </div>

          {trendText && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary">
              {trend != null && trend > 0 ? (
                <TrendingUp className="w-3.5 h-3.5 text-black" aria-hidden="true" />
              ) : trend != null && trend < 0 ? (
                <TrendingDown className="w-3.5 h-3.5 text-[#FF007A]" aria-hidden="true" />
              ) : (
                <Minus className="w-3.5 h-3.5 text-text-tertiary" aria-hidden="true" />
              )}
              <span>{trendText}</span>
            </span>
          )}
        </div>

        {/* Single Prominent Score + Exact Comparison Line */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-4xl sm:text-[42px] font-black text-text-primary tabular-nums tracking-tight leading-none">
              {overallScore != null ? `${overallScore}%` : "—"}
            </span>
            <p className="text-sm font-bold text-text-primary tabular-nums">
              {overallScore != null
                ? `· ${summary.comparisonLine.replace(new RegExp(`^${overallScore}%\\s*·\\s*`), "")}`
                : summary.comparisonLine}
            </p>
          </div>

          {/* Visual Target Track Bar with 90% Target Tick */}
          <div className="relative h-2.5 w-full rounded-full bg-[#EFEFEF] overflow-visible" aria-hidden="true">
            {overallScore != null && (
              <div
                className="h-full rounded-full bg-[#B7FF00] transition-all duration-500 motion-reduce:transition-none"
                style={{ width: `${progressPct}%` }}
              />
            )}
            <div
              className="absolute -top-1 -bottom-1 w-0.5 bg-black/75 rounded-full"
              style={{ left: `${Math.min(99, Math.max(1, target))}%` }}
              title={`Target ${target}%`}
            />
          </div>

          {/* Factual Single Explanation */}
          <p className="text-xs sm:text-sm font-medium text-text-secondary leading-relaxed">
            {summary.explanationLine}
          </p>
        </div>
      </div>

      {/* Side Snapshot Tiles (Attendance & Task delivery counts at a glance) */}
      <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3.5">
        {/* Attendance Snapshot Tile */}
        <div className="rounded-2xl bg-card border border-border-light shadow-card p-4 flex flex-col justify-between gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-black" aria-hidden="true" />
                <span className="text-xs font-bold text-text-primary">Attendance</span>
              </div>
              <p className="text-[11px] text-text-tertiary mt-0.5">
                {expectedDays != null ? `${expectedDays} scheduled days` : "Current window"}
              </p>
            </div>
            <div className="text-right tabular-nums">
              {workedDays != null && expectedDays != null ? (
                <span className="text-xl font-black text-text-primary">
                  {workedDays}
                  <span className="text-sm font-semibold text-text-tertiary">/{expectedDays}</span>
                </span>
              ) : (
                <span className="text-sm font-bold text-text-tertiary">No data</span>
              )}
            </div>
          </div>

          {/* Segmented workday blocks (capped cleanly at 22 cells for clean alignment) */}
          {workedDays != null && expectedDays != null && expectedDays > 0 ? (
            <div
              className="flex items-center gap-1"
              aria-label={`${workedDays} of ${expectedDays} working days present`}
            >
              {Array.from({ length: Math.min(expectedDays, 20) }).map((_, i) => {
                const filledCount =
                  expectedDays <= 20
                    ? workedDays
                    : Math.round((workedDays / expectedDays) * 20);
                return (
                  <span
                    key={i}
                    className={cn(
                      "h-2.5 flex-1 rounded-[3px]",
                      i < filledCount ? "bg-[#B7FF00]" : "bg-[#E6E6E6]"
                    )}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-text-tertiary">
              No attendance check-ins logged yet.
            </p>
          )}
        </div>

        {/* Task Delivery Snapshot Tile */}
        <div className="rounded-2xl bg-card border border-border-light shadow-card p-4 flex flex-col justify-between gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5 text-black" aria-hidden="true" />
                <span className="text-xs font-bold text-text-primary">Task completion</span>
              </div>
              <p className="text-[11px] text-text-tertiary mt-0.5">
                {totalTasks != null
                  ? `${totalTasks} assigned task${totalTasks === 1 ? "" : "s"}`
                  : "Not counted in score"}
              </p>
            </div>
            <div className="text-right tabular-nums shrink-0">
              {doneTasks != null && totalTasks != null ? (
                <span className="text-xl font-black text-text-primary">
                  {doneTasks}
                  <span className="text-sm font-semibold text-text-tertiary">/{totalTasks}</span>
                </span>
              ) : (
                <span className="text-xs font-semibold text-text-tertiary whitespace-nowrap">
                  0 assigned
                </span>
              )}
            </div>
          </div>

          {doneTasks != null && totalTasks != null && totalTasks > 0 ? (
            <div
              className="flex items-center gap-1.5"
              aria-label={`${doneTasks} of ${totalTasks} assigned tasks completed`}
            >
              {Array.from({ length: Math.min(totalTasks, 10) }).map((_, i) => {
                const filled =
                  totalTasks <= 10
                    ? i < doneTasks
                    : i < Math.round((doneTasks / totalTasks) * 10);
                return (
                  <span
                    key={i}
                    className={cn(
                      "h-2.5 flex-1 rounded-[3px]",
                      filled ? "bg-[#B7FF00]" : "bg-[#E6E6E6]"
                    )}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-text-tertiary">
              Weight is excluded when zero tasks are assigned.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

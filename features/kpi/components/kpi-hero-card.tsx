"use client";

import * as React from "react";
import { KpiRadialGauge } from "./kpi-radial-gauge";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPI_CONFIG, getKpiBand, getActiveCategoryWeightNotice } from "@/lib/kpi/config";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Clock,
  Calendar,
  CheckSquare,
  Info,
} from "lucide-react";

export interface CategoryHistorySlice {
  label: string;
  attendanceScore: number | null;
  hoursScore: number | null;
  tasksScore: number | null;
}

interface KpiHeroCardProps {
  overallScore: number | null;
  trend?: number | null;
  target?: number;
  currentMetrics?: any;
  previousMetrics?: any;
  categoryHistory?: CategoryHistorySlice[];
  onOpenBreakdown?: () => void;
  isSelfView?: boolean;
  userRole?: string;
  previousPeriodLabel?: string;
  className?: string;
}

function CategorySparkline({ data }: { data: (number | null)[] }) {
  const valid = data.filter((v): v is number => typeof v === "number");
  if (valid.length < 2) return null;

  const w = 48;
  const h = 14;
  const pts = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * w;
    const y = val != null ? h - (Math.min(100, Math.max(0, val)) / 100) * (h - 2) - 1 : h / 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible mt-1" aria-hidden="true">
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

export function KpiHeroCard({
  overallScore,
  trend,
  target = 90,
  currentMetrics,
  previousMetrics,
  categoryHistory = [],
  onOpenBreakdown,
  isSelfView = true,
  userRole = "employee",
  previousPeriodLabel = "previous period",
  className,
}: KpiHeroCardProps) {
  const isManagerOrAdmin = userRole === "manager" || userRole === "hr" || userRole === "admin";
  const showBand = !isSelfView && isManagerOrAdmin;
  const band = getKpiBand(overallScore);

  // Category values & trends for the 3 sub-items under the gauge
  const att1 = currentMetrics?.on_time_check_in_rate?.value;
  const att2 = currentMetrics?.days_worked_vs_expected?.value;
  const attendanceScore =
    att1 != null && att2 != null
      ? Math.round((att1 + att2) / 2)
      : att1 ?? att2 ?? null;

  const hoursScore = currentMetrics?.worked_hours_vs_target?.value ?? null;

  const t1 = currentMetrics?.tasks_completed_vs_assigned?.value;
  const t2 = currentMetrics?.task_on_time_rate?.value;
  const tasksScore =
    t1 != null && t2 != null
      ? Math.round((t1 + t2) / 2)
      : t1 ?? t2 ?? null;

  // Previous category values for trend calculation
  const prevAtt1 = previousMetrics?.on_time_check_in_rate?.value;
  const prevAtt2 = previousMetrics?.days_worked_vs_expected?.value;
  const prevAttendance =
    prevAtt1 != null && prevAtt2 != null
      ? Math.round((prevAtt1 + prevAtt2) / 2)
      : prevAtt1 ?? prevAtt2 ?? null;
  const attTrend = attendanceScore != null && prevAttendance != null ? attendanceScore - prevAttendance : null;

  const prevHours = previousMetrics?.worked_hours_vs_target?.value ?? null;
  const hoursTrend = hoursScore != null && prevHours != null ? hoursScore - prevHours : null;

  const prevT1 = previousMetrics?.tasks_completed_vs_assigned?.value;
  const prevT2 = previousMetrics?.task_on_time_rate?.value;
  const prevTasks =
    prevT1 != null && prevT2 != null
      ? Math.round((prevT1 + prevT2) / 2)
      : prevT1 ?? prevT2 ?? null;
  const tasksTrend = tasksScore != null && prevTasks != null ? tasksScore - prevTasks : null;

  // Active category weight notice (when a category lacks data)
  const weightNotice = currentMetrics
    ? getActiveCategoryWeightNotice(currentMetrics)
    : { notice: null, percent: 100 };

  const hasAttendance = Boolean(attendanceScore != null && attendanceScore > 0);
  const hasHours = Boolean(hoursScore != null && hoursScore > 0);
  const hasTasks = Boolean(tasksScore != null && tasksScore > 0);

  return (
    <div
      data-tour="kpi-overview"
      className={cn(
        "rounded-[20px] bg-card border border-border-light shadow-card p-5 lg:p-6 flex flex-col justify-between transition-all",
        className
      )}
    >
      {/* Card Header (Normal sentence case, no duplicate links) */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-border-light/60">
        <span className="text-xs font-bold text-text-primary">
          Overall performance
        </span>

        {/* Band Label shown ONLY to managers/HR viewing team members */}
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

      {overallScore != null ? (
        /* Active Performance View */
        <div className="space-y-4 pt-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <KpiRadialGauge score={overallScore} target={target} size={112} />

            <div className="space-y-2 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={
                    overallScore >= target
                      ? "on_track"
                      : overallScore >= target - 10
                      ? "at_risk"
                      : "behind"
                  }
                />

                {/* Trend beside gauge (hidden when previous period has no data, no -0% chip) */}
                {trend != null && trend !== 0 && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border",
                      trend > 0
                        ? "bg-[#B7FF00]/20 text-black border-[#B7FF00]/40"
                        : "bg-rose-50 text-rose-700 border-rose-200"
                    )}
                  >
                    {trend > 0 ? (
                      <TrendingUp className="w-3.5 h-3.5 text-black" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
                    )}
                    <span className="tabular-nums">
                      {trend > 0 ? `+${trend}` : `${trend}`} points vs {previousPeriodLabel}
                    </span>
                  </span>
                )}
              </div>

              {/* Notice when category has no data: plain grey note matching page */}
              {weightNotice.notice ? (
                <div className="flex items-center gap-1.5 text-xs text-[#808080] font-normal">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  <span>{weightNotice.notice}</span>
                </div>
              ) : (
                <p className="text-xs text-text-secondary font-medium">
                  Goal: <span className="font-bold text-text-primary tabular-nums">{target}%</span> across Attendance, Hours, and Task execution.
                </p>
              )}
            </div>
          </div>

          {/* Three Small Category Items under the Gauge */}
          <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-border-light/60">
            {/* 1. Attendance */}
            <div className="p-2.5 rounded-xl bg-card-subtle/80 border border-border-light flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-text-tertiary">Attendance</span>
              <div className="flex items-baseline justify-between gap-1 mt-1">
                <span
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    attendanceScore != null ? "text-text-primary" : "text-[#808080]"
                  )}
                >
                  {attendanceScore != null ? `${attendanceScore}%` : "No data"}
                </span>
                {attTrend != null && attTrend !== 0 && (
                  <span
                    className={cn(
                      "text-[10px] font-bold tabular-nums",
                      attTrend > 0 ? "text-black" : "text-rose-600"
                    )}
                  >
                    {attTrend > 0 ? `+${attTrend}%` : `${attTrend}%`}
                  </span>
                )}
              </div>
              <CategorySparkline data={categoryHistory.map((h) => h.attendanceScore)} />
            </div>

            {/* 2. Hours */}
            <div className="p-2.5 rounded-xl bg-card-subtle/80 border border-border-light flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-text-tertiary">Hours</span>
              <div className="flex items-baseline justify-between gap-1 mt-1">
                <span
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    hoursScore != null ? "text-text-primary" : "text-[#808080]"
                  )}
                >
                  {hoursScore != null ? `${hoursScore}%` : "No data"}
                </span>
                {hoursTrend != null && hoursTrend !== 0 && (
                  <span
                    className={cn(
                      "text-[10px] font-bold tabular-nums",
                      hoursTrend > 0 ? "text-black" : "text-rose-600"
                    )}
                  >
                    {hoursTrend > 0 ? `+${hoursTrend}%` : `${hoursTrend}%`}
                  </span>
                )}
              </div>
              <CategorySparkline data={categoryHistory.map((h) => h.hoursScore)} />
            </div>

            {/* 3. Tasks */}
            <div className="p-2.5 rounded-xl bg-card-subtle/80 border border-border-light flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-text-tertiary">Tasks</span>
              <div className="flex items-baseline justify-between gap-1 mt-1">
                <span
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    tasksScore != null ? "text-text-primary" : "text-[#808080]"
                  )}
                >
                  {tasksScore != null ? `${tasksScore}%` : "No data"}
                </span>
                {tasksTrend != null && tasksTrend !== 0 && (
                  <span
                    className={cn(
                      "text-[10px] font-bold tabular-nums",
                      tasksTrend > 0 ? "text-black" : "text-rose-600"
                    )}
                  >
                    {tasksTrend > 0 ? `+${tasksTrend}%` : `${tasksTrend}%`}
                  </span>
                )}
              </div>
              <CategorySparkline data={categoryHistory.map((h) => h.tasksScore)} />
            </div>
          </div>

          {/* Stacked Weight Bar with legend underneath */}
          <div className="pt-2 border-t border-border-light/60 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-text-tertiary">
              <span>Category Weighting</span>
              <span className="tabular-nums">100% Total</span>
            </div>

            <div className="h-2 w-full rounded-full overflow-hidden flex bg-[#E6E6E6]">
              <div
                style={{ width: `${Math.round(KPI_CONFIG.weights.attendance * 100)}%` }}
                className="bg-[#B7FF00] h-full transition-all"
                title={`Attendance & Reliability (${Math.round(KPI_CONFIG.weights.attendance * 100)}%)`}
              />
              <div
                style={{ width: `${Math.round(KPI_CONFIG.weights.hours * 100)}%` }}
                className="bg-[#4D4D4D] h-full transition-all"
                title={`Shift Hours Target (${Math.round(KPI_CONFIG.weights.hours * 100)}%)`}
              />
              <div
                style={{ width: `${Math.round(KPI_CONFIG.weights.tasks * 100)}%` }}
                className="bg-[#808080] h-full transition-all"
                title={`Task Delivery & Execution (${Math.round(KPI_CONFIG.weights.tasks * 100)}%)`}
              />
            </div>

            <p className="text-[10px] text-text-tertiary font-medium">
              Attendance {Math.round(KPI_CONFIG.weights.attendance * 100)}% · Hours {Math.round(KPI_CONFIG.weights.hours * 100)}% · Tasks {Math.round(KPI_CONFIG.weights.tasks * 100)}%
            </p>
          </div>
        </div>
      ) : (
        /* Empty State with diagnostic checklist */
        <div className="space-y-4 pt-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <h2 className="text-base font-bold text-text-primary tracking-tight">
                Not enough data yet
              </h2>
              <p className="text-xs text-text-secondary leading-relaxed font-medium">
                Active attendance punches and deliverables in this period feed your performance score.
              </p>
            </div>
            <KpiRadialGauge score={null} size={76} />
          </div>

          <div className="p-3 rounded-xl bg-card-subtle/80 border border-border-light space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block">
              Required Score Inputs:
            </span>

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {hasAttendance ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-black shrink-0" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                  )}
                  <span className={cn(hasAttendance ? "font-semibold text-text-primary" : "text-text-tertiary")}>
                    Attendance punches
                  </span>
                </div>
                <span className="text-[11px] font-medium text-text-tertiary">
                  {hasAttendance ? "Recorded" : "Missing"}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {hasHours ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-black shrink-0" />
                  ) : (
                    <Calendar className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                  )}
                  <span className={cn(hasHours ? "font-semibold text-text-primary" : "text-text-tertiary")}>
                    Shift hours logged
                  </span>
                </div>
                <span className="text-[11px] font-medium text-text-tertiary">
                  {hasHours ? "Recorded" : "Missing"}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {hasTasks ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-black shrink-0" />
                  ) : (
                    <CheckSquare className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                  )}
                  <span className={cn(hasTasks ? "font-semibold text-text-primary" : "text-text-tertiary")}>
                    Tasks assigned
                  </span>
                </div>
                <span className="text-[11px] font-medium text-text-tertiary">
                  {hasTasks ? "Recorded" : "Missing"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

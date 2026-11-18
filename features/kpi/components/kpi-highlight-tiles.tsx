"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Clock,
  Calendar,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";

interface HighlightTileProps {
  title: string;
  icon: React.ReactNode;
  primaryValue: string;
  subValue?: string | null;
  targetText?: string;
  hasData: boolean;
  hint?: string;
  percentValue?: number | null;
  trendDiff?: number | null;
  accentColor?: "purple" | "emerald" | "amber";
}

function HighlightTile({
  title,
  icon,
  primaryValue,
  subValue,
  targetText,
  hasData,
  hint,
  percentValue,
  trendDiff,
  accentColor = "purple",
}: HighlightTileProps) {
  const barColors = {
    purple: "bg-brand-purple",
    emerald: "bg-brand-purple/75",
    amber: "bg-brand-purple/55",
  };

  return (
    <div
      className={cn(
        "rounded-[22px] border p-5 flex flex-col justify-between transition-all",
        hasData
          ? "bg-card border-border-light shadow-card hover:shadow-card-hover"
          : "bg-card-subtle/50 border-dashed border-border-light text-text-tertiary"
      )}
    >
      {/* Tile Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-7 h-7 rounded-xl flex items-center justify-center shrink-0",
              hasData ? "bg-card-subtle" : "bg-card-subtle/60"
            )}
          >
            {icon}
          </div>
          <span className="text-xs font-extrabold text-text-primary tracking-tight">
            {title}
          </span>
        </div>

        {/* Trend Indicator */}
        {hasData && trendDiff != null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-md",
              trendDiff > 0
                ? "bg-emerald-500/10 text-emerald-600"
                : trendDiff < 0
                ? "bg-rose-500/10 text-rose-600"
                : "bg-card-subtle text-text-tertiary"
            )}
            title="Compared to previous evaluation cycle"
          >
            {trendDiff > 0 ? (
              <TrendingUp className="w-3 h-3" />
            ) : trendDiff < 0 ? (
              <TrendingDown className="w-3 h-3" />
            ) : (
              <Minus className="w-3 h-3" />
            )}
            <span>
              {trendDiff > 0 ? `+${trendDiff}%` : `${trendDiff}%`}
            </span>
          </span>
        )}
      </div>

      {/* Main Headline & Context */}
      <div className="space-y-2 my-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "text-3xl font-black tabular-nums tracking-tight",
              hasData ? "text-text-primary" : "text-text-tertiary text-xl font-bold"
            )}
          >
            {primaryValue}
          </span>

          {hasData && targetText && (
            <span className="text-[11px] font-mono text-text-tertiary font-bold tabular-nums shrink-0">
              {targetText}
            </span>
          )}
        </div>

        {hasData && subValue ? (
          <p className="text-xs font-semibold text-text-secondary leading-snug">
            {subValue}
          </p>
        ) : !hasData ? (
          <p className="text-xs text-text-muted italic">
            {hint || "No activity recorded"}
          </p>
        ) : null}

        {/* Mini Progress Bar */}
        {hasData && percentValue != null && (
          <div className="pt-1">
            <div className="h-1.5 w-full bg-card-subtle rounded-full overflow-hidden relative">
              <div
                style={{ width: `${Math.min(100, Math.max(0, percentValue))}%` }}
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  barColors[accentColor]
                )}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer / Hint */}
      <div className="pt-2 border-t border-border-light/60 text-[11px]">
        {hasData ? (
          <span className="text-text-tertiary font-medium">
            Active tracking in cycle
          </span>
        ) : (
          <span className="text-text-muted italic">Awaiting punches / deliverables</span>
        )}
      </div>
    </div>
  );
}

interface KpiHighlightTilesProps {
  currentMetrics?: any;
  previousMetrics?: any;
  className?: string;
}

export function KpiHighlightTiles({
  currentMetrics,
  previousMetrics,
  className,
}: KpiHighlightTilesProps) {
  // 1. Attendance Headline: On-Time Rate or Attended Days
  const onTimeMetric = currentMetrics?.on_time_check_in_rate;
  const daysMetric = currentMetrics?.days_worked_vs_expected;
  const prevOnTime = previousMetrics?.on_time_check_in_rate;

  const attendanceHasData =
    Boolean(onTimeMetric?.value != null && onTimeMetric.status !== "no_data") ||
    Boolean(daysMetric?.value != null && daysMetric.status !== "no_data");

  let attendancePrimary = "No data";
  let attendanceSub: string | null = null;
  let attendancePercent: number | null = null;

  if (attendanceHasData) {
    if (onTimeMetric?.value != null) {
      attendancePrimary = `${onTimeMetric.value}%`;
      attendancePercent = onTimeMetric.value;
      const m = onTimeMetric.displayValue?.match(/\(([^)]+)\)/);
      attendanceSub = m ? `${m[1]} on time` : "Punctual punches recorded";
    } else if (daysMetric?.value != null) {
      attendancePrimary = `${daysMetric.value}%`;
      attendancePercent = daysMetric.value;
      const m = daysMetric.displayValue?.match(/^([^(]+)/);
      attendanceSub = m ? `${m[1].trim()} attended` : "Shift attendance tracked";
    }
  }

  const attendanceTrend =
    onTimeMetric?.value != null && prevOnTime?.value != null
      ? onTimeMetric.value - prevOnTime.value
      : null;

  // 2. Hours Headline
  const hoursMetric = currentMetrics?.worked_hours_vs_target;
  const prevHours = previousMetrics?.worked_hours_vs_target;

  const hoursHasData = Boolean(
    hoursMetric?.value != null && hoursMetric.status !== "no_data"
  );

  let hoursPrimary = "No data";
  let hoursSub: string | null = null;
  const hoursPercent = hoursMetric?.value != null ? hoursMetric.value : null;

  if (hoursHasData && hoursMetric?.displayValue) {
    // Expected format: "8.3h / 104.0h (8%)"
    const m = hoursMetric.displayValue.match(/^([\d.]+h)\s*\/\s*([\d.]+h)/);
    if (m) {
      hoursPrimary = m[1];
      hoursSub = `of ${m[2]} target (${hoursMetric.value ?? 0}%)`;
    } else {
      hoursPrimary = `${hoursMetric.value ?? 0}%`;
      hoursSub = hoursMetric.displayValue;
    }
  }

  const hoursTrend =
    hoursMetric?.value != null && prevHours?.value != null
      ? hoursMetric.value - prevHours.value
      : null;

  // 3. Tasks Headline
  const tasksMetric = currentMetrics?.tasks_completed_vs_assigned;
  const prevTasks = previousMetrics?.tasks_completed_vs_assigned;

  const tasksHasData = Boolean(
    tasksMetric?.value != null && tasksMetric.status !== "no_data"
  );

  let tasksPrimary = "No data";
  let tasksSub: string | null = null;
  const tasksPercent = tasksMetric?.value != null ? tasksMetric.value : null;

  if (tasksHasData && tasksMetric?.displayValue) {
    // Expected format: "3 / 4 (75%)"
    const m = tasksMetric.displayValue.match(/^(\d+)\s*\/\s*(\d+)/);
    if (m) {
      tasksPrimary = `${tasksMetric.value ?? 0}%`;
      tasksSub = `${m[1]} of ${m[2]} deliverables completed`;
    } else {
      tasksPrimary = `${tasksMetric.value ?? 0}%`;
      tasksSub = tasksMetric.displayValue;
    }
  }

  const tasksTrend =
    tasksMetric?.value != null && prevTasks?.value != null
      ? tasksMetric.value - prevTasks.value
      : null;

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-3 gap-4 h-full items-stretch", className)}>
      <HighlightTile
        title="Attendance"
        icon={<Clock className="w-4 h-4 text-brand-purple" />}
        primaryValue={attendancePrimary}
        subValue={attendanceSub}
        targetText="Target: 95%"
        hasData={attendanceHasData}
        hint="No punch records yet"
        percentValue={attendancePercent}
        trendDiff={attendanceTrend}
        accentColor="purple"
      />

      <HighlightTile
        title="Hours Target"
        icon={<Calendar className="w-4 h-4 text-brand-purple" />}
        primaryValue={hoursPrimary}
        subValue={hoursSub}
        targetText="Goal: 100%"
        hasData={hoursHasData}
        hint="No logged shift hours"
        percentValue={hoursPercent}
        trendDiff={hoursTrend}
        accentColor="emerald"
      />

      <HighlightTile
        title="Task Delivery"
        icon={<CheckCircle2 className="w-4 h-4 text-brand-purple" />}
        primaryValue={tasksPrimary}
        subValue={tasksSub}
        targetText="Target: 90%"
        hasData={tasksHasData}
        hint="No deliverables in cycle"
        percentValue={tasksPercent}
        trendDiff={tasksTrend}
        accentColor="amber"
      />
    </div>
  );
}

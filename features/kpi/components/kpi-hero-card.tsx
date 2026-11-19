"use client";

import * as React from "react";
import Link from "next/link";
import { KpiRadialGauge } from "./kpi-radial-gauge";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  HelpCircle,
  CheckCircle2,
  Clock,
  Calendar,
  CheckSquare,
  ArrowRight,
} from "lucide-react";

interface KpiHeroCardProps {
  overallScore: number | null;
  trend?: number | null;
  target?: number;
  currentMetrics?: any;
  onOpenBreakdown: () => void;
  className?: string;
}

export function KpiHeroCard({
  overallScore,
  trend,
  target = 90,
  currentMetrics,
  onOpenBreakdown,
  className,
}: KpiHeroCardProps) {
  // Activity checks for the empty-state checklist
  const hasAttendance =
    Boolean(
      currentMetrics?.days_worked_vs_expected?.value != null &&
        currentMetrics.days_worked_vs_expected.value > 0
    ) ||
    Boolean(
      currentMetrics?.on_time_check_in_rate?.value != null &&
        currentMetrics.on_time_check_in_rate.value > 0
    );

  const hasHours = Boolean(
    currentMetrics?.worked_hours_vs_target?.value != null &&
      currentMetrics.worked_hours_vs_target.value > 0
  );

  const hasTasks = Boolean(
    currentMetrics?.tasks_completed_vs_assigned?.value != null &&
      currentMetrics.tasks_completed_vs_assigned.value > 0
  );

  return (
    <div
      data-tour="kpi-overview"
      className={cn(
        "rounded-[24px] bg-card border border-border-light shadow-card p-5 lg:p-6 flex flex-col justify-between transition-all",
        className
      )}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-border-light/60">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-text-tertiary">
          Overall Performance Index
        </span>
        <button
          type="button"
          onClick={onOpenBreakdown}
          className="text-brand-purple hover:text-brand-purple-hover text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-brand-purple rounded-md px-1"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>View Weight Breakdown</span>
        </button>
      </div>

      {overallScore != null ? (
        /* State 1: Active Performance Data */
        <div className="space-y-5 pt-3">
          <div className="flex items-center gap-5 sm:gap-6">
            <KpiRadialGauge score={overallScore} target={target} size={112} />

            <div className="space-y-2 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={
                    overallScore >= target
                      ? "on_track"
                      : overallScore >= target - 15
                      ? "at_risk"
                      : "behind"
                  }
                />

                {trend != null && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-xs font-extrabold px-2.5 py-0.5 rounded-full border",
                      trend > 0
                        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        : trend < 0
                        ? "bg-rose-500/10 text-rose-600 border-rose-500/20"
                        : "bg-card-subtle text-text-secondary border-border-light"
                    )}
                  >
                    {trend > 0 ? (
                      <TrendingUp className="w-3.5 h-3.5" />
                    ) : trend < 0 ? (
                      <TrendingDown className="w-3.5 h-3.5" />
                    ) : null}
                    <span>
                      {trend > 0 ? `+${trend}%` : `${trend}%`} vs previous
                    </span>
                  </span>
                )}
              </div>

              <p className="text-xs text-text-secondary leading-relaxed font-medium">
                Goal: <strong className="text-text-primary">{target}%+</strong> • Weighted across Attendance (40%), Hours (25%), and Task delivery (35%).
              </p>
            </div>
          </div>

          {/* Stacked Weight Breakdown Bar */}
          <div className="pt-2 border-t border-border-light/60 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-text-tertiary">
              <span>Category Weighting</span>
              <span className="font-mono">100% Total</span>
            </div>

            <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-[#E6E6E6]">
              <div
                style={{ width: "40%" }}
                className="bg-[#B7FF00] h-full transition-all duration-500"
                title="Attendance & Reliability (40%)"
              />
              <div
                style={{ width: "25%" }}
                className="bg-[#4D4D4D] h-full transition-all duration-500"
                title="Shift Hours Target (25%)"
              />
              <div
                style={{ width: "35%" }}
                className="bg-[#808080] h-full transition-all duration-500"
                title="Task Delivery & Execution (35%)"
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#4D4D4D] font-medium">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#B7FF00] shrink-0" />
                Attendance 40%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#4D4D4D] shrink-0" />
                Hours 25%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#808080] shrink-0" />
                Tasks 35%
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* State 2: Friendly Empty State without enough data */
        <div className="space-y-4 pt-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <h2 className="text-lg font-black text-text-primary tracking-tight">
                Not enough data yet
              </h2>
              <p className="text-xs text-text-secondary leading-relaxed font-medium">
                Active attendance sessions and completed tasks in this period feed your performance score.
              </p>
            </div>

            <KpiRadialGauge score={null} size={76} />
          </div>

          {/* Checklist of what feeds the score */}
          <div className="p-3.5 rounded-2xl bg-card-subtle/80 border border-border-light space-y-2.5">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-text-tertiary block">
              Activities Feeding Your Score:
            </span>

            <div className="space-y-2 text-xs">
              {/* Item 1: Attendance */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {hasAttendance ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-brand-purple shrink-0" />
                  )}
                  <span
                    className={cn(
                      "font-semibold truncate",
                      hasAttendance ? "text-text-primary line-through opacity-80" : "text-text-primary"
                    )}
                  >
                    Check in on scheduled working days
                  </span>
                </div>
                <Link
                  href="/attendance"
                  className="text-[11px] font-bold text-brand-purple hover:underline shrink-0 flex items-center gap-0.5"
                >
                  <span>Attendance</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {/* Item 2: Hours */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {hasHours ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
                  )}
                  <span
                    className={cn(
                      "font-semibold truncate",
                      hasHours ? "text-text-primary line-through opacity-80" : "text-text-primary"
                    )}
                  >
                    Complete shift hours target
                  </span>
                </div>
                <Link
                  href="/attendance"
                  className="text-[11px] font-bold text-brand-purple hover:underline shrink-0 flex items-center gap-0.5"
                >
                  <span>Timesheet</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {/* Item 3: Tasks */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {hasTasks ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <CheckSquare className="w-4 h-4 text-amber-500 shrink-0" />
                  )}
                  <span
                    className={cn(
                      "font-semibold truncate",
                      hasTasks ? "text-text-primary line-through opacity-80" : "text-text-primary"
                    )}
                  >
                    Complete tasks assigned to you
                  </span>
                </div>
                <Link
                  href="/tasks"
                  className="text-[11px] font-bold text-brand-purple hover:underline shrink-0 flex items-center gap-0.5"
                >
                  <span>Tasks</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

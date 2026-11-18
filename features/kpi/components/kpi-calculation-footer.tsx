"use client";

import * as React from "react";
import { KPI_CONFIG } from "@/lib/kpi/config";
import { cn } from "@/lib/utils";
import { ChevronDown, HelpCircle, ShieldCheck } from "lucide-react";

interface KpiCalculationFooterProps {
  employeeType?: string;
  className?: string;
}

const WEIGHT_LABELS: Record<string, string> = {
  on_time_check_in_rate: "On-Time Check-In Rate",
  days_worked_vs_expected: "Days Worked vs Expected",
  worked_hours_vs_target: "Worked Hours vs Target",
  tasks_completed_vs_assigned: "Tasks Completed vs Assigned",
  task_on_time_rate: "Task On-Time Delivery Rate",
};

export function KpiCalculationFooter({
  employeeType = "full_time",
  className,
}: KpiCalculationFooterProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const normType = employeeType.toLowerCase();
  const currentTargets =
    KPI_CONFIG.employeeTypes[normType] ||
    KPI_CONFIG.employeeTypes[KPI_CONFIG.defaultType];

  return (
    <div
      className={cn(
        "rounded-2xl bg-card border border-border-light shadow-xs transition-all overflow-hidden",
        className
      )}
    >
      {/* Header Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-card-subtle/50 transition-colors cursor-pointer"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-brand-purple/10 text-brand-purple flex items-center justify-center shrink-0">
            <HelpCircle className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-extrabold text-text-primary tracking-tight">
              How Performance & KPI Metrics Are Calculated
            </h4>
            <p className="text-[11px] text-text-secondary font-medium">
              Objective formulas, weighting rules, and shift policy targets from the system configuration.
            </p>
          </div>
        </div>

        <ChevronDown
          className={cn(
            "w-4 h-4 text-text-tertiary transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Expanded Content */}
      {isOpen && (
        <div className="p-4 pt-0 space-y-4 border-t border-border-light/60 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
            {/* Left: Weights Table */}
            <div className="space-y-2 p-3.5 rounded-xl bg-card-subtle border border-border-light">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-text-tertiary block">
                Overall Index Component Weights
              </span>

              <div className="space-y-1.5 divide-y divide-border-light/60">
                {Object.entries(KPI_CONFIG.weights).map(([key, weight]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between pt-1.5 first:pt-0"
                  >
                    <span className="font-semibold text-text-primary">
                      {WEIGHT_LABELS[key] || key}
                    </span>
                    <span className="font-mono font-bold text-brand-purple">
                      {Math.round(weight * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Per-Type Targets */}
            <div className="space-y-2 p-3.5 rounded-xl bg-card-subtle border border-border-light">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-text-tertiary block">
                  Active Policy Targets ({normType.replace("_", "-")})
                </span>
                <span className="font-mono text-[10px] font-bold text-brand-purple">
                  {currentTargets.hoursPerDay}h Shift
                </span>
              </div>

              <div className="space-y-1.5 divide-y divide-border-light/60">
                <div className="flex items-center justify-between pt-1.5 first:pt-0">
                  <span className="font-semibold text-text-primary">On-Time Punch Target</span>
                  <span className="font-mono font-bold text-text-secondary">
                    {currentTargets.onTimeTargetRate}%
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5">
                  <span className="font-semibold text-text-primary">Working Days Attendance</span>
                  <span className="font-mono font-bold text-text-secondary">
                    {currentTargets.daysWorkedTargetRate}%
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5">
                  <span className="font-semibold text-text-primary">Shift Hours Target</span>
                  <span className="font-mono font-bold text-text-secondary">
                    {currentTargets.hoursTargetRate}%
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5">
                  <span className="font-semibold text-text-primary">Task Completion Target</span>
                  <span className="font-mono font-bold text-text-secondary">
                    {currentTargets.taskCompletionTargetRate}%
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5">
                  <span className="font-semibold text-text-primary">Task On-Time Delivery</span>
                  <span className="font-mono font-bold text-text-secondary">
                    {currentTargets.taskOnTimeTargetRate}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Governance & Privacy Statement */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-brand-purple/5 border border-brand-purple/15 text-[11px] text-text-secondary leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-brand-purple shrink-0 mt-0.5" />
            <div>
              <strong className="text-brand-purple block mb-0.5">Objective Governance Policy:</strong>
              Approved leave applications and official corporate holidays automatically count as met and are not charged against your working days or target hours. Periods or metrics with no recorded activity are tagged <strong>No data</strong> and never penalize your score.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

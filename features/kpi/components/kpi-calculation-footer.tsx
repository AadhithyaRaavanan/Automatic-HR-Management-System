"use client";

import * as React from "react";
import { KPI_CONFIG } from "@/lib/kpi/config";
import { cn } from "@/lib/utils";
import { ChevronDown, HelpCircle } from "lucide-react";

interface KpiCalculationFooterProps {
  employeeType?: string;
  configEffectiveDate?: string | null;
  onOpenBreakdown?: () => void;
  className?: string;
}

const PLAIN_WEIGHT_LABELS: Record<string, string> = {
  on_time_check_in_rate: "Punctuality (on-time check-ins)",
  days_worked_vs_expected: "Days present (scheduled workdays)",
  worked_hours_vs_target: "Hours logged (vs shift target)",
  tasks_completed_vs_assigned: "Tasks completed",
  task_on_time_rate: "Tasks delivered on time",
};

export function KpiCalculationFooter({
  employeeType = "full_time",
  configEffectiveDate = "1 Nov 2026",
  onOpenBreakdown,
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
          <div className="w-7 h-7 rounded-lg bg-black text-[#B7FF00] flex items-center justify-center shrink-0">
            <HelpCircle className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold text-text-primary tracking-tight">
                How this is calculated
              </h4>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-card-subtle border border-border-light text-text-tertiary">
                Effective {configEffectiveDate || "1 Nov 2026"}
              </span>
            </div>
            <p className="text-[11px] text-text-secondary font-medium">
              Formulas, category weights, and tracking rules.
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3">
            {/* 1. Component Weights */}
            <div className="space-y-2 p-3.5 rounded-xl bg-card-subtle border border-border-light">
              <span className="text-[10px] font-bold text-text-tertiary block">
                What counts toward your result
              </span>

              <div className="space-y-1.5 divide-y divide-border-light/60">
                {Object.entries(KPI_CONFIG.weights).map(([key, weight]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between pt-1.5 first:pt-0"
                  >
                    <span className="font-semibold text-text-primary">
                      {PLAIN_WEIGHT_LABELS[key] || key}
                    </span>
                    <span className="tabular-nums font-bold text-black">
                      {Math.round(weight * 100)}%
                    </span>
                  </div>
                ))}
              </div>

              {onOpenBreakdown && (
                <button
                  type="button"
                  onClick={onOpenBreakdown}
                  className="w-full mt-2 py-1.5 rounded-lg bg-card border border-border-light text-xs font-bold text-black hover:bg-card-subtle text-center cursor-pointer"
                >
                  View full formula breakdown
                </button>
              )}
            </div>

            {/* 2. Target Expectations */}
            <div className="space-y-2 p-3.5 rounded-xl bg-card-subtle border border-border-light">
              <span className="text-[10px] font-bold text-text-tertiary block">
                Target expectations ({employeeType.replace("_", "-")})
              </span>

              <div className="space-y-1.5 text-xs text-text-secondary">
                <div className="flex justify-between">
                  <span>Punctuality target</span>
                  <span className="font-bold text-text-primary tabular-nums">
                    {currentTargets.onTimeTargetRate}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Days present target</span>
                  <span className="font-bold text-text-primary tabular-nums">
                    {currentTargets.daysWorkedTargetRate}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Daily shift hours</span>
                  <span className="font-bold text-text-primary tabular-nums">
                    {currentTargets.hoursPerDay}h / day
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Task completion target</span>
                  <span className="font-bold text-text-primary tabular-nums">
                    {currentTargets.taskCompletionTargetRate}%
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Also Tracked (formerly Diagnostics) */}
            <div className="space-y-2 p-3.5 rounded-xl bg-card-subtle border border-border-light">
              <span className="text-[10px] font-bold text-text-tertiary block">
                Also tracked (does not reduce score)
              </span>

              <div className="space-y-1.5 text-xs text-text-secondary">
                <p>• <strong>Early check-outs:</strong> Leaving before scheduled shift end.</p>
                <p>• <strong>Forgot to check out:</strong> Punches auto-closed at midnight.</p>
                <p>• <strong>Correction requests:</strong> Punch adjustments submitted.</p>
                <p>• <strong>Average task cycle time:</strong> Elapsed hours to finish tasks.</p>
                <p>• <strong>Overdue tasks:</strong> Open tasks past target due date.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

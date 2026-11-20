"use client";

import * as React from "react";
import { KPI_CONFIG } from "@/lib/kpi/config";
import { cn } from "@/lib/utils";
import { ChevronDown, HelpCircle, ShieldCheck } from "lucide-react";

interface KpiCalculationFooterProps {
  employeeType?: string;
  configEffectiveDate?: string | null;
  className?: string;
}

const WEIGHT_LABELS: Record<string, string> = {
  on_time_check_in_rate: "On-time check-in rate",
  days_worked_vs_expected: "Days worked vs expected",
  worked_hours_vs_target: "Worked hours vs target",
  tasks_completed_vs_assigned: "Tasks completed vs assigned",
  task_on_time_rate: "Task on-time delivery rate",
};

export function KpiCalculationFooter({
  employeeType = "full_time",
  configEffectiveDate = "1 Nov 2026",
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
                How performance & KPI metrics are calculated
              </h4>
              <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-card-subtle border border-border-light text-text-tertiary">
                Targets effective from {configEffectiveDate || "1 Nov 2026"}
              </span>
            </div>
            <p className="text-[11px] text-text-secondary font-medium">
              Objective formulas, component weighting, and shift policy targets from the system configuration.
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
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block">
                Overall index component weights
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
                    <span className="tabular-nums font-bold text-black">
                      {Math.round(weight * 100)}%
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t border-border-light text-[11px] font-bold">
                  <span className="text-text-primary">Overall benchmark target</span>
                  <span className="tabular-nums text-black">{KPI_CONFIG.overallTarget || 90}%</span>
                </div>
              </div>
            </div>

            {/* 2. Active Role Policy Targets */}
            <div className="space-y-2 p-3.5 rounded-xl bg-card-subtle border border-border-light">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block">
                  Active policy targets ({normType.replace("_", "-")})
                </span>
                <span className="tabular-nums text-[11px] font-bold text-black">
                  {currentTargets.hoursPerDay}h Shift
                </span>
              </div>

              <div className="space-y-1.5 divide-y divide-border-light/60">
                <div className="flex items-center justify-between pt-1.5 first:pt-0">
                  <span className="font-semibold text-text-primary">On-time punch target</span>
                  <span className="tabular-nums font-bold text-text-secondary">
                    {currentTargets.onTimeTargetRate}%
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5">
                  <span className="font-semibold text-text-primary">Working days attendance</span>
                  <span className="tabular-nums font-bold text-text-secondary">
                    {currentTargets.daysWorkedTargetRate}%
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5">
                  <span className="font-semibold text-text-primary">Shift hours target</span>
                  <span className="tabular-nums font-bold text-text-secondary">
                    {currentTargets.hoursTargetRate}%
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5">
                  <span className="font-semibold text-text-primary">Task completion target</span>
                  <span className="tabular-nums font-bold text-text-secondary">
                    {currentTargets.taskCompletionTargetRate}%
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5">
                  <span className="font-semibold text-text-primary">Task on-time delivery</span>
                  <span className="tabular-nums font-bold text-text-secondary">
                    {currentTargets.taskOnTimeTargetRate}%
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Status Thresholds from Config */}
            <div className="space-y-2 p-3.5 rounded-xl bg-card-subtle border border-border-light">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block">
                Status evaluation thresholds
              </span>

              <div className="space-y-2 pt-1 text-xs">
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#B7FF00] mt-1 shrink-0" />
                  <div>
                    <strong className="text-black block">On track</strong>
                    <span className="text-[11px] text-text-secondary">At or above target</span>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500 mt-1 shrink-0" />
                  <div>
                    <strong className="text-black block">At risk</strong>
                    <span className="text-[11px] text-text-secondary">Within 10 points below target</span>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-500 mt-1 shrink-0" />
                  <div>
                    <strong className="text-black block">Behind</strong>
                    <span className="text-[11px] text-text-secondary">More than 10 points below target</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Governance & Privacy Statement */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] text-[11px] text-[#4D4D4D] leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-black shrink-0 mt-0.5" />
            <div>
              <strong className="text-black block mb-0.5">Objective Governance Policy:</strong>
              Approved leave applications and official corporate holidays automatically count as met and are not charged against your working days or target hours. Periods or metrics with no recorded activity are tagged <strong>No data</strong> and never penalize your score.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

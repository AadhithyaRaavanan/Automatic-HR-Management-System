"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  MessageSquare,
  Target,
  Users,
  ChevronLeft,
  ChevronRight,
  Calendar,
} from "lucide-react";

export type KpiTab = "metrics" | "team" | "reviews" | "goals";
export type PeriodPreset = "week" | "month" | "quarter" | "custom";

interface KpiToolbarProps {
  activeTab: KpiTab;
  onTabChange: (tab: KpiTab) => void;
  reviewCount: number;
  goalCount: number;

  // Period Navigator
  periodLabel: string;
  preset: PeriodPreset;
  onPresetChange: (preset: PeriodPreset) => void;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;

  // Custom date range
  customRange: { from: string; to: string };
  onCustomRangeChange: (range: { from: string; to: string }) => void;

  // Manager/HR Scoped Filters
  isManagerOrAdmin: boolean;
  scopedEmployees: Array<{ id: string; full_name: string | null; email: string }>;
  selectedEmpId: string;
  onSelectEmployee: (empId: string) => void;
  currentUserId?: string | null;

  empType: string;
  onEmpTypeChange: (type: string) => void;

  deptFilter: string;
  onDeptFilterChange: (dept: string) => void;
  departments?: Array<{ id: string; name: string }>;

  className?: string;
}

export function KpiToolbar({
  activeTab,
  onTabChange,
  reviewCount,
  goalCount,
  periodLabel,
  preset,
  onPresetChange,
  onPrevPeriod,
  onNextPeriod,
  customRange,
  onCustomRangeChange,
  isManagerOrAdmin,
  scopedEmployees,
  selectedEmpId,
  onSelectEmployee,
  currentUserId,
  empType,
  onEmpTypeChange,
  deptFilter,
  onDeptFilterChange,
  departments = [],
  className,
}: KpiToolbarProps) {
  const isSelfView = !selectedEmpId || selectedEmpId === currentUserId;

  return (
    <div
      data-tour="kpi-filters"
      className={cn(
        "sticky top-0 z-20 p-2.5 sm:p-3 rounded-2xl bg-card/95 backdrop-blur-md border border-border-light shadow-card space-y-2.5",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left Side: Segmented Pill Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-card-subtle border border-border-light/80">
          {/* Tab 1: Metrics */}
          <button
            type="button"
            onClick={() => onTabChange("metrics")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5",
              activeTab === "metrics"
                ? "bg-black text-white shadow-xs"
                : "text-text-secondary hover:text-text-primary hover:bg-card/60"
            )}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Metrics & Score</span>
          </button>

          {/* Tab 2: Team (Managers, HR, Admin only) */}
          {isManagerOrAdmin && (
            <button
              type="button"
              data-tour="kpi-team-tab"
              onClick={() => onTabChange("team")}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5",
                activeTab === "team"
                  ? "bg-black text-white shadow-xs"
                  : "text-text-secondary hover:text-text-primary hover:bg-card/60"
              )}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Team</span>
            </button>
          )}

          {/* Tab 3: Reviews */}
          <button
            type="button"
            data-tour="kpi-reviews-tab"
            onClick={() => onTabChange("reviews")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5",
              activeTab === "reviews"
                ? "bg-black text-white shadow-xs"
                : "text-text-secondary hover:text-text-primary hover:bg-card/60"
            )}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Reviews</span>
            {reviewCount > 0 && (
              <span
                className={cn(
                  "px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums",
                  activeTab === "reviews"
                    ? "bg-white/20 text-white"
                    : "bg-card border border-border-light text-text-tertiary"
                )}
              >
                {reviewCount}
              </span>
            )}
          </button>

          {/* Tab 4: Goals */}
          <button
            type="button"
            data-tour="kpi-goals-tab"
            onClick={() => onTabChange("goals")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5",
              activeTab === "goals"
                ? "bg-black text-white shadow-xs"
                : "text-text-secondary hover:text-text-primary hover:bg-card/60"
            )}
          >
            <Target className="w-3.5 h-3.5" />
            <span>Goals</span>
            {goalCount > 0 && (
              <span
                className={cn(
                  "px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums",
                  activeTab === "goals"
                    ? "bg-white/20 text-white"
                    : "bg-card border border-border-light text-text-tertiary"
                )}
              >
                {goalCount}
              </span>
            )}
          </button>
        </div>

        {/* Right Side: Filters & Period Navigation */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Manager/HR: Employee Selector */}
          {isManagerOrAdmin && scopedEmployees.length > 0 && activeTab !== "team" && (
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Select Employee"
                value={selectedEmpId}
                onChange={(e) => onSelectEmployee(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary cursor-pointer hover:border-black/30 transition-colors"
              >
                {scopedEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name || emp.email} {emp.id === currentUserId ? "(You)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Employee Type: In self-view, plain label; Managers/HR keep dropdown */}
          {isSelfView ? (
            <div className="px-2.5 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary capitalize select-none">
              {empType.replace("_", "-")}
            </div>
          ) : isManagerOrAdmin ? (
            <select
              aria-label="Employee Type"
              value={empType}
              onChange={(e) => onEmpTypeChange(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary cursor-pointer"
            >
              <option value="full_time">Full-Time (8h)</option>
              <option value="part_time">Part-Time (4h)</option>
              <option value="intern">Intern (8h)</option>
              <option value="contract">Contract (8h)</option>
            </select>
          ) : (
            <div className="px-2.5 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary capitalize select-none">
              {empType.replace("_", "-")}
            </div>
          )}

          {/* Period Navigator with Prev/Next and Exact Date Range */}
          <div className="flex items-center rounded-xl bg-card-subtle border border-border-light p-0.5">
            <button
              type="button"
              onClick={onPrevPeriod}
              aria-label="Previous Period"
              title="Previous period"
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            {/* Period Label with exact date range under it */}
            <div className="flex flex-col items-center px-2.5 min-w-[130px] select-none leading-tight py-0.5">
              <span className="text-xs font-bold text-text-primary">
                {periodLabel}
              </span>
              <span className="text-[10px] text-text-tertiary font-medium">
                {customRange.from} – {customRange.to}
              </span>
            </div>

            <button
              type="button"
              onClick={onNextPeriod}
              aria-label="Next Period"
              title="Next period"
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card transition-colors cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Presets: Week / Month / Quarter / Custom */}
          <div className="flex items-center gap-1 rounded-xl bg-card-subtle p-0.5 border border-border-light">
            {(["week", "month", "quarter", "custom"] as PeriodPreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onPresetChange(p)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer",
                  preset === p
                    ? "bg-black text-white shadow-xs"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Custom Date Pickers when 'Custom' is selected */}
      {preset === "custom" && (
        <div className="flex items-center gap-2 pt-2 border-t border-border-light/60 text-xs">
          <Calendar className="w-3.5 h-3.5 text-black shrink-0" />
          <span className="font-bold text-text-secondary">Custom Range:</span>
          <input
            type="date"
            aria-label="Start Date"
            value={customRange.from}
            onChange={(e) =>
              onCustomRangeChange({ ...customRange, from: e.target.value })
            }
            className="px-2.5 py-1 rounded-lg bg-card-subtle border border-border-light text-xs text-text-primary"
          />
          <span className="text-text-tertiary font-bold">to</span>
          <input
            type="date"
            aria-label="End Date"
            value={customRange.to}
            onChange={(e) =>
              onCustomRangeChange({ ...customRange, to: e.target.value })
            }
            className="px-2.5 py-1 rounded-lg bg-card-subtle border border-border-light text-xs text-text-primary"
          />
        </div>
      )}
    </div>
  );
}

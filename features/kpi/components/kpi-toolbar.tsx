"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  MessageSquare,
  Users,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Filter,
  MoreHorizontal,
  Check,
} from "lucide-react";

export type KpiTab = "overview" | "reviews_and_goals" | "team" | "metrics" | "reviews" | "goals";
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
  const isOverview = activeTab === "overview" || activeTab === "metrics";
  const isReviewsGoals = activeTab === "reviews_and_goals" || activeTab === "reviews" || activeTab === "goals";
  const isTeam = activeTab === "team";

  // Popover state for "More" period presets (Week, Custom)
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLDivElement>(null);

  // Popover state for "Filters" (Department, Type for managers/HR)
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const filtersRef = React.useRef<HTMLDivElement>(null);

  // Close menus on outside click
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    }
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const totalReviewsAndGoals = reviewCount + goalCount;

  return (
    <div
      data-tour="kpi-filters"
      className={cn(
        "sticky top-0 z-20 p-2 sm:p-2.5 rounded-2xl bg-card/95 backdrop-blur-md border border-border-light shadow-card space-y-2",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Left Side: Three Simple Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-card-subtle border border-border-light/80">
          {/* Tab 1: Overview */}
          <button
            type="button"
            data-tour="kpi-overview-tab"
            onClick={() => onTabChange("overview")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5",
              isOverview
                ? "bg-black text-white shadow-xs"
                : "text-text-secondary hover:text-text-primary hover:bg-card/60"
            )}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Overview</span>
          </button>

          {/* Tab 2: Reviews and goals (Merged) */}
          <button
            type="button"
            data-tour="kpi-reviews-tab"
            onClick={() => onTabChange("reviews_and_goals")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5",
              isReviewsGoals
                ? "bg-black text-white shadow-xs"
                : "text-text-secondary hover:text-text-primary hover:bg-card/60"
            )}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Reviews and goals</span>
            {totalReviewsAndGoals > 0 && (
              <span
                className={cn(
                  "px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums",
                  isReviewsGoals
                    ? "bg-white/20 text-white"
                    : "bg-card border border-border-light text-text-tertiary"
                )}
              >
                {totalReviewsAndGoals}
              </span>
            )}
          </button>

          {/* Tab 3: Team (Managers and HR only) */}
          {isManagerOrAdmin && (
            <button
              type="button"
              data-tour="kpi-team-tab"
              onClick={() => onTabChange("team")}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5",
                isTeam
                  ? "bg-black text-white shadow-xs"
                  : "text-text-secondary hover:text-text-primary hover:bg-card/60"
              )}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Team</span>
            </button>
          )}
        </div>

        {/* Right Side: Simple Period Control + Month/Quarter Switch + Scoped Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Manager/HR: Employee Selector (visible only when manager/HR is browsing) */}
          {isManagerOrAdmin && scopedEmployees.length > 0 && (
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

          {/* Filters Popover for Managers/HR (Department & Employee Type) */}
          {isManagerOrAdmin && (
            <div className="relative" ref={filtersRef}>
              <button
                type="button"
                onClick={() => setFiltersOpen((prev) => !prev)}
                aria-label="Filters"
                className={cn(
                  "px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer",
                  (deptFilter && deptFilter !== "all") || (empType && empType !== "full_time")
                    ? "bg-black text-white border-black"
                    : "bg-card-subtle border-border-light text-text-secondary hover:text-text-primary"
                )}
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Filters</span>
                {((deptFilter && deptFilter !== "all") || (empType && empType !== "full_time")) && (
                  <span className="w-2 h-2 rounded-full bg-[#B7FF00]" aria-hidden="true" />
                )}
              </button>

              {filtersOpen && (
                <div className="absolute right-0 mt-2 w-64 p-3 rounded-2xl bg-card border border-border-light shadow-shell z-30 space-y-3">
                  <div>
                    <label className="text-[11px] font-bold text-text-secondary block mb-1">
                      Department
                    </label>
                    <select
                      value={deptFilter || "all"}
                      onChange={(e) => onDeptFilterChange(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-card-subtle border border-border-light text-xs text-text-primary font-medium"
                    >
                      <option value="all">All Departments</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-text-secondary block mb-1">
                      Employment type
                    </label>
                    <select
                      value={empType}
                      onChange={(e) => onEmpTypeChange(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-card-subtle border border-border-light text-xs text-text-primary font-medium"
                    >
                      <option value="full_time">Full-Time (8h)</option>
                      <option value="part_time">Part-Time (4h)</option>
                      <option value="intern">Intern (8h)</option>
                      <option value="contract">Contract (8h)</option>
                    </select>
                  </div>

                  <div className="flex justify-between items-center pt-1 border-t border-border-light text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        onDeptFilterChange("all");
                        onEmpTypeChange("full_time");
                      }}
                      className="text-text-tertiary hover:text-black font-semibold cursor-pointer"
                    >
                      Reset filters
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(false)}
                      className="px-2.5 py-1 rounded-lg bg-black text-white font-bold cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Period Navigator: Prev, Label with exact date range, Next */}
          <div className="flex items-center rounded-xl bg-card-subtle border border-border-light p-0.5">
            <button
              type="button"
              onClick={onPrevPeriod}
              aria-label="Previous period"
              title="Previous period"
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

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
              aria-label="Next period"
              title="Next period"
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card transition-colors cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Simple Month / Quarter Switch + More Menu (Week, Custom) */}
          <div className="flex items-center gap-1 rounded-xl bg-card-subtle p-0.5 border border-border-light">
            <button
              type="button"
              onClick={() => onPresetChange("month")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer",
                preset === "month"
                  ? "bg-black text-white shadow-xs"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              Month
            </button>
            <button
              type="button"
              onClick={() => onPresetChange("quarter")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer",
                preset === "quarter"
                  ? "bg-black text-white shadow-xs"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              Quarter
            </button>

            {/* More Menu (Week, Custom) */}
            <div className="relative" ref={moreRef}>
              <button
                type="button"
                onClick={() => setMoreOpen((prev) => !prev)}
                aria-label="More periods"
                title="More periods (Week, Custom)"
                className={cn(
                  "p-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center",
                  preset === "week" || preset === "custom"
                    ? "bg-black text-white shadow-xs px-2"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {preset === "week" ? (
                  <span>Week</span>
                ) : preset === "custom" ? (
                  <span>Custom</span>
                ) : (
                  <MoreHorizontal className="w-3.5 h-3.5" />
                )}
              </button>

              {moreOpen && (
                <div className="absolute right-0 mt-1.5 w-32 p-1.5 rounded-xl bg-card border border-border-light shadow-shell z-30 space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      onPresetChange("week");
                      setMoreOpen(false);
                    }}
                    className={cn(
                      "w-full px-2 py-1.5 rounded-lg text-xs font-semibold text-left flex items-center justify-between cursor-pointer",
                      preset === "week"
                        ? "bg-card-subtle text-black font-bold"
                        : "text-text-secondary hover:bg-card-subtle/60"
                    )}
                  >
                    <span>Week</span>
                    {preset === "week" && <Check className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onPresetChange("custom");
                      setMoreOpen(false);
                    }}
                    className={cn(
                      "w-full px-2 py-1.5 rounded-lg text-xs font-semibold text-left flex items-center justify-between cursor-pointer",
                      preset === "custom"
                        ? "bg-card-subtle text-black font-bold"
                        : "text-text-secondary hover:bg-card-subtle/60"
                    )}
                  >
                    <span>Custom</span>
                    {preset === "custom" && <Check className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Custom Date Pickers when 'Custom' is selected */}
      {preset === "custom" && (
        <div className="flex items-center gap-2 pt-2 border-t border-border-light/60 text-xs">
          <Calendar className="w-3.5 h-3.5 text-black shrink-0" />
          <span className="font-semibold text-text-secondary">Custom Range:</span>
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

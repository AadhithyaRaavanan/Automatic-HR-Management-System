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
} from "lucide-react";

export type KpiTab = "overview" | "reviews_and_goals" | "team" | "metrics" | "reviews" | "goals";
export type PeriodPreset = "week" | "month" | "quarter" | "custom";

interface KpiToolbarProps {
  activeTab: KpiTab;
  onTabChange: (tab: KpiTab) => void;
  reviewCount: number;
  goalCount: number;

  // Period Navigator
  stepperLabel: string;
  preset: PeriodPreset;
  onPresetChange: (preset: PeriodPreset) => void;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;

  // Custom date range
  customRange: { from: string; to: string };
  onCustomRangeChange: (range: { from: string; to: string }) => void;

  // Manager/HR Scoped Employee Selector
  isManagerOrAdmin: boolean;
  scopedEmployees: Array<{ id: string; full_name: string | null; email: string }>;
  selectedEmpId: string;
  onSelectEmployee: (empId: string) => void;
  currentUserId?: string | null;

  className?: string;
}

const PRESET_OPTIONS: Array<{ key: PeriodPreset; label: string }> = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "custom", label: "Custom" },
];

export function KpiToolbar({
  activeTab,
  onTabChange,
  reviewCount,
  goalCount,
  stepperLabel,
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
  className,
}: KpiToolbarProps) {
  const isOverview = activeTab === "overview" || activeTab === "metrics";
  const isReviewsGoals = activeTab === "reviews_and_goals" || activeTab === "reviews" || activeTab === "goals";
  const isTeam = activeTab === "team";

  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const totalReviewsAndGoals = reviewCount + goalCount;

  const tabsList = React.useMemo(() => {
    const items: Array<{ id: KpiTab; active: boolean; label: string; badge?: number; tour: string }> = [
      { id: "overview", active: isOverview, label: "Overview", tour: "kpi-overview-tab" },
      {
        id: "reviews_and_goals",
        active: isReviewsGoals,
        label: "Reviews & goals",
        badge: totalReviewsAndGoals > 0 ? totalReviewsAndGoals : undefined,
        tour: "kpi-reviews-tab",
      },
    ];
    if (isManagerOrAdmin) {
      items.push({ id: "team", active: isTeam, label: "Team", tour: "kpi-team-tab" });
    }
    return items;
  }, [isOverview, isReviewsGoals, isTeam, isManagerOrAdmin, totalReviewsAndGoals]);

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = (index + 1) % tabsList.length;
    else if (e.key === "ArrowLeft") nextIndex = (index - 1 + tabsList.length) % tabsList.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = tabsList.length - 1;

    if (nextIndex !== null) {
      e.preventDefault();
      const targetTab = tabsList[nextIndex];
      onTabChange(targetTab.id);
      tabRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <div
      data-tour="kpi-filters"
      className={cn(
        "rounded-2xl bg-card border border-border-light shadow-card px-3 py-2.5 space-y-2.5",
        className
      )}
    >
      {/* Distinct Navigation Row (left) + Period & Employee Controls (right) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
        {/* Primary KPI Section Tabs (single non-wrapping row with ARIA tablist + keyboard arrows) */}
        <div
          role="tablist"
          aria-label="KPI sections"
          className="inline-flex items-center gap-1 overflow-x-auto pb-0.5 lg:pb-0"
        >
          {tabsList.map((tab, idx) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[idx] = el;
              }}
              id={`kpi-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={tab.active}
              tabIndex={tab.active ? 0 : -1}
              data-tour={tab.tour}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              className={cn(
                "relative shrink-0 min-h-[36px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black",
                tab.active
                  ? "bg-black text-white shadow-xs after:content-[''] after:absolute after:inset-x-3 after:bottom-0 after:border-b-[2px] after:border-[#B7FF00]"
                  : "text-text-secondary hover:text-text-primary hover:bg-card-subtle"
              )}
            >
              {tab.id === "overview" ? (
                <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
              ) : tab.id === "reviews_and_goals" ? (
                <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Users className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{tab.label}</span>
              {tab.badge != null && (
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums",
                    tab.active
                      ? "bg-[#B7FF00] text-black"
                      : "bg-card-subtle border border-border-light text-text-secondary"
                  )}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Right Controls: Manager Employee Selector + All 4 Period Presets + Stepper */}
        <div className="flex flex-wrap items-center gap-2">
          {isManagerOrAdmin && !isTeam && scopedEmployees.length > 0 && (
            <div className="flex items-center">
              <label htmlFor="kpi-employee-select" className="sr-only">
                Select employee
              </label>
              <select
                id="kpi-employee-select"
                aria-label="Select Employee"
                value={selectedEmpId}
                onChange={(e) => onSelectEmployee(e.target.value)}
                className="min-h-[34px] px-3 py-1 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary cursor-pointer hover:border-black/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                {scopedEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name || emp.email} {emp.id === currentUserId ? "(You)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* All 4 Period Presets directly visible */}
          <div
            role="group"
            aria-label="Reporting period presets"
            className="inline-flex items-center gap-0.5 rounded-xl bg-card-subtle p-0.5 border border-border-light"
          >
            {PRESET_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                aria-pressed={preset === opt.key}
                onClick={() => onPresetChange(opt.key)}
                className={cn(
                  "min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-black",
                  preset === opt.key
                    ? "bg-[#B7FF00] text-black shadow-xs"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Period Stepper (< Range >) */}
          {preset !== "custom" && (
            <div className="inline-flex items-center rounded-xl bg-card-subtle border border-border-light p-0.5">
              <button
                type="button"
                onClick={onPrevPeriod}
                aria-label="Previous period"
                title="Previous period"
                className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
              >
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              </button>

              <span className="px-2.5 text-xs font-bold text-text-primary tabular-nums whitespace-nowrap select-none">
                {stepperLabel}
              </span>

              <button
                type="button"
                onClick={onNextPeriod}
                aria-label="Next period"
                title="Next period"
                className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
              >
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline Custom Date Range Bar */}
      {preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border-light/70 text-xs">
          <Calendar className="w-3.5 h-3.5 text-black shrink-0" aria-hidden="true" />
          <label htmlFor="kpi-custom-from" className="font-semibold text-text-secondary">
            Custom range:
          </label>
          <input
            id="kpi-custom-from"
            type="date"
            aria-label="Start Date"
            value={customRange.from}
            onChange={(e) =>
              onCustomRangeChange({ ...customRange, from: e.target.value })
            }
            className="min-h-[32px] px-2.5 py-1 rounded-lg bg-card-subtle border border-border-light text-xs font-medium text-text-primary focus-visible:outline-2 focus-visible:outline-black"
          />
          <span className="text-text-tertiary font-semibold">to</span>
          <input
            id="kpi-custom-to"
            type="date"
            aria-label="End Date"
            value={customRange.to}
            onChange={(e) =>
              onCustomRangeChange({ ...customRange, to: e.target.value })
            }
            className="min-h-[32px] px-2.5 py-1 rounded-lg bg-card-subtle border border-border-light text-xs font-medium text-text-primary focus-visible:outline-2 focus-visible:outline-black"
          />
        </div>
      )}
    </div>
  );
}

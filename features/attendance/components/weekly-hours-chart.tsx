"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface DayBarData {
  dayLabel: string; // "Mon", "Tue", etc.
  dateStr: string;  // "2026-11-16"
  workedMinutes: number;
  isToday?: boolean;
}

interface WeeklyHoursChartProps {
  days: DayBarData[];
  targetHours?: number;
  className?: string;
}

export function WeeklyHoursChart({
  days,
  targetHours = 8,
  className,
}: WeeklyHoursChartProps) {
  const targetMinutes = targetHours * 60;
  const maxDisplayMinutes = Math.max(targetMinutes * 1.25, ...days.map((d) => d.workedMinutes || 0), 600);

  const hasAnyData = days.some((d) => (d.workedMinutes || 0) > 0);

  if (!hasAnyData) {
    return (
      <div className="py-8 px-4 text-center rounded-2xl bg-card-subtle/50 border border-dashed border-border-light text-xs text-text-tertiary">
        No attendance sessions logged this week yet.
      </div>
    );
  }

  // Calculate target line percentage from bottom
  const targetLinePercent = Math.round((targetMinutes / maxDisplayMinutes) * 100);

  return (
    <div className={cn("space-y-3 pt-1", className)}>
      <div className="flex items-center justify-between text-[11px] text-text-tertiary font-bold">
        <span>Hours Worked / Day</span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-2 h-0.5 bg-brand-purple/60 border-t border-dashed border-brand-purple" />
          Target: {targetHours}h / day
        </span>
      </div>

      <div className="relative h-40 w-full pt-4 pb-6 flex items-end justify-between gap-3 px-2">
        {/* Target Dashed Guideline */}
        <div
          className="absolute left-0 right-0 border-b border-dashed border-brand-purple/40 pointer-events-none flex items-center justify-end pr-1"
          style={{ bottom: `calc(${targetLinePercent}% + 24px)` }}
        >
          <span className="text-[10px] font-mono font-bold text-brand-purple bg-card px-1 rounded shadow-xs">
            {targetHours}h
          </span>
        </div>

        {/* Day Bars */}
        {days.map((d) => {
          const hours = (d.workedMinutes / 60).toFixed(1);
          const heightPercent = Math.min(
            100,
            Math.max(d.workedMinutes > 0 ? 8 : 2, Math.round((d.workedMinutes / maxDisplayMinutes) * 100))
          );
          const isTargetMet = d.workedMinutes >= targetMinutes;

          return (
            <div key={d.dateStr} className="flex-1 flex flex-col items-center h-full justify-end group relative">
              {/* Tooltip on Hover */}
              <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity bg-brand-navy text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-lg pointer-events-none whitespace-nowrap z-20">
                {d.dayLabel}: {hours} hrs {isTargetMet ? "✓ Met" : ""}
              </div>

              {/* Bar */}
              <div className="w-full max-w-[36px] bg-card-subtle/80 rounded-t-xl h-full flex items-end p-0.5 overflow-hidden">
                <div
                  className={cn(
                    "w-full rounded-t-lg transition-all duration-500 ease-out",
                    d.workedMinutes === 0
                      ? "bg-transparent"
                      : isTargetMet
                      ? "bg-emerald-500 hover:bg-emerald-600"
                      : d.isToday
                      ? "bg-brand-purple hover:bg-brand-purple-hover"
                      : "bg-brand-purple/75 hover:bg-brand-purple"
                  )}
                  style={{ height: `${heightPercent}%` }}
                />
              </div>

              {/* Day Label */}
              <div className="mt-2 text-center">
                <span
                  className={cn(
                    "text-[11px] font-bold block",
                    d.isToday ? "text-brand-purple font-black" : "text-text-secondary"
                  )}
                >
                  {d.dayLabel}
                </span>
                <span className="text-[9px] font-mono text-text-tertiary tabular-nums block">
                  {d.workedMinutes > 0 ? `${hours}h` : "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

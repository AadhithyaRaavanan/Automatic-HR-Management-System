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
      <div className="py-8 px-4 text-center rounded-[14px] bg-[#F5F5F5] border border-dashed border-[#E6E6E6] text-xs text-[#808080]">
        No attendance sessions logged this week yet.
      </div>
    );
  }

  // Calculate target line percentage from bottom
  const targetLinePercent = Math.round((targetMinutes / maxDisplayMinutes) * 100);

  return (
    <div className={cn("space-y-3 pt-1 select-none", className)}>
      <div className="flex items-center justify-between text-xs text-[#808080]">
        <span className="font-medium text-black">Hours worked / day</span>
        <span className="flex items-center gap-1.5 font-normal">
          <span className="w-2.5 h-0.5 border-t border-dashed border-[#B3B3B3]" />
          Target: {targetHours}h / day
        </span>
      </div>

      <div className="relative h-40 w-full pt-4 pb-6 flex items-end justify-between gap-3 px-2">
        {/* Target Dashed Guideline */}
        <div
          className="absolute left-0 right-0 border-b border-dashed border-[#B3B3B3] pointer-events-none flex items-center justify-end pr-1 z-0"
          style={{ bottom: `calc(${targetLinePercent}% + 24px)` }}
        >
          <span className="text-[10px] font-sans font-medium text-[#4D4D4D] bg-white px-1 rounded border border-[#E6E6E6]">
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
            <div key={d.dateStr} className="flex-1 flex flex-col items-center h-full justify-end group relative z-10">
              {/* Tooltip on Hover */}
              <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-[10px] font-medium px-2 py-0.5 rounded shadow pointer-events-none whitespace-nowrap z-20">
                {d.dayLabel}: {hours} hrs {isTargetMet ? "✓ Met" : ""}
              </div>

              {/* Bar track and fill */}
              <div className="w-full max-w-[36px] bg-[#E6E6E6] rounded-t-lg h-full flex items-end p-0.5 overflow-hidden">
                <div
                  className={cn(
                    "w-full rounded-t-md transition-all duration-300 ease-out",
                    d.workedMinutes === 0
                      ? "bg-transparent"
                      : "bg-[#A6F000] hover:brightness-95"
                  )}
                  style={{ height: `${heightPercent}%` }}
                />
              </div>

              {/* Day Label */}
              <div className="mt-2 text-center">
                <span
                  className={cn(
                    "text-xs block font-medium",
                    d.isToday ? "text-black font-bold" : "text-[#808080]"
                  )}
                >
                  {d.dayLabel}
                </span>
                <span className="text-[10px] tabular-nums text-[#808080] block">
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

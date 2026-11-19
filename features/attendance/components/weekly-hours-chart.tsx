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
  const targetMinutes = targetHours * 60; // 480
  const maxWorked = Math.max(...days.map((d) => d.workedMinutes || 0), 0);
  // Scale display ceiling so target (8h) sits nicely around 75%-80% of max height, or expands if someone worked > 8h
  const maxDisplayMinutes = Math.max(targetMinutes * 1.25, maxWorked * 1.1, 600);

  const hasAnyData = days.some((d) => (d.workedMinutes || 0) > 0);

  if (!hasAnyData) {
    return (
      <div className="py-8 px-4 text-center rounded-[14px] bg-[#F5F5F5] border border-dashed border-[#E6E6E6] text-xs text-[#808080]">
        No attendance sessions logged this week yet.
      </div>
    );
  }

  // Exact target line percentage from bottom of the plot area
  const targetLinePercent = Math.min(100, Math.round((targetMinutes / maxDisplayMinutes) * 100));

  return (
    <div className={cn("space-y-3 pt-1 select-none", className)}>
      {/* Header: Title and Legend */}
      <div className="flex items-center justify-between text-xs text-[#808080]">
        <span className="font-medium text-black">Hours worked / day</span>
        <span className="flex items-center gap-1.5 font-normal">
          <span className="w-2.5 h-0.5 border-t border-dashed border-[#B3B3B3]" />
          Target: {targetHours}h / day
        </span>
      </div>

      {/* Plot Area: Shared coordinate container for target guideline and bar tracks */}
      <div className="relative h-36 w-full mt-2">
        {/* Target Dashed Guideline: exactly at targetLinePercent from bottom */}
        <div
          className="absolute left-0 right-0 border-b border-dashed border-[#B3B3B3] pointer-events-none flex items-center justify-end z-0"
          style={{ bottom: `${targetLinePercent}%` }}
        >
          <span className="text-[10px] font-sans font-medium text-[#4D4D4D] bg-white px-1.5 py-0.5 -translate-y-1/2 rounded border border-[#E6E6E6] shadow-2xs">
            {targetHours}h
          </span>
        </div>

        {/* Bars Container: spans h-full of the plot area */}
        <div className="relative z-10 h-full flex items-end justify-between gap-3 px-3">
          {days.map((d) => {
            const hours = (d.workedMinutes / 60).toFixed(1);
            // Height calculation strictly matches the plot coordinate space
            const heightPercent = Math.min(
              100,
              Math.max(d.workedMinutes > 0 ? 6 : 0, Math.round((d.workedMinutes / maxDisplayMinutes) * 100))
            );
            const isTargetMet = d.workedMinutes >= targetMinutes;

            return (
              <div
                key={d.dateStr}
                className="flex-1 flex flex-col items-center h-full justify-end group relative"
              >
                {d.workedMinutes > 0 ? (
                  /* Solid freestanding pill bar with NO empty grey track */
                  <div
                    className="w-7 sm:w-8 md:w-9 max-w-[38px] bg-[#A6F000] rounded-full transition-all duration-300 ease-out hover:brightness-95 relative cursor-pointer"
                    style={{ height: `${heightPercent}%` }}
                  >
                    {/* Tooltip pinned directly above the top of this bar */}
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-[10px] font-semibold px-2 py-0.5 rounded shadow-md pointer-events-none whitespace-nowrap z-30 flex items-center gap-1">
                      <span>{d.dayLabel}: {hours}h</span>
                      {isTargetMet && <span className="text-[#A6F000] text-[10px] font-bold">✓</span>}
                      {/* Downward triangle arrow */}
                      <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-[4px] border-t-black" />
                    </div>
                  </div>
                ) : (
                  /* Zero hours logged: tiny subtle baseline marker, no tall grey field */
                  <div className="w-7 sm:w-8 md:w-9 max-w-[38px] h-1.5 bg-[#E6E6E6] rounded-full relative cursor-pointer">
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-[10px] font-semibold px-2 py-0.5 rounded shadow-md pointer-events-none whitespace-nowrap z-30 flex items-center gap-1">
                      <span>{d.dayLabel}: 0.0h</span>
                      <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-[4px] border-t-black" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* X-Axis Day & Hours Labels: Separate row below the plot area */}
      <div className="flex items-center justify-between gap-3 px-3 pt-2.5 border-t border-[#E6E6E6]">
        {days.map((d) => {
          const hours = (d.workedMinutes / 60).toFixed(1);
          return (
            <div key={d.dateStr} className="flex-1 text-center">
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
          );
        })}
      </div>
    </div>
  );
}

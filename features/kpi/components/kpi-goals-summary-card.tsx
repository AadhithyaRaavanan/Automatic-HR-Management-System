"use client";

import * as React from "react";
import { Target, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiGoalsSummaryCardProps {
  goals: Array<{
    id: string;
    title: string;
    status: string;
  }>;
  className?: string;
}

export function KpiGoalsSummaryCard({
  goals = [],
  className,
}: KpiGoalsSummaryCardProps) {
  const total = goals.length;
  const done = goals.filter((g) => g.status === "done").length;
  const onTrack = goals.filter((g) => g.status === "on_track").length;
  const atRisk = goals.filter((g) => g.status === "at_risk").length;
  const notStarted = goals.filter((g) => g.status === "not_started").length;

  return (
    <div className={cn("p-4 rounded-[18px] bg-card border border-border-light shadow-card flex flex-col justify-between space-y-3", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-text-primary">
          <Target className="w-3.5 h-3.5 text-black" />
          <span>Active goals</span>
        </div>
        <span className="text-[11px] font-bold tabular-nums text-text-primary">
          {done} of {total} completed
        </span>
      </div>

      {/* Progress pill breakdown */}
      <div className="grid grid-cols-4 gap-1.5 text-center">
        <div
          className={cn(
            "p-1.5 rounded-lg border",
            notStarted > 0
              ? "bg-card-subtle text-text-primary border-border-light"
              : "bg-[#F5F5F5] text-[#808080] border-[#E6E6E6]"
          )}
        >
          <span className="text-[10px] text-text-tertiary block">Not started</span>
          <span className="text-xs font-bold tabular-nums">{notStarted}</span>
        </div>
        <div
          className={cn(
            "p-1.5 rounded-lg border",
            onTrack > 0
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-[#F5F5F5] text-[#808080] border-[#E6E6E6]"
          )}
        >
          <span className="text-[10px] block">On track</span>
          <span className="text-xs font-bold tabular-nums">{onTrack}</span>
        </div>
        <div
          className={cn(
            "p-1.5 rounded-lg border",
            atRisk > 0
              ? "bg-rose-50 text-rose-800 border-rose-200"
              : "bg-[#F5F5F5] text-[#808080] border-[#E6E6E6]"
          )}
        >
          <span className="text-[10px] block">At risk</span>
          <span className="text-xs font-bold tabular-nums">{atRisk}</span>
        </div>
        <div
          className={cn(
            "p-1.5 rounded-lg border",
            done > 0
              ? "bg-[#B7FF00]/20 text-black border-[#B7FF00]/50"
              : "bg-[#F5F5F5] text-[#808080] border-[#E6E6E6]"
          )}
        >
          <span className="text-[10px] block">Done</span>
          <span className="text-xs font-bold tabular-nums">{done}</span>
        </div>
      </div>

      {/* Active goal highlight */}
      {goals.length > 0 ? (
        <div className="text-[11px] text-[#4D4D4D] truncate">
          <span className="font-semibold text-black">Top deliverable: </span>
          <span>{goals[0].title}</span>
        </div>
      ) : (
        <p className="text-xs text-text-tertiary">
          No goals established for this evaluation window yet.
        </p>
      )}
    </div>
  );
}

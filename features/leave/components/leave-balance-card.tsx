"use client";

import * as React from "react";
import { LeaveBalance } from "../types";
import { Calendar, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeaveBalanceCardProps {
  balance: LeaveBalance;
}

export function LeaveBalanceCard({ balance }: LeaveBalanceCardProps) {
  const typeName = balance.leave_types?.name || "Leave";
  const typeCode = balance.leave_types?.code || "LEAVE";
  const allocated = Number(balance.allocated);
  const carriedForward = Number(balance.carried_forward);
  const adjusted = Number(balance.adjusted);
  const used = Number(balance.used);
  const total = allocated + carriedForward + adjusted;
  const remaining = Math.max(0, total - used);
  const percentUsed = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  const isCasual = typeCode === "CASUAL";
  const isSick = typeCode === "SICK";

  return (
    <div className="bg-card border border-border-light rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <span
            className={cn(
              "px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider",
              isCasual
                ? "bg-brand-purple/10 text-brand-purple"
                : isSick
                ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400"
                : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
            )}
          >
            {typeCode}
          </span>
          <h3 className="text-base font-bold text-text-primary mt-2">{typeName}</h3>
        </div>

        <div className="w-9 h-9 rounded-xl bg-card-subtle flex items-center justify-center text-text-secondary border border-border-light">
          {isCasual ? (
            <Calendar className="w-4 h-4 text-brand-purple" />
          ) : isSick ? (
            <ShieldCheck className="w-4 h-4 text-rose-500" />
          ) : (
            <Clock className="w-4 h-4 text-blue-500" />
          )}
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <div>
          <div className="text-3xl font-extrabold text-text-primary tracking-tight">
            {remaining}
            <span className="text-xs font-medium text-text-tertiary ml-1">days left</span>
          </div>
          <p className="text-xs text-text-secondary mt-0.5">
            {used} used of {total} total
          </p>
        </div>

        <div className="text-right">
          <span className="text-xs font-bold text-text-secondary">{percentUsed}%</span>
          <p className="text-[10px] text-text-tertiary">exhausted</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-3.5 w-full bg-card-subtle h-2 rounded-full overflow-hidden border border-border-light/50">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            isCasual ? "bg-brand-purple" : isSick ? "bg-rose-500" : "bg-blue-500"
          )}
          style={{ width: `${percentUsed}%` }}
        />
      </div>

      {/* Footer details */}
      <div className="mt-4 pt-3 border-t border-border-light/50 flex items-center justify-between text-[11px] text-text-tertiary">
        <span>Carried: +{carriedForward}d</span>
        <span>Adjusted: {adjusted >= 0 ? `+${adjusted}` : adjusted}d</span>
      </div>
    </div>
  );
}


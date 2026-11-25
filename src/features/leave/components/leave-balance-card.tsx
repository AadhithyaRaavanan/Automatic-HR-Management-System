"use client";

import * as React from "react";
import { LeaveBalance } from "../types";
import { Calendar, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeaveBalanceCardProps {
  balance: LeaveBalance;
  pendingDays?: number;
}

export function LeaveBalanceCard({ balance, pendingDays = 0 }: LeaveBalanceCardProps) {
  const typeName = balance.leave_types?.name || "Leave";
  const typeCode = balance.leave_types?.code || "LEAVE";
  const allocated = Number(balance.allocated);
  const carriedForward = Number(balance.carried_forward);
  const adjusted = Number(balance.adjusted);
  const used = Number(balance.used);
  const total = allocated + carriedForward + adjusted;
  const remaining = Math.max(0, total - used);
  const percentUsed = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  const isEL = typeCode === "EL" || typeCode === "PL";
  const isCL = typeCode === "CL" || typeCode === "CASUAL";
  const isSL = typeCode === "SL" || typeCode === "SICK";

  return (
    <div className="bg-card border border-border-light rounded-xl p-5 relative overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <span
            className={cn(
              "px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide",
              isEL
                ? "bg-blue-500/10 text-blue-600 border border-blue-500/30"
                : isCL
                ? "bg-purple-500/10 text-purple-600 border border-purple-500/30"
                : isSL
                ? "bg-rose-500/10 text-rose-600 border border-rose-500/30"
                : "bg-card-subtle text-text-secondary border border-border-light"
            )}
          >
            {typeCode}
          </span>
          <h3 className="text-sm font-bold text-text-primary mt-1.5">{typeName}</h3>
        </div>

        <div className="w-8 h-8 rounded-lg bg-card-subtle flex items-center justify-center text-text-secondary border border-border-light">
          {isEL ? (
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
          ) : isCL ? (
            <Calendar className="w-4 h-4 text-purple-600" />
          ) : isSL ? (
            <ShieldCheck className="w-4 h-4 text-rose-500" />
          ) : (
            <Clock className="w-4 h-4 text-text-secondary" />
          )}
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <div>
          <div className="text-2xl font-black text-text-primary tracking-tight tabular-nums">
            {remaining}
            <span className="text-xs font-normal text-text-tertiary ml-1">days remaining</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-text-secondary mt-1">
            <span>Used: <strong className="text-text-primary">{used}d</strong></span>
            <span>•</span>
            <span>Entitled: <strong className="text-text-primary">{total}d</strong></span>
            {pendingDays > 0 && (
              <>
                <span>•</span>
                <span className="text-amber-500 font-semibold">Pending: {pendingDays}d</span>
              </>
            )}
          </div>
        </div>

        <div className="text-right">
          <span className="text-xs font-bold text-text-secondary">{percentUsed}%</span>
          <p className="text-[10px] text-text-tertiary">used</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-3.5 w-full bg-card-subtle h-2 rounded-full overflow-hidden border border-border-light/50">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            isEL ? "bg-blue-600" : isCL ? "bg-purple-600" : isSL ? "bg-rose-500" : "bg-brand-navy"
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


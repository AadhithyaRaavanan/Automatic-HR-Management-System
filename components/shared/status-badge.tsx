"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, AlertCircle, HelpCircle, Clock, XCircle } from "lucide-react";

export type StatusType =
  | "on_track"
  | "at_risk"
  | "behind"
  | "no_data"
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled"
  | "approved"
  | "rejected"
  | "pending";

interface StatusBadgeProps {
  status: StatusType | string;
  label?: string;
  showIcon?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  label,
  showIcon = true,
  className,
}: StatusBadgeProps) {
  const norm = (status || "").toLowerCase().replace(/\s+/g, "_");

  let colorClass = "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
  let defaultLabel = "No Data";
  let Icon = HelpCircle;

  switch (norm) {
    case "on_track":
    case "done":
    case "approved":
    case "completed":
      colorClass = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25";
      defaultLabel = norm === "on_track" ? "On Track" : norm === "done" ? "Done" : "Approved";
      Icon = CheckCircle2;
      break;

    case "at_risk":
    case "in_progress":
    case "pending":
      colorClass = "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25";
      defaultLabel = norm === "at_risk" ? "At Risk" : norm === "in_progress" ? "In Progress" : "Pending";
      Icon = norm === "in_progress" ? Clock : AlertTriangle;
      break;

    case "behind":
    case "blocked":
    case "rejected":
    case "overdue":
      colorClass = "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/25";
      defaultLabel = norm === "behind" ? "Behind" : norm === "blocked" ? "Blocked" : "Rejected";
      Icon = AlertCircle;
      break;

    case "cancelled":
      colorClass = "bg-slate-500/10 text-slate-500 border-slate-500/20";
      defaultLabel = "Cancelled";
      Icon = XCircle;
      break;

    case "todo":
      colorClass = "bg-brand-purple/10 text-brand-purple border-brand-purple/20";
      defaultLabel = "To Do";
      Icon = Clock;
      break;

    case "no_data":
    default:
      colorClass = "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
      defaultLabel = "No Data";
      Icon = HelpCircle;
      break;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider border shrink-0 select-none",
        colorClass,
        className
      )}
    >
      {showIcon && <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />}
      <span>{label || defaultLabel}</span>
    </span>
  );
}

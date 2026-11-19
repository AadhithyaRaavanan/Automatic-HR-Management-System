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

  let dotColor = "bg-slate-400";
  let colorClass = "bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300 border-slate-200 dark:border-slate-800";
  let defaultLabel = "No data";

  switch (norm) {
    case "on_track":
    case "done":
    case "approved":
    case "completed":
      dotColor = "bg-emerald-500";
      colorClass = "bg-emerald-50/60 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60";
      defaultLabel = norm === "on_track" ? "On track" : norm === "done" ? "Done" : "Approved";
      break;

    case "at_risk":
    case "in_progress":
    case "pending":
      dotColor = "bg-amber-500";
      colorClass = "bg-amber-50/60 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60";
      defaultLabel = norm === "at_risk" ? "At risk" : norm === "in_progress" ? "In progress" : "Pending";
      break;

    case "behind":
    case "blocked":
    case "rejected":
    case "overdue":
      dotColor = "bg-rose-500";
      colorClass = "bg-rose-50/60 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/60";
      defaultLabel = norm === "behind" ? "Behind" : norm === "blocked" ? "Blocked" : "Rejected";
      break;

    case "cancelled":
      dotColor = "bg-slate-400";
      colorClass = "bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400 border-slate-200 dark:border-slate-800";
      defaultLabel = "Cancelled";
      break;

    case "todo":
      dotColor = "bg-brand-purple";
      colorClass = "bg-brand-purple-light/50 text-brand-purple border-brand-purple/20";
      defaultLabel = "To do";
      break;

    case "no_data":
    default:
      dotColor = "bg-slate-400";
      colorClass = "bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400 border-slate-200 dark:border-slate-800";
      defaultLabel = "No data";
      break;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border shrink-0 select-none",
        colorClass,
        className
      )}
    >
      {showIcon && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} aria-hidden="true" />}
      <span>{label || defaultLabel}</span>
    </span>
  );
}

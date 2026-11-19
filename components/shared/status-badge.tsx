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

  let dotColor = "bg-[#808080]";
  let colorClass = "bg-[#F5F5F5] text-[#4D4D4D] border-[#E6E6E6]";
  let defaultLabel = "No data";

  switch (norm) {
    case "on_track":
    case "done":
    case "approved":
    case "completed":
      dotColor = "bg-[#A6F000]";
      colorClass = "bg-[#A6F000]/15 text-black border-[#A6F000]/30";
      defaultLabel = norm === "on_track" ? "On track" : norm === "done" ? "Done" : "Approved";
      break;

    case "at_risk":
    case "in_progress":
    case "pending":
      dotColor = "bg-amber-400";
      colorClass = "bg-amber-500/10 text-amber-800 border-amber-500/20";
      defaultLabel = norm === "at_risk" ? "At risk" : norm === "in_progress" ? "In progress" : "Pending";
      break;

    case "behind":
    case "blocked":
    case "rejected":
    case "overdue":
      dotColor = "bg-[#F00091]";
      colorClass = "bg-[#F00091]/10 text-[#F00091] border-[#F00091]/20";
      defaultLabel = norm === "behind" ? "Behind" : norm === "blocked" ? "Blocked" : "Rejected";
      break;

    case "cancelled":
      dotColor = "bg-[#808080]";
      colorClass = "bg-[#F5F5F5] text-[#808080] border-[#E6E6E6]";
      defaultLabel = "Cancelled";
      break;

    case "todo":
      dotColor = "bg-[#808080]";
      colorClass = "bg-[#F5F5F5] text-[#4D4D4D] border-[#E6E6E6]";
      defaultLabel = "To do";
      break;

    case "no_data":
    default:
      dotColor = "bg-[#808080]";
      colorClass = "bg-[#F5F5F5] text-[#808080] border-[#E6E6E6]";
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

import * as React from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, AlertCircle, Calendar, Coffee, FileText } from "lucide-react";

export type AttendanceStatusType =
  | "present"
  | "half_day"
  | "absent"
  | "holiday"
  | "weekend"
  | "leave"
  | "pending"
  | "approved"
  | "rejected"
  | "active"
  | "on_leave"
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled"
  | "low"
  | "medium"
  | "high"
  | "urgent"
  | "open"
  | "closed";

interface StatusPillProps {
  status: AttendanceStatusType | string;
  label?: string;
  className?: string;
  showIcon?: boolean;
}

const statusConfig: Record<
  string,
  { label: string; bg: string; text: string; dot: string; icon: React.ElementType }
> = {
  present: {
    label: "Present",
    bg: "bg-[#A6F000]/15 border border-[#A6F000]/30",
    text: "text-black",
    dot: "bg-[#A6F000]",
    icon: CheckCircle2,
  },
  approved: {
    label: "Approved",
    bg: "bg-[#A6F000]/15 border border-[#A6F000]/30",
    text: "text-black",
    dot: "bg-[#A6F000]",
    icon: CheckCircle2,
  },
  active: {
    label: "Active",
    bg: "bg-[#A6F000]/15 border border-[#A6F000]/30",
    text: "text-black",
    dot: "bg-[#A6F000]",
    icon: CheckCircle2,
  },
  half_day: {
    label: "Half Day",
    bg: "bg-amber-500/10 border border-amber-500/20",
    text: "text-amber-800",
    dot: "bg-amber-400",
    icon: Clock,
  },
  pending: {
    label: "Pending",
    bg: "bg-amber-500/10 border border-amber-500/20",
    text: "text-amber-800",
    dot: "bg-amber-400",
    icon: Clock,
  },
  absent: {
    label: "Absent",
    bg: "bg-[#F00091]/10 border border-[#F00091]/20",
    text: "text-[#F00091]",
    dot: "bg-[#F00091]",
    icon: AlertCircle,
  },
  rejected: {
    label: "Rejected",
    bg: "bg-[#F00091]/10 border border-[#F00091]/20",
    text: "text-[#F00091]",
    dot: "bg-[#F00091]",
    icon: AlertCircle,
  },
  holiday: {
    label: "Holiday",
    bg: "bg-[#F5F5F5] border border-[#E6E6E6]",
    text: "text-black",
    dot: "bg-[#F00091]",
    icon: Calendar,
  },
  weekend: {
    label: "Weekend",
    bg: "bg-[#F5F5F5] border border-[#E6E6E6]",
    text: "text-[#808080]",
    dot: "bg-[#B3B3B3]",
    icon: Coffee,
  },
  leave: {
    label: "On Leave",
    bg: "bg-[#F5F5F5] border border-[#E6E6E6]",
    text: "text-[#4D4D4D]",
    dot: "bg-[#808080]",
    icon: FileText,
  },
  on_leave: {
    label: "On Leave",
    bg: "bg-[#F5F5F5] border border-[#E6E6E6]",
    text: "text-[#4D4D4D]",
    dot: "bg-[#808080]",
    icon: FileText,
  },
  todo: {
    label: "To Do",
    bg: "bg-[#F5F5F5] border border-[#E6E6E6]",
    text: "text-[#4D4D4D]",
    dot: "bg-[#808080]",
    icon: Clock,
  },
  in_progress: {
    label: "In Progress",
    bg: "bg-[#A6F000]/15 border border-[#A6F000]/30",
    text: "text-black",
    dot: "bg-[#A6F000]",
    icon: Clock,
  },
  blocked: {
    label: "Blocked",
    bg: "bg-amber-500/10 border border-amber-500/20",
    text: "text-amber-800",
    dot: "bg-amber-400",
    icon: AlertCircle,
  },
  done: {
    label: "Done",
    bg: "bg-[#A6F000]/15 border border-[#A6F000]/30",
    text: "text-black",
    dot: "bg-[#A6F000]",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    bg: "bg-[#F00091]/10 border border-[#F00091]/20",
    text: "text-[#F00091]",
    dot: "bg-[#F00091]",
    icon: AlertCircle,
  },
  low: {
    label: "Low",
    bg: "bg-[#F5F5F5] border border-[#E6E6E6]",
    text: "text-[#4D4D4D]",
    dot: "bg-[#808080]",
    icon: Clock,
  },
  medium: {
    label: "Medium",
    bg: "bg-[#F5F5F5] border border-[#E6E6E6]",
    text: "text-[#4D4D4D]",
    dot: "bg-[#808080]",
    icon: Clock,
  },
  high: {
    label: "High",
    bg: "bg-amber-500/10 border border-amber-500/20",
    text: "text-amber-800",
    dot: "bg-amber-400",
    icon: AlertCircle,
  },
  urgent: {
    label: "Urgent",
    bg: "bg-[#F00091]/10 border border-[#F00091]/20",
    text: "text-[#F00091]",
    dot: "bg-[#F00091]",
    icon: AlertCircle,
  },
  open: {
    label: "Open",
    bg: "bg-[#A6F000]/15 border border-[#A6F000]/30",
    text: "text-black",
    dot: "bg-[#A6F000]",
    icon: Clock,
  },
  closed: {
    label: "Closed",
    bg: "bg-[#F5F5F5] border border-[#E6E6E6]",
    text: "text-[#808080]",
    dot: "bg-[#808080]",
    icon: CheckCircle2,
  },
};

export function StatusPill({ status, label, className, showIcon = true }: StatusPillProps) {
  const normalizedKey = status.toLowerCase();
  const config = statusConfig[normalizedKey] || {
    label: label || status,
    bg: "bg-card-subtle",
    text: "text-text-secondary",
    dot: "bg-text-tertiary",
    icon: Clock,
  };

  const Icon = config.icon;
  const displayLabel = label || config.label;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium select-none",
        config.bg,
        config.text,
        className
      )}
    >
      {showIcon ? (
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", config.dot)} />
      ) : null}
      <span>{displayLabel}</span>
    </span>
  );
}


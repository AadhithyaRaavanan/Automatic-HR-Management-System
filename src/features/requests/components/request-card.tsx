"use client";

import * as React from "react";
import { RegularizationRequestItem } from "@/features/requests/types";
import { StatusPill } from "@/components/shared/status-pill";
import { Calendar, Clock, MessageSquare, Check, X } from "lucide-react";
import { formatTimeInTimezone } from "@/lib/date/timezone";
import { cn } from "@/lib/utils";
import { KpiBadge } from "@/features/kpi/components/kpi-badge";

interface RequestCardProps {
  request: RegularizationRequestItem;
  canReview?: boolean;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  className?: string;
}

export function RequestCard({
  request,
  canReview = false,
  onApprove,
  onReject,
  className,
}: RequestCardProps) {
  const isPending = request.status === "pending";

  return (
    <div
      className={cn(
        "p-5 rounded-xl bg-card border border-border-light flex flex-col justify-between",
        className
      )}
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1 text-xs font-semibold text-text-primary">
              <Calendar className="w-3.5 h-3.5 text-text-secondary" />
              {request.work_date}
            </span>
            {request.employee_name && (
              <span className="text-xs font-medium text-text-secondary">
                • {request.employee_name}
              </span>
            )}
            <KpiBadge employeeId={request.employee_id} />
          </div>
          <StatusPill status={request.status} />
        </div>

        <div className="flex items-center gap-3 text-xs text-text-tertiary tabular-nums my-2">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-text-tertiary" />
            {formatTimeInTimezone(request.requested_in, "UTC", "hh:mm a")} -{" "}
            {formatTimeInTimezone(request.requested_out, "UTC", "hh:mm a")}
          </span>
        </div>

        <div className="bg-card-subtle p-3 rounded-lg text-xs text-text-secondary mt-2">
          <span className="font-semibold text-text-primary block text-[11px] mb-0.5">
            Reason:
          </span>
          {request.reason}
        </div>

        {request.review_note && (
          <div className="mt-2 text-xs text-text-secondary font-medium flex items-start gap-1">
            <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Note: {request.review_note}</span>
          </div>
        )}
      </div>

      {/* Review Actions if Manager or HR */}
      {canReview && isPending && (
        <div className="mt-4 pt-3 border-t border-border-light flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onReject?.(request.id)}
            className="px-3 py-1.5 rounded-lg border border-border-light hover:bg-card-subtle text-status-danger-text text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Reject</span>
          </button>
          <button
            type="button"
            onClick={() => onApprove?.(request.id)}
            className="px-3 py-1.5 rounded-lg bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Approve</span>
          </button>
        </div>
      )}
    </div>
  );
}


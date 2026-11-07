"use client";

import * as React from "react";
import { LeaveRequest } from "../types";
import { useCancelLeave } from "../hooks/use-leave";
import { format } from "date-fns";
import { Calendar, CheckCircle, Clock, XCircle, Ban, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

interface LeaveHistoryTableProps {
  requests: LeaveRequest[];
  isLoading: boolean;
}

export function LeaveHistoryTable({ requests, isLoading }: LeaveHistoryTableProps) {
  const cancelMutation = useCancelLeave();
  const [cancelTarget, setCancelTarget] = React.useState<LeaveRequest | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    await cancelMutation.mutateAsync({
      requestId: cancelTarget.id,
      reason: cancelReason.trim() || undefined,
    });
    setCancelTarget(null);
    setCancelReason("");
  };

  if (isLoading) {
    return (
      <div className="bg-card border border-border-light rounded-2xl p-8 text-center text-text-tertiary">
        <Clock className="w-6 h-6 mx-auto mb-2 animate-spin text-brand-purple" />
        <p className="text-sm">Loading leave history...</p>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="bg-card border border-border-light rounded-2xl p-8 text-center text-text-tertiary">
        <Calendar className="w-8 h-8 mx-auto mb-2 text-text-tertiary" />
        <h4 className="text-base font-bold text-text-primary">No leave applications yet</h4>
        <p className="text-xs text-text-secondary mt-1">
          When you apply for leave or holidays, your requests and approval status will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-card border border-border-light rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border-light/60 bg-card-subtle text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
                <th className="py-3 px-4">Leave Type</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Days</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Submitted</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light/40">
              {requests.map((r) => {
                const isPending = r.status === "pending";
                const isApproved = r.status === "approved";
                const isRejected = r.status === "rejected";
                const isCancelled = r.status === "cancelled";
                const canCancel = isPending || isApproved;

                return (
                  <tr key={r.id} className="hover:bg-card-subtle/50 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-text-primary">
                      {r.leave_types?.name || "Leave"}
                      <span className="block text-[10px] text-text-tertiary font-normal uppercase">
                        {r.day_part.replace("_", " ")}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-text-secondary font-medium">
                      {r.start_date === r.end_date
                        ? r.start_date
                        : `${r.start_date} to ${r.end_date}`}
                    </td>

                    <td className="py-3.5 px-4 font-bold text-text-primary">
                      {Number(r.total_days)}d
                    </td>

                    <td className="py-3.5 px-4 text-text-secondary max-w-xs truncate" title={r.reason}>
                      {r.reason}
                      {r.review_note && (
                        <span className="block text-[10px] text-text-tertiary italic">
                          Note: {r.review_note}
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                          isPending && "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800",
                          isApproved && "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800",
                          isRejected && "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800",
                          isCancelled && "bg-slate-100 text-slate-500 dark:bg-slate-800/40 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                        )}
                      >
                        {isPending && <Clock className="w-3 h-3" />}
                        {isApproved && <CheckCircle className="w-3 h-3" />}
                        {isRejected && <XCircle className="w-3 h-3" />}
                        {isCancelled && <Ban className="w-3 h-3" />}
                        {r.status}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-text-tertiary text-[11px]">
                      {r.created_at ? format(new Date(r.created_at), "MMM d, yyyy") : "-"}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      {canCancel && (
                        <button
                          type="button"
                          onClick={() => setCancelTarget(r)}
                          className="px-2.5 py-1 text-[11px] font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer border border-rose-200 dark:border-rose-900"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      <Modal
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancel Leave Request"
        description="Are you sure you want to cancel this leave application? Restores balance if already approved."
      >
        <div className="space-y-4 pt-2">
          {cancelTarget && (
            <div className="bg-card-subtle border border-border-light rounded-xl p-3 text-xs space-y-1">
              <p>
                <strong>Dates:</strong> {cancelTarget.start_date} to {cancelTarget.end_date} ({cancelTarget.total_days} days)
              </p>
              <p>
                <strong>Status:</strong> {cancelTarget.status}
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-text-secondary mb-1">
              Reason for cancellation (optional)
            </label>
            <textarea
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Schedule changed, work urgent"
              className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCancelTarget(null)}
              disabled={cancelMutation.isPending}
            >
              Keep Request
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmCancel}
              isLoading={cancelMutation.isPending}
            >
              Confirm Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}


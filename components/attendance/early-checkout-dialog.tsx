"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { AlertCircle } from "lucide-react";

interface EarlyCheckOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftEndTime: string;
  formattedEarly: string;
  isPending?: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}

export function EarlyCheckOutDialog({
  open,
  onOpenChange,
  shiftEndTime,
  formattedEarly,
  isPending = false,
  onConfirm,
  onCancel,
}: EarlyCheckOutDialogProps) {
  const [reason, setReason] = React.useState("");

  const handleConfirm = () => {
    onConfirm(reason);
    setReason("");
  };

  const handleCancel = () => {
    onCancel();
    setReason("");
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(val: boolean) => {
        if (!val) handleCancel();
      }}
      title="Early Check-Out Confirmation"
      description={`Your shift ends at ${shiftEndTime}. You are checking out ${formattedEarly} early. Check out anyway?`}
      className="max-w-[460px]"
    >
      <div className="space-y-4 pt-2">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="text-xs font-medium leading-relaxed">
            Your shift ends at {shiftEndTime}. You are checking out {formattedEarly} early. Check out anyway?
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="early-checkout-reason"
            className="text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            Reason for early check-out (optional)
          </label>
          <textarea
            id="early-checkout-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Doctor appointment, urgent personal errand..."
            className="w-full text-xs p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500/30 text-slate-900 dark:text-white"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isPending}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-colors cursor-pointer"
          >
            {isPending ? "Checking out..." : "Yes, check out"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

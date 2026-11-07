"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useLeaveTypes, useLeaveBalances, useLeavePolicies, useRequestLeave } from "../hooks/use-leave";
import { format, parseISO, isWeekend } from "date-fns";
import { AlertCircle, Calendar, Check, Info } from "lucide-react";

interface ApplyLeaveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApplyLeaveModal({ open, onOpenChange }: ApplyLeaveModalProps) {
  const { data: leaveTypes = [] } = useLeaveTypes();
  const { data: balances = [] } = useLeaveBalances();
  const { data: policies = [] } = useLeavePolicies();
  const requestLeaveMutation = useRequestLeave();

  const [leaveTypeId, setLeaveTypeId] = React.useState<string>("");
  const [startDate, setStartDate] = React.useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = React.useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [dayPart, setDayPart] = React.useState<"full" | "first_half" | "second_half">("full");
  const [reason, setReason] = React.useState<string>("");

  // Select first leave type by default
  React.useEffect(() => {
    if (leaveTypes.length > 0 && !leaveTypeId) {
      setLeaveTypeId(leaveTypes[0].id);
    }
  }, [leaveTypes, leaveTypeId]);

  // Selected balance & policy
  const selectedBalance = balances.find((b) => b.leave_type_id === leaveTypeId);
  const selectedPolicy = policies.find((p) => p.leave_type_id === leaveTypeId);

  const availableDays = selectedBalance
    ? Number(selectedBalance.allocated) +
      Number(selectedBalance.carried_forward) +
      Number(selectedBalance.adjusted) -
      Number(selectedBalance.used)
    : 0;

  // Calculate estimated working days (basic client side approximation)
  const estimatedDays = React.useMemo(() => {
    if (!startDate || !endDate) return 0;
    if (startDate > endDate) return 0;
    if (dayPart !== "full") return 0.5;

    let count = 0;
    let curr = new Date(startDate);
    const end = new Date(endDate);

    while (curr <= end) {
      if (!isWeekend(curr)) {
        count += 1;
      }
      curr.setDate(curr.getDate() + 1);
    }
    return count;
  }, [startDate, endDate, dayPart]);

  // Live validation checks
  const isDateInvalid = startDate > endDate;
  const isHalfDayMismatch = dayPart !== "full" && startDate !== endDate;
  const isExceedingBalance = selectedBalance && estimatedDays > availableDays;
  const isExceedingMonthlyCap =
    selectedPolicy?.monthly_cap && estimatedDays > Number(selectedPolicy.monthly_cap);

  const canSubmit =
    leaveTypeId &&
    startDate &&
    endDate &&
    reason.trim().length >= 3 &&
    estimatedDays > 0 &&
    !isDateInvalid &&
    !isHalfDayMismatch &&
    !isExceedingBalance &&
    !requestLeaveMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    await requestLeaveMutation.mutateAsync({
      leaveTypeId,
      startDate,
      endDate,
      dayPart,
      reason: reason.trim(),
    });

    onOpenChange(false);
    setReason("");
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Apply for Leave"
      description="Submit a planned or emergency absence request for approval."
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {/* Leave Type Select */}
        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1">
            Leave Type
          </label>
          <select
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
          >
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.code})
              </option>
            ))}
          </select>
          {selectedBalance && (
            <p className="text-[11px] text-text-tertiary mt-1 flex items-center justify-between">
              <span>Available balance: <strong className="text-text-primary">{availableDays} days</strong></span>
              {selectedPolicy?.monthly_cap && (
                <span>Monthly cap: <strong className="text-text-primary">{selectedPolicy.monthly_cap}d/mo</strong></span>
              )}
            </p>
          )}
        </div>

        {/* Day Part Selector */}
        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1">
            Day Duration
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "full", label: "Full Day" },
              { id: "first_half", label: "First Half" },
              { id: "second_half", label: "Second Half" },
            ].map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setDayPart(d.id as any);
                  if (d.id !== "full") {
                    setEndDate(startDate);
                  }
                }}
                className={`py-2 px-2 text-xs font-bold rounded-xl border text-center transition-all ${
                  dayPart === d.id
                    ? "bg-brand-purple text-white border-brand-purple shadow-sm"
                    : "bg-card-subtle text-text-secondary border-border-light hover:bg-card"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date Range Inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-text-secondary mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (dayPart !== "full") {
                  setEndDate(e.target.value);
                }
              }}
              className="w-full px-3 py-2 text-sm bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-text-secondary mb-1">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              disabled={dayPart !== "full"}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple disabled:opacity-50"
            />
          </div>
        </div>

        {/* Working Days Estimate Badge */}
        <div className="flex items-center justify-between px-3 py-2 bg-card-subtle border border-border-light rounded-xl text-xs">
          <span className="text-text-secondary flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-brand-purple" />
            Working Days (excl. weekends):
          </span>
          <span className="font-extrabold text-brand-purple text-sm">
            {estimatedDays} day{estimatedDays === 1 ? "" : "s"}
          </span>
        </div>

        {/* Validation Errors */}
        {isDateInvalid && (
          <div className="flex items-center gap-1.5 text-xs text-rose-500 font-medium">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Start date cannot be after end date.
          </div>
        )}
        {isHalfDayMismatch && (
          <div className="flex items-center gap-1.5 text-xs text-rose-500 font-medium">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Half day leave must have identical start and end dates.
          </div>
        )}
        {isExceedingBalance && (
          <div className="flex items-center gap-1.5 text-xs text-rose-500 font-medium">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Requested {estimatedDays} days exceeds your available balance of {availableDays} days.
          </div>
        )}
        {isExceedingMonthlyCap && (
          <div className="flex items-center gap-1.5 text-xs text-rose-500 font-medium">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Requested days exceeds policy monthly cap of {selectedPolicy?.monthly_cap} days.
          </div>
        )}

        {/* Reason */}
        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1">
            Reason for Absence
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Briefly state reason for leave (medical, personal, family event, etc.)"
            className="w-full px-3 py-2 text-sm bg-card border border-border-light rounded-xl text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-purple resize-none"
          />
        </div>

        {/* Footer Actions */}
        <div className="pt-2 flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={requestLeaveMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit}
            isLoading={requestLeaveMutation.isPending}
          >
            Submit Leave Request
          </Button>
        </div>
      </form>
    </Modal>
  );
}


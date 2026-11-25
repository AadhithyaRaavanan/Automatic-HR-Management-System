"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useLeaveTypes, useLeaveBalances, useLeavePolicies, useRequestLeave } from "../hooks/use-leave";
import { format, parseISO } from "date-fns";
import { AlertCircle, Calendar, Check, Info } from "lucide-react";
import { countWorkingDaysBetween } from "@/lib/date/working-days";
import { createClient } from "@/lib/supabase/client";

interface ApplyLeaveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApplyLeaveModal({ open, onOpenChange }: ApplyLeaveModalProps) {
  const supabase = React.useMemo(() => createClient(), []);
  const { data: leaveTypes = [] } = useLeaveTypes();
  const { data: balances = [] } = useLeaveBalances();
  const { data: policies = [] } = useLeavePolicies();
  const requestLeaveMutation = useRequestLeave();

  const [leaveTypeId, setLeaveTypeId] = React.useState<string>("");
  const [startDate, setStartDate] = React.useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = React.useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [dayPart, setDayPart] = React.useState<"full" | "first_half" | "second_half">("full");
  const [reason, setReason] = React.useState<string>("");
  const [holidays, setHolidays] = React.useState<Array<{ date: string; name: string }>>([]);

  React.useEffect(() => {
    async function loadHolidays() {
      const { data } = await supabase
        .from("holidays")
        .select("date, name")
        .eq("is_active", true);
      if (data) setHolidays(data);
    }
    loadHolidays();
  }, [supabase]);

  // Select first leave type by default (prefer EL, CL, SL)
  React.useEffect(() => {
    if (leaveTypes.length > 0 && !leaveTypeId) {
      const preferred = leaveTypes.find((t) => ["EL", "CL", "SL"].includes(t.code)) || leaveTypes[0];
      setLeaveTypeId(preferred.id);
    }
  }, [leaveTypes, leaveTypeId]);

  // Selected balance & policy
  const selectedType = leaveTypes.find((t) => t.id === leaveTypeId);
  const selectedBalance = balances.find((b) => b.leave_type_id === leaveTypeId);
  const selectedPolicy = policies.find((p) => p.leave_type_id === leaveTypeId);

  const availableDays = selectedBalance
    ? Number(selectedBalance.allocated) +
      Number(selectedBalance.carried_forward) +
      Number(selectedBalance.adjusted) -
      Number(selectedBalance.used)
    : 0;

  // Calculate working days according to ZEN XEA calendar:
  // Mon-Fri are working days; Saturday (6) and Sunday (0) are weekly off; company holidays are excluded.
  const estimatedDays = React.useMemo(() => {
    if (!startDate || !endDate) return 0;
    if (startDate > endDate) return 0;
    return countWorkingDaysBetween(startDate, endDate, holidays, dayPart);
  }, [startDate, endDate, holidays, dayPart]);

  // Notice Period Guideline evaluation
  const noticeEvaluation = React.useMemo(() => {
    if (!startDate) return { meetsNotice: true, guidelineText: "" };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [sy, sm, sd] = startDate.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    const diffDays = Math.ceil((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    const code = selectedType?.code;
    if (code === "EL") {
      const meets = diffDays >= 14;
      return {
        meetsNotice: meets,
        guidelineText: "Notice guideline: 14 calendar days advance notice for planned EL.",
        warning: !meets ? "Application is within 14 days notice window (flagged for HR review)." : null,
      };
    }
    if (code === "CL") {
      const meets = diffDays >= 1;
      return {
        meetsNotice: meets,
        guidelineText: "Notice guideline: At least 1 day advance notice (emergency CL permitted immediately).",
        warning: !meets ? "Same-day or retroactive CL application (flagged for HR review)." : null,
      };
    }
    if (code === "SL") {
      return {
        meetsNotice: true,
        guidelineText: "Notice guideline: Notify HR as soon as possible for unexpected illness.",
        warning: null,
      };
    }
    return { meetsNotice: true, guidelineText: "" };
  }, [startDate, selectedType]);

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
            Working Days (excl. Sundays & Holidays):
          </span>
          <span className="font-extrabold text-brand-purple text-sm">
            {estimatedDays} day{estimatedDays === 1 ? "" : "s"}
          </span>
        </div>

        {/* Notice Guideline Banner */}
        {noticeEvaluation.guidelineText && (
          <div className="p-2.5 rounded-xl bg-card border border-border-light text-[11px] space-y-1">
            <p className="text-text-tertiary flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-brand-purple" />
              <span>{noticeEvaluation.guidelineText}</span>
            </p>
            {noticeEvaluation.warning && (
              <p className="text-amber-500 font-semibold flex items-center gap-1 pl-5">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>{noticeEvaluation.warning}</span>
              </p>
            )}
          </div>
        )}

        {/* Half-day overlap policy documentation */}
        <p className="text-[11px] text-text-tertiary leading-relaxed px-1">
          Overlap rule: First-half and second-half requests on the same date are permitted as separate half-day slots, whereas duplicate half-days or overlapping full-day requests on the same date are rejected.
        </p>

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


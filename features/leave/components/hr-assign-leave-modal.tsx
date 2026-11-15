"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useLeaveTypes, useHRAssignLeave } from "../hooks/use-leave";
import { createClient } from "@/lib/supabase/client";
import { format } from "date-fns";
import { AlertCircle, UserPlus, Users } from "lucide-react";
import { getStoredUsers } from "@/lib/storage/demo-store";

interface HRAssignLeaveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HRAssignLeaveModal({ open, onOpenChange }: HRAssignLeaveModalProps) {
  const supabase = createClient();
  const { data: leaveTypes = [] } = useLeaveTypes();
  const assignMutation = useHRAssignLeave();

  const [employees, setEmployees] = React.useState<Array<{ id: string; full_name: string; email: string }>>([]);
  const [selectedEmpIds, setSelectedEmpIds] = React.useState<string[]>([]);
  const [leaveTypeId, setLeaveTypeId] = React.useState<string>("");
  const [startDate, setStartDate] = React.useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = React.useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [dayPart, setDayPart] = React.useState<"full" | "first_half" | "second_half">("full");
  const [reason, setReason] = React.useState<string>("");
  const [overrideBalance, setOverrideBalance] = React.useState<boolean>(false);

  // Load active employees
  React.useEffect(() => {
    async function loadEmps() {
      const stored: Array<{ id: string; full_name: string; email: string }> = getStoredUsers().map((u) => ({ id: u.id, full_name: u.name, email: u.email }));
      try {
        const { data } = await supabase
          .from("employees")
          .select("id, full_name, email")
          .eq("status", "active")
          .order("full_name");
        if (data && (data as any[]).length > 0) {
          for (const d of (data as any[])) {
            if (!stored.some((s) => s.id === d.id)) {
              stored.push({ id: d.id, full_name: d.full_name, email: d.email });
            }
          }
        }
      } catch {}
      setEmployees(stored);
    }
    if (open) {
      loadEmps();
    }
  }, [open, supabase]);

  // Set default leave type
  React.useEffect(() => {
    if (leaveTypes.length > 0 && !leaveTypeId) {
      setLeaveTypeId(leaveTypes[0].id);
    }
  }, [leaveTypes, leaveTypeId]);

  const toggleEmp = (id: string) => {
    setSelectedEmpIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedEmpIds.length === employees.length) {
      setSelectedEmpIds([]);
    } else {
      setSelectedEmpIds(employees.map((e) => e.id));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEmpIds.length === 0 || !leaveTypeId || !startDate || !endDate) return;

    await assignMutation.mutateAsync({
      employeeIds: selectedEmpIds,
      leaveTypeId,
      startDate,
      endDate,
      dayPart,
      reason: reason.trim() || "HR Administrative Assignment",
      overrideBalance,
    });

    onOpenChange(false);
    setSelectedEmpIds([]);
    setReason("");
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Assign Leave (HR Admin)"
      description="Directly assign approved leave across multiple employees with optional balance override."
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {/* Employee multi-select */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-text-secondary flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-brand-purple" />
              Target Employees ({selectedEmpIds.length} selected)
            </label>
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-[11px] font-bold text-brand-purple hover:underline cursor-pointer"
            >
              {selectedEmpIds.length === employees.length ? "Deselect All" : "Select All"}
            </button>
          </div>

          <div className="max-h-36 overflow-y-auto border border-border-light rounded-xl p-2 bg-card-subtle divide-y divide-border-light/40">
            {employees.map((emp) => {
              const isChecked = selectedEmpIds.includes(emp.id);
              return (
                <label
                  key={emp.id}
                  className="flex items-center gap-2.5 py-1.5 px-2 hover:bg-card rounded-lg cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleEmp(emp.id)}
                    className="rounded text-brand-purple focus:ring-brand-purple"
                  />
                  <span className="font-bold text-text-primary">{emp.full_name}</span>
                  <span className="text-[11px] text-text-tertiary">({emp.email})</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Leave Type */}
        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1">
            Leave Type
          </label>
          <select
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
          >
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.code})
              </option>
            ))}
          </select>
        </div>

        {/* Date Range */}
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
                if (dayPart !== "full") setEndDate(e.target.value);
              }}
              className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
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
              className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple disabled:opacity-50"
            />
          </div>
        </div>

        {/* Override Balance Toggle */}
        <label className="flex items-center gap-2 p-2.5 bg-card-subtle border border-border-light rounded-xl text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={overrideBalance}
            onChange={(e) => setOverrideBalance(e.target.checked)}
            className="rounded text-brand-purple focus:ring-brand-purple"
          />
          <div>
            <span className="font-bold text-text-primary block">Override Balance Quota</span>
            <span className="text-[11px] text-text-tertiary">Allow assigning leave even if employee balance is zero or insufficient</span>
          </div>
        </label>

        {/* Reason */}
        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1">
            Administrative Reason
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Sabbatical granted, Bereavement, System correction"
            className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div className="pt-2 flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={assignMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={selectedEmpIds.length === 0 || assignMutation.isPending}
            isLoading={assignMutation.isPending}
          >
            Assign Leave ({selectedEmpIds.length})
          </Button>
        </div>
      </form>
    </Modal>
  );
}


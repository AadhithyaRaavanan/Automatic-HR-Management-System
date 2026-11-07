"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useLeaveTypes, useHRAdjustBalance } from "../hooks/use-leave";
import { createClient } from "@/lib/supabase/client";

interface HRAdjustBalanceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedEmployeeId?: string;
}

export function HRAdjustBalanceModal({
  open,
  onOpenChange,
  preselectedEmployeeId,
}: HRAdjustBalanceModalProps) {
  const supabase = createClient();
  const { data: leaveTypes = [] } = useLeaveTypes();
  const adjustMutation = useHRAdjustBalance();

  const [employees, setEmployees] = React.useState<Array<{ id: string; full_name: string; email: string }>>([]);
  const [employeeId, setEmployeeId] = React.useState<string>(preselectedEmployeeId || "");
  const [leaveTypeId, setLeaveTypeId] = React.useState<string>("");
  const [amount, setAmount] = React.useState<string>("1.0");
  const [reason, setReason] = React.useState<string>("");

  React.useEffect(() => {
    async function loadEmps() {
      const { data } = await supabase
        .from("employees")
        .select("id, full_name, email")
        .eq("status", "active")
        .order("full_name");
      if (data) {
        const empList = data as unknown as Array<{ id: string; full_name: string; email: string }>;
        setEmployees(empList);
        if (!employeeId && empList.length > 0) {
          setEmployeeId(preselectedEmployeeId || empList[0].id);
        }
      }
    }
    if (open) {
      loadEmps();
    }
  }, [open, preselectedEmployeeId]);

  React.useEffect(() => {
    if (leaveTypes.length > 0 && !leaveTypeId) {
      setLeaveTypeId(leaveTypes[0].id);
    }
  }, [leaveTypes, leaveTypeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (!employeeId || !leaveTypeId || isNaN(numAmount) || numAmount === 0 || !reason.trim()) {
      return;
    }

    await adjustMutation.mutateAsync({
      employeeId,
      leaveTypeId,
      amount: numAmount,
      reason: reason.trim(),
    });

    onOpenChange(false);
    setReason("");
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Adjust Employee Leave Balance"
      description="Credit or deduct leave balance days with full audit logging."
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1">
            Employee
          </label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} ({e.email})
              </option>
            ))}
          </select>
        </div>

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

        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1">
            Adjustment Amount (Days)
          </label>
          <input
            type="number"
            step="0.5"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 2.0 or -1.5"
            className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
          <p className="text-[11px] text-text-tertiary mt-1">
            Use positive numbers (e.g. +2) to grant extra days, or negative (e.g. -1) to deduct days.
          </p>
        </div>

        <div>
          <label className="block text-xs font-bold text-text-secondary mb-1">
            Adjustment Reason
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Overtime comp-off earned, Manual audit correction"
            className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple"
          />
        </div>

        <div className="pt-2 flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={adjustMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!employeeId || !leaveTypeId || !reason.trim() || adjustMutation.isPending}
            isLoading={adjustMutation.isPending}
          >
            Apply Adjustment
          </Button>
        </div>
      </form>
    </Modal>
  );
}

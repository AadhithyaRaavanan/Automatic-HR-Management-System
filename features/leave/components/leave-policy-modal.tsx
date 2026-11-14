"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useLeavePolicies } from "../hooks/use-leave";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface LeavePolicyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeavePolicyModal({ open, onOpenChange }: LeavePolicyModalProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: policies = [] } = useLeavePolicies();

  const [saving, setSaving] = React.useState(false);
  const [editedPolicies, setEditedPolicies] = React.useState<
    Record<string, { yearly_quota: number; monthly_cap: number | null; carry_forward_max: number }>
  >({});
  const [editedKpiFlags, setEditedKpiFlags] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (policies.length > 0) {
      const initial: Record<string, any> = {};
      const kpiInitial: Record<string, boolean> = {};
      policies.forEach((p) => {
        initial[p.id] = {
          yearly_quota: Number(p.yearly_quota),
          monthly_cap: p.monthly_cap ? Number(p.monthly_cap) : null,
          carry_forward_max: Number(p.carry_forward_max),
        };
        if (p.leave_type_id) {
          kpiInitial[p.leave_type_id] = p.leave_types?.counts_toward_kpi ?? true;
        }
      });
      setEditedPolicies(initial);
      setEditedKpiFlags(kpiInitial);
    }
  }, [policies]);

  const handleChange = (id: string, field: string, val: any) => {
    setEditedPolicies((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: val,
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [id, values] of Object.entries(editedPolicies)) {
        const { error } = await (supabase
          .from("leave_policies") as any)
          .update({
            yearly_quota: values.yearly_quota,
            monthly_cap: values.monthly_cap || null,
            carry_forward_max: values.carry_forward_max,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (error) throw error;
      }

      for (const p of policies) {
        const originalFlag = p.leave_types?.counts_toward_kpi ?? true;
        const nextFlag = editedKpiFlags[p.leave_type_id] ?? originalFlag;
        if (nextFlag !== originalFlag) {
          const { error: rpcError } = await (supabase.rpc as any)(
            "hr_update_leave_type_kpi_setting",
            {
              p_leave_type_id: p.leave_type_id,
              p_counts_toward_kpi: nextFlag,
            }
          );
          if (rpcError) throw rpcError;
        }
      }

      queryClient.invalidateQueries({ queryKey: ["leave-policies"] });
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
      toast.success("Leave policies updated successfully");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update policies");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Organization Leave Policies"
      description="Configure yearly quota, monthly cap, and carry forward maximums per leave type."
    >
      <div className="space-y-4 pt-2">
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {policies.map((p) => {
            const current = editedPolicies[p.id] || {
              yearly_quota: Number(p.yearly_quota),
              monthly_cap: p.monthly_cap ? Number(p.monthly_cap) : null,
              carry_forward_max: Number(p.carry_forward_max),
            };

            return (
              <div
                key={p.id}
                className="p-3.5 bg-card-subtle border border-border-light rounded-xl space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold text-text-primary">
                    {p.leave_types?.name} ({p.leave_types?.code})
                  </h4>
                  <span className="text-[10px] text-text-tertiary">
                    {p.leave_types?.is_paid ? "Paid Leave" : "Unpaid Leave"}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-text-secondary mb-1">
                      Yearly Quota
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={current.yearly_quota}
                      onChange={(e) =>
                        handleChange(p.id, "yearly_quota", parseFloat(e.target.value) || 0)
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-card border border-border-light rounded-lg text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-text-secondary mb-1">
                      Monthly Cap (Optional)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      placeholder="None"
                      value={current.monthly_cap ?? ""}
                      onChange={(e) =>
                        handleChange(
                          p.id,
                          "monthly_cap",
                          e.target.value ? parseFloat(e.target.value) : null
                        )
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-card border border-border-light rounded-lg text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-text-secondary mb-1">
                      Carry Forward Max
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={current.carry_forward_max}
                      onChange={(e) =>
                        handleChange(
                          p.id,
                          "carry_forward_max",
                          parseFloat(e.target.value) || 0
                        )
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-card border border-border-light rounded-lg text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 pt-1 text-[11px] font-semibold text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editedKpiFlags[p.leave_type_id] ?? p.leave_types?.counts_toward_kpi ?? true}
                    onChange={(e) =>
                      setEditedKpiFlags((prev) => ({
                        ...prev,
                        [p.leave_type_id]: e.target.checked,
                      }))
                    }
                    className="rounded border-border-light text-brand-purple focus:ring-brand-purple"
                  />
                  <span>Count toward Leave KPI metric (unchecked excludes sick/statutory leave)</span>
                </label>
              </div>
            );
          })}
        </div>

        <div className="pt-2 flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} isLoading={saving}>
            Save Policies
          </Button>
        </div>
      </div>
    </Modal>
  );
}

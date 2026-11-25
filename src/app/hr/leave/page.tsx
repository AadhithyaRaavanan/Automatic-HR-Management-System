"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import {
  useLeaveRequests,
  useLeaveBalances,
  useLeaveTypes,
  useApproveLeave,
  useRejectLeave,
} from "@/features/leave/hooks/use-leave";
import { HRAssignLeaveModal } from "@/features/leave/components/hr-assign-leave-modal";
import { HRAdjustBalanceModal } from "@/features/leave/components/hr-adjust-balance-modal";
import { CompanyDayOffModal } from "@/features/leave/components/company-day-off-modal";
import { LeavePolicyModal } from "@/features/leave/components/leave-policy-modal";
import { createClient } from "@/lib/supabase/client";
import {
  CalendarDays,
  Check,
  X,
  FileSpreadsheet,
  Plus,
  Sliders,
  CalendarPlus,
  Scale,
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { KpiBadge } from "@/features/kpi/components/kpi-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { toast } from "sonner";

export default function HRLeavePage() {
  const supabase = createClient();
  const { data: requests = [], isLoading: reqLoading, refetch: refetchReqs } = useLeaveRequests("all");
  const { data: allBalances = [], isLoading: balLoading, refetch: refetchBals } = useLeaveBalances();
  const { data: leaveTypes = [] } = useLeaveTypes();

  const approveMutation = useApproveLeave();
  const rejectMutation = useRejectLeave();

  const [activeTab, setActiveTab] = React.useState<"queue" | "summary" | "history">("queue");
  const [searchQuery, setSearchQuery] = React.useState("");

  // Modals
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [adjustOpen, setAdjustOpen] = React.useState(false);
  const [dayOffOpen, setDayOffOpen] = React.useState(false);
  const [policyOpen, setPolicyOpen] = React.useState(false);

  // Review modal
  const [reviewTarget, setReviewTarget] = React.useState<{ id: string; action: "approve" | "reject"; empName: string } | null>(null);
  const [reviewNote, setReviewNote] = React.useState("");

  const pendingRequests = requests.filter((r) => r.status === "pending");

  // Per-employee balances map supporting EL, CL, SL
  const balancesByEmp = React.useMemo(() => {
    const map = new Map<string, { elLeft: number; elUsed: number; clLeft: number; clUsed: number; slLeft: number; slUsed: number }>();
    allBalances.forEach((b) => {
      const current = map.get(b.employee_id) || { elLeft: 0, elUsed: 0, clLeft: 0, clUsed: 0, slLeft: 0, slUsed: 0 };
      const code = b.leave_types?.code;
      const left = Math.max(0, Number(b.allocated) + Number(b.carried_forward) + Number(b.adjusted) - Number(b.used));
      const used = Number(b.used);

      if (code === "EL" || code === "PL") {
        current.elLeft = left;
        current.elUsed = used;
      } else if (code === "CL" || code === "CASUAL") {
        current.clLeft = left;
        current.clUsed = used;
      } else if (code === "SL" || code === "SICK") {
        current.slLeft = left;
        current.slUsed = used;
      }
      map.set(b.employee_id, current);
    });
    return map;
  }, [allBalances]);

  // Employee summary list & current user (for separation of duties UI state)
  const [employees, setEmployees] = React.useState<Array<{ id: string; full_name: string; email: string }>>([]);
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);
  React.useEffect(() => {
    async function loadEmps() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        setCurrentUserId(session.user.id);
      }
      const { data } = await supabase
        .from("employees")
        .select("id, full_name, email")
        .eq("status", "active")
        .order("full_name");
      if (data) setEmployees(data);
    }
    loadEmps();
  }, [supabase]);

  const filteredEmployees = React.useMemo(
    () =>
      employees.filter(
        (e) =>
          e.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.email.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [employees, searchQuery]
  );

  const isReviewNoteValid = reviewNote.trim().length >= 5;

  const handleReviewSubmit = async () => {
    if (!reviewTarget || !isReviewNoteValid) return;
    if (reviewTarget.action === "approve") {
      await approveMutation.mutateAsync({
        requestId: reviewTarget.id,
        reviewNote: reviewNote.trim(),
      });
    } else {
      await rejectMutation.mutateAsync({
        requestId: reviewTarget.id,
        reviewNote: reviewNote.trim(),
      });
    }
    setReviewTarget(null);
    setReviewNote("");
    refetchReqs();
    refetchBals();
  };

  const handleExport = () => {
    window.open("/api/leave/export", "_blank");
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1 pb-2">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
              Leave Management Hub
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary mt-1">
              Centralized approvals with live balances, administrative assignments, quotas, and sanitized exports.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="px-3 py-1.5 rounded-xl bg-card border border-border-light text-text-primary hover:bg-card-subtle text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
              title="Sanitized Excel Export"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-black" />
              <span>Export Excel</span>
            </button>

            <button
              type="button"
              onClick={() => setPolicyOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-card border border-border-light text-text-primary hover:bg-card-subtle text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-brand-purple" />
              <span>Policies</span>
            </button>

            <button
              type="button"
              onClick={() => setDayOffOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-card border border-border-light text-text-primary hover:bg-card-subtle text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <CalendarPlus className="w-3.5 h-3.5 text-blue-600" />
              <span>Day Off</span>
            </button>

            <button
              type="button"
              onClick={() => setAdjustOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-card border border-border-light text-text-primary hover:bg-card-subtle text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Scale className="w-3.5 h-3.5 text-amber-600" />
              <span>Adjust</span>
            </button>

            <button
              type="button"
              onClick={() => setAssignOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Assign Leave</span>
            </button>
          </div>
        </section>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 border-b border-border-light/60 pb-3">
          {[
            { id: "queue", label: "Approval Queue", count: pendingRequests.length },
            { id: "summary", label: "Workforce Balances & Usage" },
            { id: "history", label: "Complete History", count: requests.length },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as any)}
              className={cn(
                "px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5",
                activeTab === t.id
                  ? "bg-brand-purple text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary bg-card-subtle hover:bg-card border border-border-light"
              )}
            >
              <span>{t.label}</span>
              {t.count !== undefined && (
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded-full text-[10px] font-extrabold",
                    activeTab === t.id
                      ? "bg-white/20 text-white"
                      : "bg-card text-text-secondary border border-border-light"
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* TAB 1: Approval Queue with Balances Beside Each Request */}
        {activeTab === "queue" && (
          <div className="space-y-3">
            {pendingRequests.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="w-6 h-6 text-black" />}
                title="Approval queue is clear"
                description="There are no pending leave requests awaiting HR or administrative review."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {pendingRequests.map((req) => {
                  const isSelfRequest = Boolean(currentUserId && req.employee_id === currentUserId);
                  const empBal = balancesByEmp.get(req.employee_id) || {
                    elLeft: 0,
                    elUsed: 0,
                    clLeft: 0,
                    clUsed: 0,
                    slLeft: 0,
                    slUsed: 0,
                  };

                  return (
                    <div
                      key={req.id}
                      className="bg-card border border-border-light rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-sm text-text-primary">
                            {req.employees?.full_name || "Employee"}
                          </span>
                          <KpiBadge employeeId={req.employee_id} />
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-purple/10 text-brand-purple uppercase">
                            {req.leave_types?.name || "Leave"} ({req.day_part.replace("_", " ")})
                          </span>
                        </div>

                        <p className="text-xs text-text-secondary">
                          <strong className="text-text-primary">{req.start_date} to {req.end_date}</strong> (
                          {req.total_days} working day{req.total_days === 1 ? "" : "s"})
                        </p>

                        <p className="text-xs text-text-tertiary italic">
                          &quot;{req.reason}&quot;
                        </p>
                      </div>

                      {/* Balances Beside Request (EL, CL, SL) */}
                      <div className="flex items-center gap-3 bg-card-subtle px-3 py-2 rounded-xl border border-border-light/60 text-xs shrink-0">
                        <div>
                          <span className="block text-[10px] text-text-tertiary font-bold uppercase">
                            EL Left
                          </span>
                          <span className="font-extrabold text-blue-600 text-sm">
                            {empBal.elLeft}d
                          </span>
                        </div>
                        <div className="w-px h-6 bg-border-light" />
                        <div>
                          <span className="block text-[10px] text-text-tertiary font-bold uppercase">
                            CL Left
                          </span>
                          <span className="font-extrabold text-brand-purple text-sm">
                            {empBal.clLeft}d
                          </span>
                        </div>
                        <div className="w-px h-6 bg-border-light" />
                        <div>
                          <span className="block text-[10px] text-text-tertiary font-bold uppercase">
                            SL Left
                          </span>
                          <span className="font-extrabold text-rose-500 text-sm">
                            {empBal.slLeft}d
                          </span>
                        </div>
                      </div>

                      {/* Approval Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isSelfRequest}
                          title={isSelfRequest ? "Separation of duties: cannot approve your own leave" : "Approve leave"}
                          onClick={() =>
                            setReviewTarget({
                              id: req.id,
                              action: "approve",
                              empName: req.employees?.full_name || "Employee",
                            })
                          }
                          className="px-3 py-1.5 rounded-xl bg-lime hover:bg-lime-hover disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-bold flex items-center gap-1 shadow-sm transition-all cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </button>

                        <button
                          type="button"
                          disabled={isSelfRequest}
                          title={isSelfRequest ? "Separation of duties: cannot reject your own leave" : "Reject leave"}
                          onClick={() =>
                            setReviewTarget({
                              id: req.id,
                              action: "reject",
                              empName: req.employees?.full_name || "Employee",
                            })
                          }
                          className="px-3 py-1.5 rounded-xl bg-card border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Workforce Balances & Usage Summary */}
        {activeTab === "summary" && (
          <div className="bg-card border border-border-light rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border-light/60 flex items-center justify-between">
              <div className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-text-tertiary" />
                <input
                  type="text"
                  placeholder="Search employee..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                />
              </div>
              <span className="text-xs text-text-tertiary font-medium">
                {employees.length} Active Employees
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border-light/60 bg-card-subtle text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-4">EL (Earned)</th>
                    <th className="py-3 px-4">CL (Casual)</th>
                    <th className="py-3 px-4">SL (Sick)</th>
                    <th className="py-3 px-4 text-right">Quick Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light/40">
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4">
                        <EmptyState
                          icon={<Users className="w-6 h-6" />}
                          title="No matching employees"
                          description={
                            employees.length === 0
                              ? "No active employee leave balances found in this organization."
                              : "Try clearing or adjusting your employee search query."
                          }
                          className="border-none shadow-none"
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((emp) => {
                      const bal = balancesByEmp.get(emp.id) || {
                        elLeft: 0,
                        elUsed: 0,
                        clLeft: 0,
                        clUsed: 0,
                        slLeft: 0,
                        slUsed: 0,
                      };

                      return (
                        <tr key={emp.id} className="hover:bg-card-subtle/50 transition-colors">
                          <td className="py-3 px-4">
                            <span className="font-bold text-text-primary block">{emp.full_name}</span>
                            <span className="text-[11px] text-text-tertiary">{emp.email}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-extrabold text-blue-600 block">{bal.elLeft}d left</span>
                            <span className="text-[10px] text-text-tertiary">{bal.elUsed}d used</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-extrabold text-brand-purple block">{bal.clLeft}d left</span>
                            <span className="text-[10px] text-text-tertiary">{bal.clUsed}d used</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-extrabold text-rose-500 block">{bal.slLeft}d left</span>
                            <span className="text-[10px] text-text-tertiary">{bal.slUsed}d used</span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => setAdjustOpen(true)}
                              className="px-2.5 py-1 text-[11px] font-bold text-brand-purple hover:bg-brand-purple/10 rounded-lg transition-colors cursor-pointer border border-brand-purple/20"
                            >
                              Adjust
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: Complete History */}
        {activeTab === "history" && (
          <div className="bg-card border border-border-light rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border-light/60 bg-card-subtle text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Dates</th>
                    <th className="py-3 px-4">Days</th>
                    <th className="py-3 px-4">Reason</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light/40">
                  {requests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4">
                        <EmptyState
                          icon={<CalendarDays className="w-6 h-6" />}
                          title="No leave history recorded"
                          description="Submitted, approved, rejected, and cancelled leave records will appear here."
                          className="border-none shadow-none"
                        />
                      </td>
                    </tr>
                  ) : (
                    requests.map((r) => (
                      <tr key={r.id} className="hover:bg-card-subtle/50 transition-colors">
                        <td className="py-3 px-4 font-bold text-text-primary">
                          {r.employees?.full_name || "Employee"}
                        </td>
                        <td className="py-3 px-4 font-bold text-brand-purple">
                          {r.leave_types?.name}
                        </td>
                        <td className="py-3 px-4 text-text-secondary">
                          {r.start_date} to {r.end_date}
                        </td>
                        <td className="py-3 px-4 font-bold text-text-primary">{r.total_days}d</td>
                        <td className="py-3 px-4 text-text-secondary max-w-xs truncate">{r.reason}</td>
                        <td className="py-3 px-4">
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                              r.status === "approved" && "bg-lime/20 text-black border border-lime/40",
                              r.status === "pending" && "bg-amber-50 text-amber-600 border border-amber-200",
                              r.status === "rejected" && "bg-rose-50 text-rose-600 border border-rose-200",
                              r.status === "cancelled" && "bg-slate-100 text-slate-500 border border-slate-200"
                            )}
                          >
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Review Note Dialog */}
        <Modal
          open={!!reviewTarget}
          onOpenChange={(open) => !open && setReviewTarget(null)}
          title={`${reviewTarget?.action === "approve" ? "Approve" : "Reject"} Leave Request`}
          description={`Review leave application for ${reviewTarget?.empName}. Decision note is mandatory.`}
        >
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-bold text-text-secondary mb-1">
                Decision Note <span className="text-rose-500">*</span> (min 5 characters)
              </label>
              <textarea
                rows={3}
                required
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Provide mandatory reason or feedback for this decision (min 5 characters)..."
                className="w-full px-3 py-2 text-xs bg-card border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-purple resize-none"
              />
              <div className="flex justify-between items-center mt-1 text-[11px] text-text-tertiary">
                <span>{reviewNote.trim().length < 5 ? `At least ${5 - reviewNote.trim().length} more characters required` : "Requirement satisfied"}</span>
                <span>{reviewNote.trim().length} / 5 min</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button type="button" variant="ghost" onClick={() => setReviewTarget(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant={reviewTarget?.action === "approve" ? "default" : "destructive"}
                onClick={handleReviewSubmit}
                disabled={!isReviewNoteValid || approveMutation.isPending || rejectMutation.isPending}
                isLoading={approveMutation.isPending || rejectMutation.isPending}
              >
                Confirm {reviewTarget?.action === "approve" ? "Approval" : "Rejection"}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Action Modals */}
        <HRAssignLeaveModal open={assignOpen} onOpenChange={setAssignOpen} />
        <HRAdjustBalanceModal open={adjustOpen} onOpenChange={setAdjustOpen} />
        <CompanyDayOffModal open={dayOffOpen} onOpenChange={setDayOffOpen} />
        <LeavePolicyModal open={policyOpen} onOpenChange={setPolicyOpen} />
      </div>
    </AppShell>
  );
}


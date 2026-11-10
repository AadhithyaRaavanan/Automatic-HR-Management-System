"use client";

import * as React from "react";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { RequestCard } from "@/features/requests/components/request-card";
import { RequestModal } from "@/features/requests/components/request-modal";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/shared/empty-state";
import {
  useRegularizations,
  useSubmitRegularization,
  useApproveRegularization,
  useRejectRegularization,
} from "@/features/requests/hooks/use-regularizations";
import {
  useLeaveRequests,
  useApproveLeave,
  useRejectLeave,
} from "@/features/leave/hooks/use-leave";
import { createClient } from "@/lib/supabase/client";
import { RegularizationStatus } from "@/types/database.types";
import {
  Plus,
  Filter,
  CheckCircle2,
  RefreshCw,
  Calendar,
  Clock,
  Check,
  X,
  UserCheck,
  ShieldCheck,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface DelegationItem {
  id: string;
  delegator_id: string;
  delegate_id: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
  is_active: boolean;
  revoked_at: string | null;
  delegator_name: string;
  delegate_name: string;
}

interface ColleagueOption {
  id: string;
  full_name: string;
  email: string;
}

function RequestsPageContent() {
  const { userId, userRole } = useAppSession();
  const isManagerOrAbove = userRole === "manager" || userRole === "hr" || userRole === "admin";
  const isHrOrAdmin = userRole === "hr" || userRole === "admin";
  const supabase = React.useMemo(() => createClient(), []);

  const [inboxModule, setInboxModule] = React.useState<"regularization" | "leave" | "delegations">(
    "regularization"
  );

  // Regularizations
  const { data: requests, isLoading, refetch: refetchRegs } = useRegularizations();
  const submitMutation = useSubmitRegularization();
  const approveRegMutation = useApproveRegularization();
  const rejectRegMutation = useRejectRegularization();

  // Leaves
  const {
    data: leaveRequests = [],
    isLoading: leaveLoading,
    refetch: refetchLeaves,
  } = useLeaveRequests("all");
  const approveLeaveMutation = useApproveLeave();
  const rejectLeaveMutation = useRejectLeave();

  // Delegations state
  const [delegations, setDelegations] = React.useState<DelegationItem[]>([]);
  const [delegationsLoading, setDelegationsLoading] = React.useState(false);
  const [colleagues, setColleagues] = React.useState<ColleagueOption[]>([]);
  const [delegationModalOpen, setDelegationModalOpen] = React.useState(false);
  const [delegatorId, setDelegatorId] = React.useState("");
  const [delegateId, setDelegateId] = React.useState("");
  const todayIso = new Date().toISOString().slice(0, 10);
  const [startsOn, setStartsOn] = React.useState(todayIso);
  const [endsOn, setEndsOn] = React.useState(todayIso);
  const [delegationReason, setDelegationReason] = React.useState("");
  const [savingDelegation, setSavingDelegation] = React.useState(false);

  const [modalOpen, setModalOpen] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<"all" | RegularizationStatus>("all");

  const loadDelegations = React.useCallback(async () => {
    if (!userId) return;
    setDelegationsLoading(true);
    try {
      const [{ data: dels }, { data: emps }] = await Promise.all([
        (supabase as any)
          .from("approval_delegations")
          .select(
            "id, delegator_id, delegate_id, starts_on, ends_on, reason, is_active, revoked_at, delegator:delegator_id(full_name), delegate:delegate_id(full_name)"
          )
          .order("starts_on", { ascending: false }),
        (supabase as any)
          .from("employees")
          .select("id, full_name, email")
          .eq("status", "active")
          .order("full_name"),
      ]);

      if (dels) {
        setDelegations(
          dels.map((d: any) => ({
            id: d.id,
            delegator_id: d.delegator_id,
            delegate_id: d.delegate_id,
            starts_on: d.starts_on,
            ends_on: d.ends_on,
            reason: d.reason,
            is_active: Boolean(d.is_active),
            revoked_at: d.revoked_at,
            delegator_name: d.delegator?.full_name || d.delegator_id,
            delegate_name: d.delegate?.full_name || d.delegate_id,
          }))
        );
      }

      if (emps) {
        setColleagues(emps);
      }
    } catch {
      // ignore
    } finally {
      setDelegationsLoading(false);
    }
  }, [supabase, userId]);

  React.useEffect(() => {
    loadDelegations();
  }, [loadDelegations]);

  const filteredRequests = (requests || []).filter((req) => {
    if (statusFilter === "all") return true;
    return req.status === statusFilter;
  });

  const filteredLeaves = leaveRequests.filter((l) => {
    if (statusFilter === "all") return true;
    return l.status === statusFilter;
  });

  const pendingRegCount = (requests || []).filter((r) => r.status === "pending").length;
  const pendingLeaveCount = leaveRequests.filter((r) => r.status === "pending").length;
  const activeDelegationsCount = delegations.filter(
    (d) => d.is_active && d.starts_on <= todayIso && d.ends_on >= todayIso
  ).length;

  const handleRefresh = () => {
    refetchRegs();
    refetchLeaves();
    loadDelegations();
  };

  const openCreateDelegation = () => {
    const defaultMgr = userId || colleagues[0]?.id || "";
    const otherColleague = colleagues.find((c) => c.id !== defaultMgr)?.id || "";
    setDelegatorId(defaultMgr);
    setDelegateId(otherColleague);
    setStartsOn(todayIso);
    setEndsOn(todayIso);
    setDelegationReason("");
    setDelegationModalOpen(true);
  };

  const handleCreateDelegation = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetManager = isHrOrAdmin ? delegatorId : userId || delegatorId;
    if (!targetManager || !delegateId) {
      toast.error("Please select both delegator and delegate.");
      return;
    }
    if (targetManager === delegateId) {
      toast.error("Self-delegation is not permitted.");
      return;
    }
    setSavingDelegation(true);
    try {
      const { error } = await (supabase.rpc as any)("create_approval_delegation", {
        p_manager_id: targetManager,
        p_delegate_id: delegateId,
        p_starts_on: startsOn,
        p_ends_on: endsOn,
        p_reason: delegationReason.trim() || "Planned coverage delegation",
      });
      if (error) throw error;
      toast.success("Approval delegation activated.");
      setDelegationModalOpen(false);
      await loadDelegations();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create delegation.");
    } finally {
      setSavingDelegation(false);
    }
  };

  const handleRevokeDelegation = async (id: string) => {
    try {
      const { error } = await (supabase.rpc as any)("revoke_approval_delegation", {
        p_delegation_id: id,
      });
      if (error) throw error;
      toast.success("Approval delegation revoked.");
      await loadDelegations();
    } catch (err: any) {
      toast.error(err?.message || "Failed to revoke delegation.");
    }
  };

  const showDelegationsTab = isManagerOrAbove || delegations.length > 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
            {isManagerOrAbove ? "Manager Approvals & Delegations" : "Approvals, Requests & Delegations"}
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Review attendance regularizations, team leave requests, and temporary approval delegations.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleRefresh}
            className="p-2 rounded-full bg-card border border-border-light text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors shadow-sm cursor-pointer"
            title="Refresh requests"
            aria-label="Refresh requests"
          >
            <RefreshCw className="w-4 h-4 text-brand-purple" />
          </button>

          {inboxModule === "delegations" && isManagerOrAbove ? (
            <button
              type="button"
              onClick={openCreateDelegation}
              className="px-4 py-2 rounded-full bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Delegation</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="px-4 py-2 rounded-full bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Apply Correction</span>
            </button>
          )}
        </div>
      </section>

      {/* Module Switcher Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-card-subtle border border-border-light rounded-2xl w-fit">
        <button
          type="button"
          onClick={() => setInboxModule("regularization")}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2",
            inboxModule === "regularization"
              ? "bg-brand-purple text-white shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Regularizations</span>
          {pendingRegCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400 text-slate-900 font-extrabold">
              {pendingRegCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setInboxModule("leave")}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2",
            inboxModule === "leave"
              ? "bg-brand-purple text-white shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>Leave Approvals</span>
          {pendingLeaveCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400 text-slate-900 font-extrabold">
              {pendingLeaveCount}
            </span>
          )}
        </button>

        {showDelegationsTab && (
          <button
            type="button"
            onClick={() => setInboxModule("delegations")}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2",
              inboxModule === "delegations"
                ? "bg-brand-purple text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Approval Delegations</span>
            {activeDelegationsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-400 text-slate-900 font-extrabold">
                {activeDelegationsCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Filter Pills for Regularization & Leave */}
      {inboxModule !== "delegations" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-light/60 pb-3">
          <Filter className="w-3.5 h-3.5 text-text-tertiary mr-1" />
          {(["all", "pending", "approved", "rejected"] as const).map((tab) => {
            const isActive = statusFilter === tab;
            const count =
              inboxModule === "regularization"
                ? (requests || []).filter((r) => tab === "all" || r.status === tab).length
                : leaveRequests.filter((r) => tab === "all" || r.status === tab).length;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-bold capitalize transition-colors cursor-pointer flex items-center gap-1.5",
                  isActive
                    ? "bg-brand-purple text-white shadow-sm"
                    : "text-text-secondary hover:text-text-primary bg-card-subtle hover:bg-card border border-border-light"
                )}
              >
                <span>{tab}</span>
                <span className="text-[10px] opacity-80">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Regularization Inbox */}
      {inboxModule === "regularization" && (
        <div>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-44 rounded-2xl bg-card border border-border-light animate-pulse p-5"
                />
              ))}
            </div>
          ) : filteredRequests.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredRequests.map((req) => {
                // Separation of duties: never allow approving/rejecting one's own request
                const canReviewThis = Boolean(userId && req.employee_id !== userId);
                return (
                  <RequestCard
                    key={req.id}
                    request={req}
                    canReview={canReviewThis}
                    onApprove={(id) =>
                      approveRegMutation.mutate({
                        requestId: id,
                        reviewNote: "Approved via requests inbox",
                      })
                    }
                    onReject={(id) =>
                      rejectRegMutation.mutate({
                        requestId: id,
                        reviewNote: "Declined per policy guidelines",
                      })
                    }
                  />
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<CheckCircle2 className="w-6 h-6" />}
              title="No regularization requests found"
              description="All punch regularizations are up to date."
            />
          )}
        </div>
      )}

      {/* Leave Approvals Inbox */}
      {inboxModule === "leave" && (
        <div>
          {leaveLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-36 rounded-2xl bg-card border border-border-light animate-pulse p-5" />
              ))}
            </div>
          ) : filteredLeaves.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredLeaves.map((leave) => {
                const isPending = leave.status === "pending";
                const canReviewThis = Boolean(userId && leave.employee_id !== userId);

                return (
                  <div
                    key={leave.id}
                    className="bg-card border border-border-light rounded-2xl p-5 shadow-sm space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-extrabold text-sm text-text-primary block">
                          {leave.employees?.full_name || "Team Member"}
                        </span>
                        <span className="text-[11px] text-text-tertiary">
                          {leave.employees?.email}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase",
                          leave.status === "approved" && "bg-emerald-50 text-emerald-600 border border-emerald-200",
                          leave.status === "pending" && "bg-amber-50 text-amber-600 border border-amber-200",
                          leave.status === "rejected" && "bg-rose-50 text-rose-600 border border-rose-200",
                          leave.status === "cancelled" && "bg-slate-100 text-slate-500 border border-slate-200"
                        )}
                      >
                        {leave.status}
                      </span>
                    </div>

                    <div className="p-3 bg-card-subtle rounded-xl border border-border-light/60 space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-brand-purple">
                          {leave.leave_types?.name} ({leave.day_part.replace("_", " ")})
                        </span>
                        <span className="font-extrabold text-text-primary">
                          {leave.total_days} day{leave.total_days === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="text-text-secondary">
                        {leave.start_date} to {leave.end_date}
                      </p>
                      <p className="text-text-tertiary italic text-[11px] pt-1">
                        &ldquo;{leave.reason}&rdquo;
                      </p>
                    </div>

                    {isPending && canReviewThis && (
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            rejectLeaveMutation.mutate({
                              requestId: leave.id,
                              reviewNote: "Rejected by approver",
                            })
                          }
                          className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Decline</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            approveLeaveMutation.mutate({
                              requestId: leave.id,
                              reviewNote: "Approved by approver",
                            })
                          }
                          className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve Leave</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Calendar className="w-6 h-6" />}
              title="No leave requests found"
              description="There are no leave requests matching the selected filter."
            />
          )}
        </div>
      )}

      {/* Approval Delegations Panel */}
      {inboxModule === "delegations" && (
        <div className="space-y-4">
          <div className="p-4 rounded-3xl bg-brand-purple-light/20 border border-brand-purple/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-brand-purple shrink-0" />
              <div className="text-xs text-text-secondary">
                <strong className="text-text-primary block">
                  Time-Bounded Approval Delegations
                </strong>
                <span>
                  Delegates can review and approve regularization and leave requests for a manager&apos;s direct reports during the active date range.
                </span>
              </div>
            </div>
            {isManagerOrAbove && (
              <button
                type="button"
                onClick={openCreateDelegation}
                className="px-4 py-2 rounded-full bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold shrink-0 cursor-pointer"
              >
                + Delegate Approvals
              </button>
            )}
          </div>

          {delegationsLoading ? (
            <div className="h-36 rounded-2xl bg-card border border-border-light animate-pulse" />
          ) : delegations.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {delegations.map((del) => {
                const isExpired = del.ends_on < todayIso;
                const isActiveNow = del.is_active && del.starts_on <= todayIso && del.ends_on >= todayIso;
                const canRevoke =
                  del.is_active && (isHrOrAdmin || del.delegator_id === userId);

                return (
                  <div
                    key={del.id}
                    className="bg-card border border-border-light rounded-2xl p-5 shadow-sm flex flex-col justify-between space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs font-extrabold text-text-primary block">
                          {del.delegator_name} → {del.delegate_name}
                        </span>
                        <span className="text-[11px] font-mono text-text-tertiary">
                          {del.starts_on} to {del.ends_on}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase",
                          !del.is_active
                            ? "bg-slate-100 text-slate-600"
                            : isActiveNow
                            ? "bg-emerald-100 text-emerald-700"
                            : isExpired
                            ? "bg-amber-100 text-amber-800"
                            : "bg-brand-purple-light text-brand-purple"
                        )}
                      >
                        {!del.is_active
                          ? "Revoked"
                          : isActiveNow
                          ? "Active"
                          : isExpired
                          ? "Expired"
                          : "Scheduled"}
                      </span>
                    </div>

                    {del.reason && (
                      <p className="text-xs text-text-secondary bg-card-subtle p-3 rounded-xl border border-border-light/60">
                        {del.reason}
                      </p>
                    )}

                    {canRevoke && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleRevokeDelegation(del.id)}
                          className="px-3 py-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Revoke Delegation</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<UserCheck className="w-6 h-6" />}
              title="No approval delegations configured"
              description="Assign a colleague to cover team approvals while a manager is out of office."
              action={
                isManagerOrAbove ? (
                  <button
                    type="button"
                    onClick={openCreateDelegation}
                    className="px-4 py-2 rounded-full bg-brand-purple text-white text-xs font-bold cursor-pointer"
                  >
                    Create First Delegation
                  </button>
                ) : undefined
              }
            />
          )}
        </div>
      )}

      {/* Regularization Modal */}
      <RequestModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSubmitRequest={async (data) => {
          await submitMutation.mutateAsync(data);
        }}
      />

      {/* Create Delegation Modal */}
      <Modal
        open={delegationModalOpen}
        onOpenChange={setDelegationModalOpen}
        title="Create Approval Delegation"
        description="Empowers the selected delegate to review team requests during the active window"
      >
        <form onSubmit={handleCreateDelegation} className="space-y-4">
          {isHrOrAdmin && (
            <div>
              <label
                htmlFor="delegation-manager"
                className="block text-xs font-bold text-text-primary mb-1"
              >
                Manager / Delegator
              </label>
              <select
                id="delegation-manager"
                required
                value={delegatorId}
                onChange={(e) => setDelegatorId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
              >
                {colleagues.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} ({c.email})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label
              htmlFor="delegation-delegate"
              className="block text-xs font-bold text-text-primary mb-1"
            >
              Delegate Approver
            </label>
            <select
              id="delegation-delegate"
              required
              value={delegateId}
              onChange={(e) => setDelegateId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
            >
              {colleagues
                .filter((c) => c.id !== (isHrOrAdmin ? delegatorId : userId))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} ({c.email})
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="delegation-starts"
                className="block text-xs font-bold text-text-primary mb-1"
              >
                Starts On
              </label>
              <input
                id="delegation-starts"
                type="date"
                required
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
              />
            </div>
            <div>
              <label
                htmlFor="delegation-ends"
                className="block text-xs font-bold text-text-primary mb-1"
              >
                Ends On
              </label>
              <input
                id="delegation-ends"
                type="date"
                required
                min={startsOn}
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="delegation-reason"
              className="block text-xs font-bold text-text-primary mb-1"
            >
              Reason / Handoff Note
            </label>
            <input
              id="delegation-reason"
              type="text"
              placeholder="e.g. Annual leave handoff"
              value={delegationReason}
              onChange={(e) => setDelegationReason(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDelegationModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingDelegation}
              className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {savingDelegation ? "Saving..." : "Activate Delegation"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function RequestsPage() {
  return (
    <AppShell>
      <RequestsPageContent />
    </AppShell>
  );
}

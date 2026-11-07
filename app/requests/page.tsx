"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { RequestCard } from "@/features/requests/components/request-card";
import { RequestModal } from "@/features/requests/components/request-modal";
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
import { RegularizationStatus } from "@/types/database.types";
import { Plus, Filter, CheckCircle2, RefreshCw, Calendar, Clock, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function RequestsPage() {
  const [inboxModule, setInboxModule] = React.useState<"regularization" | "leave">("regularization");

  // Regularizations
  const { data: requests, isLoading, refetch: refetchRegs } = useRegularizations();
  const submitMutation = useSubmitRegularization();
  const approveRegMutation = useApproveRegularization();
  const rejectRegMutation = useRejectRegularization();

  // Leaves
  const { data: leaveRequests = [], isLoading: leaveLoading, refetch: refetchLeaves } = useLeaveRequests("all");
  const approveLeaveMutation = useApproveLeave();
  const rejectLeaveMutation = useRejectLeave();

  const [modalOpen, setModalOpen] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<"all" | RegularizationStatus>("all");

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

  const handleRefresh = () => {
    refetchRegs();
    refetchLeaves();
  };

  return (
    <AppShell
      primaryActionLabel={inboxModule === "regularization" ? "New Regularization" : undefined}
      onPrimaryAction={() => setModalOpen(true)}
    >
      <div className="space-y-6">
        {/* Page Header */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
              Manager Approvals & Requests
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary mt-1">
              Unified manager inbox for attendance regularizations and team leave applications.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleRefresh}
              className="p-2 rounded-full bg-card border border-border-light text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors shadow-sm cursor-pointer"
              title="Refresh requests"
            >
              <RefreshCw className="w-4 h-4 text-brand-purple" />
            </button>

            {inboxModule === "regularization" && (
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

        {/* Module Switcher Tabs (Regularization vs Leave) */}
        <div className="flex items-center gap-2 p-1.5 bg-card-subtle border border-border-light rounded-2xl w-fit">
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
            <span>Regularization Requests</span>
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
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 border-b border-border-light/60 pb-3">
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
                {filteredRequests.map((req) => (
                  <RequestCard
                    key={req.id}
                    request={req}
                    canReview={true}
                    onApprove={(id) =>
                      approveRegMutation.mutate({
                        requestId: id,
                        reviewNote: "Approved via dashboard",
                      })
                    }
                    onReject={(id) =>
                      rejectRegMutation.mutate({
                        requestId: id,
                        reviewNote: "Declined per policy guidelines",
                      })
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="py-16 text-center rounded-3xl bg-card border border-border-light shadow-sm flex flex-col items-center justify-center p-6">
                <div className="w-12 h-12 rounded-full bg-brand-purple-light flex items-center justify-center text-brand-purple mb-3">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-text-primary">
                  No regularization requests found
                </h3>
                <p className="text-xs text-text-tertiary mt-1 max-w-sm">
                  All employee punch regularizations are up to date.
                </p>
              </div>
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
                          "{leave.reason}"
                        </p>
                      </div>

                      {isPending && (
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              rejectLeaveMutation.mutate({
                                requestId: leave.id,
                                reviewNote: "Rejected by Manager",
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
                                reviewNote: "Approved by Manager",
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
              <div className="py-16 text-center rounded-3xl bg-card border border-border-light shadow-sm flex flex-col items-center justify-center p-6">
                <div className="w-12 h-12 rounded-full bg-brand-purple-light flex items-center justify-center text-brand-purple mb-3">
                  <Calendar className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-text-primary">
                  No leave requests found
                </h3>
                <p className="text-xs text-text-tertiary mt-1 max-w-sm">
                  There are no leave requests matching the selected filter.
                </p>
              </div>
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
      </div>
    </AppShell>
  );
}

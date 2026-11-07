"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LeaveBalanceCard } from "@/features/leave/components/leave-balance-card";
import { LeaveHistoryTable } from "@/features/leave/components/leave-history-table";
import { ApplyLeaveModal } from "@/features/leave/components/apply-leave-modal";
import { useLeaveBalances, useLeaveRequests } from "@/features/leave/hooks/use-leave";
import { Plus, RefreshCw, Calendar, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LeavePage() {
  const [applyModalOpen, setApplyModalOpen] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<string>("all");

  const { data: balances = [], isLoading: balancesLoading, refetch: refetchBalances } = useLeaveBalances();
  const { data: requests = [], isLoading: requestsLoading, refetch: refetchRequests } = useLeaveRequests(statusFilter);

  const handleRefresh = () => {
    refetchBalances();
    refetchRequests();
  };

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <AppShell
      primaryActionLabel="Apply for Leave"
      onPrimaryAction={() => setApplyModalOpen(true)}
    >
      <div className="space-y-6">
        {/* Header */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-2">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
              Leave & Time Off
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary mt-1">
              Check leave quotas, submit absence requests with live validation, and track status.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleRefresh}
              className="p-2 rounded-full bg-card border border-border-light text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors shadow-sm cursor-pointer"
              title="Refresh balances"
            >
              <RefreshCw className="w-4 h-4 text-brand-purple" />
            </button>

            <button
              type="button"
              onClick={() => setApplyModalOpen(true)}
              className="px-4 py-2 rounded-full bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Apply for Leave</span>
            </button>
          </div>
        </section>

        {/* Balance Cards Grid */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-text-secondary uppercase tracking-wider">
              Your Current Balances
            </h2>
          </div>

          {balancesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-40 rounded-2xl bg-card-subtle animate-pulse border border-border-light" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {balances.map((b) => (
                <LeaveBalanceCard key={b.id} balance={b} />
              ))}
            </div>
          )}
        </section>

        {/* History Section & Filter */}
        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-light/60 pb-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-brand-purple" />
              <h2 className="text-sm font-bold text-text-primary">Leave History & Applications</h2>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              <Filter className="w-3 h-3 text-text-tertiary mr-1 shrink-0" />
              {(["all", "pending", "approved", "rejected", "cancelled"] as const).map((tab) => {
                const isActive = statusFilter === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setStatusFilter(tab)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-bold capitalize transition-colors cursor-pointer shrink-0",
                      isActive
                        ? "bg-brand-purple text-white shadow-sm"
                        : "text-text-secondary hover:text-text-primary bg-card-subtle hover:bg-card border border-border-light"
                    )}
                  >
                    {tab}
                    {tab === "pending" && pendingCount > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400 text-slate-900 font-extrabold">
                        {pendingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <LeaveHistoryTable requests={requests} isLoading={requestsLoading} />
        </section>

        {/* Apply Leave Modal */}
        <ApplyLeaveModal open={applyModalOpen} onOpenChange={setApplyModalOpen} />
      </div>
    </AppShell>
  );
}


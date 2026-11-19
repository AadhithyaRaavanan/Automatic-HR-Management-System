"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LeaveBalanceCard } from "@/features/leave/components/leave-balance-card";
import { LeaveHistoryTable } from "@/features/leave/components/leave-history-table";
import { ApplyLeaveModal } from "@/features/leave/components/apply-leave-modal";
import { EmptyState } from "@/components/shared/empty-state";
import { useLeaveBalances, useLeaveRequests } from "@/features/leave/hooks/use-leave";
import { Plus, RefreshCw, Calendar, Filter, CalendarDays } from "lucide-react";
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
      primaryActionLabel="Apply for leave"
      onPrimaryAction={() => setApplyModalOpen(true)}
    >
      <div className="space-y-6">
        {/* Header */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-2">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
              Leave
            </h1>
            <p className="text-xs text-text-secondary mt-1">
              Check leave balances, submit time-off requests, and track status.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleRefresh}
              className="p-1.5 rounded-lg bg-card border border-border-light text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors cursor-pointer"
              title="Refresh balances"
              aria-label="Refresh leave balances"
            >
              <RefreshCw className="w-4 h-4 text-text-secondary" />
            </button>

            <button
              data-tour="leave-apply"
              type="button"
              onClick={() => setApplyModalOpen(true)}
              className="px-3.5 py-1.5 rounded-lg bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Apply for leave</span>
            </button>
          </div>
        </section>

        {/* Balance Cards Grid */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium text-text-secondary">
              Current balances
            </h2>
          </div>

          {balancesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-40 rounded-xl bg-card-subtle animate-pulse border border-border-light" />
              ))}
            </div>
          ) : balances.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {balances.map((b) => (
                <LeaveBalanceCard key={b.id} balance={b} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<CalendarDays className="w-6 h-6" />}
              title="No leave balances allocated yet"
              description="Ask your HR administrator to allocate leave quotas for the current leave year."
            />
          )}
        </section>

        {/* History Section & Filter */}
        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-light/60 pb-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-text-secondary" />
              <h2 className="text-sm font-semibold text-text-primary">Leave history</h2>
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
                      "px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors cursor-pointer shrink-0",
                      isActive
                        ? "bg-brand-purple text-white"
                        : "text-text-secondary hover:text-text-primary bg-card border border-border-light"
                    )}
                  >
                    {tab}
                    {tab === "pending" && pendingCount > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-status-warning-bg text-status-warning-text font-medium">
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

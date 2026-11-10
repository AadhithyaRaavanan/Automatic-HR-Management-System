"use client";

import * as React from "react";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import { StatCard } from "@/features/attendance/components/stat-card";
import { StatusPill } from "@/components/shared/status-pill";
import { AvatarStack } from "@/components/shared/avatar-stack";
import { EmptyState } from "@/components/shared/empty-state";
import {
  useRegularizations,
  useApproveRegularization,
  useRejectRegularization,
} from "@/features/requests/hooks/use-regularizations";
import { createClient } from "@/lib/supabase/client";
import { formatDurationMinutes, formatTimeInTimezone } from "@/lib/date/timezone";
import { AttendanceDayStatus } from "@/types/database.types";
import {
  Users,
  Clock,
  CheckCircle2,
  AlertCircle,
  Check,
  X,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TeamMemberRosterItem {
  id: string;
  name: string;
  subtitle: string;
  timezone: string;
  checkInTime: string;
  loggedMinutes: number;
  status: "online" | "idle" | "offline";
  dayStatus: AttendanceDayStatus;
  isLate: boolean;
}

function TeamPageContent() {
  const { userId, userRole } = useAppSession();
  const supabase = React.useMemo(() => createClient(), []);
  const { data: requests, refetch } = useRegularizations();
  const approveMutation = useApproveRegularization();
  const rejectMutation = useRejectRegularization();

  const [roster, setRoster] = React.useState<TeamMemberRosterItem[]>([]);
  const [rosterLoading, setRosterLoading] = React.useState(true);

  const loadRoster = React.useCallback(async () => {
    setRosterLoading(true);
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      let empQuery = (supabase as any)
        .from("employees")
        .select("id, full_name, email, timezone, work_mode, departments:department_id(name)")
        .eq("status", "active")
        .order("full_name");

      if (userRole === "manager" && userId) {
        empQuery = empQuery.eq("manager_id", userId);
      } else if (userId) {
        empQuery = empQuery.neq("id", userId);
      }

      const [{ data: emps }, { data: days }, { data: openSess }] = await Promise.all([
        empQuery,
        (supabase as any)
          .from("attendance_days")
          .select("employee_id, status, total_minutes, is_late")
          .eq("work_date", todayIso),
        (supabase as any)
          .from("attendance_sessions")
          .select("employee_id, check_in_at, check_out_at")
          .eq("work_date", todayIso)
          .order("check_in_at", { ascending: true }),
      ]);

      const dayMap = new Map<string, any>();
      for (const d of days || []) {
        dayMap.set(d.employee_id, d);
      }

      const firstInMap = new Map<string, string>();
      const openMap = new Map<string, boolean>();
      for (const s of openSess || []) {
        if (!firstInMap.has(s.employee_id)) {
          firstInMap.set(s.employee_id, s.check_in_at);
        }
        if (s.check_out_at === null) {
          openMap.set(s.employee_id, true);
        }
      }

      if (emps) {
        setRoster(
          emps.map((e: any) => {
            const d = dayMap.get(e.id);
            const isOnline = Boolean(openMap.get(e.id));
            const firstIn = firstInMap.get(e.id);
            const tz = e.timezone || "UTC";
            return {
              id: e.id,
              name: e.full_name,
              subtitle: e.departments?.name || e.work_mode || "Team Member",
              timezone: tz,
              checkInTime: firstIn ? formatTimeInTimezone(firstIn, tz) : "--:--",
              loggedMinutes: d?.total_minutes || 0,
              status: isOnline ? "online" : firstIn ? "idle" : "offline",
              dayStatus: (d?.status || "absent") as AttendanceDayStatus,
              isLate: Boolean(d?.is_late),
            };
          })
        );
      }
    } catch {
      setRoster([]);
    } finally {
      setRosterLoading(false);
    }
  }, [supabase, userId, userRole]);

  React.useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  // Exclude self requests from approval queue (separation of duties)
  const pendingRequests = (requests || []).filter(
    (r) => r.status === "pending" && (!userId || r.employee_id !== userId)
  );

  const onlineCount = roster.filter((m) => m.status === "online").length;
  const totalReports = roster.length;
  const activePct = totalReports > 0 ? Math.round((onlineCount / totalReports) * 100) : 0;
  const avgMins =
    totalReports > 0
      ? Math.round(roster.reduce((a, b) => a + b.loggedMinutes, 0) / totalReports)
      : 0;
  const presentMembers = roster.filter(
    (m) => m.dayStatus === "present" || m.dayStatus === "half_day"
  );
  const onTimePct =
    presentMembers.length > 0
      ? Math.round(
          (presentMembers.filter((m) => !m.isLate).length / presentMembers.length) * 100
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
              Manager Team Hub
            </h1>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-brand-purple-light text-brand-purple flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-status-success-dot animate-pulse" />
              {onlineCount} Online Now
            </span>
          </div>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Real-time team presence, daily attendance status, and pending correction approvals.
          </p>
        </div>

        {roster.length > 0 && (
          <AvatarStack
            users={roster.map((m) => ({
              id: m.id,
              name: m.name,
              status: m.status,
            }))}
            max={4}
            size="md"
          />
        )}
      </section>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Team Online"
          value={`${onlineCount}/${totalReports}`}
          subtitle={`${activePct}% active punch rate`}
          icon={<Activity className="w-4 h-4 text-status-success-dot" />}
        />
        <StatCard
          title="Avg Hours Today"
          value={formatDurationMinutes(avgMins)}
          subtitle="Target: 08h 00m"
          progress={Math.min(100, Math.round((avgMins / 480) * 100))}
          icon={<Clock className="w-4 h-4" />}
        />
        <StatCard
          title="On-Time Rate"
          value={`${onTimePct}%`}
          subtitle="Team punctuality today"
          icon={<CheckCircle2 className="w-4 h-4 text-brand-purple" />}
        />
        <StatCard
          title="Pending Requests"
          value={`${pendingRequests.length}`}
          subtitle="Awaiting your review"
          icon={<AlertCircle className="w-4 h-4 text-status-warning-dot" />}
        />
      </div>

      {/* Bento Grid: Team Roster + Approvals Queue */}
      <BentoGrid>
        {/* Left: Team Today Roster */}
        <BentoCard
          title="Team Attendance Today"
          subtitle="Direct reports and department working status"
          className="lg:col-span-7 p-6"
        >
          {rosterLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-2xl bg-card-subtle animate-pulse" />
              ))}
            </div>
          ) : roster.length > 0 ? (
            <div className="space-y-3">
              {roster.map((member) => (
                <div
                  key={member.id}
                  className="p-4 rounded-2xl bg-card-subtle border border-border-light flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-card transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-brand-purple-light flex items-center justify-center font-bold text-xs text-brand-purple uppercase">
                        {member.name.slice(0, 2)}
                      </div>
                      <span
                        className={cn(
                          "absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-card",
                          member.status === "online"
                            ? "bg-status-success-dot"
                            : member.status === "idle"
                            ? "bg-status-warning-dot"
                            : "bg-text-tertiary"
                        )}
                      />
                    </div>

                    <div>
                      <h3 className="text-xs font-bold text-text-primary">{member.name}</h3>
                      <p className="text-[11px] text-text-tertiary">
                        {member.subtitle} • {member.timezone}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-5">
                    <div className="text-right">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block">
                        Check-in: {member.checkInTime}
                      </span>
                      <span className="text-xs font-extrabold text-text-primary font-mono">
                        {formatDurationMinutes(member.loggedMinutes)}
                      </span>
                    </div>

                    <StatusPill status={member.dayStatus} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title="No team members assigned"
              description="Direct reports assigned to you will appear here once active."
            />
          )}
        </BentoCard>

        {/* Right: Pending Approvals Queue */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <span>Pending Approvals</span>
              {pendingRequests.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-status-warning-dot text-brand-navy">
                  {pendingRequests.length}
                </span>
              )}
            </div>
          }
          subtitle="Regularization requests awaiting your approval"
          className="lg:col-span-5 p-6 flex flex-col justify-between"
        >
          <div className="space-y-3">
            {pendingRequests.length > 0 ? (
              pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-4 rounded-2xl bg-card-subtle border border-border-light shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-bold text-text-primary">
                      {req.employee_name || "Direct Report"}
                    </span>
                    <span className="text-[11px] font-mono font-bold text-brand-purple">
                      {req.work_date}
                    </span>
                  </div>

                  <p className="text-xs text-text-secondary bg-card p-2.5 rounded-xl border border-border-light my-2">
                    {req.reason}
                  </p>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-light/60">
                    <button
                      type="button"
                      onClick={() =>
                        rejectMutation.mutate({
                          requestId: req.id,
                          reviewNote: "Declined by manager",
                        })
                      }
                      className="px-3 py-1.5 rounded-xl border border-status-danger-dot/40 text-status-danger-text hover:bg-status-danger-bg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        approveMutation.mutate({
                          requestId: req.id,
                          reviewNote: "Approved by manager",
                        })
                      }
                      className="px-3.5 py-1.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1 cursor-pointer active:scale-95"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve</span>
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                className="py-10 border-dashed shadow-none bg-card-subtle/40"
                icon={<CheckCircle2 className="w-5 h-5" />}
                title="Approvals queue clear"
                description="No pending corrections requiring your review."
              />
            )}
          </div>

          <div className="pt-4 border-t border-border-light mt-4 text-[11px] text-text-tertiary flex items-center justify-between">
            <span>All approvals logged to audit trail</span>
            <button
              type="button"
              onClick={() => {
                refetch();
                loadRoster();
              }}
              className="text-brand-purple font-bold hover:underline cursor-pointer"
            >
              Refresh
            </button>
          </div>
        </BentoCard>
      </BentoGrid>
    </div>
  );
}

export default function ManagerDashboardPage() {
  return (
    <AppShell>
      <TeamPageContent />
    </AppShell>
  );
}

"use client";

import * as React from "react";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import { StatCard } from "@/features/attendance/components/stat-card";
import { StatusPill } from "@/components/shared/status-pill";
import { AvatarStack } from "@/components/shared/avatar-stack";
import { EmptyState } from "@/components/shared/empty-state";
import { Modal } from "@/components/ui/modal";
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
  Plus,
  Edit,
  Trash2,
  UserMinus,
  UserPlus,
  Briefcase,
  Building2,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";
import {
  getStoredUsers,
  getStoredTeams,
  getStoredDepartments,
  getStoredAttendanceSessions,
  getStoredAttendanceDays,
  addStoredTeam,
  updateStoredTeam,
  deleteStoredTeam,
  kickTeamMember,
  addTeamMember,
  type DemoTeam,
  type DemoUser,
} from "@/lib/storage/demo-store";

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
  jobTitle?: string;
  department?: string;
  teamIds: string[];
}

function TeamPageContent() {
  const { userId, userRole } = useAppSession();
  const supabase = React.useMemo(() => createClient(), []);
  const { data: requests, refetch } = useRegularizations();
  const approveMutation = useApproveRegularization();
  const rejectMutation = useRejectRegularization();

  const [roster, setRoster] = React.useState<TeamMemberRosterItem[]>([]);
  const [teams, setTeams] = React.useState<DemoTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = React.useState<string>("all");
  const [rosterLoading, setRosterLoading] = React.useState(true);

  // Team Creation & Editing Modal State
  const [teamModalOpen, setTeamModalOpen] = React.useState(false);
  const [editingTeam, setEditingTeam] = React.useState<DemoTeam | null>(null);
  const [teamName, setTeamName] = React.useState("");
  const [teamCode, setTeamCode] = React.useState("");
  const [teamDeptId, setTeamDeptId] = React.useState("");
  const [teamLeadId, setTeamLeadId] = React.useState("");
  const [teamMemberIds, setTeamMemberIds] = React.useState<string[]>([]);
  const [availableUsers, setAvailableUsers] = React.useState<DemoUser[]>([]);
  const [availableDepts, setAvailableDepts] = React.useState<{ id: string; name: string }[]>([]);

  // Add Member to Current Team Modal State
  const [addMemberModalOpen, setAddMemberModalOpen] = React.useState(false);
  const [selectedNewMemberId, setSelectedNewMemberId] = React.useState("");

  const isAdminOrManager = userRole === "admin" || userRole === "manager";

  const loadRoster = React.useCallback(async () => {
    setRosterLoading(true);
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const storedUsersList = getStoredUsers();
      const storedTeamsList = getStoredTeams();
      const storedDeptsList = getStoredDepartments();
      const storedSessions = getStoredAttendanceSessions();
      const storedDays = getStoredAttendanceDays();

      setTeams(storedTeamsList);
      setAvailableUsers(storedUsersList);
      setAvailableDepts(storedDeptsList.map((d) => ({ id: d.id, name: d.name })));

      let emps: any = null;
      let daysData: any = null;
      let openSessData: any = null;

      try {
        let empQuery = (supabase as any)
          .from("employees")
          .select(
            "id, full_name, email, timezone, work_mode, department_id, departments:department_id(name), job_titles:job_title_id(title_name)"
          )
          .eq("status", "active")
          .order("full_name");

        if (userRole === "manager" && userId) {
          empQuery = empQuery.eq("manager_id", userId);
        }

        const [empsRes, daysRes, sessRes] = await Promise.all([
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

        emps = empsRes?.data;
        daysData = daysRes?.data;
        openSessData = sessRes?.data;
      } catch {
        // Fallback to demo store
      }

      // Merge day and session maps
      const dayMap = new Map<string, any>();
      for (const d of daysData || []) {
        dayMap.set(d.employee_id, d);
      }
      if (isDemoModeEnabled()) {
        for (const d of storedDays.filter((d) => d.work_date === todayIso)) {
          if (!dayMap.has(d.employee_id)) {
            dayMap.set(d.employee_id, d);
          }
        }
      }

      const firstInMap = new Map<string, string>();
      const openMap = new Map<string, boolean>();
      for (const s of openSessData || []) {
        if (!firstInMap.has(s.employee_id)) {
          firstInMap.set(s.employee_id, s.check_in_at);
        }
        if (s.check_out_at === null) {
          openMap.set(s.employee_id, true);
        }
      }
      if (isDemoModeEnabled()) {
        for (const s of storedSessions.filter((s) => s.work_date === todayIso)) {
          if (!firstInMap.has(s.employee_id)) {
            firstInMap.set(s.employee_id, s.check_in_at);
          }
          if (s.check_out_at === null) {
            openMap.set(s.employee_id, true);
          }
        }
      }

      // Build roster members
      let rawMembers: { id: string; name: string; timezone: string; department?: string; jobTitle?: string; workMode?: string }[] = [];

      if (emps && emps.length > 0) {
        rawMembers = emps.map((e: any) => {
          const storedU = storedUsersList.find((u) => u.id === e.id || u.email === e.email);
          const deptVal = storedU
            ? storedU.department !== "Unassigned"
              ? storedU.department
              : undefined
            : e.departments?.name;
          const titleVal = storedU
            ? storedU.jobTitle !== "Unassigned"
              ? storedU.jobTitle
              : undefined
            : e.job_titles?.title_name;

          return {
            id: e.id,
            name: storedU?.name || e.full_name,
            timezone: storedU?.timezone || e.timezone || "UTC",
            department: deptVal,
            jobTitle: titleVal,
            workMode: storedU?.workMode || e.work_mode,
          };
        });
      } else {
        rawMembers = storedUsersList.map((u) => ({
          id: u.id,
          name: u.name,
          timezone: u.timezone || "UTC",
          department: u.department !== "Unassigned" ? u.department : undefined,
          jobTitle: u.jobTitle !== "Unassigned" ? u.jobTitle : undefined,
          workMode: u.workMode,
        }));
      }

      // Map team memberships
      const memberTeamMap = new Map<string, string[]>();
      for (const team of storedTeamsList) {
        for (const mId of team.memberIds || []) {
          const list = memberTeamMap.get(mId) || [];
          list.push(team.id);
          memberTeamMap.set(mId, list);
        }
      }

      const builtRoster: TeamMemberRosterItem[] = rawMembers.map((m) => {
        const d = dayMap.get(m.id);
        const isOnline = Boolean(openMap.get(m.id));
        const firstIn = firstInMap.get(m.id);
        const tz = m.timezone || "UTC";
        const loggedMins = d?.total_minutes || 0;

        return {
          id: m.id,
          name: m.name,
          subtitle: m.department || m.workMode || "Team Member",
          timezone: tz,
          checkInTime: firstIn ? formatTimeInTimezone(firstIn, tz) : "--:--",
          loggedMinutes: loggedMins,
          status: isOnline ? "online" : firstIn ? "idle" : "offline",
          dayStatus: (d?.status || (isOnline ? "present" : "absent")) as AttendanceDayStatus,
          isLate: Boolean(d?.is_late),
          jobTitle: m.jobTitle,
          department: m.department,
          teamIds: memberTeamMap.get(m.id) || [],
        };
      });

      setRoster(builtRoster);
    } catch {
      // Keep UI clean
    } finally {
      setRosterLoading(false);
    }
  }, [supabase, userId, userRole]);

  React.useEffect(() => {
    loadRoster();
    const handleStorageChange = () => loadRoster();
    window.addEventListener("remotehr_storage_change", handleStorageChange);
    return () => {
      window.removeEventListener("remotehr_storage_change", handleStorageChange);
    };
  }, [loadRoster]);

  // Exclude self requests from approval queue (separation of duties)
  const pendingRequests = (requests || []).filter(
    (r) => r.status === "pending" && (!userId || r.employee_id !== userId)
  );

  // Filter roster by selected team
  const displayedRoster = React.useMemo(() => {
    if (selectedTeamId === "all") return roster;
    return roster.filter((m) => m.teamIds.includes(selectedTeamId));
  }, [roster, selectedTeamId]);

  const activeTeam = React.useMemo(() => {
    return teams.find((t) => t.id === selectedTeamId) || null;
  }, [teams, selectedTeamId]);

  const onlineCount = displayedRoster.filter((m) => m.status === "online").length;
  const totalReports = displayedRoster.length;
  const activePct = totalReports > 0 ? Math.round((onlineCount / totalReports) * 100) : 0;
  const avgMins =
    totalReports > 0
      ? Math.round(displayedRoster.reduce((a, b) => a + b.loggedMinutes, 0) / totalReports)
      : 0;
  const presentMembers = displayedRoster.filter(
    (m) => m.dayStatus === "present" || m.dayStatus === "half_day"
  );
  const onTimePct =
    presentMembers.length > 0
      ? Math.round(
          (presentMembers.filter((m) => !m.isLate).length / presentMembers.length) * 100
        )
      : 0;

  // Team Modal Handlers
  const handleOpenCreateTeam = () => {
    setEditingTeam(null);
    setTeamName("");
    setTeamCode("");
    setTeamDeptId("");
    setTeamLeadId("");
    setTeamMemberIds([]);
    setTeamModalOpen(true);
  };

  const handleOpenEditTeam = (team: DemoTeam) => {
    setEditingTeam(team);
    setTeamName(team.name);
    setTeamCode(team.code);
    setTeamDeptId(team.departmentId || "");
    setTeamLeadId(team.leadId || "");
    setTeamMemberIds(team.memberIds || []);
    setTeamModalOpen(true);
  };

  const handleSaveTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim() || !teamCode.trim()) {
      toast.error("Please enter a team name and unique team code.");
      return;
    }

    const leadUser = availableUsers.find((u) => u.id === teamLeadId);

    if (editingTeam) {
      updateStoredTeam({
        ...editingTeam,
        name: teamName.trim(),
        code: teamCode.trim().toUpperCase(),
        departmentId: teamDeptId || null,
        leadId: teamLeadId || null,
        leadName: leadUser ? leadUser.name : null,
        memberIds: teamMemberIds,
      });
      toast.success(`Team "${teamName}" updated!`);
    } else {
      const created = addStoredTeam({
        name: teamName.trim(),
        code: teamCode.trim().toUpperCase(),
        departmentId: teamDeptId || null,
        leadId: teamLeadId || null,
        leadName: leadUser ? leadUser.name : null,
        memberIds: teamMemberIds,
      });
      setSelectedTeamId(created.id);
      toast.success(`Team "${created.name}" created!`);
    }

    setTeamModalOpen(false);
    loadRoster();
  };

  const handleDeleteTeam = (team: DemoTeam) => {
    if (!confirm(`Are you sure you want to delete team "${team.name}"? Members will remain in workforce.`)) {
      return;
    }
    deleteStoredTeam(team.id);
    setSelectedTeamId("all");
    toast.success(`Team "${team.name}" deleted.`);
    loadRoster();
  };

  const handleKickMember = (teamId: string, member: TeamMemberRosterItem) => {
    if (!confirm(`Are you sure you want to kick ${member.name} from this team?`)) {
      return;
    }
    kickTeamMember(teamId, member.id);
    toast.success(`${member.name} kicked from team.`);
    loadRoster();
  };

  const handleAddMemberToTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam || !selectedNewMemberId) return;
    addTeamMember(activeTeam.id, selectedNewMemberId);
    toast.success("Member added to team!");
    setAddMemberModalOpen(false);
    setSelectedNewMemberId("");
    loadRoster();
  };

  const toggleMemberSelection = (userIdToToggle: string) => {
    setTeamMemberIds((prev) =>
      prev.includes(userIdToToggle)
        ? prev.filter((id) => id !== userIdToToggle)
        : [...prev, userIdToToggle]
    );
  };

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
              <span
                className={cn(
                  "w-2 h-2 rounded-full",
                  onlineCount > 0 ? "bg-status-success-dot animate-pulse" : "bg-text-tertiary"
                )}
              />
              {onlineCount} Online Now
            </span>
          </div>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Real-time team presence, collaborative units, and pending correction approvals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAdminOrManager && (
            <button
              type="button"
              onClick={handleOpenCreateTeam}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Team</span>
            </button>
          )}

          {displayedRoster.length > 0 && (
            <AvatarStack
              users={displayedRoster.map((m) => ({
                id: m.id,
                name: m.name,
                status: m.status,
              }))}
              max={4}
              size="md"
            />
          )}
        </div>
      </section>

      {/* Team Tabs / Selector */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          type="button"
          onClick={() => setSelectedTeamId("all")}
          className={cn(
            "px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all cursor-pointer",
            selectedTeamId === "all"
              ? "bg-brand-purple text-white shadow-sm"
              : "bg-card-subtle text-text-secondary hover:text-text-primary hover:bg-card"
          )}
        >
          All Workforce ({roster.length})
        </button>

        {teams.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSelectedTeamId(t.id)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer",
              selectedTeamId === t.id
                ? "bg-brand-purple text-white shadow-sm"
                : "bg-card-subtle text-text-secondary hover:text-text-primary hover:bg-card"
            )}
          >
            <span>{t.name}</span>
            <span
              className={cn(
                "px-1.5 py-0.2 rounded-full text-[10px]",
                selectedTeamId === t.id ? "bg-white/20 text-white" : "bg-card text-text-tertiary"
              )}
            >
              {(t.memberIds || []).length}
            </span>
          </button>
        ))}
      </div>

      {/* Active Team Header Bar (When a specific team is selected) */}
      {activeTeam && (
        <div className="p-4 rounded-2xl bg-card border border-border-light shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-purple/10 flex items-center justify-center text-brand-purple font-extrabold text-xs">
              {activeTeam.code.slice(0, 3)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold text-text-primary">{activeTeam.name}</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-card-subtle border border-border-light text-text-secondary">
                  {activeTeam.code}
                </span>
              </div>
              <p className="text-xs text-text-tertiary mt-0.5 flex items-center gap-2">
                <span>Team Lead: <strong className="text-text-primary">{activeTeam.leadName || "None"}</strong></span>
                <span>•</span>
                <span>Members: <strong className="text-text-primary">{(activeTeam.memberIds || []).length}</strong></span>
              </p>
            </div>
          </div>

          {isAdminOrManager && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAddMemberModalOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-card-subtle hover:bg-card border border-border-light text-xs font-bold text-brand-purple flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Member</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenEditTeam(activeTeam)}
                className="p-1.5 rounded-xl hover:bg-card-subtle text-text-secondary hover:text-brand-purple transition-colors cursor-pointer"
                title="Edit Team"
              >
                <Edit className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleDeleteTeam(activeTeam)}
                className="p-1.5 rounded-xl hover:bg-card-subtle text-text-secondary hover:text-rose-500 transition-colors cursor-pointer"
                title="Delete Team"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

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
          title={activeTeam ? `${activeTeam.name} Attendance` : "Workforce Attendance Today"}
          subtitle="Real-time check-in and attendance status"
          className="lg:col-span-7 p-6"
        >
          {rosterLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-2xl bg-card-subtle animate-pulse" />
              ))}
            </div>
          ) : displayedRoster.length > 0 ? (
            <div className="space-y-3">
              {displayedRoster.map((member) => (
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-xs font-bold text-text-primary">{member.name}</h3>
                        {member.jobTitle && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-navy/10 text-brand-navy border border-brand-navy/20">
                            {member.jobTitle}
                          </span>
                        )}
                        {member.department && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-card border border-border-light text-text-secondary">
                            {member.department}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-text-tertiary mt-0.5">
                        {member.timezone}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4">
                    <div className="text-right">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block">
                        Check-in: {member.checkInTime}
                      </span>
                      <span className="text-xs font-extrabold text-text-primary font-mono">
                        {formatDurationMinutes(member.loggedMinutes)}
                      </span>
                    </div>

                    <StatusPill status={member.dayStatus} />

                    {/* Kick from Team action button */}
                    {activeTeam && isAdminOrManager && (
                      <button
                        type="button"
                        onClick={() => handleKickMember(activeTeam.id, member)}
                        title={`Kick ${member.name} from team`}
                        className="p-1.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 text-text-tertiary hover:text-rose-600 transition-colors cursor-pointer"
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title={activeTeam ? "No members in this team" : "No workforce members"}
              description={
                activeTeam
                  ? 'Click "Add Member" above to add people to this team.'
                  : "Invite workforce members from the Workforce Directory."
              }
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
                      className="px-3 py-1.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1 cursor-pointer active:scale-95"
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

      {/* Create / Edit Team Modal */}
      <Modal
        open={teamModalOpen}
        onOpenChange={setTeamModalOpen}
        title={editingTeam ? "Edit Team" : "Create New Team"}
        description="Organize workforce members into collaborative delivery teams."
        className="max-w-lg"
      >
        <form onSubmit={handleSaveTeam} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1">
              Team Name *
            </label>
            <input
              type="text"
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Platform Engineering"
              className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary focus:outline-none focus:border-brand-purple"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1">
                Team Code *
              </label>
              <input
                type="text"
                required
                value={teamCode}
                onChange={(e) => setTeamCode(e.target.value)}
                placeholder="e.g. PLAT-ENG"
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary uppercase focus:outline-none focus:border-brand-purple"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1">
                Department
              </label>
              <select
                value={teamDeptId}
                onChange={(e) => setTeamDeptId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary focus:outline-none focus:border-brand-purple"
              >
                <option value="">Cross-departmental</option>
                {availableDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1">
              Team Lead
            </label>
            <select
              value={teamLeadId}
              onChange={(e) => setTeamLeadId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary focus:outline-none focus:border-brand-purple"
            >
              <option value="">Select Team Lead...</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1">
              Assign Team Members ({teamMemberIds.length} selected)
            </label>
            <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 rounded-xl bg-card-subtle border border-border-light">
              {availableUsers.map((u) => {
                const isSelected = teamMemberIds.includes(u.id);
                return (
                  <label
                    key={u.id}
                    className={cn(
                      "flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition-colors",
                      isSelected ? "bg-brand-purple/10 border border-brand-purple/30" : "hover:bg-card"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleMemberSelection(u.id)}
                        className="rounded border-border-light text-brand-purple focus:ring-brand-purple"
                      />
                      <span className="font-semibold text-text-primary">{u.name}</span>
                    </div>
                    <span className="text-[10px] text-text-tertiary uppercase">{u.role}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-light">
            <button
              type="button"
              onClick={() => setTeamModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-card-subtle text-xs font-bold text-text-secondary hover:text-text-primary cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              {editingTeam ? "Save Changes" : "Create Team"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Member Modal */}
      <Modal
        open={addMemberModalOpen}
        onOpenChange={setAddMemberModalOpen}
        title={`Add Member to ${activeTeam?.name || "Team"}`}
        description="Select a workforce member to join this team."
        className="max-w-md"
      >
        <form onSubmit={handleAddMemberToTeam} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1">
              Select Member
            </label>
            <select
              required
              value={selectedNewMemberId}
              onChange={(e) => setSelectedNewMemberId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary focus:outline-none focus:border-brand-purple"
            >
              <option value="">Select an employee...</option>
              {availableUsers
                .filter((u) => !activeTeam?.memberIds?.includes(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.email} ({u.role})
                  </option>
                ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-light">
            <button
              type="button"
              onClick={() => setAddMemberModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-card-subtle text-xs font-bold text-text-secondary hover:text-text-primary cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedNewMemberId}
              className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
            >
              Add to Team
            </button>
          </div>
        </form>
      </Modal>
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

"use client";

import * as React from "react";
import { Search, Download, ChevronDown, ChevronRight, AlertCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getStatusDisplay } from "@/lib/kpi/plain-language";

interface TeamMemberRecord {
  id: string;
  fullName: string;
  email: string;
  department: string;
  departmentId: string | null;
  employmentCategory: string;
  overallScore: number | null;
  attendanceScore: number | null;
  hoursScore: number | null;
  tasksScore: number | null;
  needsAttention: boolean;
  latestReviewDate: string | null;
  latestReviewRatings: Record<string, number> | null;
  latestReviewNote: string | null;
  goals: {
    total: number;
    done: number;
    onTrack: number;
    atRisk: number;
    notStarted: number;
  };
}

interface KpiTeamOverviewProps {
  from: string;
  to: string;
  departmentFilter: string;
  employeeTypeFilter: string;
  onSelectEmployee: (employeeId: string) => void;
  className?: string;
}

export function KpiTeamOverview({
  from,
  to,
  departmentFilter,
  employeeTypeFilter,
  onSelectEmployee,
  className,
}: KpiTeamOverviewProps) {
  const [team, setTeam] = React.useState<TeamMemberRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [everyoneOpen, setEveryoneOpen] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    setLoading(true);

    const params = new URLSearchParams({ from, to });
    if (departmentFilter && departmentFilter !== "all") params.set("department", departmentFilter);
    if (employeeTypeFilter && employeeTypeFilter !== "all") params.set("employee_type", employeeTypeFilter);

    fetch(`/api/kpi/team?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        setTeam(data?.team || []);
      })
      .catch(() => {
        if (!active) return;
        setTeam([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [from, to, departmentFilter, employeeTypeFilter]);

  // Search filtering
  const searchFiltered = React.useMemo(() => {
    return team.filter((m) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        m.fullName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.department.toLowerCase().includes(q)
      );
    });
  }, [team, search]);

  // Helper for single reason sentence in Needs Attention
  const getNeedsAttentionReason = (m: TeamMemberRecord): string => {
    if (m.overallScore == null) {
      if (m.tasksScore == null && m.attendanceScore == null) return "No activity recorded yet";
      if (m.tasksScore == null) return "No tasks assigned";
      return "Not enough data recorded yet";
    }
    if (m.hoursScore != null && m.hoursScore < 80) return `Hours at ${m.hoursScore}%`;
    if (m.attendanceScore != null && m.attendanceScore < 80) return `Attendance at ${m.attendanceScore}%`;
    if (m.tasksScore != null && m.tasksScore < 70) return `Tasks at ${m.tasksScore}%`;
    if (m.hoursScore != null && m.hoursScore < 90) return `Hours at ${m.hoursScore}%`;
    if (m.attendanceScore != null && m.attendanceScore < 90) return `Attendance at ${m.attendanceScore}%`;
    if (m.tasksScore == null) return "No tasks assigned";
    if (m.goals.atRisk > 0) return `${m.goals.atRisk} goal marked at risk`;
    return "Check-ins or deliverables need attention";
  };

  // Group into "Needs attention" vs All
  const needsAttentionList = React.useMemo(() => {
    return searchFiltered.filter((m) => {
      const isBehind =
        m.overallScore == null ||
        (m.attendanceScore != null && m.attendanceScore < 90) ||
        (m.hoursScore != null && m.hoursScore < 90) ||
        (m.tasksScore != null && m.tasksScore < 85) ||
        m.tasksScore == null ||
        m.needsAttention;
      return isBehind;
    });
  }, [searchFiltered]);

  // Everyone sorted alphabetically by name
  const everyoneAlphabetical = React.useMemo(() => {
    return [...searchFiltered].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [searchFiltered]);

  const handleExportTeamCsv = () => {
    if (everyoneAlphabetical.length === 0) return;

    const headers = [
      "Employee Name",
      "Email",
      "Department",
      "Overall Score",
      "Attendance %",
      "Hours %",
      "Tasks %",
      "Latest Review",
      "Goals Summary",
      "Employment Type",
    ];

    const rows = everyoneAlphabetical.map((m) => [
      `"${m.fullName.replace(/"/g, '""')}"`,
      `"${m.email.replace(/"/g, '""')}"`,
      `"${m.department.replace(/"/g, '""')}"`,
      m.overallScore != null ? `${m.overallScore}%` : "No data",
      m.attendanceScore != null ? `${m.attendanceScore}%` : "No data",
      m.hoursScore != null ? `${m.hoursScore}%` : "No data",
      m.tasksScore != null ? `${m.tasksScore}%` : "No data",
      m.latestReviewDate || "No data",
      `"${m.goals.done} done, ${m.goals.onTrack} on track, ${m.goals.atRisk} at risk"`,
      `"${m.employmentCategory.replace("_", "-")}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `team-performance-${from}-to-${to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Team performance exported to CSV");
  };

  return (
    <div className={cn("space-y-5", className)}>
      {/* Search Bar + Export Button */}
      <div className="p-3 rounded-2xl bg-card border border-border-light shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full max-w-sm">
          <Search className="w-4 h-4 text-text-tertiary absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search team member or department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary focus:ring-1 focus:ring-black outline-none"
          />
        </div>

        <button
          type="button"
          onClick={handleExportTeamCsv}
          disabled={loading || everyoneAlphabetical.length === 0}
          className="px-3.5 py-1.5 rounded-xl bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-black" />
          <span>Export team CSV</span>
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="h-32 rounded-2xl bg-card border border-border-light animate-pulse" />
          <div className="h-64 rounded-2xl bg-card border border-border-light animate-pulse" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* SECTION 1: Needs Attention (Opens first) */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-extrabold text-text-primary tracking-tight">
                  Needs attention
                </h3>
              </div>
              <span className="text-xs text-text-tertiary font-semibold">
                {needsAttentionList.length} people
              </span>
            </div>

            {needsAttentionList.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {needsAttentionList.map((m) => {
                  const reason = getNeedsAttentionReason(m);
                  const statusKey =
                    m.overallScore != null
                      ? m.overallScore >= 90
                        ? "on_track"
                        : m.overallScore >= 80
                        ? "at_risk"
                        : "behind"
                      : "no_data";
                  const status = getStatusDisplay(statusKey);

                  return (
                    <div
                      key={m.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectEmployee(m.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectEmployee(m.id);
                        }
                      }}
                      className="p-4 rounded-2xl bg-card border border-border-light shadow-card hover:border-black/30 hover:shadow-card-hover transition-all cursor-pointer flex flex-col justify-between space-y-3 group select-none"
                    >
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-xs font-bold text-text-primary group-hover:text-black block leading-snug">
                              {m.fullName}
                            </span>
                            <span className="text-[11px] text-text-tertiary">
                              {m.department || "General"}
                            </span>
                          </div>

                          <div className="inline-flex items-center gap-1 text-[11px] shrink-0">
                            <span className={cn("w-2 h-2 rounded-full", status.dotColor)} aria-hidden="true" />
                            <span className={status.textColor}>{status.label}</span>
                          </div>
                        </div>

                        {/* ONE plain reason sentence */}
                        <p className="text-xs text-amber-900 font-semibold pt-1">
                          {reason}
                        </p>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-text-tertiary pt-2 border-t border-border-light/60">
                        <span>Score: {m.overallScore != null ? `${m.overallScore}%` : "—"}</span>
                        <span className="text-black font-bold group-hover:underline inline-flex items-center gap-0.5">
                          View details <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-card border border-border-light text-xs text-text-secondary">
                No team members need attention right now.
              </div>
            )}
          </section>

          {/* SECTION 2: Collapsible "Everyone" list sorted alphabetically */}
          <section className="space-y-2.5">
            <button
              type="button"
              onClick={() => setEveryoneOpen((prev) => !prev)}
              className="w-full flex items-center justify-between p-2 text-left hover:bg-card-subtle/40 rounded-xl transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <ChevronDown
                  className={cn(
                    "w-4 h-4 text-text-tertiary transition-transform duration-200",
                    !everyoneOpen && "-rotate-90"
                  )}
                />
                <h3 className="text-sm font-extrabold text-text-primary tracking-tight">
                  Everyone
                </h3>
              </div>
              <span className="text-xs text-text-tertiary font-semibold">
                {everyoneAlphabetical.length} people
              </span>
            </button>

            {everyoneOpen && (
              <div className="rounded-2xl bg-card border border-border-light overflow-hidden shadow-card divide-y divide-border-light">
                {everyoneAlphabetical.length > 0 ? (
                  everyoneAlphabetical.map((m) => {
                    const statusKey =
                      m.overallScore != null
                        ? m.overallScore >= 90
                          ? "on_track"
                          : m.overallScore >= 80
                          ? "at_risk"
                          : "behind"
                        : "no_data";
                    const status = getStatusDisplay(statusKey);

                    return (
                      <div
                        key={m.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectEmployee(m.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectEmployee(m.id);
                          }
                        }}
                        className="p-3.5 flex items-center justify-between gap-3 text-xs hover:bg-card-subtle transition-colors cursor-pointer group select-none"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-card-subtle border border-border-light text-text-secondary flex items-center justify-center font-bold text-xs shrink-0">
                            {m.fullName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-text-primary group-hover:text-black block truncate">
                              {m.fullName}
                            </span>
                            <span className="text-[11px] text-text-tertiary truncate block">
                              {m.department || "General"}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 shrink-0">
                          {/* One status word with dot */}
                          <div className="inline-flex items-center gap-1.5 text-xs">
                            <span className={cn("w-2 h-2 rounded-full", status.dotColor)} aria-hidden="true" />
                            <span className={status.textColor}>{status.label}</span>
                          </div>

                          <ChevronRight className="w-4 h-4 text-text-tertiary group-hover:text-black transition-colors" />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-xs text-text-tertiary">
                    No team members found matching your search.
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

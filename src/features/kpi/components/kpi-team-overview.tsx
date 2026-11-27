"use client";

import * as React from "react";
import { Search, Download, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getStatusDisplay } from "@/features/kpi/plain-language";

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
  onDepartmentFilterChange?: (dept: string) => void;
  departments?: Array<{ id: string; name: string }>;
  employeeTypeFilter: string;
  onEmployeeTypeFilterChange?: (empType: string) => void;
  onSelectEmployee: (employeeId: string) => void;
  onClearFilters?: () => void;
  className?: string;
}

export function KpiTeamOverview({
  from,
  to,
  departmentFilter,
  onDepartmentFilterChange,
  departments = [],
  employeeTypeFilter,
  onEmployeeTypeFilterChange,
  onSelectEmployee,
  onClearFilters,
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

  const hasFilters =
    Boolean(search.trim()) ||
    Boolean(departmentFilter && departmentFilter !== "all") ||
    Boolean(employeeTypeFilter && employeeTypeFilter !== "all" && employeeTypeFilter !== "full_time");

  return (
    <div className={cn("space-y-5", className)}>
      {/* Visible Team Filter Bar: Employee Search + Department + Employment Type + CSV Export */}
      <div className="p-3.5 rounded-2xl bg-card border border-border-light shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
          <div className="relative w-full sm:w-64">
            <label htmlFor="team-member-search" className="sr-only">
              Search team member or department
            </label>
            <Search className="w-4 h-4 text-text-tertiary absolute left-3 top-2.5" aria-hidden="true" />
            <input
              id="team-member-search"
              type="text"
              placeholder="Search team member..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 min-h-[34px] rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary focus-visible:outline-2 focus-visible:outline-black"
            />
          </div>

          {onDepartmentFilterChange && (
            <div className="flex items-center gap-1.5">
              <label htmlFor="team-department-select" className="text-[11px] font-bold text-text-secondary">
                Department
              </label>
              <select
                id="team-department-select"
                aria-label="Department"
                value={departmentFilter || "all"}
                onChange={(e) => onDepartmentFilterChange(e.target.value)}
                className="min-h-[34px] px-2.5 py-1 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
              >
                <option value="all">All Departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {onEmployeeTypeFilterChange && (
            <div className="flex items-center gap-1.5">
              <label htmlFor="team-type-select" className="text-[11px] font-bold text-text-secondary">
                Type
              </label>
              <select
                id="team-type-select"
                aria-label="Employment type"
                value={employeeTypeFilter || "full_time"}
                onChange={(e) => onEmployeeTypeFilterChange(e.target.value)}
                className="min-h-[34px] px-2.5 py-1 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
              >
                <option value="full_time">Full-Time (8h)</option>
                <option value="part_time">Part-Time (4h)</option>
                <option value="intern">Intern (8h)</option>
                <option value="contract">Contract (8h)</option>
              </select>
            </div>
          )}

          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                onClearFilters?.();
              }}
              className="px-2.5 py-1 min-h-[32px] rounded-xl text-xs font-semibold text-text-secondary hover:text-black hover:bg-card-subtle cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleExportTeamCsv}
          disabled={loading || everyoneAlphabetical.length === 0}
          className="px-3.5 py-1.5 min-h-[34px] rounded-xl bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-black"
        >
          <Download className="w-3.5 h-3.5 text-black" aria-hidden="true" />
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
          {team.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" aria-hidden="true" />
                  <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                    Needs attention
                  </h2>
                </div>
                <span className="text-xs text-text-tertiary font-semibold tabular-nums">
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
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onSelectEmployee(m.id)}
                        className="p-4 rounded-2xl bg-card border border-border-light shadow-card hover:border-black/30 hover:shadow-card-hover transition-all cursor-pointer flex flex-col justify-between space-y-3 group text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                      >
                        <div className="space-y-1 w-full">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-text-primary group-hover:text-black block leading-snug truncate">
                                {m.fullName}
                              </span>
                              <span className="text-[11px] text-text-tertiary block truncate">
                                {m.department || "General"}
                              </span>
                            </div>

                            <div className="inline-flex items-center gap-1 text-[11px] shrink-0">
                              <span className={cn("w-2 h-2 rounded-full", status.dotColor)} aria-hidden="true" />
                              <span className={status.textColor}>{status.label}</span>
                            </div>
                          </div>

                          <p className="text-xs text-amber-900 font-semibold pt-1">
                            {reason}
                          </p>
                        </div>

                        <div className="w-full flex items-center justify-between text-[11px] text-text-tertiary pt-2 border-t border-border-light/60 tabular-nums">
                          <span>Score: {m.overallScore != null ? `${m.overallScore}%` : "—"}</span>
                          <span className="text-black font-bold group-hover:underline inline-flex items-center gap-0.5">
                            View details <ChevronRight className="w-3 h-3" aria-hidden="true" />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-card border border-border-light text-xs text-text-secondary">
                  Nobody needs attention right now.
                </div>
              )}
            </section>
          )}

          {/* SECTION 2: Collapsible "Everyone" list sorted alphabetically */}
          <section className="space-y-2.5">
            <button
              type="button"
              aria-expanded={everyoneOpen}
              onClick={() => setEveryoneOpen((prev) => !prev)}
              className="w-full flex items-center justify-between p-2 text-left hover:bg-card-subtle/40 rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
            >
              <div className="flex items-center gap-2">
                <ChevronDown
                  className={cn(
                    "w-4 h-4 text-text-tertiary transition-transform duration-200",
                    !everyoneOpen && "-rotate-90"
                  )}
                  aria-hidden="true"
                />
                <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                  Everyone
                </h2>
              </div>
              <span className="text-xs text-text-tertiary font-semibold tabular-nums">
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
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onSelectEmployee(m.id)}
                        className="w-full p-3.5 flex items-center justify-between gap-3 text-xs hover:bg-card-subtle transition-colors cursor-pointer group text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-black"
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
                          <span className="text-xs font-bold text-text-primary tabular-nums">
                            {m.overallScore != null ? `${m.overallScore}%` : "—"}
                          </span>

                          <div className="inline-flex items-center gap-1.5 text-xs min-w-[96px]">
                            <span className={cn("w-2 h-2 rounded-full", status.dotColor)} aria-hidden="true" />
                            <span className={status.textColor}>{status.label}</span>
                          </div>

                          <ChevronRight className="w-4 h-4 text-text-tertiary group-hover:text-black transition-colors" aria-hidden="true" />
                        </div>
                      </button>
                    );
                  })
                ) : hasFilters ? (
                  <div className="p-8 text-center space-y-3">
                    <p className="text-xs text-text-secondary font-medium">
                      No team members match these filters.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        onClearFilters?.();
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-text-secondary font-medium">
                    No team members yet.
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

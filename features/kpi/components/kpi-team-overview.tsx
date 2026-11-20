"use client";

import * as React from "react";
import { Search, Download, Filter, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
  const [needsAttentionOnly, setNeedsAttentionOnly] = React.useState(false);
  const [sortField, setSortField] = React.useState<"name" | "score" | "review">("name");
  const [sortAsc, setSortAsc] = React.useState(true);

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

  // Filtering
  const filtered = React.useMemo(() => {
    return team.filter((m) => {
      const matchSearch =
        m.fullName.toLowerCase().includes(search.toLowerCase()) ||
        m.email.toLowerCase().includes(search.toLowerCase()) ||
        m.department.toLowerCase().includes(search.toLowerCase());

      if (!matchSearch) return false;
      if (needsAttentionOnly && !m.needsAttention) return false;
      return true;
    });
  }, [team, search, needsAttentionOnly]);

  // Sorting: default alphabetical by name, allow column sort, NO leaderboard styling
  const sorted = React.useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortField === "name") {
        const cmp = a.fullName.localeCompare(b.fullName);
        return sortAsc ? cmp : -cmp;
      }
      if (sortField === "score") {
        const sA = a.overallScore ?? -1;
        const sB = b.overallScore ?? -1;
        return sortAsc ? sA - sB : sB - sA;
      }
      if (sortField === "review") {
        const rA = a.latestReviewDate || "";
        const rB = b.latestReviewDate || "";
        return sortAsc ? rA.localeCompare(rB) : rB.localeCompare(rA);
      }
      return 0;
    });
  }, [filtered, sortField, sortAsc]);

  const handleSort = (field: "name" | "score" | "review") => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const handleExportTeamCsv = () => {
    if (sorted.length === 0) return;

    // Export CSV with Type column LAST
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

    const rows = sorted.map((m) => [
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
    link.setAttribute("download", `team-kpi-${from}-to-${to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Team performance exported to CSV");
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Table Toolbar */}
      <div className="p-3 rounded-xl bg-card border border-border-light shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-3 w-full">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-text-tertiary absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search team member or department..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-card-subtle border border-border-light text-xs text-text-primary focus:ring-1 focus:ring-black"
            />
          </div>

          {/* Needs Attention Toggle */}
          <button
            type="button"
            onClick={() => setNeedsAttentionOnly((prev) => !prev)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer",
              needsAttentionOnly
                ? "bg-black text-white"
                : "bg-card-subtle text-text-secondary hover:text-black border border-border-light"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Needs attention</span>
          </button>
        </div>

        {/* Export Team CSV */}
        <button
          type="button"
          onClick={handleExportTeamCsv}
          disabled={loading || sorted.length === 0 || team.length === 0}
          title={sorted.length === 0 ? "No team members to export" : "Export team performance to CSV"}
          className="px-3.5 py-1.5 rounded-lg bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5 text-black" />
          <span>Export Team CSV</span>
        </button>
      </div>

      {/* Team Matrix Table */}
      {loading ? (
        <div className="h-64 rounded-2xl bg-card/60 border border-border-light animate-pulse" />
      ) : sorted.length > 0 ? (
        <div className="rounded-2xl bg-card border border-border-light overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-border-light bg-card-subtle/70 text-text-tertiary font-bold uppercase tracking-wider text-[11px]">
                  <th className="p-3.5 cursor-pointer select-none" onClick={() => handleSort("name")}>
                    <div className="flex items-center gap-1">
                      <span>Team Member</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="p-3.5">Department</th>
                  <th className="p-3.5 cursor-pointer select-none" onClick={() => handleSort("score")}>
                    <div className="flex items-center gap-1">
                      <span>Overall</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="p-3.5">Attendance</th>
                  <th className="p-3.5">Hours</th>
                  <th className="p-3.5">Tasks</th>
                  <th className="p-3.5 cursor-pointer select-none" onClick={() => handleSort("review")}>
                    <div className="flex items-center gap-1">
                      <span>Latest Review</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="p-3.5">Goals</th>
                  {/* Type Column placed LAST */}
                  <th className="p-3.5 text-right">Type</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border-light/60">
                {sorted.map((m) => {
                  const initials = m.fullName
                    .trim()
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase() || "ZX";

                  return (
                    <tr
                      key={m.id}
                      onClick={() => onSelectEmployee(m.id)}
                      className="hover:bg-card-subtle/50 transition-colors cursor-pointer group"
                    >
                      {/* Person */}
                      <td className="p-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-black text-[#B7FF00] font-bold text-xs flex items-center justify-center shrink-0">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-text-primary group-hover:text-black transition-colors block truncate">
                              {m.fullName}
                            </span>
                            <span className="text-[11px] text-text-tertiary truncate block">
                              {m.email}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Department */}
                      <td className="p-3.5 text-text-secondary font-medium">
                        {m.department}
                      </td>

                      {/* Overall Score + Status Dot */}
                      <td className="p-3.5 font-bold tabular-nums">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full",
                              m.overallScore == null
                                ? "bg-[#808080]"
                                : m.overallScore >= 85
                                ? "bg-[#B7FF00]"
                                : m.overallScore >= 70
                                ? "bg-amber-500"
                                : "bg-rose-500"
                            )}
                            aria-hidden="true"
                          />
                          <span className={cn(m.overallScore != null ? "text-text-primary" : "text-[#808080]")}>
                            {m.overallScore != null ? `${m.overallScore}%` : "No data"}
                          </span>
                        </div>
                      </td>

                      {/* Attendance */}
                      <td className="p-3.5 font-medium tabular-nums text-text-secondary">
                        {m.attendanceScore != null ? `${m.attendanceScore}%` : "—"}
                      </td>

                      {/* Hours */}
                      <td className="p-3.5 font-medium tabular-nums text-text-secondary">
                        {m.hoursScore != null ? `${m.hoursScore}%` : "—"}
                      </td>

                      {/* Tasks */}
                      <td className="p-3.5 font-medium tabular-nums text-text-secondary">
                        {m.tasksScore != null ? `${m.tasksScore}%` : "—"}
                      </td>

                      {/* Latest Review */}
                      <td className="p-3.5 text-text-secondary">
                        {m.latestReviewDate || <span className="text-text-tertiary">No data</span>}
                      </td>

                      {/* Goals Summary */}
                      <td className="p-3.5">
                        <span className="text-[11px] font-semibold text-text-secondary">
                          {m.goals.total > 0 ? `${m.goals.done}/${m.goals.total} done` : "0 active"}
                        </span>
                      </td>

                      {/* Type Column placed LAST */}
                      <td className="p-3.5 text-right">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-card-subtle border border-border-light text-text-secondary capitalize">
                          {m.employmentCategory.replace("_", "-")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : team.length === 0 ? (
        <div className="p-12 text-center text-xs text-text-tertiary border border-dashed border-border-light rounded-2xl bg-card">
          No team members yet
        </div>
      ) : (
        <div className="p-12 text-center space-y-3 border border-dashed border-border-light rounded-2xl bg-card">
          <p className="text-xs text-text-tertiary">No team members match these filters</p>
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setNeedsAttentionOnly(false);
            }}
            className="px-3.5 py-1.5 rounded-lg bg-black text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

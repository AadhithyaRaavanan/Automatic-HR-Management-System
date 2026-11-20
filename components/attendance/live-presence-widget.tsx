"use client";

import * as React from "react";
import { formatTimeInTimezone, formatDurationMinutes } from "@/lib/date/timezone";
import { Users, Clock, LogIn, LogOut, Search, Radio, Filter, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmployeePresenceLog {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  department: string;
  jobTitle: string;
  status: "active" | "checked_out" | "not_logged_in";
  checkInAt: string | null;
  checkOutAt: string | null;
  totalMinutes: number;
}

interface PresenceData {
  counts: {
    total: number;
    active: number;
    checkedOut: number;
    notLoggedIn: number;
  };
  logs: EmployeePresenceLog[];
}

export function LivePresenceWidget({ userTimezone = "UTC" }: { userTimezone?: string }) {
  const [data, setData] = React.useState<PresenceData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<"ALL" | "active" | "checked_out" | "not_logged_in">("ALL");

  const loadData = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance/live-presence?_t=${Date.now()}`, {
        cache: "no-store",
        headers: {
          "Pragma": "no-cache",
          "Cache-Control": "no-cache",
        },
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setData(json);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
    // Refresh presence data every 45 seconds automatically
    const interval = setInterval(loadData, 45000);
    return () => clearInterval(interval);
  }, [loadData]);

  const filteredLogs = React.useMemo(() => {
    if (!data?.logs || !Array.isArray(data.logs)) return [];
    const query = search.trim().toLowerCase();
    return data.logs.filter((log) => {
      if (!log) return false;
      const matchesFilter = filter === "ALL" || log.status === filter;
      const name = (log.name || "").toLowerCase();
      const dept = (log.department || "").toLowerCase();
      const title = (log.jobTitle || "").toLowerCase();
      const email = (log.email || "").toLowerCase();
      const matchesSearch = !query || name.includes(query) || dept.includes(query) || title.includes(query) || email.includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [data?.logs, filter, search]);

  return (
    <div className="p-5 rounded-2xl bg-card border border-border-light shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-black text-[#B7FF00] flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-text-primary">Live Workforce Presence & Logging</h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#B7FF00] text-black">
                Live
              </span>
              <button
                type="button"
                onClick={loadData}
                className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors cursor-pointer"
                title="Refresh Live Presence"
              >
                <RefreshCw className={cn("w-3 h-3", loading && "animate-spin text-black")} />
              </button>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              Real-time shift login, active session durations, and checkout times across your organization.
            </p>
          </div>
        </div>

        {/* Counter Pills */}
        {data?.counts && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setFilter("ALL")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border",
                filter === "ALL"
                  ? "bg-black text-[#B7FF00] border-black"
                  : "bg-card-subtle text-text-secondary border-border-light hover:text-text-primary"
              )}
            >
              All ({data.counts.total})
            </button>
            <button
              type="button"
              onClick={() => setFilter("active")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border flex items-center gap-1.5",
                filter === "active"
                  ? "bg-[#B7FF00] text-black border-[#B7FF00]"
                  : "bg-card-subtle text-text-secondary border-border-light hover:text-text-primary"
              )}
            >
              <span className="w-2 h-2 rounded-full bg-[#B7FF00] border border-black animate-ping shrink-0" />
              Active ({data.counts.active})
            </button>
            <button
              type="button"
              onClick={() => setFilter("checked_out")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border",
                filter === "checked_out"
                  ? "bg-black text-white border-black"
                  : "bg-card-subtle text-text-secondary border-border-light hover:text-text-primary"
              )}
            >
              Completed ({data.counts.checkedOut})
            </button>
            <button
              type="button"
              onClick={() => setFilter("not_logged_in")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border",
                filter === "not_logged_in"
                  ? "bg-black text-white border-black"
                  : "bg-card-subtle text-text-secondary border-border-light hover:text-text-primary"
              )}
            >
              Not Logged In ({data.counts.notLoggedIn})
            </button>
          </div>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee by name, department, or job title..."
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-black"
          />
        </div>
      </div>

      {/* Table of Employee Logins */}
      <div className="border border-border-light rounded-xl overflow-hidden bg-card">
        {loading ? (
          <div className="p-8 text-center text-xs text-text-tertiary">Loading live presence records...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-text-secondary">
            No employees match the selected criteria.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-card-subtle text-text-secondary font-semibold border-b border-border-light sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-4">Employee</th>
                  <th className="py-2.5 px-4">Department & Role</th>
                  <th className="py-2.5 px-4">Current Status</th>
                  <th className="py-2.5 px-4">Check-In</th>
                  <th className="py-2.5 px-4">Check-Out</th>
                  <th className="py-2.5 px-4 text-right">Logged Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {filteredLogs.map((log) => {
                  return (
                    <tr key={log.id} className="hover:bg-card-subtle/50 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-black text-[#B7FF00] font-bold text-xs flex items-center justify-center shrink-0">
                            {(log.name || log.email || "EM").trim().slice(0, 2).toUpperCase()}
                          </div>
                          <div className="overflow-hidden">
                            <p className="font-bold text-text-primary truncate">{log.name || "Employee"}</p>
                            <p className="text-[11px] text-text-secondary truncate">{log.email || "—"}</p>
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 px-4">
                        <span className="font-medium text-text-primary block">{log.jobTitle || "Team Member"}</span>
                        <span className="text-[11px] text-text-secondary">{log.department || "Company"}</span>
                      </td>

                      <td className="py-2.5 px-4">
                        {log.status === "active" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#B7FF00]/25 text-black border border-[#B7FF00]/60">
                            <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                            Logged In (Online)
                          </span>
                        ) : log.status === "checked_out" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-700 border border-gray-200">
                            <LogOut className="w-3 h-3 text-gray-500" />
                            Completed Shift
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-card-subtle text-text-tertiary border border-border-light">
                            Not Checked In
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-4 font-mono font-medium text-text-primary">
                        {log.checkInAt ? (
                          <span className="inline-flex items-center gap-1">
                            <LogIn className="w-3 h-3 text-[#B7FF00]" />
                            {formatTimeInTimezone(log.checkInAt, userTimezone)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="py-2.5 px-4 font-mono font-medium text-text-secondary">
                        {log.checkOutAt ? (
                          <span className="inline-flex items-center gap-1">
                            <LogOut className="w-3 h-3 text-gray-400" />
                            {formatTimeInTimezone(log.checkOutAt, userTimezone)}
                          </span>
                        ) : log.status === "active" ? (
                          <span className="text-[11px] font-sans font-bold text-black animate-pulse">
                            In Session...
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="py-2.5 px-4 text-right font-mono font-bold text-text-primary">
                        {log.totalMinutes > 0 ? (
                          <span className={cn(log.status === "active" ? "text-black font-extrabold" : "")}>
                            {formatDurationMinutes(log.totalMinutes)}
                          </span>
                        ) : (
                          "0h 00m"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

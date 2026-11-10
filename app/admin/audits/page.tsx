"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/client";
import {
  ScrollText,
  Download,
  Filter,
  Search,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  Calendar,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";

interface AuditEntry {
  id: string;
  created_at: string;
  actor_name: string;
  action: string;
  table_name: string;
  record_id: string;
  old_data: any;
  new_data: any;
}

const mockAudits: AuditEntry[] = [
  {
    id: "aud-001",
    created_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    actor_name: "System Administrator",
    action: "POLICY_UPDATED",
    table_name: "attendance_policies",
    record_id: "00000000-0000-0000-0000-000000000001",
    old_data: { grace_minutes: 10, half_day_minutes: 240, auto_checkout_time: "19:00:00" },
    new_data: { grace_minutes: 20, half_day_minutes: 240, auto_checkout_time: "20:00:00" },
  },
  {
    id: "aud-002",
    created_at: new Date(Date.now() - 1000 * 60 * 65).toISOString(),
    actor_name: "Sarah Jenkins",
    action: "EMPLOYEE_UPDATED",
    table_name: "employees",
    record_id: "00000000-0000-0000-0000-000000000004",
    old_data: { work_mode: "office", timezone: "America/New_York" },
    new_data: { work_mode: "remote", timezone: "Asia/Kolkata" },
  },
  {
    id: "aud-003",
    created_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    actor_name: "System Administrator",
    action: "LOCATION_CREATED",
    table_name: "locations",
    record_id: "00000000-0000-0000-0000-000000000020",
    old_data: null,
    new_data: { name: "Bangalore HQ", code: "BLR-01", timezone: "Asia/Kolkata", working_hours: 480 },
  },
  {
    id: "aud-004",
    created_at: new Date(Date.now() - 1000 * 60 * 320).toISOString(),
    actor_name: "System Administrator",
    action: "MEMBER_DEACTIVATED",
    table_name: "organization_members",
    record_id: "00000000-0000-0000-0000-000000000099",
    old_data: { status: "active" },
    new_data: { status: "suspended" },
  },
];

export default function AuditsAdminPage() {
  const [audits, setAudits] = React.useState<AuditEntry[]>(isDemoModeEnabled() ? mockAudits : []);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [actionFilter, setActionFilter] = React.useState("ALL");

  const supabase = createClient();

  React.useEffect(() => {
    async function loadAudits() {
      try {
        const { data, error } = await supabase
          .from("audit_logs")
          .select("id, created_at, actor_id, action, table_name, record_id, old_data, new_data")
          .order("created_at", { ascending: false })
          .limit(50);
        if (!error && data) {
          setAudits(
            data.map((r: any) => ({
              id: r.id,
              created_at: r.created_at,
              actor_name: r.actor_id || "System",
              action: r.action,
              table_name: r.table_name,
              record_id: r.record_id,
              old_data: r.old_data,
              new_data: r.new_data,
            }))
          );
        }
      } catch {
        if (isDemoModeEnabled()) {
          setAudits(mockAudits);
        }
      }
    }
    loadAudits();
  }, [supabase]);

  const filteredAudits = audits.filter((a) => {
    const matchesAction = actionFilter === "ALL" || a.action === actionFilter;
    const matchesSearch =
      a.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.table_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.record_id && a.record_id.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesAction && matchesSearch;
  });

  const handleExport = (format: "csv" | "xlsx") => {
    toast.success(`Exporting organization audit logs as .${format}...`, {
      description: "Formula injection protection (CWE-1236) enabled on all exported fields.",
    });
    window.open(`/api/admin/audits/export?format=${format}`, "_blank");
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <AppShell primaryActionLabel="Export Logs" onPrimaryAction={() => handleExport("csv")} userRole="admin">
      <div className="space-y-6">
        {/* Header */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary dark:text-white tracking-tight flex items-center gap-2">
              Enterprise Audit Viewer & Compliance
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary dark:text-slate-400 mt-1">
              Tamper-evident system activity log capturing authoritative actor identities, before/after diffs, and sanitization.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExport("csv")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 hover:bg-slate-200 text-xs font-semibold text-text-primary dark:text-white transition-all"
            >
              <FileText className="w-4 h-4 text-brand-purple" />
              CSV Export
            </button>
            <button
              onClick={() => handleExport("xlsx")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-xs font-semibold text-white shadow-sm transition-all"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Excel Export
            </button>
          </div>
        </section>

        {/* Filters Bar */}
        <div className="bg-white dark:bg-slate-900 rounded-[24px] p-4 border border-border-light dark:border-slate-800 shadow-card flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-text-tertiary absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search action, table, or record ID..."
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-xs text-text-primary dark:text-white placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand-purple"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-text-tertiary shrink-0" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-xs font-semibold text-text-primary dark:text-white"
            >
              <option value="ALL">All Actions</option>
              <option value="POLICY_UPDATED">POLICY_UPDATED</option>
              <option value="EMPLOYEE_UPDATED">EMPLOYEE_UPDATED</option>
              <option value="LOCATION_CREATED">LOCATION_CREATED</option>
              <option value="MEMBER_DEACTIVATED">MEMBER_DEACTIVATED</option>
              <option value="SHIFT_CREATED">SHIFT_CREATED</option>
              <option value="MONTH_LOCKED">MONTH_LOCKED</option>
              <option value="MONTH_UNLOCKED">MONTH_UNLOCKED</option>
              <option value="REGULARIZATION_APPROVED">REGULARIZATION_APPROVED</option>
              <option value="REGULARIZATION_REJECTED">REGULARIZATION_REJECTED</option>
              <option value="ATTENDANCE_EXPORTED">ATTENDANCE_EXPORTED</option>
              <option value="LEAVE_APPROVED">LEAVE_APPROVED</option>
            </select>
          </div>
        </div>

        {/* Audits Table */}
        <div className="bg-white dark:bg-slate-900 rounded-[28px] border border-border-light dark:border-slate-800 shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-card-subtle dark:bg-slate-800/50 text-text-secondary dark:text-slate-400 font-semibold border-b border-border-light dark:border-slate-800">
                <tr>
                  <th className="py-3.5 px-5">Timestamp</th>
                  <th className="py-3.5 px-4">Action</th>
                  <th className="py-3.5 px-4">Target Table</th>
                  <th className="py-3.5 px-4">Record ID</th>
                  <th className="py-3.5 px-5 text-right">State Diff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light dark:divide-slate-800">
                {filteredAudits.map((a) => (
                  <React.Fragment key={a.id}>
                    <tr
                      onClick={() => toggleExpand(a.id)}
                      className="cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-4 px-5 whitespace-nowrap text-xs text-text-secondary dark:text-slate-400">
                        <span className="font-semibold text-text-primary dark:text-white block">
                          {new Date(a.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                        <span className="text-[11px] text-text-tertiary">
                          {new Date(a.created_at).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-lg bg-brand-purple/10 text-brand-purple">
                          {a.action}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-xs font-mono text-text-secondary dark:text-slate-300">
                        {a.table_name}
                      </td>
                      <td className="py-4 px-4 text-xs font-mono text-text-tertiary">
                        {a.record_id ? `${a.record_id.slice(0, 8)}...` : "--"}
                      </td>
                      <td className="py-4 px-5 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-purple hover:underline"
                        >
                          {expandedId === a.id ? (
                            <>
                              Hide Diff <ChevronUp className="w-3.5 h-3.5" />
                            </>
                          ) : (
                            <>
                              View Diff <ChevronDown className="w-3.5 h-3.5" />
                            </>
                          )}
                        </button>
                      </td>
                    </tr>

                    {/* Expandable Old vs New Data Diff View */}
                    {expandedId === a.id && (
                      <tr className="bg-card-subtle/50 dark:bg-slate-900/80">
                        <td colSpan={5} className="p-4 sm:p-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 border border-border-light dark:border-slate-700 shadow-sm">
                              <span className="text-xs font-bold uppercase tracking-wider text-status-warning-dot block mb-2">
                                Prior State (old_data)
                              </span>
                              <pre className="text-xs font-mono text-text-secondary dark:text-slate-300 overflow-x-auto p-2 bg-slate-50 dark:bg-slate-950 rounded-xl">
                                {a.old_data ? JSON.stringify(a.old_data, null, 2) : "null (Record Created)"}
                              </pre>
                            </div>

                            <div className="bg-white dark:bg-slate-800/90 rounded-2xl p-4 border border-border-light dark:border-slate-700 shadow-sm">
                              <span className="text-xs font-bold uppercase tracking-wider text-status-success-dot block mb-2">
                                New State (new_data)
                              </span>
                              <pre className="text-xs font-mono text-text-secondary dark:text-slate-300 overflow-x-auto p-2 bg-slate-50 dark:bg-slate-950 rounded-xl">
                                {a.new_data ? JSON.stringify(a.new_data, null, 2) : "null (Record Deleted)"}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}


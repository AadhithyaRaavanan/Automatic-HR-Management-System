"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { FEATURES } from "@/lib/features";
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
import { EmptyState } from "@/components/shared/empty-state";
import { getStoredAudits } from "@/lib/storage/demo-store";

interface AuditEntry {
  id: string;
  created_at: string;
  actor_name: string;
  action: string;
  table_name: string;
  record_id: string;
  old_data?: any;
  new_data?: any;
}

function AuditsAdminPageContent() {
  const [audits, setAudits] = React.useState<AuditEntry[]>(() => getStoredAudits());
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [actionFilter, setActionFilter] = React.useState("ALL");

  const supabase = React.useMemo(() => createClient(), []);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    async function loadAudits() {
      setIsLoading(true);
      const stored = getStoredAudits();
      try {
        const { data, error } = await supabase
          .from("audit_logs")
          .select("id, created_at, actor_id, action, table_name, record_id, old_data, new_data")
          .order("created_at", { ascending: false })
          .limit(100);
        if (!error && data && data.length > 0 && active) {
          const merged = [...stored];
          for (const d of data as any[]) {
            if (!merged.some((m) => m.id === d.id)) {
              merged.push({
                id: d.id,
                created_at: d.created_at,
                actor_name: d.actor_id || "System",
                action: d.action,
                table_name: d.table_name,
                record_id: d.record_id,
                old_data: d.old_data,
                new_data: d.new_data,
              });
            }
          }
          setAudits(merged);
        } else if (active) {
          setAudits(stored);
        }
      } catch {
        if (active) setAudits(stored);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    loadAudits();

    const handleStorageChange = () => setAudits(getStoredAudits());
    window.addEventListener("remotehr_storage_change", handleStorageChange);
    return () => {
      active = false;
      window.removeEventListener("remotehr_storage_change", handleStorageChange);
    };
  }, [supabase]);

  const availableActions = React.useMemo(() => {
    const known = new Set<string>([
      "POLICY_UPDATED",
      "EMPLOYEE_UPDATED",
      "LOCATION_CREATED",
      "MEMBER_DEACTIVATED",
      "SHIFT_CREATED",
      "ATTENDANCE_CORRECTED",
      "MONTH_LOCKED",
      "MONTH_UNLOCKED",
      "REGULARIZATION_APPROVED",
      "REGULARIZATION_REJECTED",
      "ATTENDANCE_EXPORTED",
      "LEAVE_APPROVED",
      "HOLIDAY_CREATED",
      "HOLIDAY_IMPORTED",
      "DELEGATION_CREATED",
      "DELEGATION_REVOKED",
      "RETENTION_POLICY_UPDATED",
      "RETENTION_ARCHIVE_CREATED",
      "RETENTION_CLEANUP_EXECUTED",
      "PROJECT_CREATED",
      "TASK_CREATED",
      "TASK_ASSIGNED",
      "TASK_STATUS_UPDATED",
      "TASK_COMPLETED",
      "TASK_CANCELLED",
      "TASK_COMMENT_ADDED",
      "TASK_TIME_LOGGED",
      "KPI_DEFINITION_CREATED",
      "KPI_DEFINITION_UPDATED",
      "KPI_DEFINITION_DELETED",
      "KPI_PERIOD_CREATED",
      "KPI_SCORES_COMPUTED",
      "KPI_PERIOD_CLOSED",
      "KPI_REVIEW_SUBMITTED",
      "KPI_EXPORTED",
    ]);
    audits.forEach((a) => known.add(a.action));
    return Array.from(known).sort();
  }, [audits]);

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
    <AppShell primaryActionLabel="Export Logs" onPrimaryAction={() => handleExport("csv")}>
      <div className="space-y-6">
        {/* Header */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-black tracking-tight flex items-center gap-2">
              Enterprise Audit Viewer & Compliance
            </h1>
            <p className="text-xs sm:text-sm text-[#808080] mt-1">
              Tamper-evident system activity log capturing authoritative actor identities, before/after diffs, and sanitization.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExport("csv")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-semibold text-black transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-black" />
              CSV Export
            </button>
            <button
              onClick={() => handleExport("xlsx")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-xs font-semibold text-white shadow-xs transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Excel Export
            </button>
          </div>
        </section>

        {/* Filters Bar */}
        <div className="bg-white rounded-[14px] p-4 border border-[#E6E6E6] shadow-none flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-[#808080] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search action, table, or record ID..."
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-xs text-black placeholder:text-[#808080] focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-[#808080] shrink-0" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none focus:ring-2 focus:ring-black"
            >
              <option value="ALL">All Actions</option>
              {availableActions.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Audits Table */}
        <div className="bg-white rounded-[14px] border border-[#E6E6E6] shadow-none overflow-hidden">
          {filteredAudits.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="w-6 h-6" />}
              title={isLoading ? "Loading audit logs..." : "No matching audit records"}
              description={
                isLoading
                  ? "Fetching tamper-evident system activity from the database..."
                  : "Adjust your search or action filter, or wait for new privileged events to be recorded."
              }
              className="border-none rounded-none shadow-none"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F5F5F5] text-[#808080] font-semibold border-b border-[#E6E6E6]">
                  <tr>
                    <th className="py-3 px-5 text-xs">Timestamp</th>
                    <th className="py-3 px-4 text-xs">Action</th>
                    <th className="py-3 px-4 text-xs">Target Table</th>
                    <th className="py-3 px-4 text-xs">Record ID</th>
                    <th className="py-3 px-5 text-right text-xs">State Diff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E6E6]">
                  {filteredAudits.map((a) => (
                  <React.Fragment key={a.id}>
                    <tr
                      onClick={() => toggleExpand(a.id)}
                      className="cursor-pointer hover:bg-[#F5F5F5]/60 transition-colors"
                    >
                      <td className="py-3.5 px-5 whitespace-nowrap text-xs text-[#808080]">
                        <span className="font-semibold text-black block">
                          {new Date(a.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                        <span className="text-[11px] text-[#808080]">
                          {new Date(a.created_at).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-xs font-medium px-2 py-0.5 rounded bg-[#F5F5F5] border border-[#E6E6E6] text-black">
                          {a.action}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-mono text-black">
                        {a.table_name}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-mono text-[#808080]">
                        {a.record_id ? `${a.record_id.slice(0, 8)}...` : "--"}
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-black hover:underline"
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
                      <tr className="bg-[#F5F5F5]/40">
                        <td colSpan={5} className="p-4 sm:p-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white rounded-lg p-4 border border-[#E6E6E6] shadow-none">
                              <span className="text-xs font-semibold text-amber-700 block mb-2">
                                Prior State (old_data)
                              </span>
                              <pre className="text-xs font-mono text-black overflow-x-auto p-2 bg-[#F5F5F5] rounded border border-[#E6E6E6]">
                                {a.old_data ? JSON.stringify(a.old_data, null, 2) : "null (Record Created)"}
                              </pre>
                            </div>

                            <div className="bg-white rounded-lg p-4 border border-[#E6E6E6] shadow-none">
                              <span className="text-xs font-semibold text-black block mb-2">
                                New State (new_data)
                              </span>
                              <pre className="text-xs font-mono text-black overflow-x-auto p-2 bg-[#F5F5F5] rounded border border-[#E6E6E6]">
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
          )}
        </div>
      </div>
    </AppShell>
  );
}

export default function AuditsAdminPage() {
  if (!FEATURES.AUDITS) {
    if (typeof window !== "undefined") {
      window.location.href = "/dashboard";
    }
    return null;
  }
  return <AuditsAdminPageContent />;
}


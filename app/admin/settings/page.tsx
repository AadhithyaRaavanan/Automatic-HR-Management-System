"use client";

import * as React from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/client";
import {
  ShieldCheck,
  Building2,
  Save,
  HardDrive,
  Database,
  Archive,
  Play,
  Download,
  RefreshCw,
  ListTodo,
} from "lucide-react";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";

interface TableHealthMetric {
  table_name: string;
  row_count: number;
  estimated_bytes: number;
}

interface OrgSystemHealth {
  organization_id: string;
  scope: string;
  total_rows: number;
  estimated_db_bytes: number;
  archive_storage_bytes: number;
  tables: TableHealthMetric[];
}

interface RetentionPreview {
  dry_run: boolean;
  batch_size: number;
  eligible: {
    attendance_sessions_locked: number;
    attendance_sessions_archived_ready: number;
    attendance_sessions_needs_archive: number;
    attendance_sessions_unlocked_skipped: number;
    audit_logs: number;
    notifications_read: number;
    notifications_unread_skipped: number;
  };
  deleted?: {
    attendance_sessions: number;
    audit_logs: number;
    notifications: number;
  };
}

interface RetentionArchiveRow {
  id: string;
  archive_month: string;
  period_start: string;
  period_end: string;
  storage_path: string;
  row_count: number;
  byte_size: number;
  checksum_sha256: string;
  created_at: string;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function OrganizationSettingsAdminPage() {
  const [activeTab, setActiveTab] = React.useState<"profile" | "policy" | "health">("profile");

  // Org Settings State
  const [orgName, setOrgName] = React.useState("Zenxea");
  const [orgTimezone, setOrgTimezone] = React.useState("UTC");
  const [orgWorkMode, setOrgWorkMode] = React.useState("hybrid");
  const [isSavingOrg, setIsSavingOrg] = React.useState(false);

  // Attendance Policy State
  const [graceMinutes, setGraceMinutes] = React.useState(15);
  const [halfDayMinutes, setHalfDayMinutes] = React.useState(240);
  const [autoCheckoutTime, setAutoCheckoutTime] = React.useState("20:00");
  const [isSavingPolicy, setIsSavingPolicy] = React.useState(false);

  // Retention Policy & System Health State
  const [sessionsMonths, setSessionsMonths] = React.useState(18);
  const [auditLogsMonths, setAuditLogsMonths] = React.useState(24);
  const [notificationsDays, setNotificationsDays] = React.useState(90);
  const [isSavingRetention, setIsSavingRetention] = React.useState(false);
  const [healthMetrics, setHealthMetrics] = React.useState<OrgSystemHealth | null>(null);
  const [retentionPreview, setRetentionPreview] = React.useState<RetentionPreview | null>(null);
  const [archives, setArchives] = React.useState<RetentionArchiveRow[]>([]);
  const [isLoadingHealth, setIsLoadingHealth] = React.useState(false);
  const [isRunningDryRun, setIsRunningDryRun] = React.useState(false);
  const [isRunningCleanup, setIsRunningCleanup] = React.useState(false);
  const [downloadingArchiveId, setDownloadingArchiveId] = React.useState<string | null>(null);

  const supabase = React.useMemo(() => createClient(), []);

  const loadHealthAndRetention = React.useCallback(async () => {
    setIsLoadingHealth(true);
    try {
      const [
        { data: retPolicy },
        { data: healthData, error: healthError },
        { data: previewData },
        { data: archiveRows },
      ] = await Promise.all([
        (supabase as any)
          .from("retention_policies")
          .select(
            "sessions_archive_after_months, audit_logs_delete_after_months, read_notifications_delete_after_days"
          )
          .limit(1)
          .maybeSingle(),
        (supabase.rpc as any)("get_org_system_health"),
        (supabase.rpc as any)("get_org_retention_preview"),
        (supabase as any)
          .from("retention_archives")
          .select("id, archive_month, period_start, period_end, storage_path, row_count, byte_size, checksum_sha256, created_at")
          .order("archive_month", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(24),
      ]);

      if (retPolicy) {
        if (retPolicy.sessions_archive_after_months !== undefined) {
          setSessionsMonths(Number(retPolicy.sessions_archive_after_months));
        }
        if (retPolicy.audit_logs_delete_after_months !== undefined) {
          setAuditLogsMonths(Number(retPolicy.audit_logs_delete_after_months));
        }
        if (retPolicy.read_notifications_delete_after_days !== undefined) {
          setNotificationsDays(Number(retPolicy.read_notifications_delete_after_days));
        }
      }

      if (!healthError && healthData) {
        setHealthMetrics(healthData as OrgSystemHealth);
      }

      if (previewData) {
        setRetentionPreview(previewData as RetentionPreview);
      }

      if (Array.isArray(archiveRows)) {
        setArchives(archiveRows as RetentionArchiveRow[]);
      }
    } finally {
      setIsLoadingHealth(false);
    }
  }, [supabase]);

  React.useEffect(() => {
    let active = true;
    async function loadSettings() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) return;

      const [{ data: org }, { data: policy }] = await Promise.all([
        (supabase as any)
          .from("organizations")
          .select("name, timezone, work_mode")
          .limit(1)
          .maybeSingle(),
        (supabase as any)
          .from("attendance_policies")
          .select("grace_minutes, half_day_minutes, auto_checkout_time")
          .limit(1)
          .maybeSingle(),
      ]);

      if (!active) return;
      if (org) {
        if (org.name) setOrgName(org.name);
        if (org.timezone) setOrgTimezone(org.timezone);
        if (org.work_mode) setOrgWorkMode(org.work_mode);
      }
      if (policy) {
        if (policy.grace_minutes !== undefined) setGraceMinutes(Number(policy.grace_minutes));
        if (policy.half_day_minutes !== undefined) setHalfDayMinutes(Number(policy.half_day_minutes));
        if (policy.auto_checkout_time) setAutoCheckoutTime(String(policy.auto_checkout_time).slice(0, 5));
      }

      await loadHealthAndRetention();
    }
    loadSettings();
    return () => {
      active = false;
    };
  }, [supabase, loadHealthAndRetention]);

  const handleSaveOrgSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemoModeEnabled()) {
      toast.success("Organization profile updated with full audit diff! (demo session)");
      return;
    }
    setIsSavingOrg(true);
    try {
      const { error } = await (supabase.rpc as any)("admin_update_organization_settings", {
        p_name: orgName,
        p_timezone: orgTimezone,
        p_work_mode: orgWorkMode,
      });
      if (error) throw error;
      toast.success("Organization profile updated with full audit diff!");
    } catch (err: any) {
      toast.error(err?.message || "Failed to update organization settings");
    } finally {
      setIsSavingOrg(false);
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDemoModeEnabled()) {
      toast.success("Attendance policy updated with full audit diff! (demo session)");
      return;
    }
    setIsSavingPolicy(true);
    try {
      const { error } = await (supabase.rpc as any)("admin_update_attendance_policy", {
        p_grace_minutes: graceMinutes,
        p_half_day_minutes: halfDayMinutes,
        p_auto_checkout_time: `${autoCheckoutTime}:00`,
      });
      if (error) throw error;
      toast.success("Attendance policy updated with full audit diff!");
    } catch (err: any) {
      toast.error(err?.message || "Failed to update attendance policy");
    } finally {
      setIsSavingPolicy(false);
    }
  };

  const handleSaveRetentionPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sessionsMonths < 18 || auditLogsMonths < 24 || notificationsDays < 90) {
      toast.error("Minimum floors apply: 18 months for sessions, 24 months for audit logs, and 90 days for read notifications.");
      return;
    }

    if (isDemoModeEnabled()) {
      toast.success("Retention policy saved and audited! (demo session)");
      return;
    }

    setIsSavingRetention(true);
    try {
      const { error } = await (supabase.rpc as any)("admin_update_retention_policy", {
        p_sessions_months: sessionsMonths,
        p_audit_logs_months: auditLogsMonths,
        p_notifications_days: notificationsDays,
      });
      if (error) throw error;
      toast.success("Retention policy saved and audited!");
      await loadHealthAndRetention();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update retention settings");
    } finally {
      setIsSavingRetention(false);
    }
  };

  const handleDryRunPreview = async () => {
    if (isDemoModeEnabled()) {
      toast.success("Dry-run retention preview refreshed (zero rows modified).");
      return;
    }
    setIsRunningDryRun(true);
    try {
      const res = await fetch("/api/admin/retention/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Dry-run preview failed");
      setRetentionPreview(json.cleanup as RetentionPreview);
      toast.success("Dry-run retention preview refreshed (zero rows modified).");
    } catch (err: any) {
      toast.error(err?.message || "Failed to run retention dry-run");
    } finally {
      setIsRunningDryRun(false);
    }
  };

  const handleRunArchiveAndCleanup = async () => {
    if (isDemoModeEnabled()) {
      toast.success("Archive & cleanup complete (demo session): 0 sessions, 0 audit logs purged.");
      return;
    }
    setIsRunningCleanup(true);
    try {
      const res = await fetch("/api/admin/retention/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Retention archival & cleanup failed");
      const deleted = json.cleanup?.deleted || {};
      const archCount = Array.isArray(json.archivesCreated) ? json.archivesCreated.length : 0;
      toast.success(
        `Archive & cleanup complete: ${archCount} monthly bundle(s) exported, ${deleted.attendance_sessions ?? 0} sessions, ${deleted.audit_logs ?? 0} audit logs, ${deleted.notifications ?? 0} notifications purged.`
      );
      await loadHealthAndRetention();
    } catch (err: any) {
      toast.error(err?.message || "Failed to execute retention archival & cleanup");
    } finally {
      setIsRunningCleanup(false);
    }
  };

  const handleDownloadArchive = async (archiveId: string) => {
    setDownloadingArchiveId(archiveId);
    try {
      const res = await fetch(`/api/admin/retention/archive-url?id=${encodeURIComponent(archiveId)}`);
      const json = await res.json();
      if (!res.ok || !json?.signedUrl) {
        throw new Error(json?.error || "Failed to generate archive download URL");
      }
      window.open(json.signedUrl, "_blank");
    } catch (err: any) {
      toast.error(err?.message || "Could not download archive");
    } finally {
      setDownloadingArchiveId(null);
    }
  };

  return (
    <AppShell primaryActionLabel="Settings Saved">
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <section className="pt-1 pb-3">
          <h1 className="text-2xl md:text-3xl font-bold text-black tracking-tight flex items-center gap-2">
            Organization governance & policies
          </h1>
          <p className="text-xs sm:text-sm text-[#808080] mt-1">
            Configure organization defaults, company-wide work modes, retention floors, and storage health.
          </p>
        </section>

        {/* Tab Switcher */}
        <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-[#E6E6E6] border border-[#E6E6E6] w-fit">
          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "profile"
                ? "bg-white text-black shadow-xs"
                : "text-[#808080] hover:text-black"
            }`}
          >
            Organization profile
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("policy")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "policy"
                ? "bg-white text-black shadow-xs"
                : "text-[#808080] hover:text-black"
            }`}
          >
            Attendance & work policy
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("health")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all inline-flex items-center gap-1.5 cursor-pointer ${
              activeTab === "health"
                ? "bg-white text-black shadow-xs"
                : "text-[#808080] hover:text-black"
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            System health & retention
          </button>
          <Link
            href="/admin/task-types"
            className="px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all inline-flex items-center gap-1.5 text-[#808080] hover:text-black hover:bg-white/60 cursor-pointer"
          >
            <ListTodo className="w-3.5 h-3.5" />
            Task types & presets
          </Link>
        </div>

        {/* Tab 1: Org Profile */}
        {activeTab === "profile" && (
          <div className="bg-white rounded-[14px] p-6 sm:p-8 border border-[#E6E6E6] shadow-none space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#E6E6E6] text-black flex items-center justify-center">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-black">
                  Corporate profile settings
                </h2>
                <p className="text-xs text-[#808080]">
                  Tenant status and identity are immutable. Profile modifications generate structured audit logs.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveOrgSettings} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-[#4D4D4D] block mb-1">
                  Legal organization name
                </label>
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-sm font-medium text-black focus:outline-none focus:ring-1 focus:ring-black"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-[#4D4D4D] block mb-1">
                    Primary default timezone
                  </label>
                  <input
                    type="text"
                    required
                    value={orgTimezone}
                    onChange={(e) => setOrgTimezone(e.target.value)}
                    placeholder="UTC"
                    className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-sm font-medium text-black focus:outline-none focus:ring-1 focus:ring-black"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-[#4D4D4D] block mb-1">
                    Default work mode
                  </label>
                  <select
                    value={orgWorkMode}
                    onChange={(e) => setOrgWorkMode(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-sm font-medium text-black focus:outline-none focus:ring-1 focus:ring-black"
                  >
                    <option value="remote">Remote-First</option>
                    <option value="office">Office-Based</option>
                    <option value="hybrid">Hybrid Workforce</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingOrg}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold shadow-none transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {isSavingOrg ? "Saving..." : "Save profile settings"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tab 2: Attendance Policy */}
        {activeTab === "policy" && (
          <div className="bg-white rounded-[14px] p-6 sm:p-8 border border-[#E6E6E6] shadow-none space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#E6E6E6] text-black flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-black">
                  Attendance rules & thresholds
                </h2>
                <p className="text-xs text-[#808080]">
                  Rules applied during daily attendance evaluation and automated nightly cron runs.
                </p>
              </div>
            </div>

            <form onSubmit={handleSavePolicy} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-[#4D4D4D] block mb-1">
                    Check-in grace period (minutes)
                  </label>
                  <input
                    type="number"
                    required
                    value={graceMinutes}
                    onChange={(e) => setGraceMinutes(parseInt(e.target.value) || 15)}
                    className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-sm font-medium text-black focus:outline-none focus:ring-1 focus:ring-black"
                  />
                  <span className="text-[11px] text-[#808080] mt-1 block">
                    Punches within this window after shift start will not mark the day late.
                  </span>
                </div>

                <div>
                  <label className="text-xs font-medium text-[#4D4D4D] block mb-1">
                    Half-day threshold (minutes)
                  </label>
                  <input
                    type="number"
                    required
                    value={halfDayMinutes}
                    onChange={(e) => setHalfDayMinutes(parseInt(e.target.value) || 240)}
                    className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-sm font-medium text-black focus:outline-none focus:ring-1 focus:ring-black"
                  />
                  <span className="text-[11px] text-[#808080] mt-1 block">
                    Total logged working minutes required to qualify for at least a half-day credit.
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-[#4D4D4D] block mb-1">
                  Automatic nightly checkout time
                </label>
                <input
                  type="time"
                  required
                  value={autoCheckoutTime}
                  onChange={(e) => setAutoCheckoutTime(e.target.value)}
                  className="w-full sm:w-1/2 px-3.5 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-sm font-medium text-black focus:outline-none focus:ring-1 focus:ring-black"
                />
                <span className="text-[11px] text-[#808080] mt-1 block">
                  Unclosed sessions will be terminated automatically by the scheduled maintenance job.
                </span>
              </div>

              <div className="pt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingPolicy}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold shadow-none transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {isSavingPolicy ? "Saving..." : "Save attendance policy"}
                </button>
              </div>
            </form>

            {/* Punch Channels & Verification Governance */}
            <div className="pt-6 border-t border-[#E6E6E6] space-y-4">
              <div>
                <h3 className="text-sm font-bold text-black">
                  Punch channels & verification governance
                </h3>
                <p className="text-xs text-[#808080] mt-0.5">
                  Configure permitted authentication mechanisms for workforce check-ins.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="p-4 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-black">Manual Web Check-In</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#A6F000]/20 text-black border border-[#A6F000]/40">Active</span>
                    </div>
                    <p className="text-[11px] text-[#4D4D4D] mt-1">
                      Authenticated self-service web punches with pre-shift 5-min gate and persistent timer.
                    </p>
                  </div>
                  <input type="checkbox" checked disabled className="rounded text-black cursor-not-allowed mt-1" />
                </div>

                <div className="p-4 rounded-xl bg-[#F5F5F5]/60 border border-[#E6E6E6] flex items-start justify-between opacity-80">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#4D4D4D]">Geofence GPS Punch</span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700">In development</span>
                    </div>
                    <p className="text-[11px] text-[#808080] mt-1">
                      Restricts punches to physical office boundary coordinates.
                    </p>
                  </div>
                  <input type="checkbox" disabled className="rounded cursor-not-allowed opacity-50 mt-1" />
                </div>

                <div className="p-4 rounded-xl bg-[#F5F5F5]/60 border border-[#E6E6E6] flex items-start justify-between opacity-80">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#4D4D4D]">Office IP Allowlist</span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700">In development</span>
                    </div>
                    <p className="text-[11px] text-[#808080] mt-1">
                      Requires check-in requests to originate from registered corporate subnet CIDRs.
                    </p>
                  </div>
                  <input type="checkbox" disabled className="rounded cursor-not-allowed opacity-50 mt-1" />
                </div>

                <div className="p-4 rounded-xl bg-[#F5F5F5]/60 border border-[#E6E6E6] flex items-start justify-between opacity-80">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#4D4D4D]">Rotating QR & Kiosk Mode</span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700">In development</span>
                    </div>
                    <p className="text-[11px] text-[#808080] mt-1">
                      Shared tablet kiosk scanner with time-expiring rolling QR code tokens.
                    </p>
                  </div>
                  <input type="checkbox" disabled className="rounded cursor-not-allowed opacity-50 mt-1" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: System Health & Retention */}
        {activeTab === "health" && (
          <div className="space-y-6">
            {/* Organization System Health Card */}
            <div className="bg-white rounded-[14px] p-6 sm:p-8 border border-[#E6E6E6] shadow-none space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#E6E6E6] text-black flex items-center justify-center">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-black">
                      Organization storage footprint
                    </h2>
                    <p className="text-xs text-[#808080]">
                      Scoped strictly to your organization rows and archives.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => loadHealthAndRetention()}
                  disabled={isLoadingHealth}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-medium text-black hover:bg-[#F5F5F5] transition-colors disabled:opacity-50 cursor-pointer w-fit"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHealth ? "animate-spin" : ""}`} />
                  Refresh metrics
                </button>
              </div>

              {healthMetrics ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-xl bg-[#F5F5F5] p-4 border border-[#E6E6E6]">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-[#808080]">
                        Organization row count
                      </span>
                      <div className="text-2xl font-bold text-black mt-1 tabular-nums">
                        {healthMetrics.total_rows.toLocaleString()}
                      </div>
                      <span className="text-[11px] text-[#808080]">Across tenant tables</span>
                    </div>

                    <div className="rounded-xl bg-[#F5F5F5] p-4 border border-[#E6E6E6]">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-[#808080]">
                        Approx. organization storage
                      </span>
                      <div className="text-2xl font-bold text-black mt-1 tabular-nums">
                        {formatBytes(healthMetrics.estimated_db_bytes)}
                      </div>
                      <span className="text-[11px] text-[#808080]">Live tenant tuples & indexes</span>
                    </div>

                    <div className="rounded-xl bg-[#F5F5F5] p-4 border border-[#E6E6E6]">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-[#808080]">
                        Compressed archive storage
                      </span>
                      <div className="text-2xl font-bold text-black mt-1 tabular-nums">
                        {formatBytes(healthMetrics.archive_storage_bytes)}
                      </div>
                      <span className="text-[11px] text-[#808080]">
                        {archives.length} monthly .json.gz bundle{archives.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                    {(healthMetrics.tables || []).map((t) => (
                      <div
                        key={t.table_name}
                        className="rounded-lg px-3.5 py-2.5 bg-[#F5F5F5] border border-[#E6E6E6]"
                      >
                        <div className="text-[11px] font-medium text-[#808080] truncate">
                          {t.table_name}
                        </div>
                        <div className="flex items-baseline justify-between gap-2 mt-1">
                          <span className="text-sm font-bold text-black tabular-nums">
                            {Number(t.row_count).toLocaleString()}
                          </span>
                          <span className="text-[10px] font-medium text-[#808080] tabular-nums">
                            {formatBytes(Number(t.estimated_bytes))}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-xs text-[#808080] py-4">
                  Loading organization health metrics...
                </div>
              )}
            </div>

            {/* Retention Policy Configuration & Floor Controls */}
            <div className="bg-white rounded-[14px] p-6 sm:p-8 border border-[#E6E6E6] shadow-none space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#E6E6E6] text-black flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-black">
                    Retention policy & legal floors
                  </h2>
                  <p className="text-xs text-[#808080]">
                    Weekly cleanup runs in 500-row batches via pg_cron. Attendance sessions require locked days and storage archival before deletion.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSaveRetentionPolicy} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label
                      htmlFor="retention-sessions-months"
                      className="text-xs font-medium text-[#4D4D4D] block mb-1"
                    >
                      Locked sessions retention (months, min 18)
                    </label>
                    <input
                      id="retention-sessions-months"
                      type="number"
                      min={18}
                      max={120}
                      required
                      value={sessionsMonths}
                      onChange={(e) => setSessionsMonths(Number(e.target.value) || 18)}
                      className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-sm font-medium text-black focus:outline-none focus:ring-1 focus:ring-black"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="retention-audits-months"
                      className="text-xs font-medium text-[#4D4D4D] block mb-1"
                    >
                      Audit logs retention (months, min 24)
                    </label>
                    <input
                      id="retention-audits-months"
                      type="number"
                      min={24}
                      max={120}
                      required
                      value={auditLogsMonths}
                      onChange={(e) => setAuditLogsMonths(Number(e.target.value) || 24)}
                      className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-sm font-medium text-black focus:outline-none focus:ring-1 focus:ring-black"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="retention-notifications-days"
                      className="text-xs font-medium text-[#4D4D4D] block mb-1"
                    >
                      Read notifications retention (days, min 90)
                    </label>
                    <input
                      id="retention-notifications-days"
                      type="number"
                      min={90}
                      max={3650}
                      required
                      value={notificationsDays}
                      onChange={(e) => setNotificationsDays(Number(e.target.value) || 90)}
                      className="w-full px-3.5 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-sm font-medium text-black focus:outline-none focus:ring-1 focus:ring-black"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSavingRetention}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold shadow-none transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingRetention ? "Saving..." : "Save retention policy"}
                  </button>
                </div>
              </form>
            </div>

            {/* Dry-Run Preview & Export-Before-Delete Cleanup */}
            <div className="bg-white rounded-[14px] p-6 sm:p-8 border border-[#E6E6E6] shadow-none space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#E6E6E6] text-black flex items-center justify-center">
                    <Archive className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-black">
                      Dry-run inspection & archival cleanup
                    </h2>
                    <p className="text-xs text-[#808080]">
                      Preview eligible rows or export monthly locked attendance sessions (.json.gz) to private Storage before purging.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleDryRunPreview}
                    disabled={isRunningDryRun || isRunningCleanup}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs font-medium text-black hover:bg-[#F5F5F5] transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {isRunningDryRun ? "Previewing..." : "Run dry-run preview"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRunArchiveAndCleanup}
                    disabled={isRunningCleanup || isRunningDryRun}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold shadow-none transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    {isRunningCleanup ? "Archiving & cleaning..." : "Archive & run cleanup"}
                  </button>
                </div>
              </div>

              {retentionPreview && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl p-4 bg-[#F5F5F5] border border-[#E6E6E6]">
                    <div className="text-[11px] font-medium uppercase text-[#808080]">
                      Locked sessions eligible
                    </div>
                    <div className="text-xl font-bold text-black mt-1 tabular-nums">
                      {retentionPreview.eligible.attendance_sessions_locked}
                    </div>
                    <div className="text-[11px] text-[#808080] mt-1">
                      {retentionPreview.eligible.attendance_sessions_needs_archive} pending .json.gz export ·{" "}
                      {retentionPreview.eligible.attendance_sessions_unlocked_skipped} unlocked protected
                    </div>
                  </div>

                  <div className="rounded-xl p-4 bg-[#F5F5F5] border border-[#E6E6E6]">
                    <div className="text-[11px] font-medium uppercase text-[#808080]">
                      Audit logs eligible
                    </div>
                    <div className="text-xl font-bold text-black mt-1 tabular-nums">
                      {retentionPreview.eligible.audit_logs}
                    </div>
                    <div className="text-[11px] text-[#808080] mt-1">
                      Processed in 500-row batches
                    </div>
                  </div>

                  <div className="rounded-xl p-4 bg-[#F5F5F5] border border-[#E6E6E6]">
                    <div className="text-[11px] font-medium uppercase text-[#808080]">
                      Read notifications eligible
                    </div>
                    <div className="text-xl font-bold text-black mt-1 tabular-nums">
                      {retentionPreview.eligible.notifications_read}
                    </div>
                    <div className="text-[11px] text-[#808080] mt-1">
                      {retentionPreview.eligible.notifications_unread_skipped} unread notifications preserved
                    </div>
                  </div>
                </div>
              )}

              {/* Monthly Archives Table / Empty State */}
              <div className="pt-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#808080] mb-3">
                  Monthly compressed storage archives (.json.gz)
                </h3>
                {archives.length === 0 ? (
                  <EmptyState
                    icon={<Archive className="w-5 h-5 text-[#808080]" />}
                    title="No archived monthly bundles yet"
                    description="When locked attendance sessions age past your retention window, running Archive & Cleanup exports compressed monthly JSON bundles here before purging rows."
                  />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-[#E6E6E6]">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#F5F5F5] text-[#808080] border-b border-[#E6E6E6]">
                          <th className="py-2.5 px-3 font-semibold">Month</th>
                          <th className="py-2.5 px-3 font-semibold">Period</th>
                          <th className="py-2.5 px-3 font-semibold">Sessions</th>
                          <th className="py-2.5 px-3 font-semibold">Size (.gz)</th>
                          <th className="py-2.5 px-3 font-semibold">SHA-256</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Download</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6E6E6]">
                        {archives.map((arch) => (
                          <tr key={arch.id} className="hover:bg-[#F5F5F5]/60">
                            <td className="py-2.5 px-3 font-semibold text-black">
                              {arch.archive_month}
                            </td>
                            <td className="py-2.5 px-3 text-[#4D4D4D]">
                              {arch.period_start} → {arch.period_end}
                            </td>
                            <td className="py-2.5 px-3 font-medium tabular-nums">{arch.row_count}</td>
                            <td className="py-2.5 px-3 tabular-nums text-[#4D4D4D]">{formatBytes(arch.byte_size)}</td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-[#808080]">
                              {arch.checksum_sha256.slice(0, 12)}…
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleDownloadArchive(arch.id)}
                                disabled={downloadingArchiveId === arch.id}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black text-white hover:bg-[#1A1A1A] font-medium transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                <Download className="w-3 h-3" />
                                {downloadingArchiveId === arch.id ? "Signing..." : "Download"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

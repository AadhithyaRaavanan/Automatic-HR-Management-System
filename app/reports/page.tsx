
"use client";

import * as React from "react";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import { StatCard } from "@/features/attendance/components/stat-card";
import { StatusPill } from "@/components/shared/status-pill";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/client";
import { localDateTimeToUtcIso, formatTimeInTimezone } from "@/lib/date/timezone";
import { AttendanceDayStatus } from "@/types/database.types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Download,
  Search,
  TrendingDown,
  TrendingUp,
  Clock,
  Users,
  Edit3,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  CalendarCheck2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AttendanceRecordRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeTimezone: string;
  department: string;
  workDate: string;
  status: AttendanceDayStatus;
  totalMinutes: number;
  isLate: boolean;
  locked: boolean;
}

interface EmployeeOption {
  id: string;
  full_name: string;
  timezone: string;
  department: string;
}

interface MonthCloseChecklist {
  year: number;
  month: number;
  period_start: string;
  period_end: string;
  open_sessions_count: number;
  pending_regularizations_count: number;
  pending_leaves_count: number;
  locked_days_count: number;
  unlocked_days_count: number;
  total_days_count: number;
  is_month_locked: boolean;
  ready_to_lock: boolean;
}

interface CorrectionSessionDraft {
  checkInTime: string;
  checkOutTime: string;
  note: string;
}

function ReportsPageContent() {
  const { userId, userRole } = useAppSession();
  const isAdmin = userRole === "admin";
  const supabase = React.useMemo(() => createClient(), []);
  const [mounted, setMounted] = React.useState(false);

  const now = new Date();
  const [selectedYear, setSelectedYear] = React.useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = React.useState<number>(now.getMonth() + 1);

  const [records, setRecords] = React.useState<AttendanceRecordRow[]>([]);
  const [employees, setEmployees] = React.useState<EmployeeOption[]>([]);
  const [departments, setDepartments] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedDept, setSelectedDept] = React.useState("All");

  // Month-End Close checklist state
  const [checklist, setChecklist] = React.useState<MonthCloseChecklist | null>(null);
  const [checklistLoading, setChecklistLoading] = React.useState(false);
  const [lockingMonth, setLockingMonth] = React.useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = React.useState(false);
  const [unlockReason, setUnlockReason] = React.useState("");
  const [unlockingMonth, setUnlockingMonth] = React.useState(false);

  // HR Attendance Correction Modal state
  const [correctModalOpen, setCorrectModalOpen] = React.useState(false);
  const [corrEmployeeId, setCorrEmployeeId] = React.useState("");
  const [corrDate, setCorrDate] = React.useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  );
  const [corrReason, setCorrReason] = React.useState("");
  const [corrSessions, setCorrSessions] = React.useState<CorrectionSessionDraft[]>([
    { checkInTime: "09:30", checkOutTime: "18:30", note: "Corrected punch" },
  ]);
  const [submittingCorrection, setSubmittingCorrection] = React.useState(false);

  const periodRange = React.useMemo(() => {
    const start = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
    const end = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return { start, end };
  }, [selectedYear, selectedMonth]);

  const loadReportsData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [daysRes, empsRes] = await Promise.all([
        (supabase as any)
          .from("attendance_days")
          .select(
            "employee_id, work_date, status, total_minutes, is_late, locked, employees:employee_id(full_name, timezone, departments:department_id(name))"
          )
          .gte("work_date", periodRange.start)
          .lte("work_date", periodRange.end)
          .order("work_date", { ascending: false })
          .limit(300),
        (supabase as any)
          .from("employees")
          .select("id, full_name, timezone, departments:department_id(name)")
          .eq("status", "active")
          .order("full_name"),
      ]);

      if (!empsRes.error && empsRes.data) {
        const empList: EmployeeOption[] = empsRes.data.map((e: any) => ({
          id: e.id,
          full_name: e.full_name,
          timezone: e.timezone || "UTC",
          department: e.departments?.name || "General",
        }));
        setEmployees(empList);
        const deptSet = Array.from(new Set(empList.map((e) => e.department))).sort();
        setDepartments(deptSet);
      }

      if (!daysRes.error && daysRes.data) {
        setRecords(
          daysRes.data.map((d: any) => ({
            id: `${d.employee_id}:${d.work_date}`,
            employeeId: d.employee_id,
            employeeName: d.employees?.full_name || "Employee",
            employeeTimezone: d.employees?.timezone || "UTC",
            department: d.employees?.departments?.name || "General",
            workDate: d.work_date,
            status: d.status,
            totalMinutes: d.total_minutes || 0,
            isLate: Boolean(d.is_late),
            locked: Boolean(d.locked),
          }))
        );
      } else {
        setRecords([]);
      }
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, periodRange]);

  const loadMonthChecklist = React.useCallback(async () => {
    setChecklistLoading(true);
    try {
      const { data, error } = await (supabase.rpc as any)("get_month_close_checklist", {
        p_year: selectedYear,
        p_month: selectedMonth,
      });
      if (!error && data) {
        setChecklist(data as MonthCloseChecklist);
      }
    } catch {
      // Ignore if caller lacks session/AAL2 yet
    } finally {
      setChecklistLoading(false);
    }
  }, [supabase, selectedYear, selectedMonth]);

  React.useEffect(() => {
    loadReportsData();
    loadMonthChecklist();
  }, [loadReportsData, loadMonthChecklist]);

  const filteredData = records.filter((r) => {
    const matchesSearch =
      r.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.department.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.workDate.includes(searchQuery);
    const matchesDept = selectedDept === "All" || r.department === selectedDept;
    return matchesSearch && matchesDept;
  });

  // Compute live summary stats
  const summaryStats = React.useMemo(() => {
    const workdays = records.filter((r) => r.status !== "weekend" && r.status !== "holiday");
    const presentOrHalf = workdays.filter((r) => r.status === "present" || r.status === "half_day");
    const absent = workdays.filter((r) => r.status === "absent");
    const onTime = presentOrHalf.filter((r) => !r.isLate);
    const totalMins = presentOrHalf.reduce((acc, r) => acc + r.totalMinutes, 0);

    const attendancePct =
      workdays.length > 0 ? Math.round((presentOrHalf.length / workdays.length) * 1000) / 10 : 0;
    const avgMinutes = presentOrHalf.length > 0 ? Math.round(totalMins / presentOrHalf.length) : 0;
    const avgH = Math.floor(avgMinutes / 60);
    const avgM = avgMinutes % 60;
    const absentPct =
      workdays.length > 0 ? Math.round((absent.length / workdays.length) * 1000) / 10 : 0;
    const punctualityPct =
      presentOrHalf.length > 0 ? Math.round((onTime.length / presentOrHalf.length) * 1000) / 10 : 0;

    return {
      attendancePct: `${attendancePct}%`,
      avgShift: `${String(avgH).padStart(2, "0")}h ${String(avgM).padStart(2, "0")}m`,
      absentPct: `${absentPct}%`,
      punctualityPct: `${punctualityPct}%`,
    };
  }, [records]);

  // Compute status breakdown chart
  const chartData = React.useMemo(() => {
    const counts = { Present: 0, "Half Day": 0, Leave: 0, Absent: 0, Late: 0 };
    for (const r of records) {
      if (r.status === "present") counts.Present += 1;
      else if (r.status === "half_day") counts["Half Day"] += 1;
      else if (r.status === "leave") counts.Leave += 1;
      else if (r.status === "absent") counts.Absent += 1;
      if (r.isLate) counts.Late += 1;
    }
    return Object.entries(counts).map(([category, total]) => ({ category, total }));
  }, [records]);

  const openCorrectionForRow = async (row?: AttendanceRecordRow) => {
    const eligibleEmployees = employees.filter((e) => e.id !== userId);
    const targetEmpId = row ? row.employeeId : eligibleEmployees[0]?.id || "";
    const targetDate = row ? row.workDate : corrDate;
    const targetTz =
      row?.employeeTimezone ||
      eligibleEmployees.find((e) => e.id === targetEmpId)?.timezone ||
      "UTC";

    if (row && row.employeeId === userId) {
      toast.error("Separation of duties: you cannot correct your own attendance.");
      return;
    }

    setCorrEmployeeId(targetEmpId);
    setCorrDate(targetDate);
    setCorrReason("");

    // Try prefilling existing sessions for that employee & date
    let loadedDrafts: CorrectionSessionDraft[] = [
      { checkInTime: "09:30", checkOutTime: "18:30", note: "HR correction" },
    ];
    if (targetEmpId && targetDate) {
      const { data: existingSess } = await (supabase as any)
        .from("attendance_sessions")
        .select("check_in_at, check_out_at, note")
        .eq("employee_id", targetEmpId)
        .eq("work_date", targetDate)
        .order("check_in_at", { ascending: true });

      if (existingSess && existingSess.length > 0) {
        loadedDrafts = existingSess.map((s: any) => ({
          checkInTime: formatTimeInTimezone(s.check_in_at, targetTz, "HH:mm"),
          checkOutTime: s.check_out_at
            ? formatTimeInTimezone(s.check_out_at, targetTz, "HH:mm")
            : "18:30",
          note: s.note || "",
        }));
      }
    }
    setCorrSessions(loadedDrafts);
    setCorrectModalOpen(true);
  };

  const handleCorrectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!corrEmployeeId || !corrDate) {
      toast.error("Please select an employee and work date.");
      return;
    }
    if (!corrReason.trim()) {
      toast.error("Reason is mandatory for attendance corrections.");
      return;
    }
    if (corrEmployeeId === userId) {
      toast.error("Separation of duties: you cannot correct your own attendance.");
      return;
    }

    const empTz = employees.find((emp) => emp.id === corrEmployeeId)?.timezone || "UTC";
    const sessionsPayload = corrSessions.map((s) => ({
      check_in_at: localDateTimeToUtcIso(corrDate, s.checkInTime, empTz),
      check_out_at: localDateTimeToUtcIso(corrDate, s.checkOutTime, empTz),
      note: s.note.trim() || "HR Attendance Correction",
    }));

    setSubmittingCorrection(true);
    try {
      const { error } = await (supabase.rpc as any)("hr_correct_attendance", {
        p_employee_id: corrEmployeeId,
        p_work_date: corrDate,
        p_sessions: sessionsPayload,
        p_reason: corrReason.trim(),
      });
      if (error) throw error;
      toast.success("Attendance corrected and day recalculated.");
      setCorrectModalOpen(false);
      await Promise.all([loadReportsData(), loadMonthChecklist()]);
    } catch (err: any) {
      toast.error(err?.message || "Failed to apply attendance correction.");
    } finally {
      setSubmittingCorrection(false);
    }
  };

  const handleLockMonth = async () => {
    setLockingMonth(true);
    try {
      const { data, error } = await (supabase.rpc as any)("lock_month", {
        p_year: selectedYear,
        p_month: selectedMonth,
      });
      if (error) throw error;
      toast.success(
        `Locked ${(data as any)?.records_locked ?? 0} attendance record(s) for ${selectedYear}-${String(selectedMonth).padStart(2, "0")}.`
      );
      await Promise.all([loadReportsData(), loadMonthChecklist()]);
    } catch (err: any) {
      toast.error(err?.message || "Failed to lock month.");
    } finally {
      setLockingMonth(false);
    }
  };

  const handleUnlockMonth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockReason.trim()) {
      toast.error("An unlock reason is required.");
      return;
    }
    setUnlockingMonth(true);
    try {
      const { data, error } = await (supabase.rpc as any)("unlock_month", {
        p_year: selectedYear,
        p_month: selectedMonth,
        p_reason: unlockReason.trim(),
      });
      if (error) throw error;
      toast.success(
        `Unlocked ${(data as any)?.records_unlocked ?? 0} record(s) for ${selectedYear}-${String(selectedMonth).padStart(2, "0")}.`
      );
      setUnlockModalOpen(false);
      setUnlockReason("");
      await Promise.all([loadReportsData(), loadMonthChecklist()]);
    } catch (err: any) {
      toast.error(err?.message || "Failed to unlock month.");
    } finally {
      setUnlockingMonth(false);
    }
  };

  const handleExportXlsx = () => {
    window.open("/api/attendance/export?format=xlsx", "_blank");
    toast.success("Downloading attendance report (.xlsx)");
  };

  const handleExportCsv = () => {
    window.open("/api/attendance/export?format=csv", "_blank");
    toast.success("Downloading attendance report (.csv)");
  };

  const eligibleOtherEmployees = employees.filter((e) => e.id !== userId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1 pb-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
            Attendance Reports & Month-End Close
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Audit-logged punch corrections, pre-close compliance checklist, payroll locking, and exports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Report Month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="px-3 py-2 rounded-full bg-card border border-border-light text-xs font-bold text-text-primary shadow-sm"
          >
            {Array.from({ length: 12 }, (_, idx) => (
              <option key={idx + 1} value={idx + 1}>
                {new Date(2026, idx, 1).toLocaleString("en-US", { month: "long" })}
              </option>
            ))}
          </select>

          <select
            aria-label="Report Year"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 rounded-full bg-card border border-border-light text-xs font-bold text-text-primary shadow-sm"
          >
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => openCorrectionForRow()}
            disabled={eligibleOtherEmployees.length === 0}
            className="px-4 py-2 rounded-full bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Correct Attendance</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="px-3.5 py-2 rounded-full bg-card border border-border-light text-xs font-bold text-text-secondary hover:text-text-primary shadow-sm cursor-pointer"
          >
            CSV
          </button>

          <button
            type="button"
            onClick={handleExportXlsx}
            className="px-4 py-2 rounded-full bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export .XLSX</span>
          </button>
        </div>
      </section>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Company Attendance"
          value={summaryStats.attendancePct}
          subtitle={`${periodRange.start} – ${periodRange.end}`}
          icon={<Users className="w-4 h-4 text-brand-purple" />}
        />
        <StatCard
          title="Average Shift"
          value={summaryStats.avgShift}
          subtitle="Across logged days"
          icon={<Clock className="w-4 h-4" />}
        />
        <StatCard
          title="Absenteeism Rate"
          value={summaryStats.absentPct}
          subtitle="Working days missed"
          icon={<TrendingDown className="w-4 h-4 text-status-danger-dot" />}
        />
        <StatCard
          title="Punctuality Rate"
          value={summaryStats.punctualityPct}
          subtitle="Arrivals within grace"
          icon={<TrendingUp className="w-4 h-4 text-status-success-dot" />}
        />
      </div>

      {/* Month-End Close Checklist & Analytics Grid */}
      <BentoGrid>
        {/* Month-End Close Checklist */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <CalendarCheck2 className="w-4 h-4 text-brand-purple" />
              <span>
                Month-End Close ({selectedYear}-{String(selectedMonth).padStart(2, "0")})
              </span>
            </div>
          }
          subtitle="Verify open punches and pending approvals before locking payroll records"
          action={
            checklist?.is_month_locked ? (
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Locked
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
                Open
              </span>
            )
          }
          className="lg:col-span-6 p-6 flex flex-col justify-between space-y-4"
        >
          {checklistLoading ? (
            <div className="h-44 rounded-2xl bg-card-subtle animate-pulse" />
          ) : checklist ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div
                  className={cn(
                    "p-3.5 rounded-2xl border",
                    checklist.open_sessions_count > 0
                      ? "bg-amber-50/70 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800"
                      : "bg-card-subtle border-border-light"
                  )}
                >
                  <span className="text-[10px] font-bold uppercase text-text-tertiary block">
                    Open Sessions
                  </span>
                  <span className="text-xl font-extrabold text-text-primary mt-1 block">
                    {checklist.open_sessions_count}
                  </span>
                </div>

                <div
                  className={cn(
                    "p-3.5 rounded-2xl border",
                    checklist.pending_regularizations_count > 0
                      ? "bg-amber-50/70 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800"
                      : "bg-card-subtle border-border-light"
                  )}
                >
                  <span className="text-[10px] font-bold uppercase text-text-tertiary block">
                    Pending Regularizations
                  </span>
                  <span className="text-xl font-extrabold text-text-primary mt-1 block">
                    {checklist.pending_regularizations_count}
                  </span>
                </div>

                <div
                  className={cn(
                    "p-3.5 rounded-2xl border",
                    checklist.pending_leaves_count > 0
                      ? "bg-amber-50/70 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800"
                      : "bg-card-subtle border-border-light"
                  )}
                >
                  <span className="text-[10px] font-bold uppercase text-text-tertiary block">
                    Pending Leaves
                  </span>
                  <span className="text-xl font-extrabold text-text-primary mt-1 block">
                    {checklist.pending_leaves_count}
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-card-subtle border border-border-light flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-text-primary">
                    {checklist.locked_days_count} / {checklist.total_days_count} days locked
                  </span>
                  <p className="text-[11px] text-text-tertiary mt-0.5">
                    {checklist.ready_to_lock
                      ? "All checklist items are clear for payroll close."
                      : "Resolve open sessions or pending requests before finalizing close."}
                  </p>
                </div>
                {checklist.ready_to_lock ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                {!checklist.is_month_locked && (
                  <button
                    type="button"
                    disabled={lockingMonth}
                    onClick={handleLockMonth}
                    className="px-4 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>{lockingMonth ? "Locking..." : "Lock Month"}</span>
                  </button>
                )}

                {checklist.locked_days_count > 0 && isAdmin && (
                  <button
                    type="button"
                    onClick={() => setUnlockModalOpen(true)}
                    className="px-4 py-2 rounded-xl border border-amber-400 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    <span>Admin Unlock Month</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            <EmptyState
              className="py-6 border-dashed shadow-none bg-card-subtle/40"
              icon={<CalendarCheck2 className="w-5 h-5" />}
              title="Checklist unavailable"
              description="Month-end close checklist requires HR or Administrator MFA assurance (AAL2)."
            />
          )}
        </BentoCard>

        {/* Status Distribution Chart */}
        <BentoCard
          title="Attendance Status Breakdown"
          subtitle="Live distribution across selected reporting period"
          className="lg:col-span-6 p-6"
        >
          {records.length > 0 ? (
            <div className="h-56 w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
                  <XAxis dataKey="category" stroke="var(--text-tertiary)" fontSize={12} />
                  <YAxis stroke="var(--text-tertiary)" fontSize={12} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--card-bg)",
                      borderRadius: "16px",
                      border: "1px solid var(--border-light)",
                      fontSize: "12px",
                      fontWeight: "bold",
                    }}
                  />
                  <Bar dataKey="total" fill="var(--brand-purple)" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              className="py-8 border-dashed shadow-none bg-card-subtle/40"
              icon={<Clock className="w-5 h-5" />}
              title="No attendance data for this month"
              description="Metrics will appear once punches or leave records exist in this period."
            />
          )}
        </BentoCard>
      </BentoGrid>

      {/* Attendance Logs Table with HR Correct Action */}
      <BentoCard
        title={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
            <span>Employee Attendance Logs ({filteredData.length})</span>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  aria-label="Search attendance logs"
                  placeholder="Search employee or date..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-full bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <select
                aria-label="Filter by department"
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="px-3 py-1.5 rounded-full bg-card-subtle border border-border-light text-xs font-bold text-text-primary cursor-pointer"
              >
                <option value="All">All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>
        }
        className="p-6"
      >
        {!mounted || loading ? (
          <div className="h-44 rounded-2xl bg-card-subtle animate-pulse mt-2" />
        ) : filteredData.length > 0 ? (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-left text-xs">
              <thead className="bg-card-subtle border-b border-border-light text-text-tertiary uppercase font-bold text-[10px]">
                <tr>
                  <th className="py-3 px-4 rounded-l-xl">Employee</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Work Date</th>
                  <th className="py-3 px-4">Logged Hours</th>
                  <th className="py-3 px-4">Punctuality</th>
                  <th className="py-3 px-4">Day Status</th>
                  <th className="py-3 px-4">Lock</th>
                  <th className="py-3 px-4 rounded-r-xl text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light/60">
                {filteredData.map((row) => {
                  const isSelf = row.employeeId === userId;
                  return (
                    <tr key={row.id} className="hover:bg-card-subtle/50 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-text-primary">
                        {row.employeeName}
                      </td>
                      <td className="py-3.5 px-4 text-text-secondary">{row.department}</td>
                      <td className="py-3.5 px-4 font-mono text-text-tertiary">{row.workDate}</td>
                      <td className="py-3.5 px-4 font-extrabold text-text-primary font-mono">
                        {row.totalMinutes > 0 ? `${(row.totalMinutes / 60).toFixed(1)}h` : "--"}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs">
                        {row.status === "weekend" || row.status === "holiday" || row.status === "absent" ? (
                          <span className="text-text-tertiary">--</span>
                        ) : row.isLate ? (
                          <span className="text-status-danger-text font-bold">Late</span>
                        ) : (
                          <span className="text-status-success-text font-bold">On Time</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusPill status={row.status} />
                      </td>
                      <td className="py-3.5 px-4">
                        {row.locked ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700">
                            <Lock className="w-3 h-3" />
                            Locked
                          </span>
                        ) : (
                          <span className="text-[11px] text-text-tertiary">Open</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          disabled={isSelf || row.locked}
                          title={
                            isSelf
                              ? "Separation of duties: cannot edit own attendance"
                              : row.locked
                              ? "Day is locked (Admin unlock required)"
                              : "Correct Attendance"
                          }
                          onClick={() => openCorrectionForRow(row)}
                          className="px-2.5 py-1 rounded-xl border border-brand-purple/25 text-brand-purple hover:bg-brand-purple/10 text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Correct
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            className="mt-3"
            icon={<Users className="w-6 h-6" />}
            title="No attendance records match your filters"
            description="Select another month or department, or apply an HR attendance correction."
          />
        )}
      </BentoCard>

      {/* HR Attendance Correction Modal */}
      <Modal
        open={correctModalOpen}
        onOpenChange={setCorrectModalOpen}
        title="HR Attendance Correction"
        description="Replaces the day's session timestamps, recalculates totals, logs audit diff, and notifies employee"
      >
        <form onSubmit={handleCorrectionSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="corr-employee"
                className="block text-xs font-bold text-text-primary mb-1"
              >
                Employee
              </label>
              <select
                id="corr-employee"
                required
                value={corrEmployeeId}
                onChange={(e) => setCorrEmployeeId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
              >
                {eligibleOtherEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name} ({emp.timezone})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="corr-work-date"
                className="block text-xs font-bold text-text-primary mb-1"
              >
                Work Date
              </label>
              <input
                id="corr-work-date"
                type="date"
                required
                value={corrDate}
                onChange={(e) => setCorrDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
              />
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-primary">
                Sessions (Employee Local Time)
              </span>
              <button
                type="button"
                onClick={() =>
                  setCorrSessions((prev) => [
                    ...prev,
                    { checkInTime: "14:00", checkOutTime: "18:00", note: "Afternoon shift" },
                  ])
                }
                className="text-xs font-bold text-brand-purple hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Session
              </button>
            </div>

            {corrSessions.map((sess, idx) => (
              <div
                key={idx}
                className="p-3 rounded-2xl bg-card-subtle border border-border-light grid grid-cols-1 sm:grid-cols-7 gap-2 items-center"
              >
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-bold text-text-tertiary block mb-0.5">
                    Check In
                  </label>
                  <input
                    type="time"
                    required
                    value={sess.checkInTime}
                    onChange={(e) =>
                      setCorrSessions((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, checkInTime: e.target.value } : item
                        )
                      )
                    }
                    className="w-full px-2 py-1.5 rounded-lg bg-card border border-border-light text-xs font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-bold text-text-tertiary block mb-0.5">
                    Check Out
                  </label>
                  <input
                    type="time"
                    required
                    value={sess.checkOutTime}
                    onChange={(e) =>
                      setCorrSessions((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, checkOutTime: e.target.value } : item
                        )
                      )
                    }
                    className="w-full px-2 py-1.5 rounded-lg bg-card border border-border-light text-xs font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-bold text-text-tertiary block mb-0.5">
                    Note
                  </label>
                  <input
                    type="text"
                    value={sess.note}
                    onChange={(e) =>
                      setCorrSessions((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, note: e.target.value } : item))
                      )
                    }
                    className="w-full px-2 py-1.5 rounded-lg bg-card border border-border-light text-xs"
                  />
                </div>
                <div className="flex justify-end pt-3">
                  {corrSessions.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setCorrSessions((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="p-1 text-text-tertiary hover:text-status-danger-text cursor-pointer"
                      aria-label={`Remove session ${idx + 1}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div>
            <label
              htmlFor="corr-reason"
              className="block text-xs font-bold text-text-primary mb-1"
            >
              Mandatory Reason
            </label>
            <textarea
              id="corr-reason"
              required
              rows={2}
              placeholder="Explain why attendance sessions are being corrected..."
              value={corrReason}
              onChange={(e) => setCorrReason(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCorrectModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingCorrection}
              className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {submittingCorrection ? "Applying..." : "Save Correction"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Admin Month Unlock Modal */}
      <Modal
        open={unlockModalOpen}
        onOpenChange={setUnlockModalOpen}
        title={`Unlock ${selectedYear}-${String(selectedMonth).padStart(2, "0")}`}
        description="Administrator-only audited unlock to permit post-close attendance corrections"
      >
        <form onSubmit={handleUnlockMonth} className="space-y-4">
          <div>
            <label
              htmlFor="unlock-month-reason"
              className="block text-xs font-bold text-text-primary mb-1"
            >
              Mandatory Unlock Reason
            </label>
            <textarea
              id="unlock-month-reason"
              required
              rows={3}
              placeholder="State justification for reopening locked payroll days..."
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setUnlockModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={unlockingMonth}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {unlockingMonth ? "Unlocking..." : "Confirm Unlock"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <AppShell>
      <ReportsPageContent />
    </AppShell>
  );
}

"use client";

import * as React from "react";
import { BentoCard } from "@/components/bento/bento-card";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/client";
import { isDemoModeEnabled } from "@/lib/config/demo";
import {
  getStoredAttendanceDays,
  getStoredAttendanceSessions,
  getStoredTasks,
  getStoredLeaveRequests,
} from "@/lib/storage/demo-store";
import { KpiEmployeeOption } from "@/features/kpi/hooks/use-kpi";
import { formatDurationMinutes } from "@/lib/date/timezone";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Award,
  TrendingUp,
  User,
  ArrowRight,
  ShieldCheck,
  Briefcase,
  Layers,
  ChevronRight,
} from "lucide-react";

export type KpiTimeframe =
  | "today"
  | "last_week"
  | "this_week"
  | "last_month"
  | "this_month"
  | "last_year"
  | "custom";

interface AutomaticKpiMetric {
  key: string;
  label: string;
  category: "Attendance" | "Tasks" | "Leave";
  actual: number;
  target: number;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  score: number;
  description: string;
}

interface AutomaticKpiViewProps {
  currentUserId?: string;
  currentUserRole?: string;
  employees: KpiEmployeeOption[];
  onPromoteToPeriod?: (range: { name: string; startDate: string; endDate: string }) => void;
}

function formatDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computeTimeframeDates(timeframe: KpiTimeframe): { start: string; end: string } {
  const now = new Date();
  const todayStr = formatDateKey(now);

  if (timeframe === "today") {
    return { start: todayStr, end: todayStr };
  }

  if (timeframe === "this_week") {
    // Current Monday to today
    const day = now.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    return { start: formatDateKey(monday), end: todayStr };
  }

  if (timeframe === "last_week") {
    // Prior week Monday to Sunday
    const day = now.getDay();
    const diffToThisMonday = (day === 0 ? -6 : 1) - day;
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() + diffToThisMonday);

    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);

    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);

    return { start: formatDateKey(lastMonday), end: formatDateKey(lastSunday) };
  }

  if (timeframe === "this_month") {
    // 1st of this month to today
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: formatDateKey(firstDay), end: todayStr };
  }

  if (timeframe === "last_month") {
    // 1st to last day of previous month
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: formatDateKey(firstDay), end: formatDateKey(lastDay) };
  }

  if (timeframe === "last_year") {
    // Jan 1 to Dec 31 of prior year
    const lastYear = now.getFullYear() - 1;
    return { start: `${lastYear}-01-01`, end: `${lastYear}-12-31` };
  }

  // fallback to this month
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: formatDateKey(firstDay), end: todayStr };
}

export function AutomaticKpiView({
  currentUserId,
  currentUserRole,
  employees,
  onPromoteToPeriod,
}: AutomaticKpiViewProps) {
  const supabase = React.useMemo(() => createClient(), []);
  const isManagerOrAdmin = currentUserRole === "admin" || currentUserRole === "hr" || currentUserRole === "manager";
  const isHrOrAdmin = currentUserRole === "admin" || currentUserRole === "hr";

  const [timeframe, setTimeframe] = React.useState<KpiTimeframe>("this_month");
  const [customStart, setCustomStart] = React.useState(() => {
    const d = new Date();
    d.setDate(1);
    return formatDateKey(d);
  });
  const [customEnd, setCustomEnd] = React.useState(() => formatDateKey(new Date()));
  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState<string>(currentUserId || "");
  const [employeeSearchQuery, setEmployeeSearchQuery] = React.useState("");

  // Scoped employees from server API
  const [scopedEmployees, setScopedEmployees] = React.useState<any[]>(employees || []);
  const [kpiScope, setKpiScope] = React.useState<"all" | "department" | "self">(
    isHrOrAdmin ? "all" : currentUserRole === "manager" ? "department" : "self"
  );

  React.useEffect(() => {
    async function loadScopedEmployees() {
      try {
        const res = await fetch("/api/kpi/summary?listEmployees=true");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.employees)) {
            setScopedEmployees(data.employees);
            setKpiScope(data.scope);
          }
        }
      } catch {}
    }
    loadScopedEmployees();
  }, [currentUserRole]);

  const [loading, setLoading] = React.useState(false);
  const [metrics, setMetrics] = React.useState<AutomaticKpiMetric[]>([]);
  const [summaryStats, setSummaryStats] = React.useState({
    totalMinutesWorked: 0,
    tasksCompleted: 0,
    attendedDays: 0,
    leaveDays: 0,
  });

  const activeDateRange = React.useMemo(() => {
    if (timeframe === "custom") {
      return { start: customStart, end: customEnd };
    }
    return computeTimeframeDates(timeframe);
  }, [timeframe, customStart, customEnd]);

  // Sync selected employee if current user id arrives
  React.useEffect(() => {
    if (!selectedEmployeeId && currentUserId) {
      setSelectedEmployeeId(currentUserId);
    }
  }, [currentUserId, selectedEmployeeId]);

  // Compute live KPI metrics across attendance, tasks, and leave
  const computeAutomaticKpi = React.useCallback(async () => {
    setLoading(true);
    const { start, end } = activeDateRange;
    const targetEmpId = selectedEmployeeId || currentUserId;

    try {
      let daysData: any[] = [];
      let sessData: any[] = [];
      let tasksData: any[] = [];
      let leaveData: any[] = [];

      // 1. Fetch live DB records
      try {
        let daysQuery = (supabase as any)
          .from("attendance_days")
          .select("work_date, status, total_minutes, is_late, employee_id")
          .gte("work_date", start)
          .lte("work_date", end);
        if (targetEmpId) daysQuery = daysQuery.eq("employee_id", targetEmpId);

        let tasksQuery = (supabase as any)
          .from("tasks")
          .select("id, status, due_date, completed_at, created_at, assigned_to");
        if (targetEmpId) tasksQuery = tasksQuery.eq("assigned_to", targetEmpId);

        let leaveQuery = (supabase as any)
          .from("leave_requests")
          .select("id, start_date, end_date, status, days_count, employee_id")
          .eq("status", "approved")
          .lte("start_date", end)
          .gte("end_date", start);
        if (targetEmpId) leaveQuery = leaveQuery.eq("employee_id", targetEmpId);

        const [dRes, tRes, lRes] = await Promise.all([daysQuery, tasksQuery, leaveQuery]);

        if (dRes.data) daysData = dRes.data;
        if (tRes.data) tasksData = tRes.data;
        if (lRes.data) leaveData = lRes.data;
      } catch {
        // Fallback to local storage if offline or demo
      }

      // Fallback to local storage only if explicitly in demo mode
      if (isDemoModeEnabled()) {
        if (daysData.length === 0) {
          const storedDays = getStoredAttendanceDays();
          daysData = storedDays.filter((d) => d.work_date >= start && d.work_date <= end);
        }
        if (tasksData.length === 0) {
          const storedTasks = getStoredTasks();
          tasksData = storedTasks;
        }
        if (leaveData.length === 0) {
          const storedLeave = getStoredLeaveRequests();
          leaveData = storedLeave.filter(
            (l) => l.status === "approved" && l.startDate <= end && l.endDate >= start
          );
        }
      }

      // --- 2. Metric Calculations ---

      // A. Attendance On-Time Rate
      const attendedDays = daysData.filter((d) => d.status === "present" || d.status === "half_day" || d.total_minutes > 0);
      const onTimeDays = attendedDays.filter((d) => !d.is_late);
      const onTimeRate = attendedDays.length > 0 ? Math.round((onTimeDays.length / attendedDays.length) * 100) : 0;

      // B. Worked Hours vs Target
      const totalMinutes = daysData.reduce((acc, d) => acc + (d.total_minutes || 0), 0);
      // Estimate working days in range (exclude Sundays)
      const startDateObj = new Date(start);
      const endDateObj = new Date(end);
      let workingDaysCount = 0;
      const cur = new Date(startDateObj);
      while (cur <= endDateObj) {
        if (cur.getDay() !== 0) workingDaysCount++; // Sunday is 0, Mon-Sat are workdays
        cur.setDate(cur.getDate() + 1);
      }
      workingDaysCount = Math.max(1, workingDaysCount);
      const targetMinutes = workingDaysCount * 480; // 8 hrs per workday
      const hoursVsTargetRate = targetMinutes > 0 && totalMinutes > 0 ? Math.min(125, Math.round((totalMinutes / targetMinutes) * 100)) : 0;

      // C. Absence Days
      const absenceDaysCount = daysData.filter((d) => d.status === "absent").length;

      // D. Approved Leave Days
      const totalLeaveDays = leaveData.reduce((acc: number, l: any) => acc + (l.days_count || 1), 0);

      // E. Tasks Completed
      const completedTasks = tasksData.filter((t) => {
        const isDone = t.status === "completed" || t.status === "done";
        if (!isDone) return false;
        if (!t.completed_at) return true;
        const compDate = t.completed_at.slice(0, 10);
        return compDate >= start && compDate <= end;
      });
      const tasksCompletedCount = completedTasks.length;

      // F. Tasks On-Time Rate
      const tasksOnTime = completedTasks.filter((t) => {
        if (!t.due_date || !t.completed_at) return true;
        return t.completed_at.slice(0, 10) <= t.due_date.slice(0, 10);
      });
      const taskOnTimeRate = completedTasks.length > 0 ? Math.round((tasksOnTime.length / completedTasks.length) * 100) : 0;

      // G. Overdue Tasks
      const overdueTasks = tasksData.filter((t) => {
        const isDone = t.status === "completed" || t.status === "done";
        if (isDone) {
          if (t.due_date && t.completed_at && t.completed_at.slice(0, 10) > t.due_date.slice(0, 10)) {
            const comp = t.completed_at.slice(0, 10);
            return comp >= start && comp <= end;
          }
          return false;
        }
        if (t.due_date) {
          const due = t.due_date.slice(0, 10);
          return due >= start && due <= end && due < formatDateKey(new Date());
        }
        return false;
      });
      const overdueCount = overdueTasks.length;

      // H. Average Task Cycle Time (in days)
      let totalCycleDays = 0;
      let cycleTasksCount = 0;
      completedTasks.forEach((t) => {
        if (t.created_at && t.completed_at) {
          const diffMs = new Date(t.completed_at).getTime() - new Date(t.created_at).getTime();
          const d = Math.max(0.5, Math.round(diffMs / (1000 * 60 * 60 * 24)));
          totalCycleDays += d;
          cycleTasksCount++;
        }
      });
      const avgCycleDays = cycleTasksCount > 0 ? Number((totalCycleDays / cycleTasksCount).toFixed(1)) : 0;

      // Compute Individual Scores (0-100)
      const hasAttendanceActivity = attendedDays.length > 0 || totalMinutes > 0;
      const hasTaskActivity = tasksData.length > 0 || completedTasks.length > 0;

      const scoreOnTime = attendedDays.length > 0 ? Math.min(100, Math.round((onTimeRate / 95) * 100)) : 0;
      const scoreHours = totalMinutes > 0 ? Math.min(100, Math.round((hoursVsTargetRate / 100) * 100)) : 0;
      const scoreAbsence = hasAttendanceActivity ? (absenceDaysCount === 0 ? 100 : Math.max(0, 100 - absenceDaysCount * 25)) : 0;
      const scoreLeave = hasAttendanceActivity || leaveData.length > 0 ? (totalLeaveDays <= 2 ? 100 : Math.max(0, 100 - (totalLeaveDays - 2) * 20)) : 0;
      const scoreTasksCount = tasksCompletedCount > 0 ? Math.min(100, Math.round((tasksCompletedCount / 5) * 100)) : 0;
      const scoreTaskOnTime = completedTasks.length > 0 ? Math.min(100, Math.round((taskOnTimeRate / 90) * 100)) : 0;
      const scoreOverdue = hasTaskActivity ? (overdueCount === 0 ? 100 : Math.max(0, 100 - overdueCount * 25)) : 0;
      const scoreCycle = cycleTasksCount > 0 ? (avgCycleDays <= 3 ? 100 : Math.max(0, Math.round(100 - (avgCycleDays - 3) * 20))) : 0;

      const computedList: AutomaticKpiMetric[] = [
        {
          key: "attendance_on_time_rate",
          label: "Attendance On-Time Rate",
          category: "Attendance",
          actual: onTimeRate,
          target: 95,
          unit: "%",
          direction: "higher_is_better",
          score: scoreOnTime,
          description: "Percentage of shift check-ins completed on time within policy grace.",
        },
        {
          key: "hours_vs_target",
          label: "Worked Hours vs Shift Target",
          category: "Attendance",
          actual: hoursVsTargetRate,
          target: 100,
          unit: "%",
          direction: "higher_is_better",
          score: scoreHours,
          description: "Logged attendance hours divided by scheduled 8-hour workday target.",
        },
        {
          key: "absence_days",
          label: "Unexcused Absence Days",
          category: "Attendance",
          actual: absenceDaysCount,
          target: 0,
          unit: "days",
          direction: "lower_is_better",
          score: scoreAbsence,
          description: "Workdays marked unexcused absent during the active window.",
        },
        {
          key: "leave_days_taken",
          label: "Approved Leave Taken",
          category: "Leave",
          actual: totalLeaveDays,
          target: 2,
          unit: "days",
          direction: "lower_is_better",
          score: scoreLeave,
          description: "Approved PTO and personal leave days overlapping this timeframe.",
        },
        {
          key: "tasks_completed",
          label: "Assigned Tasks Completed",
          category: "Tasks",
          actual: tasksCompletedCount,
          target: 5,
          unit: "tasks",
          direction: "higher_is_better",
          score: scoreTasksCount,
          description: "Total deliverables and assigned project tasks closed out.",
        },
        {
          key: "tasks_on_time_rate",
          label: "Task On-Time Rate",
          category: "Tasks",
          actual: taskOnTimeRate,
          target: 90,
          unit: "%",
          direction: "higher_is_better",
          score: scoreTaskOnTime,
          description: "Percentage of tasks finished on or before scheduled deadline.",
        },
        {
          key: "tasks_overdue",
          label: "Overdue Deliverables",
          category: "Tasks",
          actual: overdueCount,
          target: 0,
          unit: "tasks",
          direction: "lower_is_better",
          score: scoreOverdue,
          description: "Open past-due tasks or tasks delivered after target due date.",
        },
        {
          key: "avg_task_cycle_days",
          label: "Mean Task Cycle Time",
          category: "Tasks",
          actual: avgCycleDays,
          target: 3,
          unit: "days",
          direction: "lower_is_better",
          score: scoreCycle,
          description: "Average turnaround days from ticket assignment to resolution.",
        },
      ];

      setMetrics(computedList);
      setSummaryStats({
        totalMinutesWorked: totalMinutes,
        tasksCompleted: tasksCompletedCount,
        attendedDays: attendedDays.length,
        leaveDays: totalLeaveDays,
      });
    } catch {
      // Keep UI steady
    } finally {
      setLoading(false);
    }
  }, [supabase, activeDateRange, selectedEmployeeId, currentUserId]);

  React.useEffect(() => {
    computeAutomaticKpi();
    const handleStorage = () => computeAutomaticKpi();
    window.addEventListener("remotehr_storage_change", handleStorage);
    return () => window.removeEventListener("remotehr_storage_change", handleStorage);
  }, [computeAutomaticKpi]);

  const hasActiveRecords = React.useMemo(() => {
    return summaryStats.attendedDays > 0 || summaryStats.tasksCompleted > 0 || summaryStats.totalMinutesWorked > 0 || summaryStats.leaveDays > 0;
  }, [summaryStats]);

  const overallScore = React.useMemo(() => {
    if (!hasActiveRecords || metrics.length === 0) return 0;
    const sum = metrics.reduce((acc, m) => acc + m.score, 0);
    return Math.round(sum / metrics.length);
  }, [hasActiveRecords, metrics]);

  const band = React.useMemo(() => {
    if (!hasActiveRecords) {
      return {
        label: "No Activity Recorded",
        tone: "neutral" as const,
        color: "text-text-tertiary",
        bg: "bg-card-subtle border-border-light text-text-secondary",
      };
    }
    if (overallScore >= 85) return { label: "Exceeding Target", tone: "success" as const, color: "text-status-success-dot", bg: "bg-status-success-bg border-status-success-border text-status-success-text" };
    if (overallScore >= 65) return { label: "On Track", tone: "warning" as const, color: "text-status-warning-dot", bg: "bg-status-warning-bg border-status-warning-border text-status-warning-text" };
    return { label: "Needs Attention", tone: "danger" as const, color: "text-status-danger-dot", bg: "bg-status-danger-bg border-status-danger-border text-status-danger-text" };
  }, [hasActiveRecords, overallScore]);

  const timeframeLabels: Record<KpiTimeframe, string> = {
    today: "Today",
    last_week: "Last Week",
    this_week: "This Week",
    last_month: "Last Month",
    this_month: "This Month",
    last_year: "Last Year",
    custom: "Custom Range",
  };

  const handlePromote = () => {
    if (!onPromoteToPeriod) return;
    const name = `Automatic KPI (${timeframeLabels[timeframe]} - ${activeDateRange.start})`;
    onPromoteToPeriod({
      name,
      startDate: activeDateRange.start,
      endDate: activeDateRange.end,
    });
  };

  return (
    <div className="space-y-6">
      {/* Timeframe & Filter Control Toolbar */}
      <div className="bg-card border border-border-light rounded-3xl p-4 shadow-card flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        {/* Quick Timeframe Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mr-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-brand-purple" />
            Timeframe:
          </span>
          {(["today", "last_week", "this_week", "last_month", "this_month", "last_year", "custom"] as KpiTimeframe[]).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
                timeframe === tf
                  ? "bg-brand-purple text-white shadow-sm"
                  : "bg-card-subtle text-text-secondary hover:text-text-primary hover:bg-card-subtle/80"
              )}
            >
              {timeframeLabels[tf]}
            </button>
          ))}
        </div>

        {/* Custom Date Pickers & Employee Dropdown */}
        <div className="flex flex-wrap items-center gap-3">
          {timeframe === "custom" && (
            <div className="flex items-center gap-2 bg-card-subtle border border-border-light rounded-2xl px-3 py-1.5 text-xs">
              <span className="text-text-tertiary font-bold">From:</span>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-transparent text-text-primary font-mono text-xs focus:outline-none cursor-pointer"
              />
              <span className="text-text-tertiary font-bold">To:</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-transparent text-text-primary font-mono text-xs focus:outline-none cursor-pointer"
              />
            </div>
          )}

          {kpiScope !== "self" && scopedEmployees.length > 0 && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              {isHrOrAdmin && (
                <input
                  type="text"
                  placeholder="Filter employees..."
                  value={employeeSearchQuery}
                  onChange={(e) => setEmployeeSearchQuery(e.target.value)}
                  className="bg-card-subtle border border-border-light rounded-2xl px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                />
              )}
              <div className="flex items-center gap-2 bg-card-subtle border border-border-light rounded-2xl px-3 py-1.5 text-xs">
                <User className="w-3.5 h-3.5 text-brand-purple shrink-0" />
                <label htmlFor="kpi-target-employee" className="sr-only">
                  Target Employee
                </label>
                <select
                  id="kpi-target-employee"
                  value={selectedEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  className="bg-transparent text-xs font-bold text-text-primary focus:outline-none cursor-pointer max-w-[200px] truncate"
                >
                  <option value={currentUserId || ""}>Myself (Active Profile)</option>
                  {scopedEmployees
                    .filter((e) => e.id !== currentUserId)
                    .filter((e) => {
                      if (!employeeSearchQuery.trim()) return true;
                      const q = employeeSearchQuery.toLowerCase();
                      return (
                        (e.full_name && e.full_name.toLowerCase().includes(q)) ||
                        (e.email && e.email.toLowerCase().includes(q))
                      );
                    })
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name || e.email}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          )}

          {onPromoteToPeriod && (
            <button
              type="button"
              onClick={handlePromote}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Save As Review Period</span>
            </button>
          )}
        </div>
      </div>

      {/* Hero Overview Card */}
      <div className="bg-gradient-to-br from-brand-purple/10 via-card to-card border border-brand-purple/20 rounded-[28px] p-6 lg:p-8 shadow-card flex flex-col lg:flex-row items-center justify-between gap-6">
        <div className="space-y-3 text-center lg:text-left max-w-xl">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border bg-card/80">
            <Sparkles className="w-3.5 h-3.5 text-brand-purple" />
            <span className="text-brand-purple font-extrabold">Automatic Real-Time Scorecard</span>
            <span className="text-text-tertiary">•</span>
            <span className="font-mono text-text-secondary">
              {activeDateRange.start} → {activeDateRange.end}
            </span>
          </div>

          <h2 className="text-2xl lg:text-3xl font-extrabold text-text-primary tracking-tight">
            Performance Index: <span className="text-brand-purple">{overallScore}%</span>
          </h2>
          <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
            Live calculated across punctuality, shift hours vs policy target, project tasks completed, and approved leave records.
          </p>

          <div className="pt-2 flex flex-wrap items-center justify-center lg:justify-start gap-4 text-xs font-bold text-text-secondary">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-brand-purple" />
              {formatDurationMinutes(summaryStats.totalMinutesWorked)} Worked
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-status-success-dot" />
              {summaryStats.tasksCompleted} Tasks Done
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-status-info-dot" />
              {summaryStats.attendedDays} Attended Days
            </span>
          </div>
        </div>

        {/* Circular Progress Ring & Band Badge */}
        <div className="flex flex-col items-center gap-3 shrink-0">
          <div className="relative w-32 h-32 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="42"
                className="text-border-light"
                strokeWidth="8"
                stroke="currentColor"
                fill="transparent"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                stroke={!hasActiveRecords ? "#e2e0f0" : band.tone === "success" ? "#10b981" : band.tone === "warning" ? "#f59e0b" : "#ef4444"}
                strokeWidth="8"
                strokeDasharray={264}
                strokeDashoffset={!hasActiveRecords ? 264 : 264 - (264 * Math.min(100, overallScore)) / 100}
                strokeLinecap="round"
                fill="transparent"
                className="transition-all duration-700 ease-out"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
              <span className="text-3xl font-extrabold text-text-primary font-mono tracking-tight">
                {overallScore}%
              </span>
              <span className="text-[10px] font-bold text-text-tertiary uppercase">Index</span>
            </div>
          </div>

          <span className={cn("px-3 py-1 rounded-full text-xs font-bold border", band.bg)}>
            {band.label}
          </span>
        </div>
      </div>

      {!hasActiveRecords && (
        <div className="bg-brand-purple/5 border border-brand-purple/15 rounded-2xl p-4 flex items-center gap-3 text-xs text-text-secondary">
          <Clock className="w-5 h-5 text-brand-purple shrink-0" />
          <span>
            <strong>No shift or task activity recorded yet for this timeframe.</strong> Once employees log attendance check-ins or complete tasks, live performance scores and percentiles will automatically compute here.
          </span>
        </div>
      )}

      {/* Metric Breakdown Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => {
          const isEvaluated = hasActiveRecords && m.score > 0;
          const isSuccess = m.score >= 85;
          const isWarning = m.score >= 65 && m.score < 85;
          const barColor = !isEvaluated ? "bg-border-light" : isSuccess ? "bg-status-success-dot" : isWarning ? "bg-status-warning-dot" : "bg-status-danger-dot";

          return (
            <div
              key={m.key}
              className="bg-card border border-border-light rounded-3xl p-5 shadow-card hover:shadow-card-hover transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-card-subtle text-text-tertiary">
                    {m.category}
                  </span>
                  <span className={cn("text-xs font-bold font-mono",
                    !isEvaluated ? "text-text-tertiary" : isSuccess ? "text-status-success-dot" : isWarning ? "text-status-warning-dot" : "text-status-danger-dot"
                  )}>
                    {m.score}%
                  </span>
                </div>

                <h3 className="text-sm font-bold text-text-primary tracking-tight">
                  {m.label}
                </h3>
                <p className="text-[11px] text-text-tertiary mt-1 line-clamp-2 leading-relaxed">
                  {m.description}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-border-light/60">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-text-tertiary font-medium">Actual:</span>
                  <span className="font-mono font-bold text-text-primary">
                    {m.actual} {m.unit}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-text-tertiary font-medium">Target:</span>
                  <span className="font-mono font-bold text-text-secondary">
                    {m.direction === "lower_is_better" ? "≤ " : "≥ "}
                    {m.target} {m.unit}
                  </span>
                </div>

                {/* Progress Mini Bar */}
                <div className="w-full h-1.5 rounded-full bg-card-subtle overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", barColor)}
                    style={{ width: `${Math.min(100, m.score)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

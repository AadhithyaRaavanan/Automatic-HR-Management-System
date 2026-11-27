// ============================================================================
// Authoritative KPI Metrics Computation Engine
// Single server-side source of truth shared across Overview, Detail Drawer,
// History, Team Matrix, Summary Badges, and CSV Export.
// ============================================================================

import { supabaseAdmin } from "@/lib/supabase/admin";
import { KPI_CONFIG, EmployeeTypeKpiTargets } from "@/features/kpi/config";
import { getKolkataToday } from "@/features/kpi/date-helper";
import { getEmployeeWorkDate } from "@/lib/date/timezone";

export interface KpiMetricItem {
  key: string;
  label: string;
  category: "attendance" | "hours" | "tasks";
  value: number | null; // null represents "No data" / "Unavailable"
  target: number | null;
  unit: string;
  status: "on_track" | "at_risk" | "behind" | "no_data";
  displayValue: string;
  breakdown?: string;
  details?: string;
  adjusted?: boolean;
  adjustmentReason?: string;
  originalValue?: number | null;
}

export interface KpiCalendarDay {
  date: string;
  weekday: number; // 0 (Sun) .. 6 (Sat)
  status:
    | "present"
    | "late"
    | "live"
    | "missing"
    | "pending"
    | "leave"
    | "partial_leave"
    | "holiday"
    | "absent"
    | "weekend"
    | "future";
  label: string;
  workedMinutes: number;
  leaveFraction: number;
  holidayName?: string;
  hasPendingCorrection?: boolean;
  isLiveSession?: boolean;
}

export interface KpiHoursBreakdown {
  workedMinutes: number;
  finalizedWorkedMinutes: number;
  liveWorkedMinutes: number;
  leaveCreditMinutes: number;
  holidayCreditMinutes: number;
  effectiveMinutes: number;
  targetMinutes: number;
  dailyTargetMinutes: number;
  hasLiveSession: boolean;
}

export interface KpiMetricDetailData {
  metric: string;
  explanation: string;
  formula: string;
  limitationNote?: string | null;
  adjustment: {
    isAdjusted: boolean;
    overrideValue: number;
    reason: string;
    createdAt?: string | null;
  } | null;
  rows: Array<{
    id: string;
    date: string;
    title?: string;
    checkIn?: string;
    statusText: string;
    statusType: "on_time" | "late" | "worked" | "holiday" | "leave" | "missing";
    details: string;
    actionUrl?: string;
  }>;
}

export interface KpiComputeResult {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  employeeType: string;
  overallScore: number | null;
  overallTarget: number;
  dataStatus: "ok" | "unavailable";
  sourceErrors: string[];
  metrics: {
    on_time_check_in_rate: KpiMetricItem;
    days_worked_vs_expected: KpiMetricItem;
    early_check_outs: KpiMetricItem;
    auto_closed_check_outs: KpiMetricItem;
    regularization_requests: KpiMetricItem;
    worked_hours_vs_target: KpiMetricItem;
    tasks_completed_vs_assigned: KpiMetricItem;
    task_on_time_rate: KpiMetricItem;
    task_average_cycle_time: KpiMetricItem;
    task_overdue_count: KpiMetricItem;
  };
  metricsList: KpiMetricItem[];
  dataPointsCount: number;
  weights?: Record<string, number>;
  configEffectiveDate?: string | null;
  configVersionReason?: string | null;
  hoursBreakdown: KpiHoursBreakdown;
  calendarDays: KpiCalendarDay[];
  actionableMissingDates: string[];
  pendingCorrectionDates: string[];
  taskPopulationNote: string;
  historicalLimitationNote: string | null;
  metricDetails: Record<string, KpiMetricDetailData>;
}

const LOWER_IS_BETTER_COUNTS = new Set([
  "early_check_outs",
  "auto_closed_check_outs",
  "regularization_requests",
  "task_overdue_count",
]);

/**
 * Shared metric threshold evaluation respecting metric direction and zero targets.
 * Used identically for raw computation and after authorized adjustments.
 */
export function evaluateMetricStatus(
  metricKey: string,
  value: number | null,
  target: number | null
): "on_track" | "at_risk" | "behind" | "no_data" {
  if (value == null || !Number.isFinite(value)) return "no_data";

  if (metricKey === "task_average_cycle_time") {
    const effTarget = target ?? 48;
    if (value <= effTarget) return "on_track";
    if (value <= effTarget * 2) return "at_risk";
    return "behind";
  }

  if (LOWER_IS_BETTER_COUNTS.has(metricKey)) {
    const effTarget = target ?? 0;
    if (value <= effTarget) return "on_track";
    const riskCeiling = metricKey === "auto_closed_check_outs" ? effTarget + 1 : effTarget + 2;
    if (value <= riskCeiling) return "at_risk";
    return "behind";
  }

  // Higher-is-better percentage metrics
  const effTarget = target ?? 80;
  if (value >= effTarget) return "on_track";
  const tolerance = metricKey === "on_time_check_in_rate" ? 10 : metricKey === "days_worked_vs_expected" || metricKey === "worked_hours_vs_target" ? 15 : 20;
  if (value >= Math.max(0, effTarget - tolerance)) return "at_risk";
  return "behind";
}

function fmtCount(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

function isMissingSchemaError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || "");
  return /column .* does not exist|relation .* does not exist|could not find .* in the schema cache/i.test(
    msg
  );
}

/**
 * Shared period task filter used for minimal direct unit checks and detail fallback.
 * Excludes cancelled tasks and handles period boundaries cleanly.
 */
export function filterPeriodTasks<T extends {
  status?: string | null;
  due_date?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
}>(tasks: T[], from: string, to: string, timezone: string = "Asia/Kolkata"): T[] {
  return (tasks || []).filter((t) => {
    if (t.status === "cancelled") return false;
    const createdLocal = t.created_at ? getEmployeeWorkDate(timezone, new Date(t.created_at)) : null;
    const completedLocal = t.completed_at ? getEmployeeWorkDate(timezone, new Date(t.completed_at)) : null;
    if (createdLocal && createdLocal > to) return false;

    const createdIn = Boolean(createdLocal && createdLocal >= from && createdLocal <= to);
    const completedIn = Boolean(completedLocal && completedLocal >= from && completedLocal <= to && t.status === "done");
    const dueIn = Boolean(t.due_date && t.due_date >= from && t.due_date <= to);
    const overdueCarryover = Boolean(
      t.status !== "done" &&
        t.due_date &&
        t.due_date < from &&
        (!createdLocal || createdLocal <= to)
    );
    return createdIn || completedIn || dueIn || overdueCarryover;
  });
}

export interface ApprovedLeaveDayInfo {
  weight: number; // 0.5 or 1.0
  dayPart: string;
}

/**
 * Fetches approved leave dates from `leave_requests` (`start_date`, `end_date`, `day_part`)
 * with fractional half-day handling (`first_half` / `second_half` = 0.5) and capped overlap.
 */
export async function fetchApprovedLeaveDaysMap(
  employeeId: string,
  from: string,
  to: string
): Promise<{ map: Map<string, ApprovedLeaveDayInfo>; error: any }> {
  const leaveMap = new Map<string, ApprovedLeaveDayInfo>();

  let res = await (supabaseAdmin as any)
    .from("leave_requests")
    .select("start_date, end_date, day_part, total_days, status")
    .eq("employee_id", employeeId)
    .eq("status", "approved")
    .lte("start_date", to)
    .gte("end_date", from);

  if (res.error && isMissingSchemaError(res.error)) {
    res = await (supabaseAdmin as any)
      .from("leave_requests")
      .select("start_date, end_date, status")
      .eq("employee_id", employeeId)
      .eq("status", "approved")
      .lte("start_date", to)
      .gte("end_date", from);
  }

  for (const leave of res.data || []) {
    const sStr = leave.start_date;
    const eStr = leave.end_date;
    if (!sStr || !eStr) continue;
    const part = String(leave.day_part || "full").toLowerCase();
    const dayWeight = part === "first_half" || part === "second_half" ? 0.5 : 1.0;

    const clampedStart = sStr < from ? from : sStr;
    const clampedEnd = eStr > to ? to : eStr;
    const curL = new Date(`${clampedStart}T00:00:00Z`);
    const endL = new Date(`${clampedEnd}T00:00:00Z`);
    while (curL <= endL) {
      const iso = curL.toISOString().slice(0, 10);
      const existing = leaveMap.get(iso);
      // Clamp combined overlapping leaves on one date at 1.0 full day max
      const combinedWeight = Math.min(1, (existing?.weight || 0) + dayWeight);
      leaveMap.set(iso, {
        weight: combinedWeight,
        dayPart: combinedWeight >= 1 ? "full" : part,
      });
      curL.setUTCDate(curL.getUTCDate() + 1);
    }
  }

  return { map: leaveMap, error: res.error && !isMissingSchemaError(res.error) ? res.error : null };
}

/**
 * Backward-compatible Set helper for callers needing approved leave date keys.
 */
export async function fetchApprovedLeaveDatesSet(
  employeeId: string,
  from: string,
  to: string
): Promise<Set<string>> {
  const { map } = await fetchApprovedLeaveDaysMap(employeeId, from, to);
  return new Set(map.keys());
}

/**
 * Fetches active holidays (from `holidays.date`) and `company_days_off`
 * scoped strictly to the employee's organization and department.
 */
export async function fetchPeriodHolidaysMap(
  organizationId: string | null | undefined,
  departmentId: string | null | undefined,
  from: string,
  to: string
): Promise<{ map: Map<string, string>; error: any }> {
  const holidayMap = new Map<string, string>();
  let firstError: any = null;

  let holQuery = (supabaseAdmin as any)
    .from("holidays")
    .select("date, name, is_active, organization_id")
    .gte("date", from)
    .lte("date", to);

  if (organizationId) {
    holQuery = holQuery.eq("organization_id", organizationId);
  }

  let { data: holRows, error: holErr } = await holQuery;
  if (holErr && isMissingSchemaError(holErr)) {
    const fallback = await (supabaseAdmin as any)
      .from("holidays")
      .select("date, name")
      .gte("date", from)
      .lte("date", to);
    holRows = fallback.data;
    holErr = fallback.error;
  }

  if (holErr && !isMissingSchemaError(holErr)) {
    firstError = holErr;
  }

  for (const h of holRows || []) {
    if (h.is_active === false) continue;
    const dStr = h.date || h.holiday_date;
    if (dStr) holidayMap.set(String(dStr).slice(0, 10), h.name || "Holiday");
  }

  // Department-aware company days off
  try {
    let cdoQuery = (supabaseAdmin as any)
      .from("company_days_off")
      .select("date, title, department_id")
      .gte("date", from)
      .lte("date", to);

    if (organizationId) {
      cdoQuery = cdoQuery.eq("organization_id", organizationId);
    }
    const { data: cdoRows, error: cdoErr } = await cdoQuery;
    if (cdoErr && !isMissingSchemaError(cdoErr) && !firstError) {
      firstError = cdoErr;
    }
    for (const c of cdoRows || []) {
      if (c.department_id && c.department_id !== departmentId) continue;
      if (c.date) {
        const dStr = String(c.date).slice(0, 10);
        if (!holidayMap.has(dStr)) {
          holidayMap.set(dStr, c.title || "Company Day Off");
        }
      }
    }
  } catch {
    // Table may be omitted in minimal unit test mocks
  }

  return { map: holidayMap, error: firstError };
}

interface ReconstructedTask {
  id: string;
  title: string;
  priority: string | null;
  due_date: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  createdLocal: string;
  statusAsOfEnd: string;
  completedLocal: string | null;
  assignedAtEnd: boolean;
  wasEverReassignedAfterEnd: boolean;
  isOverdueCarryover: boolean;
  isOnTime: boolean;
}

/**
 * Reconstructs historical task state as of `effectiveEnd` using `task_events`
 * when available and employee-local timezone boundaries so future completions,
 * reopenings, cancellations, reassignments, and carryover behave consistently.
 */
export function reconstructPeriodTasks(
  rawTasks: any[],
  rawEvents: any[],
  employeeId: string,
  from: string,
  to: string,
  effectiveEnd: string,
  timezone: string
): {
  periodTasks: ReconstructedTask[];
  taskPopulationNote: string;
  historicalLimitationNote: string | null;
} {
  const eventsByTask = new Map<string, any[]>();
  for (const ev of rawEvents || []) {
    if (!ev?.task_id) continue;
    const list = eventsByTask.get(ev.task_id) || [];
    list.push(ev);
    eventsByTask.set(ev.task_id, list);
  }
  eventsByTask.forEach((list) =>
    list.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
  );

  const periodTasks: ReconstructedTask[] = [];
  let lacksEventHistoryCount = 0;
  let withoutDueDateCount = 0;
  let carryoverCount = 0;
  let postPeriodClosureCount = 0;

  for (const t of rawTasks || []) {
    if (!t?.id || !t.created_at) continue;
    const createdLocal = getEmployeeWorkDate(timezone, new Date(t.created_at));
    if (createdLocal > to) continue;

    const events = eventsByTask.get(t.id) || [];
    const eventsUpToEnd = events.filter(
      (ev) => ev.created_at && getEmployeeWorkDate(timezone, new Date(ev.created_at)) <= effectiveEnd
    );
    const eventsAfterEnd = events.filter(
      (ev) => ev.created_at && getEmployeeWorkDate(timezone, new Date(ev.created_at)) > effectiveEnd
    );

    // 1. Determine assignee as of `effectiveEnd`
    let assigneeAtEnd: string | null = t.assignee_id ?? null;
    if (events.length > 0) {
      let trackedAssignee: string | null = null;
      const firstCreated = events.find((e) => e.event_type === "created");
      if (firstCreated?.new_assignee_id !== undefined) {
        trackedAssignee = firstCreated.new_assignee_id;
      } else {
        const firstAssigned = events.find((e) => e.event_type === "assigned");
        if (firstAssigned) {
          trackedAssignee = firstAssigned.old_assignee_id ?? firstAssigned.new_assignee_id ?? null;
        }
      }
      for (const ev of eventsUpToEnd) {
        if (ev.event_type === "assigned" || ev.event_type === "created") {
          if (ev.new_assignee_id !== undefined) trackedAssignee = ev.new_assignee_id;
        }
      }
      if (trackedAssignee !== null || eventsUpToEnd.some((e) => e.event_type === "assigned")) {
        assigneeAtEnd = trackedAssignee;
      } else if (eventsAfterEnd.some((e) => e.event_type === "assigned" && e.old_assignee_id === employeeId)) {
        assigneeAtEnd = employeeId;
      }
    }

    const wasEverReassignedAfterEnd = eventsAfterEnd.some(
      (e) => e.event_type === "assigned" && (e.old_assignee_id === employeeId || e.new_assignee_id === employeeId)
    );

    if (assigneeAtEnd !== employeeId) continue;

    // 2. Determine status & completion date as of `effectiveEnd`
    const rawCompletedLocal = t.completed_at
      ? getEmployeeWorkDate(timezone, new Date(t.completed_at))
      : null;

    let statusAtEnd: string = t.status || "todo";
    let completedLocal: string | null = rawCompletedLocal;

    if (eventsUpToEnd.length > 0) {
      let trackedStatus: string | null = null;
      let trackedCompletedLocal: string | null = null;
      for (const ev of eventsUpToEnd) {
        if (ev.event_type === "created") {
          trackedStatus = ev.to_status || "todo";
        } else if (ev.event_type === "status_changed") {
          if (ev.to_status) trackedStatus = ev.to_status;
          if (ev.to_status === "done") {
            trackedCompletedLocal = getEmployeeWorkDate(timezone, new Date(ev.created_at));
          } else if (ev.from_status === "done" && ev.to_status && ev.to_status !== "done") {
            // Task was reopened before period end
            trackedCompletedLocal = null;
          }
        } else if (ev.event_type === "completed") {
          trackedStatus = "done";
          trackedCompletedLocal = getEmployeeWorkDate(timezone, new Date(ev.created_at));
        } else if (ev.event_type === "cancelled") {
          trackedStatus = "cancelled";
          trackedCompletedLocal = null;
        }
      }
      if (trackedStatus) {
        statusAtEnd = trackedStatus;
        completedLocal = trackedStatus === "done" ? trackedCompletedLocal || rawCompletedLocal : null;
      }
    } else {
      // No event rows available: reconstruct conservatively from timestamps
      if (rawCompletedLocal && rawCompletedLocal > effectiveEnd) {
        statusAtEnd = "in_progress";
        completedLocal = null;
        postPeriodClosureCount++;
      } else if (t.status !== "done") {
        // Task could have been reopened or cancelled later without event audit trail
        if (t.status === "cancelled" && effectiveEnd < getKolkataToday()) {
          lacksEventHistoryCount++;
        }
        statusAtEnd = t.status;
        completedLocal = null;
      }
    }

    if (statusAtEnd === "cancelled") continue;

    // 3. Period inclusion: created, completed (while still done at end), due in [from..to], or open overdue carryover
    const createdIn = createdLocal >= from && createdLocal <= to;
    const completedIn = Boolean(
      statusAtEnd === "done" && completedLocal && completedLocal >= from && completedLocal <= to
    );
    const dueIn = Boolean(t.due_date && t.due_date >= from && t.due_date <= to);
    const isOverdueCarryover = Boolean(
      statusAtEnd !== "done" && t.due_date && t.due_date < from && createdLocal <= to
    );

    if (!createdIn && !completedIn && !dueIn && !isOverdueCarryover) {
      continue;
    }

    if (!t.due_date) withoutDueDateCount++;
    if (isOverdueCarryover) carryoverCount++;

    const isOnTime = Boolean(
      statusAtEnd === "done" && completedLocal && t.due_date && completedLocal <= t.due_date
    );

    periodTasks.push({
      id: t.id,
      title: t.title || "Untitled task",
      priority: t.priority || null,
      due_date: t.due_date || null,
      created_at: t.created_at,
      started_at: t.started_at || null,
      completed_at: completedLocal ? t.completed_at : null,
      createdLocal,
      statusAsOfEnd: statusAtEnd,
      completedLocal,
      assignedAtEnd: true,
      wasEverReassignedAfterEnd,
      isOverdueCarryover,
      isOnTime,
    });
  }

  const parts: string[] = [
    `${periodTasks.length} active task${periodTasks.length === 1 ? "" : "s"} assigned as of ${effectiveEnd} (cancelled excluded)`,
  ];
  if (withoutDueDateCount > 0) {
    parts.push(`${withoutDueDateCount} without due date excluded from on-time rate`);
  }
  if (carryoverCount > 0) {
    parts.push(`${carryoverCount} overdue carryover from prior period`);
  }
  if (postPeriodClosureCount > 0) {
    parts.push(`${postPeriodClosureCount} closed after ${effectiveEnd} counted as open`);
  }

  const historicalLimitationNote =
    lacksEventHistoryCount > 0
      ? `Task event history is incomplete for ${lacksEventHistoryCount} historical task(s); cancellations or reassignments after ${effectiveEnd} without audit events cannot be reverted.`
      : null;

  return {
    periodTasks,
    taskPopulationNote: parts.join(" · "),
    historicalLimitationNote,
  };
}

export async function computeKpi(
  employeeId: string,
  from: string,
  to: string,
  explicitEmployeeType?: string,
  organizationId?: string
): Promise<KpiComputeResult> {
  const sourceErrors: string[] = [];

  // Fetch target employee profile with optional columns fallback
  let empProfile: any = null;
  try {
    const empRes = await (supabaseAdmin as any)
      .from("employees")
      .select(
        "id, organization_id, department_id, employment_category, work_target_minutes, timezone, shift_start_time, shift_end_time"
      )
      .eq("id", employeeId)
      .maybeSingle();

    if (empRes.error && isMissingSchemaError(empRes.error)) {
      const fb = await (supabaseAdmin as any)
        .from("employees")
        .select("id, organization_id, department_id")
        .eq("id", employeeId)
        .maybeSingle();
      empProfile = fb.data || null;
      if (fb.error && !isMissingSchemaError(fb.error)) sourceErrors.push("employees");
    } else {
      empProfile = empRes.data || null;
      if (empRes.error) sourceErrors.push("employees");
    }
  } catch {
    sourceErrors.push("employees");
  }

  const effectiveOrgId = organizationId || empProfile?.organization_id || undefined;
  const effectiveDeptId = empProfile?.department_id || null;
  const empTimezone = empProfile?.timezone || "Asia/Kolkata";
  const normType = (
    explicitEmployeeType ||
    empProfile?.employment_category ||
    KPI_CONFIG.defaultType
  ).toLowerCase();

  let configQuery = (supabaseAdmin as any)
    .from("kpi_config_versions")
    .select("config, effective_from, reason")
    .lte("effective_from", to)
    .order("effective_from", { ascending: false })
    .limit(1);

  if (effectiveOrgId) {
    configQuery = configQuery.eq("organization_id", effectiveOrgId);
  }

  // 1. Fetch all real operational tables in parallel
  const [
    attendanceDaysRes,
    rawAttendanceSessionsRes,
    regularizationsRes,
    leaveRes,
    holidayRes,
    tasksRes,
    adjustmentsRes,
    configVersionRes,
  ] = await Promise.all([
    (supabaseAdmin as any)
      .from("attendance_days")
      .select("work_date, status, is_late, total_minutes")
      .eq("employee_id", employeeId)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date", { ascending: true }),
    (supabaseAdmin as any)
      .from("attendance_sessions")
      .select("id, work_date, check_in_at, check_out_at, source, early_checkout")
      .eq("employee_id", employeeId)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date", { ascending: true }),
    (supabaseAdmin as any)
      .from("regularization_requests")
      .select("id, work_date, status, reason, created_at")
      .eq("employee_id", employeeId)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date", { ascending: true }),
    fetchApprovedLeaveDaysMap(employeeId, from, to),
    fetchPeriodHolidaysMap(effectiveOrgId, effectiveDeptId, from, to),
    (supabaseAdmin as any)
      .from("tasks")
      .select("id, title, status, priority, assignee_id, due_date, created_at, started_at, completed_at")
      .eq("assignee_id", employeeId),
    (supabaseAdmin as any)
      .from("kpi_adjustments")
      .select("metric, override_value, reason, created_at")
      .eq("employee_id", employeeId)
      .lte("period_start", to)
      .gte("period_end", from)
      .order("created_at", { ascending: false }),
    configQuery.maybeSingle(),
  ]);

  let attendanceSessionsRes = rawAttendanceSessionsRes;
  if (attendanceSessionsRes?.error && isMissingSchemaError(attendanceSessionsRes.error)) {
    attendanceSessionsRes = await (supabaseAdmin as any)
      .from("attendance_sessions")
      .select("id, work_date, check_in_at, check_out_at, source")
      .eq("employee_id", employeeId)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date", { ascending: true });
  }

  if (attendanceDaysRes?.error) sourceErrors.push("attendance_days");
  if (attendanceSessionsRes?.error) sourceErrors.push("attendance_sessions");
  if (regularizationsRes?.error) sourceErrors.push("regularization_requests");
  if (leaveRes?.error) sourceErrors.push("leave_requests");
  if (holidayRes?.error) sourceErrors.push("holidays");
  if (tasksRes?.error) sourceErrors.push("tasks");

  // Fetch `task_events` gracefully to reconstruct historical reassignments/reopenings/closures
  let rawTasksList: any[] = tasksRes?.data || [];
  let rawEventsList: any[] = [];
  if (!tasksRes?.error) {
    try {
      const { data: empTaskEvents, error: evErr1 } = await (supabaseAdmin as any)
        .from("task_events")
        .select("task_id, event_type, from_status, to_status, old_assignee_id, new_assignee_id, created_at")
        .or(`old_assignee_id.eq.${employeeId},new_assignee_id.eq.${employeeId}`)
        .order("created_at", { ascending: true });

      if (!evErr1) {
        const knownTaskIds = new Set(rawTasksList.map((t: any) => t.id));
        const extraTaskIds = Array.from(
          new Set((empTaskEvents || []).map((e: any) => e.task_id).filter((id: string) => id && !knownTaskIds.has(id)))
        );

        if (extraTaskIds.length > 0) {
          const { data: extraTasks } = await (supabaseAdmin as any)
            .from("tasks")
            .select("id, title, status, priority, assignee_id, due_date, created_at, started_at, completed_at")
            .in("id", extraTaskIds);
          if (extraTasks) {
            rawTasksList = [...rawTasksList, ...extraTasks];
          }
        }

        const allCandidateIds = Array.from(new Set(rawTasksList.map((t: any) => t.id).filter(Boolean)));
        if (allCandidateIds.length > 0) {
          const { data: fullEvents } = await (supabaseAdmin as any)
            .from("task_events")
            .select("task_id, event_type, from_status, to_status, old_assignee_id, new_assignee_id, created_at")
            .in("task_id", allCandidateIds)
            .order("created_at", { ascending: true });
          rawEventsList = fullEvents || [];
        }
      }
    } catch {
      // Optional event table missing in minimal mock
    }
  }

  const activeVersion = configVersionRes?.data;
  const activeConfig = activeVersion?.config || {};
  const overallTarget: number =
    activeConfig.overallTarget ?? KPI_CONFIG.overallTarget;
  const activeWeights: Record<string, number> = {
    on_time_check_in_rate:
      activeConfig.weights?.on_time_check_in_rate ?? KPI_CONFIG.weights.on_time_check_in_rate,
    days_worked_vs_expected:
      activeConfig.weights?.days_worked_vs_expected ?? KPI_CONFIG.weights.days_worked_vs_expected,
    worked_hours_vs_target:
      activeConfig.weights?.worked_hours_vs_target ?? KPI_CONFIG.weights.worked_hours_vs_target,
    tasks_completed_vs_assigned:
      activeConfig.weights?.tasks_completed_vs_assigned ?? KPI_CONFIG.weights.tasks_completed_vs_assigned,
    task_on_time_rate:
      activeConfig.weights?.task_on_time_rate ?? KPI_CONFIG.weights.task_on_time_rate,
  };
  const activeEmployeeTypes = activeConfig.employeeTypes || KPI_CONFIG.employeeTypes;
  const targetConfig: EmployeeTypeKpiTargets =
    activeEmployeeTypes[normType] ||
    activeEmployeeTypes[KPI_CONFIG.defaultType] ||
    KPI_CONFIG.employeeTypes[KPI_CONFIG.defaultType];

  const attendanceDays: any[] = attendanceDaysRes?.data || [];
  const attendanceSessions: any[] = attendanceSessionsRes?.data || [];
  const regularizations: any[] = regularizationsRes?.data || [];
  const leaveDaysMap = leaveRes.map;
  const holidayMap = holidayRes.map;
  const adjustments: any[] = adjustmentsRes?.data || [];

  const adjustmentMap = new Map<string, { value: number; reason: string; createdAt?: string }>();
  for (const adj of adjustments) {
    if (adj.metric && !adjustmentMap.has(adj.metric)) {
      adjustmentMap.set(adj.metric, {
        value: Number(adj.override_value),
        reason: adj.reason,
        createdAt: adj.created_at,
      });
    }
  }

  const todayIso = empProfile?.timezone
    ? getEmployeeWorkDate(empTimezone, new Date(), empProfile.shift_start_time, empProfile.shift_end_time)
    : getKolkataToday();
  const effectiveEnd = to > todayIso ? todayIso : to;

  // Reconstruct tasks using employee-local boundaries & task_events
  const { periodTasks, taskPopulationNote, historicalLimitationNote } = reconstructPeriodTasks(
    rawTasksList,
    rawEventsList,
    employeeId,
    from,
    to,
    effectiveEnd,
    empTimezone
  );

  // 2. Build schedule expectations across [from .. effectiveEnd] with fractional half-day leave & overlap deduplication
  const expectedDateFractionMap = new Map<string, number>();
  let totalCalendarWeekdays = 0;
  let holidayCreditWeekdays = 0;
  let leaveCreditWeekdays = 0;

  if (effectiveEnd >= from) {
    const curD = new Date(`${from}T00:00:00Z`);
    const endD = new Date(`${effectiveEnd}T00:00:00Z`);
    while (curD <= endD) {
      const dayOfWeek = curD.getUTCDay();
      const dateStr = curD.toISOString().slice(0, 10);
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        totalCalendarWeekdays++;
        if (holidayMap.has(dateStr)) {
          // Holiday takes precedence over leave on the same date: count credit once
          holidayCreditWeekdays += 1;
        } else {
          const leaveInfo = leaveDaysMap.get(dateStr);
          const leaveFraction = leaveInfo ? leaveInfo.weight : 0;
          leaveCreditWeekdays += leaveFraction;
          const expectedFraction = Math.max(0, 1 - leaveFraction);
          if (expectedFraction > 0) {
            expectedDateFractionMap.set(dateStr, expectedFraction);
          }
        }
      }
      curD.setUTCDate(curD.getUTCDate() + 1);
    }
  }

  const expectedWorkingDays = Array.from(expectedDateFractionMap.values()).reduce((a, b) => a + b, 0);

  // 3. Attendance & Live Session Separation
  const sessionsByDate = new Map<string, any[]>();
  for (const s of attendanceSessions) {
    if (!s.work_date) continue;
    const list = sessionsByDate.get(s.work_date) || [];
    list.push(s);
    sessionsByDate.set(s.work_date, list);
  }

  const dayRecordMap = new Map<
    string,
    { is_late: boolean; total_minutes: number; status: string | null }
  >();
  for (const d of attendanceDays) {
    if (!d.work_date) continue;
    const existing = dayRecordMap.get(d.work_date);
    if (!existing) {
      dayRecordMap.set(d.work_date, {
        is_late: Boolean(d.is_late),
        total_minutes: d.total_minutes || 0,
        status: d.status || null,
      });
    } else {
      if (d.is_late) existing.is_late = true;
      existing.total_minutes += d.total_minutes || 0;
      if (d.status === "present" || d.status === "half_day") existing.status = d.status;
    }
  }

  // Evaluate live open session for today
  const nowMs = Date.now();
  const todaySessions = todayIso >= from && todayIso <= effectiveEnd ? sessionsByDate.get(todayIso) || [] : [];
  const todayHasOpenSession = todaySessions.some((s) => s.check_in_at && !s.check_out_at);
  const todayHasClosedSession = todaySessions.some((s) => s.check_in_at && s.check_out_at);
  let liveWorkedMinutes = 0;

  if (todaySessions.length > 0) {
    let sessionMinsTotal = 0;
    for (const s of todaySessions) {
      if (s.check_in_at && s.check_out_at) {
        sessionMinsTotal += Math.max(
          0,
          Math.round((new Date(s.check_out_at).getTime() - new Date(s.check_in_at).getTime()) / 60000)
        );
      } else if (s.check_in_at && !s.check_out_at) {
        sessionMinsTotal += Math.max(0, Math.round((nowMs - new Date(s.check_in_at).getTime()) / 60000));
      }
    }
    const recordedTodayDayMins = dayRecordMap.get(todayIso)?.total_minutes || 0;
    if (sessionMinsTotal > recordedTodayDayMins) {
      liveWorkedMinutes = sessionMinsTotal - recordedTodayDayMins;
    }
  }

  // Finalized attendance days vs live open sessions
  const regPendingDatesSet = new Set(
    regularizations.filter((r) => r.status === "pending").map((r) => r.work_date)
  );

  // Attended scheduled days (supports half-day leave fractional work expectations)
  let attendedScheduledWeight = 0;
  let finalizedPunctualityDays = 0;
  let onTimeDaysCount = 0;
  const punctualDayRows: KpiMetricDetailData["rows"] = [];

  for (const [dateStr, expectedFraction] of Array.from(expectedDateFractionMap.entries()).sort()) {
    const rec = dayRecordMap.get(dateStr);
    const isFinalizedAttended = Boolean(
      rec && (rec.status === "present" || rec.status === "half_day" || rec.total_minutes > 0)
    );
    const hasLiveOnly =
      dateStr === todayIso && todayHasOpenSession && !todayHasClosedSession && !isFinalizedAttended;

    if (isFinalizedAttended || hasLiveOnly) {
      attendedScheduledWeight += expectedFraction;
    }

    // Open live session alone does NOT establish punctuality until shift is finalized/closed
    const isOpenLiveToday = dateStr === todayIso && todayHasOpenSession && !todayHasClosedSession;
    if (isFinalizedAttended && !isOpenLiveToday) {
      finalizedPunctualityDays++;
      if (!rec!.is_late) onTimeDaysCount++;

      const firstSess = (sessionsByDate.get(dateStr) || [])[0];
      const checkInStr = firstSess?.check_in_at
        ? new Date(firstSess.check_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "Recorded";
      punctualDayRows.push({
        id: dateStr,
        date: dateStr,
        checkIn: checkInStr,
        statusText: rec!.is_late ? "Late" : "On Time",
        statusType: rec!.is_late ? "late" : "on_time",
        details: rec!.is_late ? "Checked in after shift grace period" : "Checked in within scheduled shift window",
      });
    } else if (isOpenLiveToday) {
      const liveSess = todaySessions.find((s) => s.check_in_at && !s.check_out_at);
      punctualDayRows.push({
        id: dateStr,
        date: dateStr,
        checkIn: liveSess?.check_in_at
          ? new Date(liveSess.check_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "Live",
        statusText: "Live Shift",
        statusType: "worked",
        details: "Open live session in progress — excluded from punctuality until checkout is finalized",
      });
    }
  }

  const onTimeTargetRate = targetConfig.onTimeTargetRate ?? 95;
  let onTimeRate: number | null = null;
  let onTimeDisplay = todayHasOpenSession && finalizedPunctualityDays === 0 ? "Pending checkout" : "No data";
  if (finalizedPunctualityDays > 0 && !sourceErrors.includes("attendance_days")) {
    onTimeRate = Math.round((onTimeDaysCount / finalizedPunctualityDays) * 100);
    onTimeDisplay = `${onTimeRate}% (${onTimeDaysCount}/${finalizedPunctualityDays} finalized days)`;
  }

  const daysWorkedTargetRate = targetConfig.daysWorkedTargetRate ?? 100;
  let daysWorkedRate: number | null = null;
  let daysWorkedDisplay = "No data";
  if (!sourceErrors.includes("attendance_days")) {
    if (attendedScheduledWeight === 0 && expectedWorkingDays === 0 && holidayCreditWeekdays + leaveCreditWeekdays === 0) {
      daysWorkedRate = null;
    } else if (attendedScheduledWeight === 0 && expectedWorkingDays > 0) {
      // Check if they simply had zero activity vs active data elsewhere — preserve missing data rule when 0 records
      daysWorkedRate =
        attendanceDays.length > 0 || attendanceSessions.length > 0
          ? 0
          : null;
      daysWorkedDisplay = daysWorkedRate != null ? `0 of ${fmtCount(expectedWorkingDays)} scheduled days (0%)` : "No data";
    } else if (expectedWorkingDays > 0) {
      daysWorkedRate = Math.min(100, Math.round((attendedScheduledWeight / expectedWorkingDays) * 100));
      daysWorkedDisplay = `${fmtCount(attendedScheduledWeight)} of ${fmtCount(expectedWorkingDays)} scheduled days (${daysWorkedRate}%)`;
    } else if (attendedScheduledWeight > 0) {
      daysWorkedRate = 100;
      daysWorkedDisplay = `${fmtCount(attendedScheduledWeight)} days worked (0 scheduled)`;
    }
  }

  const creditedDays = holidayCreditWeekdays + leaveCreditWeekdays;
  const daysWorkedBreakdown =
    creditedDays > 0
      ? `${fmtCount(attendedScheduledWeight)} worked + ${fmtCount(creditedDays)} leave/holiday days`
      : `${fmtCount(attendedScheduledWeight)} worked days`;

  // Diagnostic attendance counters
  const earlyCheckOutRows = attendanceSessions.filter((s: any) => s.early_checkout === true);
  const earlyCheckOutCount = earlyCheckOutRows.length;
  const autoClosedRows = attendanceSessions.filter(
    (s: any) =>
      s.source === "auto_checkout" ||
      s.source === "auto_logout" ||
      (s.work_date && s.work_date < todayIso && s.check_in_at && !s.check_out_at)
  );
  const autoClosedCount = autoClosedRows.length;
  const regularizationCount = regularizations.length;
  const hasAnyAttendancePresence = attendedScheduledWeight > 0 || attendanceDays.length > 0 || attendanceSessions.length > 0;

  // 4. Worked Hours (worked + fractional leave credit + holiday credit, live vs finalized split)
  const finalizedWorkedMinutes = attendanceDays.reduce((acc, d) => acc + (d.total_minutes || 0), 0);
  const workedMinutes = finalizedWorkedMinutes + liveWorkedMinutes;
  const dailyTargetMinutes =
    empProfile?.work_target_minutes != null
      ? Number(empProfile.work_target_minutes)
      : Math.round((targetConfig.hoursPerDay ?? 8) * 60);

  const leaveCreditMinutes = Math.round(leaveCreditWeekdays * dailyTargetMinutes);
  const holidayCreditMinutes = Math.round(holidayCreditWeekdays * dailyTargetMinutes);
  const effectiveMinutes = workedMinutes + leaveCreditMinutes + holidayCreditMinutes;
  const targetMinutes = Math.round(totalCalendarWeekdays * dailyTargetMinutes);

  const hoursTargetRate = targetConfig.hoursTargetRate ?? 100;
  let hoursRate: number | null = null;
  let hoursDisplay = "No data";
  if (!sourceErrors.includes("attendance_days") && targetMinutes > 0 && (workedMinutes > 0 || creditedDays > 0)) {
    hoursRate = Math.min(120, Math.round((effectiveMinutes / targetMinutes) * 100));
    hoursDisplay = `${(effectiveMinutes / 60).toFixed(1)}h / ${(targetMinutes / 60).toFixed(1)}h (${hoursRate}%)`;
  }

  // 5. Tasks Metrics from reconstructed historical period tasks
  const totalAssignedTasks = periodTasks.length;
  const completedTasks = periodTasks.filter((t) => t.statusAsOfEnd === "done");
  const taskCompletionTargetRate = targetConfig.taskCompletionTargetRate ?? 90;
  let taskCompletionRate: number | null = null;
  let taskCompletionDisplay = "No eligible tasks";
  if (!sourceErrors.includes("tasks") && totalAssignedTasks > 0) {
    taskCompletionRate = Math.round((completedTasks.length / totalAssignedTasks) * 100);
    taskCompletionDisplay = `${completedTasks.length} / ${totalAssignedTasks} (${taskCompletionRate}%)`;
  }

  const completedWithDue = completedTasks.filter((t) => Boolean(t.due_date && t.completedLocal));
  const taskOnTimeTargetRate = targetConfig.taskOnTimeTargetRate ?? 90;
  let taskOnTimeRate: number | null = null;
  let taskOnTimeDisplay =
    completedTasks.length === 0
      ? "No completed tasks"
      : "No due dates on completed tasks";

  if (!sourceErrors.includes("tasks") && completedWithDue.length > 0) {
    const onTimeTasks = completedWithDue.filter((t) => t.isOnTime);
    taskOnTimeRate = Math.round((onTimeTasks.length / completedWithDue.length) * 100);
    taskOnTimeDisplay = `${taskOnTimeRate}% (${onTimeTasks.length}/${completedWithDue.length})`;
  }

  let avgCycleHours: number | null = null;
  let cycleDisplay = "No data";
  if (!sourceErrors.includes("tasks") && completedTasks.length > 0) {
    let totalCycleMs = 0;
    let counted = 0;
    for (const t of completedTasks) {
      if (!t.completed_at) continue;
      const startMs = t.started_at ? new Date(t.started_at).getTime() : new Date(t.created_at).getTime();
      const endMs = new Date(t.completed_at).getTime();
      if (endMs >= startMs) {
        totalCycleMs += endMs - startMs;
        counted++;
      }
    }
    if (counted > 0) {
      avgCycleHours = Number((totalCycleMs / (counted * 3600000)).toFixed(1));
      cycleDisplay = `${avgCycleHours} hrs`;
    }
  }

  const overdueCount = sourceErrors.includes("tasks")
    ? null
    : periodTasks.filter(
        (t) => t.due_date && t.due_date < effectiveEnd && t.statusAsOfEnd !== "done"
      ).length;

  // 6. Calendar Grid across full [from .. to]
  const calendarDays: KpiCalendarDay[] = [];
  const actionableMissingDates: string[] = [];
  const pendingCorrectionDates: string[] = [];

  const curCal = new Date(`${from}T00:00:00Z`);
  const endCal = new Date(`${to}T00:00:00Z`);
  while (curCal <= endCal) {
    const weekday = curCal.getUTCDay();
    const dateStr = curCal.toISOString().slice(0, 10);
    const isWeekend = weekday === 0 || weekday === 6;

    if (isWeekend) {
      calendarDays.push({
        date: dateStr,
        weekday,
        status: "weekend",
        label: "Weekend",
        workedMinutes: 0,
        leaveFraction: 0,
      });
    } else if (holidayMap.has(dateStr)) {
      calendarDays.push({
        date: dateStr,
        weekday,
        status: "holiday",
        label: holidayMap.get(dateStr) || "Holiday",
        workedMinutes: 0,
        leaveFraction: 0,
        holidayName: holidayMap.get(dateStr),
      });
    } else if (dateStr > todayIso) {
      const leaveInfo = leaveDaysMap.get(dateStr);
      calendarDays.push({
        date: dateStr,
        weekday,
        status: leaveInfo ? (leaveInfo.weight < 1 ? "partial_leave" : "leave") : "future",
        label: leaveInfo ? "Approved Leave" : "Upcoming",
        workedMinutes: 0,
        leaveFraction: leaveInfo?.weight || 0,
      });
    } else {
      const leaveInfo = leaveDaysMap.get(dateStr);
      const leaveFraction = leaveInfo?.weight || 0;
      const rec = dayRecordMap.get(dateStr);
      const daySess = sessionsByDate.get(dateStr) || [];
      const hasOpenLive = dateStr === todayIso && daySess.some((s) => s.check_in_at && !s.check_out_at);
      const dayMinutes =
        (rec?.total_minutes || 0) + (dateStr === todayIso ? liveWorkedMinutes : 0);
      const isPresent = Boolean(
        rec && (rec.status === "present" || rec.status === "half_day" || rec.total_minutes > 0)
      );
      const isPending = regPendingDatesSet.has(dateStr);

      if (leaveFraction >= 1) {
        calendarDays.push({
          date: dateStr,
          weekday,
          status: "leave",
          label: "Approved Leave",
          workedMinutes: dayMinutes,
          leaveFraction: 1,
        });
      } else if (hasOpenLive && !isPresent) {
        calendarDays.push({
          date: dateStr,
          weekday,
          status: "live",
          label: "Live Shift",
          workedMinutes: dayMinutes,
          leaveFraction,
          isLiveSession: true,
        });
      } else if (isPresent || hasOpenLive) {
        calendarDays.push({
          date: dateStr,
          weekday,
          status: rec?.is_late ? "late" : leaveFraction > 0 ? "partial_leave" : "present",
          label: rec?.is_late ? "Late Check-In" : leaveFraction > 0 ? "Half-Day Worked + Leave" : "Present",
          workedMinutes: dayMinutes,
          leaveFraction,
          isLiveSession: hasOpenLive,
        });
      } else if (isPending) {
        pendingCorrectionDates.push(dateStr);
        calendarDays.push({
          date: dateStr,
          weekday,
          status: "pending",
          label: "Correction Pending",
          workedMinutes: 0,
          leaveFraction,
          hasPendingCorrection: true,
        });
      } else if (rec?.status === "absent") {
        calendarDays.push({
          date: dateStr,
          weekday,
          status: "absent",
          label: "Absent",
          workedMinutes: 0,
          leaveFraction,
        });
      } else {
        actionableMissingDates.push(dateStr);
        calendarDays.push({
          date: dateStr,
          weekday,
          status: "missing",
          label: "Missing Check-In",
          workedMinutes: 0,
          leaveFraction,
        });
      }
    }
    curCal.setUTCDate(curCal.getUTCDate() + 1);
  }

  // 7. Build Metrics & Apply Authorized Adjustments with Unified Direction Rules
  function applyAdj(metricKey: string, base: KpiMetricItem): KpiMetricItem {
    if (adjustmentMap.has(metricKey)) {
      const adj = adjustmentMap.get(metricKey)!;
      return {
        ...base,
        originalValue: base.value,
        value: adj.value,
        displayValue: `${adj.value}${base.unit && base.unit !== "count" ? (base.unit === "%" ? "%" : ` ${base.unit}`) : ""}`,
        adjusted: true,
        adjustmentReason: adj.reason,
        status: evaluateMetricStatus(metricKey, adj.value, base.target),
      };
    }
    return base;
  }

  const metricsRaw = {
    on_time_check_in_rate: applyAdj("on_time_check_in_rate", {
      key: "on_time_check_in_rate",
      label: "On-Time Check-In Rate",
      category: "attendance",
      value: onTimeRate,
      target: onTimeTargetRate,
      unit: "%",
      status: evaluateMetricStatus("on_time_check_in_rate", onTimeRate, onTimeTargetRate),
      displayValue: onTimeDisplay,
      breakdown:
        finalizedPunctualityDays > 0
          ? `${onTimeDaysCount} on-time / ${finalizedPunctualityDays} finalized days${todayHasOpenSession && !todayHasClosedSession ? " · 1 live shift pending checkout" : ""}`
          : todayHasOpenSession
          ? "Live open shift not included until checkout"
          : undefined,
      details: "Evaluates finalized shift check-ins against scheduled start time + grace window.",
    }),
    days_worked_vs_expected: applyAdj("days_worked_vs_expected", {
      key: "days_worked_vs_expected",
      label: "Days Worked vs Expected",
      category: "attendance",
      value: daysWorkedRate,
      target: daysWorkedTargetRate,
      unit: "%",
      status: evaluateMetricStatus("days_worked_vs_expected", daysWorkedRate, daysWorkedTargetRate),
      displayValue: daysWorkedDisplay,
      breakdown: daysWorkedBreakdown,
      details: `Scheduled elapsed weekdays up to ${effectiveEnd} minus holidays and approved leave (${fmtCount(expectedWorkingDays)} expected).`,
    }),
    early_check_outs: applyAdj("early_check_outs", {
      key: "early_check_outs",
      label: "Early Check-Outs",
      category: "attendance",
      value: hasAnyAttendancePresence ? earlyCheckOutCount : null,
      target: 0,
      unit: "count",
      status: hasAnyAttendancePresence ? evaluateMetricStatus("early_check_outs", earlyCheckOutCount, 0) : "no_data",
      displayValue: hasAnyAttendancePresence ? `${earlyCheckOutCount}` : "No data",
    }),
    auto_closed_check_outs: applyAdj("auto_closed_check_outs", {
      key: "auto_closed_check_outs",
      label: "Auto-Closed / Forgotten Check-Outs",
      category: "attendance",
      value: hasAnyAttendancePresence ? autoClosedCount : null,
      target: 0,
      unit: "count",
      status: hasAnyAttendancePresence ? evaluateMetricStatus("auto_closed_check_outs", autoClosedCount, 0) : "no_data",
      displayValue: hasAnyAttendancePresence ? `${autoClosedCount}` : "No data",
    }),
    regularization_requests: applyAdj("regularization_requests", {
      key: "regularization_requests",
      label: "Regularization Requests",
      category: "attendance",
      value: hasAnyAttendancePresence || regularizationCount > 0 ? regularizationCount : null,
      target: 0,
      unit: "count",
      status:
        hasAnyAttendancePresence || regularizationCount > 0
          ? evaluateMetricStatus("regularization_requests", regularizationCount, 0)
          : "no_data",
      displayValue: hasAnyAttendancePresence || regularizationCount > 0 ? `${regularizationCount}` : "No data",
    }),
    worked_hours_vs_target: applyAdj("worked_hours_vs_target", {
      key: "worked_hours_vs_target",
      label: "Worked Hours vs Target",
      category: "hours",
      value: hoursRate,
      target: hoursTargetRate,
      unit: "%",
      status: evaluateMetricStatus("worked_hours_vs_target", hoursRate, hoursTargetRate),
      displayValue: hoursDisplay,
      breakdown: `${(workedMinutes / 60).toFixed(1)}h worked${leaveCreditMinutes > 0 ? ` + ${(leaveCreditMinutes / 60).toFixed(1)}h leave` : ""}${holidayCreditMinutes > 0 ? ` + ${(holidayCreditMinutes / 60).toFixed(1)}h holiday` : ""}`,
    }),
    tasks_completed_vs_assigned: applyAdj("tasks_completed_vs_assigned", {
      key: "tasks_completed_vs_assigned",
      label: "Tasks Completed vs Assigned",
      category: "tasks",
      value: taskCompletionRate,
      target: taskCompletionTargetRate,
      unit: "%",
      status: evaluateMetricStatus("tasks_completed_vs_assigned", taskCompletionRate, taskCompletionTargetRate),
      displayValue: taskCompletionDisplay,
    }),
    task_on_time_rate: applyAdj("task_on_time_rate", {
      key: "task_on_time_rate",
      label: "Task On-Time Completion Rate",
      category: "tasks",
      value: taskOnTimeRate,
      target: taskOnTimeTargetRate,
      unit: "%",
      status: evaluateMetricStatus("task_on_time_rate", taskOnTimeRate, taskOnTimeTargetRate),
      displayValue: taskOnTimeDisplay,
    }),
    task_average_cycle_time: applyAdj("task_average_cycle_time", {
      key: "task_average_cycle_time",
      label: "Average Task Cycle Time",
      category: "tasks",
      value: avgCycleHours,
      target: 48,
      unit: "hrs",
      status: evaluateMetricStatus("task_average_cycle_time", avgCycleHours, 48),
      displayValue: cycleDisplay,
    }),
    task_overdue_count: applyAdj("task_overdue_count", {
      key: "task_overdue_count",
      label: "Overdue Tasks Count",
      category: "tasks",
      value: overdueCount,
      target: 0,
      unit: "count",
      status: evaluateMetricStatus("task_overdue_count", overdueCount, 0),
      displayValue: overdueCount == null ? "Unavailable" : `${overdueCount}`,
    }),
  };

  // 8. Composite Weighted Score (proportionally normalized across available scored metrics)
  const weightedMetrics = [
    { key: "on_time_check_in_rate", val: metricsRaw.on_time_check_in_rate.value, weight: activeWeights.on_time_check_in_rate },
    { key: "days_worked_vs_expected", val: metricsRaw.days_worked_vs_expected.value, weight: activeWeights.days_worked_vs_expected },
    { key: "worked_hours_vs_target", val: metricsRaw.worked_hours_vs_target.value, weight: activeWeights.worked_hours_vs_target },
    { key: "tasks_completed_vs_assigned", val: metricsRaw.tasks_completed_vs_assigned.value, weight: activeWeights.tasks_completed_vs_assigned },
    { key: "task_on_time_rate", val: metricsRaw.task_on_time_rate.value, weight: activeWeights.task_on_time_rate },
  ];

  let totalWeight = 0;
  let weightedSum = 0;
  let dataPointsCount = 0;

  for (const item of weightedMetrics) {
    if (typeof item.val === "number" && !isNaN(item.val)) {
      weightedSum += Math.min(100, item.val) * item.weight;
      totalWeight += item.weight;
      dataPointsCount++;
    }
  }

  const overallScore =
    sourceErrors.length === 0 &&
    (attendedScheduledWeight > 0 || periodTasks.length > 0 || dataPointsCount >= 2) &&
    dataPointsCount >= 2 &&
    totalWeight > 0
      ? Math.round(weightedSum / totalWeight)
      : sourceErrors.length === 0 && dataPointsCount === 1 && totalWeight > 0 && attendedScheduledWeight > 0
      ? Math.round(weightedSum / totalWeight)
      : null;

  // 9. Authoritative Drilldown Details matching exact Overview math
  const makeAdjMeta = (key: string) => {
    const a = adjustmentMap.get(key);
    return a
      ? { isAdjusted: true, overrideValue: a.value, reason: a.reason, createdAt: a.createdAt || null }
      : null;
  };

  const dailyTargetHrsStr = (dailyTargetMinutes / 60).toFixed(1);
  const hoursDetailRows = calendarDays
    .filter((d) => d.status !== "weekend" && d.status !== "future")
    .filter((d) => d.workedMinutes > 0 || d.leaveFraction > 0 || d.status === "holiday")
    .map((d) => {
      const workedHrs = (d.workedMinutes / 60).toFixed(1);
      const leaveCreditMins = d.status === "holiday" ? 0 : Math.round(d.leaveFraction * dailyTargetMinutes);
      const holidayCreditMins = d.status === "holiday" ? dailyTargetMinutes : 0;
      const effHrs = ((d.workedMinutes + leaveCreditMins + holidayCreditMins) / 60).toFixed(1);

      const parts: string[] = [];
      if (d.workedMinutes > 0) {
        parts.push(`${workedHrs}h worked${d.isLiveSession ? " (incl. live shift)" : ""}`);
      }
      if (leaveCreditMins > 0) parts.push(`${(leaveCreditMins / 60).toFixed(1)}h leave credit`);
      if (holidayCreditMins > 0) parts.push(`${(holidayCreditMins / 60).toFixed(1)}h holiday credit`);

      return {
        id: d.date,
        date: d.date,
        checkIn: `${effHrs} hrs effective`,
        statusText:
          d.status === "holiday"
            ? "Holiday"
            : d.leaveFraction >= 1
            ? "Leave"
            : d.leaveFraction > 0
            ? "Half-Day + Worked"
            : d.workedMinutes >= dailyTargetMinutes
            ? "Target Met"
            : "Under Target",
        statusType: (d.workedMinutes + leaveCreditMins + holidayCreditMins >= dailyTargetMinutes ? "on_time" : "late") as
          | "on_time"
          | "late",
        details: `${parts.join(" + ")} · Daily target ${dailyTargetHrsStr}h`,
      };
    });

  const taskDetailRows: KpiMetricDetailData["rows"] = periodTasks.map((t) => {
    const isDone = t.statusAsOfEnd === "done";
    const isOverdue = !isDone && Boolean(t.due_date && t.due_date < effectiveEnd);
    return {
      id: t.id,
      date: t.due_date || t.createdLocal,
      title: t.title,
      checkIn: isDone ? "Done" : t.statusAsOfEnd,
      statusText: t.isOnTime ? "On Time" : isOverdue ? "Overdue" : isDone ? "Late" : "In Progress",
      statusType: t.isOnTime ? "on_time" : isOverdue ? "missing" : isDone ? "late" : "worked",
      details: t.due_date
        ? `Due ${t.due_date}${t.completedLocal ? ` · Completed ${t.completedLocal}` : ""}${t.isOverdueCarryover ? " · Carryover" : ""}`
        : `No due date (excluded from on-time rate)${t.completedLocal ? ` · Completed ${t.completedLocal}` : ""}`,
    };
  });

  const daysWorkedDetailRows: KpiMetricDetailData["rows"] = calendarDays
    .filter((d) => d.status !== "weekend" && d.status !== "future")
    .map((d) => ({
      id: d.date,
      date: d.date,
      statusText: d.label,
      statusType:
        d.status === "holiday"
          ? "holiday"
          : d.status === "leave" || d.status === "partial_leave"
          ? "leave"
          : d.status === "missing" || d.status === "absent"
          ? "missing"
          : d.status === "pending" || d.status === "late"
          ? "late"
          : "worked",
      details:
        d.status === "missing"
          ? "No attendance punch or pending correction recorded"
          : d.status === "pending"
          ? "Regularization request pending approval"
          : d.holidayName || (d.workedMinutes > 0 ? `${(d.workedMinutes / 60).toFixed(1)}h logged` : d.label),
      actionUrl: d.status === "missing" ? `/requests?date=${d.date}&employee_id=${employeeId}` : undefined,
    }));

  const metricDetails: Record<string, KpiMetricDetailData> = {
    on_time_check_in_rate: {
      metric: "on_time_check_in_rate",
      explanation:
        "Evaluates finalized shift check-ins against your scheduled shift start and grace period. Open live shifts in progress today do not determine punctuality until checkout is finalized.",
      formula:
        finalizedPunctualityDays > 0
          ? `(${onTimeDaysCount} on-time / ${finalizedPunctualityDays} finalized scheduled days) × 100 = ${onTimeRate}%`
          : "No finalized shift check-ins yet",
      adjustment: makeAdjMeta("on_time_check_in_rate"),
      rows: punctualDayRows,
    },
    days_worked_vs_expected: {
      metric: "days_worked_vs_expected",
      explanation: `Compares attended scheduled workdays (${fmtCount(attendedScheduledWeight)}) against elapsed scheduled weekdays (${fmtCount(expectedWorkingDays)}) after crediting ${fmtCount(holidayCreditWeekdays)} holiday/company days off and ${fmtCount(leaveCreditWeekdays)} approved leave days (overlapping credits counted once).`,
      formula:
        expectedWorkingDays > 0
          ? `${fmtCount(attendedScheduledWeight)} worked / ${fmtCount(expectedWorkingDays)} scheduled = ${daysWorkedRate ?? 0}%`
          : "0 scheduled weekdays in period",
      adjustment: makeAdjMeta("days_worked_vs_expected"),
      rows: daysWorkedDetailRows,
    },
    worked_hours_vs_target: {
      metric: "worked_hours_vs_target",
      explanation: `Combines ${(finalizedWorkedMinutes / 60).toFixed(1)}h finalized + ${(liveWorkedMinutes / 60).toFixed(1)}h live shift worked hours with ${(leaveCreditMinutes / 60).toFixed(1)}h approved leave credits and ${(holidayCreditMinutes / 60).toFixed(1)}h holiday credits against your ${(dailyTargetMinutes / 60).toFixed(1)}h/day policy target.`,
      formula: `(${(workedMinutes / 60).toFixed(1)}h worked + ${(leaveCreditMinutes / 60).toFixed(1)}h leave + ${(holidayCreditMinutes / 60).toFixed(1)}h holiday) = ${(effectiveMinutes / 60).toFixed(1)}h / ${(targetMinutes / 60).toFixed(1)}h target`,
      adjustment: makeAdjMeta("worked_hours_vs_target"),
      rows: hoursDetailRows,
    },
    tasks_completed_vs_assigned: {
      metric: "tasks_completed_vs_assigned",
      explanation: taskPopulationNote,
      formula:
        totalAssignedTasks > 0
          ? `(${completedTasks.length} done / ${totalAssignedTasks} assigned) × 100 = ${taskCompletionRate}%`
          : "No eligible period tasks",
      limitationNote: historicalLimitationNote,
      adjustment: makeAdjMeta("tasks_completed_vs_assigned"),
      rows: taskDetailRows,
    },
    task_on_time_rate: {
      metric: "task_on_time_rate",
      explanation: `${taskPopulationNote}. Only completed tasks with a due date are evaluated for on-time delivery.`,
      formula:
        completedWithDue.length > 0
          ? `(${completedWithDue.filter((t) => t.isOnTime).length} on-time / ${completedWithDue.length} completed with due date) × 100 = ${taskOnTimeRate}%`
          : "No completed tasks with due dates",
      limitationNote: historicalLimitationNote,
      adjustment: makeAdjMeta("task_on_time_rate"),
      rows: taskDetailRows,
    },
    task_average_cycle_time: {
      metric: "task_average_cycle_time",
      explanation: "Measures average elapsed hours from task start (or creation) to completion on period tasks finished by period end.",
      formula: avgCycleHours != null ? `Mean completion duration = ${avgCycleHours} hrs` : "No completed tasks",
      limitationNote: historicalLimitationNote,
      adjustment: makeAdjMeta("task_average_cycle_time"),
      rows: taskDetailRows,
    },
    task_overdue_count: {
      metric: "task_overdue_count",
      explanation: "Counts active tasks with a due date earlier than today/period end that remained unfinished as of period end.",
      formula: `${overdueCount ?? 0} overdue active tasks (target: 0)`,
      limitationNote: historicalLimitationNote,
      adjustment: makeAdjMeta("task_overdue_count"),
      rows: taskDetailRows,
    },
    early_check_outs: {
      metric: "early_check_outs",
      explanation: "Diagnostic metric tracking early departures. Does not penalize your composite score.",
      formula: `${earlyCheckOutCount} early check-out event(s)`,
      adjustment: makeAdjMeta("early_check_outs"),
      rows: earlyCheckOutRows.map((s: any) => ({
        id: s.id || s.work_date,
        date: s.work_date,
        checkIn: s.check_out_at
          ? new Date(s.check_out_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "—",
        statusText: "Early Check-Out",
        statusType: "late",
        details: "Departed prior to scheduled shift end",
      })),
    },
    auto_closed_check_outs: {
      metric: "auto_closed_check_outs",
      explanation: "Identifies completed/past shifts without a manual check-out punch. Active live shifts today are excluded.",
      formula: `${autoClosedCount} auto-closed / unclosed past shift(s)`,
      adjustment: makeAdjMeta("auto_closed_check_outs"),
      rows: autoClosedRows.map((s: any) => ({
        id: s.id || s.work_date,
        date: s.work_date,
        checkIn: s.check_in_at
          ? new Date(s.check_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "—",
        statusText: "Auto-Closed",
        statusType: "late",
        details: "Missing manual check-out punch on closed shift",
      })),
    },
    regularization_requests: {
      metric: "regularization_requests",
      explanation: "Attendance regularization requests submitted for work dates within this period.",
      formula: `${regularizationCount} request(s) filed`,
      adjustment: makeAdjMeta("regularization_requests"),
      rows: regularizations.map((r: any) => ({
        id: r.id,
        date: r.work_date,
        checkIn: r.status,
        statusText: String(r.status || "pending").toUpperCase(),
        statusType: r.status === "approved" ? "worked" : r.status === "pending" ? "late" : "missing",
        details: r.reason || "Attendance correction request",
      })),
    },
  };

  return {
    employeeId,
    periodStart: from,
    periodEnd: to,
    employeeType: normType,
    overallScore,
    overallTarget,
    dataStatus: sourceErrors.length > 0 ? "unavailable" : "ok",
    sourceErrors,
    weights: activeWeights,
    metrics: metricsRaw,
    metricsList: Object.values(metricsRaw),
    dataPointsCount,
    configEffectiveDate: activeVersion?.effective_from || null,
    configVersionReason: activeVersion?.reason || null,
    hoursBreakdown: {
      workedMinutes,
      finalizedWorkedMinutes,
      liveWorkedMinutes,
      leaveCreditMinutes,
      holidayCreditMinutes,
      effectiveMinutes,
      targetMinutes,
      dailyTargetMinutes,
      hasLiveSession: todayHasOpenSession,
    },
    calendarDays,
    actionableMissingDates,
    pendingCorrectionDates,
    taskPopulationNote,
    historicalLimitationNote,
    metricDetails,
  };
}

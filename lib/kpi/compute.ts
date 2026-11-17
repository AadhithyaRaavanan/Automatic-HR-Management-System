// ============================================================================
// Automatic KPI Metrics Computation Engine
// ============================================================================

import { supabaseAdmin } from "@/lib/supabase/admin";
import { KPI_CONFIG, EmployeeTypeKpiTargets } from "@/lib/kpi/config";

export interface KpiMetricItem {
  key: string;
  label: string;
  category: "attendance" | "hours" | "tasks";
  value: number | null; // null represents "No data" - never forced 0%
  target: number | null;
  unit: string;
  status: "on_track" | "at_risk" | "behind" | "no_data";
  displayValue: string; // e.g., "95%", "18/20 days", "No data"
  adjusted?: boolean;
  adjustmentReason?: string;
  originalValue?: number | null;
}

export interface KpiComputeResult {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  employeeType: string;
  overallScore: number | null; // null if too little data
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
}

function getWeekdaysCount(fromIso: string, toIso: string): number {
  const start = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) {
      count++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

export async function computeKpi(
  employeeId: string,
  from: string,
  to: string,
  explicitEmployeeType?: string
): Promise<KpiComputeResult> {
  const normType = (explicitEmployeeType || KPI_CONFIG.defaultType).toLowerCase();
  const targetConfig: EmployeeTypeKpiTargets =
    KPI_CONFIG.employeeTypes[normType] || KPI_CONFIG.employeeTypes[KPI_CONFIG.defaultType];

  // 1. Fetch all required tables in parallel
  const [
    attendanceDaysRes,
    attendanceSessionsRes,
    regularizationsRes,
    leavesRes,
    holidaysRes,
    tasksRes,
    adjustmentsRes,
  ] = await Promise.all([
    ((supabaseAdmin as any).from("attendance_days"))
      .select("work_date, status, is_late, total_minutes")
      .eq("employee_id", employeeId)
      .gte("work_date", from)
      .lte("work_date", to),
    ((supabaseAdmin as any).from("attendance_sessions"))
      .select("work_date, check_in_at, check_out_at, source, early_checkout")
      .eq("employee_id", employeeId)
      .gte("work_date", from)
      .lte("work_date", to),
    ((supabaseAdmin as any).from("regularization_requests"))
      .select("id, work_date, status")
      .eq("employee_id", employeeId)
      .gte("work_date", from)
      .lte("work_date", to),
    ((supabaseAdmin as any).from("leave_applications"))
      .select("start_date, end_date, status")
      .eq("employee_id", employeeId)
      .eq("status", "approved")
      .or(`start_date.lte.${to},end_date.gte.${from}`),
    ((supabaseAdmin as any).from("holidays"))
      .select("holiday_date")
      .gte("holiday_date", from)
      .lte("holiday_date", to),
    ((supabaseAdmin as any).from("tasks"))
      .select("id, status, due_date, created_at, started_at, completed_at")
      .eq("assignee_id", employeeId)
      .or(`created_at.gte.${from}T00:00:00Z,completed_at.gte.${from}T00:00:00Z,due_date.gte.${from}`)
      .or(`created_at.lte.${to}T23:59:59Z,due_date.lte.${to}`),
    ((supabaseAdmin as any).from("kpi_adjustments"))
      .select("metric, override_value, reason")
      .eq("employee_id", employeeId)
      .lte("period_start", to)
      .gte("period_end", from),
  ]);

  const attendanceDays = attendanceDaysRes?.data || [];
  const attendanceSessions = attendanceSessionsRes?.data || [];
  const regularizations = regularizationsRes?.data || [];
  const approvedLeaves = leavesRes?.data || [];
  const holidays = holidaysRes?.data || [];
  const tasks = tasksRes?.data || [];
  const adjustments = adjustmentsRes?.data || [];

  // Adjustment map for quick lookup
  const adjustmentMap = new Map<string, { value: number; reason: string }>();
  for (const adj of adjustments) {
    if (adj.metric) {
      adjustmentMap.set(adj.metric, {
        value: Number(adj.override_value),
        reason: adj.reason,
      });
    }
  }

  // 2. Working days, holidays, and approved leave calculation
  // Days worked vs expected counts only days that have ALREADY passed (up to current date)
  const todayIso = new Date().toISOString().slice(0, 10);
  const effectiveEnd = to > todayIso ? todayIso : to;
  const totalCalendarWeekdays = effectiveEnd >= from ? getWeekdaysCount(from, effectiveEnd) : 0;

  // Approved leave days in period that fall on weekdays
  let approvedLeaveWeekdays = 0;
  for (const leave of approvedLeaves) {
    const lStart = leave.start_date < from ? from : leave.start_date;
    const lEnd = leave.end_date > effectiveEnd ? effectiveEnd : leave.end_date;
    if (lEnd >= lStart) {
      approvedLeaveWeekdays += getWeekdaysCount(lStart, lEnd);
    }
  }

  // Holidays that fall on weekdays in elapsed period
  let holidayWeekdays = 0;
  for (const h of holidays) {
    if (h.holiday_date >= from && h.holiday_date <= effectiveEnd) {
      const hDate = new Date(`${h.holiday_date}T00:00:00Z`);
      const day = hDate.getUTCDay();
      if (day !== 0 && day !== 6) {
        holidayWeekdays++;
      }
    }
  }

  const expectedWorkingDays = Math.max(
    0,
    totalCalendarWeekdays - holidayWeekdays - approvedLeaveWeekdays
  );

  // 3. Attendance Metrics
  // On-time check-in rate
  const totalAttendedDays = attendanceDays.length;
  let onTimeRate: number | null = null;
  let onTimeDisplay = "No data";
  let onTimeStatus: "on_track" | "at_risk" | "behind" | "no_data" = "no_data";

  if (totalAttendedDays > 0) {
    const onTimeDays = attendanceDays.filter((d: any) => !d.is_late).length;
    onTimeRate = Math.round((onTimeDays / totalAttendedDays) * 100);
    onTimeDisplay = `${onTimeRate}% (${onTimeDays}/${totalAttendedDays} days)`;
    onTimeStatus =
      onTimeRate >= targetConfig.onTimeTargetRate
        ? "on_track"
        : onTimeRate >= targetConfig.onTimeTargetRate - 10
        ? "at_risk"
        : "behind";
  }

  // Days worked vs expected: shows "No data" if the person has no attendance in the period, instead of 0/12 Behind
  const workedDaysCount = attendanceDays.filter(
    (d: any) => d.status === "present" || d.status === "half_day" || (d.total_minutes || 0) > 0
  ).length;

  let daysWorkedRate: number | null = null;
  let daysWorkedDisplay = "No data";
  let daysWorkedStatus: "on_track" | "at_risk" | "behind" | "no_data" = "no_data";

  if (totalAttendedDays === 0) {
    daysWorkedRate = null;
    daysWorkedDisplay = "No data";
    daysWorkedStatus = "no_data";
  } else if (expectedWorkingDays > 0) {
    daysWorkedRate = Math.min(100, Math.round((workedDaysCount / expectedWorkingDays) * 100));
    daysWorkedDisplay = `${workedDaysCount} / ${expectedWorkingDays} days (${daysWorkedRate}%)`;
    daysWorkedStatus =
      daysWorkedRate >= targetConfig.daysWorkedTargetRate
        ? "on_track"
        : daysWorkedRate >= 80
        ? "at_risk"
        : "behind";
  } else if (workedDaysCount > 0) {
    daysWorkedRate = 100;
    daysWorkedDisplay = `${workedDaysCount} days worked (0 expected)`;
    daysWorkedStatus = "on_track";
  }

  // Early check-outs: with nothing to measure (0 attendance), must NOT be green!
  const earlyCheckOutCount = attendanceSessions.filter(
    (s: any) => s.early_checkout === true
  ).length;

  const earlyCheckOutStatus: "on_track" | "at_risk" | "behind" | "no_data" =
    totalAttendedDays === 0
      ? "no_data"
      : earlyCheckOutCount === 0
      ? "on_track"
      : earlyCheckOutCount <= 2
      ? "at_risk"
      : "behind";
  const earlyCheckOutDisplay =
    totalAttendedDays === 0 ? "No data" : `${earlyCheckOutCount}`;

  // Auto-closed / forgotten checkouts
  const autoClosedCount = attendanceSessions.filter(
    (s: any) => s.source === "auto_checkout" || (s.check_in_at && !s.check_out_at)
  ).length;

  const autoClosedStatus: "on_track" | "at_risk" | "behind" | "no_data" =
    totalAttendedDays === 0
      ? "no_data"
      : autoClosedCount === 0
      ? "on_track"
      : autoClosedCount <= 1
      ? "at_risk"
      : "behind";
  const autoClosedDisplay =
    totalAttendedDays === 0 ? "No data" : `${autoClosedCount}`;

  // Regularization requests count
  const regularizationCount = regularizations.length;
  const regularizationStatus: "on_track" | "at_risk" | "behind" | "no_data" =
    totalAttendedDays === 0 && regularizationCount === 0
      ? "no_data"
      : regularizationCount <= 1
      ? "on_track"
      : regularizationCount <= 3
      ? "at_risk"
      : "behind";
  const regularizationDisplay =
    totalAttendedDays === 0 && regularizationCount === 0 ? "No data" : `${regularizationCount}`;

  // 4. Hours Metrics
  // Worked hours vs target (approved leave and holidays count as met)
  let totalWorkedMinutes = 0;
  for (const d of attendanceDays) {
    totalWorkedMinutes += d.total_minutes || 0;
  }

  const hoursPerDay = targetConfig.hoursPerDay || 8;
  const leaveCreditMinutes = approvedLeaveWeekdays * hoursPerDay * 60;
  const holidayCreditMinutes = holidayWeekdays * hoursPerDay * 60;
  const totalEffectiveMinutes = totalWorkedMinutes + leaveCreditMinutes + holidayCreditMinutes;

  const targetMinutes = totalCalendarWeekdays * hoursPerDay * 60;
  let hoursRate: number | null = null;
  let hoursDisplay = "No data";
  let hoursStatus: "on_track" | "at_risk" | "behind" | "no_data" = "no_data";

  if (targetMinutes > 0 && (totalWorkedMinutes > 0 || approvedLeaveWeekdays > 0 || holidayWeekdays > 0)) {
    hoursRate = Math.min(120, Math.round((totalEffectiveMinutes / targetMinutes) * 100));
    const effectiveHours = (totalEffectiveMinutes / 60).toFixed(1);
    const targetHours = (targetMinutes / 60).toFixed(1);
    hoursDisplay = `${effectiveHours}h / ${targetHours}h (${hoursRate}%)`;
    hoursStatus =
      hoursRate >= targetConfig.hoursTargetRate
        ? "on_track"
        : hoursRate >= 80
        ? "at_risk"
        : "behind";
  }

  // 5. Tasks Metrics
  const totalAssignedTasks = tasks.length;
  const completedTasks = tasks.filter((t: any) => t.status === "done");

  let taskCompletionRate: number | null = null;
  let taskCompletionDisplay = "No data";
  let taskCompletionStatus: "on_track" | "at_risk" | "behind" | "no_data" = "no_data";

  if (totalAssignedTasks > 0) {
    taskCompletionRate = Math.round((completedTasks.length / totalAssignedTasks) * 100);
    taskCompletionDisplay = `${completedTasks.length} / ${totalAssignedTasks} (${taskCompletionRate}%)`;
    taskCompletionStatus =
      taskCompletionRate >= targetConfig.taskCompletionTargetRate
        ? "on_track"
        : taskCompletionRate >= 70
        ? "at_risk"
        : "behind";
  }

  // Task on-time completion rate
  const completedWithDue = completedTasks.filter((t: any) => t.due_date && t.completed_at);
  let taskOnTimeRate: number | null = null;
  let taskOnTimeDisplay = "No data";
  let taskOnTimeStatus: "on_track" | "at_risk" | "behind" | "no_data" = "no_data";

  if (completedWithDue.length > 0) {
    const onTimeTasks = completedWithDue.filter((t: any) => {
      const compDate = t.completed_at.slice(0, 10);
      return compDate <= t.due_date;
    });
    taskOnTimeRate = Math.round((onTimeTasks.length / completedWithDue.length) * 100);
    taskOnTimeDisplay = `${taskOnTimeRate}% (${onTimeTasks.length}/${completedWithDue.length})`;
    taskOnTimeStatus =
      taskOnTimeRate >= targetConfig.taskOnTimeTargetRate
        ? "on_track"
        : taskOnTimeRate >= 70
        ? "at_risk"
        : "behind";
  }

  // Average task cycle time (hours)
  let avgCycleHours: number | null = null;
  let cycleDisplay = "No data";
  let cycleStatus: "on_track" | "at_risk" | "behind" | "no_data" = "no_data";

  if (completedTasks.length > 0) {
    let totalCycleMs = 0;
    let countedTasks = 0;
    for (const t of completedTasks) {
      const startMs = t.started_at ? new Date(t.started_at).getTime() : new Date(t.created_at).getTime();
      const endMs = new Date(t.completed_at).getTime();
      if (endMs >= startMs) {
        totalCycleMs += endMs - startMs;
        countedTasks++;
      }
    }
    if (countedTasks > 0) {
      avgCycleHours = Number((totalCycleMs / (countedTasks * 3600000)).toFixed(1));
      cycleDisplay = `${avgCycleHours} hrs`;
      cycleStatus = avgCycleHours <= 48 ? "on_track" : avgCycleHours <= 96 ? "at_risk" : "behind";
    }
  }

  // Overdue tasks count
  const overdueCount = tasks.filter(
    (t: any) => t.due_date && t.due_date < to && t.status !== "done" && t.status !== "cancelled"
  ).length;

  // Helper to apply adjustments
  function applyAdj(metricKey: string, base: KpiMetricItem): KpiMetricItem {
    if (adjustmentMap.has(metricKey)) {
      const adj = adjustmentMap.get(metricKey)!;
      return {
        ...base,
        originalValue: base.value,
        value: adj.value,
        displayValue: `${adj.value}${base.unit ? " " + base.unit : ""}`,
        adjusted: true,
        adjustmentReason: adj.reason,
        status: adj.value >= (base.target || 80) ? "on_track" : "at_risk",
      };
    }
    return base;
  }

  // Construct raw metric items
  const metricsRaw = {
    on_time_check_in_rate: applyAdj("on_time_check_in_rate", {
      key: "on_time_check_in_rate",
      label: "On-Time Check-In Rate",
      category: "attendance",
      value: onTimeRate,
      target: targetConfig.onTimeTargetRate,
      unit: "%",
      status: onTimeStatus,
      displayValue: onTimeDisplay,
    }),
    days_worked_vs_expected: applyAdj("days_worked_vs_expected", {
      key: "days_worked_vs_expected",
      label: "Days Worked vs Expected",
      category: "attendance",
      value: daysWorkedRate,
      target: targetConfig.daysWorkedTargetRate,
      unit: "%",
      status: daysWorkedStatus,
      displayValue: daysWorkedDisplay,
    }),
    early_check_outs: applyAdj("early_check_outs", {
      key: "early_check_outs",
      label: "Early Check-Outs",
      category: "attendance",
      value: totalAttendedDays === 0 ? null : earlyCheckOutCount,
      target: 0,
      unit: "count",
      status: earlyCheckOutStatus,
      displayValue: earlyCheckOutDisplay,
    }),
    auto_closed_check_outs: applyAdj("auto_closed_check_outs", {
      key: "auto_closed_check_outs",
      label: "Auto-Closed / Forgotten Check-Outs",
      category: "attendance",
      value: totalAttendedDays === 0 ? null : autoClosedCount,
      target: 0,
      unit: "count",
      status: autoClosedStatus,
      displayValue: autoClosedDisplay,
    }),
    regularization_requests: applyAdj("regularization_requests", {
      key: "regularization_requests",
      label: "Regularization Requests",
      category: "attendance",
      value: totalAttendedDays === 0 && regularizationCount === 0 ? null : regularizationCount,
      target: 0,
      unit: "count",
      status: regularizationStatus,
      displayValue: regularizationDisplay,
    }),
    worked_hours_vs_target: applyAdj("worked_hours_vs_target", {
      key: "worked_hours_vs_target",
      label: "Worked Hours vs Target",
      category: "hours",
      value: hoursRate,
      target: targetConfig.hoursTargetRate,
      unit: "%",
      status: hoursStatus,
      displayValue: hoursDisplay,
    }),
    tasks_completed_vs_assigned: applyAdj("tasks_completed_vs_assigned", {
      key: "tasks_completed_vs_assigned",
      label: "Tasks Completed vs Assigned",
      category: "tasks",
      value: taskCompletionRate,
      target: targetConfig.taskCompletionTargetRate,
      unit: "%",
      status: taskCompletionStatus,
      displayValue: taskCompletionDisplay,
    }),
    task_on_time_rate: applyAdj("task_on_time_rate", {
      key: "task_on_time_rate",
      label: "Task On-Time Completion Rate",
      category: "tasks",
      value: taskOnTimeRate,
      target: targetConfig.taskOnTimeTargetRate,
      unit: "%",
      status: taskOnTimeStatus,
      displayValue: taskOnTimeDisplay,
    }),
    task_average_cycle_time: applyAdj("task_average_cycle_time", {
      key: "task_average_cycle_time",
      label: "Average Task Cycle Time",
      category: "tasks",
      value: avgCycleHours,
      target: 48,
      unit: "hrs",
      status: cycleStatus,
      displayValue: cycleDisplay,
    }),
    task_overdue_count: applyAdj("task_overdue_count", {
      key: "task_overdue_count",
      label: "Overdue Tasks Count",
      category: "tasks",
      value: overdueCount,
      target: 0,
      unit: "count",
      status: overdueCount === 0 ? "on_track" : overdueCount <= 2 ? "at_risk" : "behind",
      displayValue: `${overdueCount}`,
    }),
  };

  // 6. Overall Weighted Score (returns null if insufficient data)
  const weightedMetrics = [
    { key: "on_time_check_in_rate", val: metricsRaw.on_time_check_in_rate.value, weight: KPI_CONFIG.weights.on_time_check_in_rate },
    { key: "days_worked_vs_expected", val: metricsRaw.days_worked_vs_expected.value, weight: KPI_CONFIG.weights.days_worked_vs_expected },
    { key: "worked_hours_vs_target", val: metricsRaw.worked_hours_vs_target.value, weight: KPI_CONFIG.weights.worked_hours_vs_target },
    { key: "tasks_completed_vs_assigned", val: metricsRaw.tasks_completed_vs_assigned.value, weight: KPI_CONFIG.weights.tasks_completed_vs_assigned },
    { key: "task_on_time_rate", val: metricsRaw.task_on_time_rate.value, weight: KPI_CONFIG.weights.task_on_time_rate },
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

  // If fewer than 2 core metrics have data or zero activity in period, return null overall score (never forced 0%)
  const overallScore =
    (totalAttendedDays > 0 || tasks.length > 0) &&
    dataPointsCount >= 2 &&
    totalWeight > 0
      ? Math.round(weightedSum / totalWeight)
      : null;

  return {
    employeeId,
    periodStart: from,
    periodEnd: to,
    employeeType: normType,
    overallScore,
    metrics: metricsRaw,
    metricsList: Object.values(metricsRaw),
    dataPointsCount,
  };
}

// ============================================================================
// /api/kpi/detail: Raw Record Drilldown for Scored & Diagnostic Metrics
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/lib/kpi/auth-helper";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function getWeekdays(fromIso: string, toIso: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cur.toISOString().slice(0, 10));
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export async function GET(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employee_id");
  const metric = searchParams.get("metric");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!employeeId || !metric || !from || !to) {
    return NextResponse.json(
      { error: "employee_id, metric, from, and to are required parameters" },
      { status: 400 }
    );
  }

  const isAllowed = await verifyEmployeeAccess(caller, employeeId);
  if (!isAllowed) {
    return NextResponse.json(
      { error: "Forbidden: You do not have access to view this employee's KPI detail" },
      { status: 403 }
    );
  }

  try {
    // 1. Fetch any adjustment on this metric
    const { data: adj } = await (supabaseAdmin as any)
      .from("kpi_adjustments")
      .select("override_value, reason, created_at, created_by")
      .eq("employee_id", employeeId)
      .eq("metric", metric)
      .lte("period_start", to)
      .gte("period_end", from)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const adjustmentInfo = adj
      ? {
          isAdjusted: true,
          overrideValue: Number(adj.override_value),
          reason: adj.reason,
          createdAt: adj.created_at,
        }
      : null;

    // 2. Fetch specific detail rows based on metric
    let rows: any[] = [];
    let formula = "";
    let explanation = "";

    if (metric === "on_time_check_in_rate") {
      const [daysRes, sessRes] = await Promise.all([
        (supabaseAdmin as any)
          .from("attendance_days")
          .select("work_date, status, is_late, total_minutes")
          .eq("employee_id", employeeId)
          .gte("work_date", from)
          .lte("work_date", to)
          .order("work_date", { ascending: true }),
        (supabaseAdmin as any)
          .from("attendance_sessions")
          .select("work_date, check_in_at, check_out_at")
          .eq("employee_id", employeeId)
          .gte("work_date", from)
          .lte("work_date", to),
      ]);

      const days = daysRes?.data || [];
      const sess = sessRes?.data || [];
      const sessMap = new Map<string, any>();
      for (const s of sess) {
        if (!sessMap.has(s.work_date)) sessMap.set(s.work_date, s);
      }

      const total = days.length;
      const onTime = days.filter((d: any) => !d.is_late).length;
      formula = total > 0 ? `(${onTime} punctual / ${total} attended) × 100 = ${Math.round((onTime / total) * 100)}%` : "0 attended days";
      explanation = "Evaluates each day with an attendance punch against the scheduled shift start time. Shift grace windows are counted as on-time.";

      rows = days.map((d: any) => {
        const s = sessMap.get(d.work_date);
        const checkInTime = s?.check_in_at
          ? new Date(s.check_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "—";
        return {
          id: d.work_date,
          date: d.work_date,
          checkIn: checkInTime,
          statusText: d.is_late ? "Late" : "On Time",
          statusType: d.is_late ? "late" : "on_time",
          details: d.is_late ? "Checked in after shift grace period" : "Punched on or before shift start",
        };
      });
    } else if (metric === "days_worked_vs_expected") {
      const todayIso = new Date().toISOString().slice(0, 10);
      const effectiveEnd = to > todayIso ? todayIso : to;
      const weekdays = effectiveEnd >= from ? getWeekdays(from, effectiveEnd) : [];

      const [daysRes, leavesRes, holidaysRes] = await Promise.all([
        (supabaseAdmin as any)
          .from("attendance_days")
          .select("work_date, status, total_minutes")
          .eq("employee_id", employeeId)
          .gte("work_date", from)
          .lte("work_date", effectiveEnd),
        (supabaseAdmin as any)
          .from("leave_applications")
          .select("start_date, end_date, status")
          .eq("employee_id", employeeId)
          .eq("status", "approved")
          .or(`start_date.lte.${effectiveEnd},end_date.gte.${from}`),
        (supabaseAdmin as any)
          .from("holidays")
          .select("holiday_date, name")
          .gte("holiday_date", from)
          .lte("holiday_date", effectiveEnd),
      ]);

      const attendedSet = new Set((daysRes?.data || []).filter((d: any) => d.status === "present" || d.status === "half_day" || (d.total_minutes || 0) > 0).map((d: any) => d.work_date));
      const holidayMap = new Map((holidaysRes?.data || []).map((h: any) => [h.holiday_date, h.name || "Holiday"]));

      const leaveSet = new Set<string>();
      for (const l of leavesRes?.data || []) {
        const cur = new Date(`${l.start_date}T00:00:00Z`);
        const end = new Date(`${l.end_date}T00:00:00Z`);
        while (cur <= end) {
          leaveSet.add(cur.toISOString().slice(0, 10));
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }

      let workedCount = 0;
      let leaveCount = 0;
      let holidayCount = 0;
      let missingCount = 0;

      rows = weekdays.map((dateStr) => {
        if (attendedSet.has(dateStr)) {
          workedCount++;
          return { id: dateStr, date: dateStr, statusText: "Worked", statusType: "worked", details: "Present for scheduled shift" };
        }
        if (holidayMap.has(dateStr)) {
          holidayCount++;
          return { id: dateStr, date: dateStr, statusText: "Holiday", statusType: "holiday", details: holidayMap.get(dateStr) };
        }
        if (leaveSet.has(dateStr)) {
          leaveCount++;
          return { id: dateStr, date: dateStr, statusText: "Leave", statusType: "leave", details: "Approved leave application" };
        }
        missingCount++;
        return { id: dateStr, date: dateStr, statusText: "Missing", statusType: "missing", details: "No attendance punch recorded" };
      });

      const scheduledWorkdays = Math.max(0, weekdays.length - holidayCount - leaveCount);
      formula = `${workedCount} worked / ${scheduledWorkdays} scheduled days = ${scheduledWorkdays > 0 ? Math.round((workedCount / scheduledWorkdays) * 100) : 100}%`;
      explanation = `Calculates scheduled elapsed weekdays up to today (${weekdays.length} total), subtracting official holidays (${holidayCount}) and approved leaves (${leaveCount}) which are credited and not penalized.`;
    } else if (metric === "worked_hours_vs_target") {
      const daysRes = await (supabaseAdmin as any)
        .from("attendance_days")
        .select("work_date, total_minutes")
        .eq("employee_id", employeeId)
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date", { ascending: true });

      const days = daysRes?.data || [];
      let totalMins = 0;
      rows = days.map((d: any) => {
        const mins = d.total_minutes || 0;
        totalMins += mins;
        const hrs = (mins / 60).toFixed(1);
        const targetHrs = "8.0";
        return {
          id: d.work_date,
          date: d.work_date,
          checkIn: `${hrs} hrs`,
          statusText: mins >= 480 ? "Target Met" : mins > 0 ? "Under Target" : "No Hours",
          statusType: mins >= 480 ? "on_time" : "late",
          details: `${hrs} hrs logged vs ${targetHrs} hrs target`,
        };
      });

      formula = `${(totalMins / 60).toFixed(1)} effective hours logged`;
      explanation = "Compares actual productive work hours against policy expectations (standard 8h/day). Approved leaves and holidays credit standard shift hours.";
    } else if (metric === "tasks_completed_vs_assigned" || metric === "task_on_time_rate" || metric === "task_overdue_count" || metric === "task_average_cycle_time") {
      const tasksRes = await (supabaseAdmin as any)
        .from("tasks")
        .select("id, title, status, priority, due_date, created_at, completed_at, started_at")
        .eq("assignee_id", employeeId)
        .order("created_at", { ascending: false });

      const allTasks = tasksRes?.data || [];
      const relevantTasks = allTasks.filter((t: any) => {
        const createdIn = t.created_at >= `${from}T00:00:00Z` && t.created_at <= `${to}T23:59:59Z`;
        const completedIn = t.completed_at && t.completed_at >= `${from}T00:00:00Z` && t.completed_at <= `${to}T23:59:59Z`;
        const dueIn = t.due_date && t.due_date >= from && t.due_date <= to;
        return createdIn || completedIn || dueIn;
      });

      rows = relevantTasks.map((t: any) => {
        const isDone = t.status === "done";
        const isOnTime = isDone && t.due_date && t.completed_at ? t.completed_at.slice(0, 10) <= t.due_date : false;
        const isOverdue = !isDone && t.status !== "cancelled" && t.due_date && t.due_date < to;

        return {
          id: t.id,
          date: t.due_date || t.created_at.slice(0, 10),
          title: t.title,
          checkIn: isDone ? "Done" : t.status,
          statusText: isOnTime ? "On Time" : isOverdue ? "Overdue" : isDone ? "Late" : "In Progress",
          statusType: isOnTime ? "on_time" : isOverdue ? "missing" : isDone ? "late" : "worked",
          details: t.due_date ? `Due ${t.due_date}${t.completed_at ? ` • Completed ${t.completed_at.slice(0, 10)}` : ""}` : "No due date set",
        };
      });

      explanation = "Tracks sprint deliverables, completed milestones, and delivery punctuality against agreed target dates.";
      formula = `${rows.filter(r => r.statusType === "on_time").length} on-time / ${rows.filter(r => r.checkIn === "Done").length} completed`;
    } else if (metric === "early_check_outs") {
      const sessRes = await (supabaseAdmin as any)
        .from("attendance_sessions")
        .select("id, work_date, check_in_at, check_out_at, early_checkout")
        .eq("employee_id", employeeId)
        .eq("early_checkout", true)
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date", { ascending: true });

      rows = (sessRes?.data || []).map((s: any) => ({
        id: s.id,
        date: s.work_date,
        checkIn: s.check_out_at ? new Date(s.check_out_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
        statusText: "Early Departure",
        statusType: "late",
        details: "Departed prior to scheduled shift conclusion without authorized coverage",
      }));
      explanation = "Diagnostic metric recording early departures. Early check-outs do NOT penalize the composite overall score.";
      formula = `${rows.length} early departure events recorded`;
    } else if (metric === "auto_closed_check_outs") {
      const sessRes = await (supabaseAdmin as any)
        .from("attendance_sessions")
        .select("id, work_date, check_in_at, check_out_at, source")
        .eq("employee_id", employeeId)
        .eq("source", "auto_checkout")
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date", { ascending: true });

      rows = (sessRes?.data || []).map((s: any) => ({
        id: s.id,
        date: s.work_date,
        checkIn: s.check_in_at ? new Date(s.check_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
        statusText: "Auto-Closed",
        statusType: "late",
        details: "Session auto-closed at midnight due to missing check-out punch",
      }));
      explanation = "Identifies missed manual check-outs. Can be regularized under Requests.";
      formula = `${rows.length} auto-closed sessions`;
    } else if (metric === "regularization_requests") {
      const regRes = await (supabaseAdmin as any)
        .from("regularization_requests")
        .select("id, work_date, status, reason, created_at")
        .eq("employee_id", employeeId)
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date", { ascending: true });

      rows = (regRes?.data || []).map((r: any) => ({
        id: r.id,
        date: r.work_date,
        checkIn: r.status,
        statusText: r.status.toUpperCase(),
        statusType: r.status === "approved" ? "worked" : r.status === "pending" ? "late" : "missing",
        details: r.reason || "Attendance correction request",
      }));
      explanation = "Total attendance correction requests filed during the evaluation window.";
      formula = `${rows.length} regularization requests filed`;
    }

    return NextResponse.json({
      metric,
      explanation,
      formula,
      adjustment: adjustmentInfo,
      rows,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch metric detail" }, { status: 500 });
  }
}

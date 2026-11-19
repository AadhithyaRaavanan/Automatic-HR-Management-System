// ============================================================================
// /api/kpi/history: Multi-Period Performance Trend History
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/lib/kpi/auth-helper";
import { computeKpi } from "@/lib/kpi/compute";

export const dynamic = "force-dynamic";

interface PeriodSlice {
  label: string;
  from: string;
  to: string;
}

function calculateHistoricalPeriods(count: number, periodType: string = "month", baseDate = new Date()): PeriodSlice[] {
  const slices: PeriodSlice[] = [];
  const todayIso = new Date().toISOString().slice(0, 10);

  for (let i = count - 1; i >= 0; i--) {
    if (periodType === "week") {
      const end = new Date(baseDate.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
      const label = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      slices.push({
        label,
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
      });
    } else if (periodType === "quarter") {
      const totalMonths = baseDate.getFullYear() * 12 + baseDate.getMonth() - i * 3;
      const y = Math.floor(totalMonths / 12);
      const m = totalMonths % 12;
      const q = Math.floor(m / 3) + 1;
      const start = new Date(y, (q - 1) * 3, 1).toISOString().slice(0, 10);
      const end = new Date(y, q * 3, 0).toISOString().slice(0, 10);
      slices.push({
        label: `Q${q} ${y}`,
        from: start,
        to: end > todayIso ? todayIso : end,
      });
    } else {
      // Month
      const totalMonths = baseDate.getFullYear() * 12 + baseDate.getMonth() - i;
      const y = Math.floor(totalMonths / 12);
      const m = totalMonths % 12;
      const start = new Date(y, m, 1).toISOString().slice(0, 10);
      const end = new Date(y, m + 1, 0).toISOString().slice(0, 10);
      const label = new Date(y, m, 1).toLocaleDateString("en-US", { month: "short" });
      slices.push({
        label,
        from: start,
        to: end > todayIso ? todayIso : end,
      });
    }
  }

  return slices;
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
  const count = Math.min(12, Math.max(2, Number(searchParams.get("periods")) || 6));
  const periodType = searchParams.get("period_type") || "month";

  if (!employeeId) {
    return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  }

  const isAllowed = await verifyEmployeeAccess(caller, employeeId);
  if (!isAllowed) {
    return NextResponse.json(
      { error: "Forbidden: You do not have access to view this employee's KPI history" },
      { status: 403 }
    );
  }

  try {
    const slices = calculateHistoricalPeriods(count, periodType);

    // Compute KPI for each period concurrently
    const results = await Promise.all(
      slices.map(async (slice) => {
        try {
          const res = await computeKpi(employeeId, slice.from, slice.to);
          const att1 = res.metrics.on_time_check_in_rate.value;
          const att2 = res.metrics.days_worked_vs_expected.value;
          const attendanceScore =
            att1 != null && att2 != null
              ? Math.round((att1 + att2) / 2)
              : att1 ?? att2 ?? null;

          const hoursScore = res.metrics.worked_hours_vs_target.value;

          const t1 = res.metrics.tasks_completed_vs_assigned.value;
          const t2 = res.metrics.task_on_time_rate.value;
          const tasksScore =
            t1 != null && t2 != null
              ? Math.round((t1 + t2) / 2)
              : t1 ?? t2 ?? null;

          return {
            label: slice.label,
            from: slice.from,
            to: slice.to,
            overallScore: res.overallScore, // null if no data
            attendanceScore,
            hoursScore,
            tasksScore,
          };
        } catch {
          return {
            label: slice.label,
            from: slice.from,
            to: slice.to,
            overallScore: null,
            attendanceScore: null,
            hoursScore: null,
            tasksScore: null,
          };
        }
      })
    );

    return NextResponse.json({
      employeeId,
      periods: results,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch KPI history" }, { status: 500 });
  }
}

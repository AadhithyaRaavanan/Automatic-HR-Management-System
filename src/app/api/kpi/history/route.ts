// ============================================================================
// /api/kpi/history: Multi-Period Performance Trend History
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/features/kpi/auth-helper";
import { computeKpi } from "@/features/kpi/compute";
import { getKolkataToday, getKolkataTodayParts, pad2 } from "@/features/kpi/date-helper";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface PeriodSlice {
  label: string;
  from: string;
  to: string;
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function calculateHistoricalPeriods(count: number, periodType: string = "month"): PeriodSlice[] {
  const slices: PeriodSlice[] = [];
  const { year: curYear, month: curMonth, day: curDay } = getKolkataTodayParts();
  const todayIso = getKolkataToday();

  for (let i = count - 1; i >= 0; i--) {
    if (periodType === "week") {
      const anchor = new Date(Date.UTC(curYear, curMonth - 1, curDay));
      const end = new Date(anchor.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
      const label = `${start.getUTCDate()} ${MONTH_SHORT[start.getUTCMonth()]}`;
      const fromStr = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`;
      const toStr = `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
      slices.push({
        label,
        from: fromStr,
        to: toStr > todayIso ? todayIso : toStr,
      });
    } else if (periodType === "quarter") {
      const totalMonths = curYear * 12 + (curMonth - 1) - i * 3;
      const y = Math.floor(totalMonths / 12);
      const m = totalMonths % 12; // 0..11
      const q = Math.floor(m / 3) + 1;
      const qStartMonth = (q - 1) * 3 + 1;
      const qEndMonth = q * 3;
      const lastDay = new Date(y, qEndMonth, 0).getDate();
      const from = `${y}-${pad2(qStartMonth)}-01`;
      const end = `${y}-${pad2(qEndMonth)}-${pad2(lastDay)}`;
      slices.push({
        label: `Q${q} ${y}`,
        from,
        to: end > todayIso ? todayIso : end,
      });
    } else {
      // Month
      const totalMonths = curYear * 12 + (curMonth - 1) - i;
      const y = Math.floor(totalMonths / 12);
      const m = totalMonths % 12; // 0..11
      const monthNum = m + 1;
      const lastDay = new Date(y, monthNum, 0).getDate();
      const from = `${y}-${pad2(monthNum)}-01`;
      const end = `${y}-${pad2(monthNum)}-${pad2(lastDay)}`;
      const label = MONTH_SHORT[m];
      slices.push({
        label,
        from,
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
    const { data: empMeta } = await (supabaseAdmin.from("employees") as any)
      .select("organization_id, employment_category")
      .eq("id", employeeId)
      .maybeSingle();

    const slices = calculateHistoricalPeriods(count, periodType);

    // Compute KPI for each period concurrently using org & employment category
    const results = await Promise.all(
      slices.map(async (slice) => {
        try {
          const res = await computeKpi(
            employeeId,
            slice.from,
            slice.to,
            empMeta?.employment_category || undefined,
            empMeta?.organization_id || caller.organizationId
          );
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

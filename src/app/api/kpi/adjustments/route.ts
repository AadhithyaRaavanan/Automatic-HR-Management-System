// ============================================================================
// /api/kpi/adjustments: Metric Adjustments with Required Justification
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/features/kpi/auth-helper";
import { getKolkataToday } from "@/features/kpi/date-helper";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ALLOWED_ADJUSTMENT_METRICS = new Set([
  "on_time_check_in_rate",
  "days_worked_vs_expected",
  "early_check_outs",
  "auto_closed_check_outs",
  "regularization_requests",
  "worked_hours_vs_target",
  "tasks_completed_vs_assigned",
  "task_on_time_rate",
  "task_average_cycle_time",
  "task_overdue_count",
]);

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (caller.role === "employee") {
    return NextResponse.json({ error: "Forbidden: Only managers, HR, and admins can adjust metrics" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { employee_id, metric, period_start, period_end, override_value, reason } = body;

    if (!employee_id || !metric || override_value == null) {
      return NextResponse.json(
        { error: "employee_id, metric, and override_value are required" },
        { status: 400 }
      );
    }

    if (!ALLOWED_ADJUSTMENT_METRICS.has(metric)) {
      return NextResponse.json({ error: "Unknown KPI metric key" }, { status: 400 });
    }

    const numericOverride = Number(override_value);
    if (!Number.isFinite(numericOverride) || numericOverride < 0) {
      return NextResponse.json({ error: "override_value must be a non-negative number" }, { status: 400 });
    }

    if (caller.userId === employee_id) {
      return NextResponse.json(
        { error: "Forbidden: You cannot adjust your own KPI metrics." },
        { status: 403 }
      );
    }

    const isAllowed = await verifyEmployeeAccess(caller, employee_id);
    if (!isAllowed) {
      return NextResponse.json({ error: "Forbidden: Employee is outside your adjustment scope" }, { status: 403 });
    }

    const trimmedReason = (reason || "").trim();
    if (!trimmedReason || trimmedReason.length < 5) {
      return NextResponse.json(
        { error: "A detailed adjustment reason is required (minimum 5 characters)." },
        { status: 400 }
      );
    }

    const todayIso = getKolkataToday();
    const { data: newAdj, error } = await (supabaseAdmin as any)
      .from("kpi_adjustments")
      .insert({
        employee_id,
        metric,
        period_start: period_start || todayIso,
        period_end: period_end || todayIso,
        override_value: numericOverride,
        reason: trimmedReason,
        created_by: caller.userId,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, adjustment: newAdj }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Invalid adjustment payload" }, { status: 400 });
  }
}

// ============================================================================
// /api/kpi/adjustments: Metric Adjustments with Required Justification
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/lib/kpi/auth-helper";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

    const { data: newAdj, error } = await (supabaseAdmin as any)
      .from("kpi_adjustments")
      .insert({
        employee_id,
        metric,
        period_start: period_start || new Date().toISOString().slice(0, 10),
        period_end: period_end || new Date().toISOString().slice(0, 10),
        override_value: Number(override_value),
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

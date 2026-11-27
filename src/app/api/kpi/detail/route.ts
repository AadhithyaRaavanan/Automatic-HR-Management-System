// ============================================================================
// /api/kpi/detail: Authoritative Metric Drilldown Powered by computeKpi
// Guarantees exact 1:1 parity with KPI Overview, Team Matrix, and CSV Export.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/features/kpi/auth-helper";
import { computeKpi } from "@/features/kpi/compute";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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
  const explicitEmployeeType = searchParams.get("employee_type") || undefined;

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
    const { data: empMeta } = await (supabaseAdmin as any)
      .from("employees")
      .select("id, organization_id, employment_category")
      .eq("id", employeeId)
      .maybeSingle();

    const kpi = await computeKpi(
      employeeId,
      from,
      to,
      explicitEmployeeType || empMeta?.employment_category || undefined,
      empMeta?.organization_id || caller.organizationId
    );

    const detail = kpi.metricDetails[metric];
    if (!detail) {
      return NextResponse.json({ error: `Unknown KPI metric: ${metric}` }, { status: 400 });
    }

    const metricItem = (kpi.metrics as Record<string, any>)[metric] || null;

    return NextResponse.json({
      ...detail,
      metricItem,
      overallTarget: kpi.overallTarget,
      dataStatus: kpi.dataStatus,
      sourceErrors: kpi.sourceErrors,
      hoursBreakdown: kpi.hoursBreakdown,
      taskPopulationNote: kpi.taskPopulationNote,
      historicalLimitationNote: kpi.historicalLimitationNote,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch metric detail" }, { status: 500 });
  }
}

// ============================================================================
// GET /api/kpi/summary: KPI Summary for Badges and Widgets
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/features/kpi/auth-helper";
import { computeKpi } from "@/features/kpi/compute";
import { getKolkataPresetDates } from "@/features/kpi/date-helper";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const targetEmployeeId = searchParams.get("employeeId") || searchParams.get("employee_id") || caller.userId;

  const isAllowed = await verifyEmployeeAccess(caller, targetEmployeeId);
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { from, to } = getKolkataPresetDates("month");
  const kpiResult = await computeKpi(targetEmployeeId, from, to, undefined, caller.organizationId);

  return NextResponse.json({
    overallScore: kpiResult.overallScore ?? 0,
    overallTarget: kpiResult.overallTarget,
    hasActivity: kpiResult.dataPointsCount > 0,
    overallScoreRaw: kpiResult.overallScore,
    dataPointsCount: kpiResult.dataPointsCount,
    dataStatus: kpiResult.dataStatus,
  });
}

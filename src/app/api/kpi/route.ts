// ============================================================================
// GET /api/kpi: Scoped Automatic KPI Metrics & Trends
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/features/kpi/auth-helper";
import { computeKpi, KpiComputeResult } from "@/features/kpi/compute";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getKolkataPresetDates, pad2 } from "@/features/kpi/date-helper";

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
  const targetEmployeeId = searchParams.get("employee_id") || caller.userId;
  const employeeType = searchParams.get("employee_type") || undefined;
  const deptFilter = searchParams.get("department") || undefined;

  // Server-side access verification
  const isAllowed = await verifyEmployeeAccess(caller, targetEmployeeId);
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden: Access denied to target employee KPI" }, { status: 403 });
  }

  // Date range parsing (default: Asia/Kolkata current month to date)
  const defaultDates = getKolkataPresetDates("month");
  const from = searchParams.get("from") || defaultDates.from;
  const to = searchParams.get("to") || defaultDates.to;

  // Previous period calculation (same number of days immediately preceding `from`)
  const [fYear, fMonth, fDay] = from.split("-").map(Number);
  const [tYear, tMonth, tDay] = to.split("-").map(Number);
  const fromTime = Date.UTC(fYear, fMonth - 1, fDay);
  const toTime = Date.UTC(tYear, tMonth - 1, tDay);
  const diffTime = Math.max(1, toTime - fromTime);
  const prevToDate = new Date(fromTime - 24 * 60 * 60 * 1000);
  const prevFromDate = new Date(prevToDate.getTime() - diffTime);

  const prevTo = `${prevToDate.getUTCFullYear()}-${pad2(prevToDate.getUTCMonth() + 1)}-${pad2(prevToDate.getUTCDate())}`;
  const prevFrom = `${prevFromDate.getUTCFullYear()}-${pad2(prevFromDate.getUTCMonth() + 1)}-${pad2(prevFromDate.getUTCDate())}`;

  // Target employee info
  const { data: targetEmp } = await (supabaseAdmin.from("employees") as any)
    .select("id, full_name, email, department_id, job_title_id, status")
    .eq("id", targetEmployeeId)
    .maybeSingle();

  const effectiveEmpType = employeeType || "full_time";

  // Compute current and previous period KPI
  const [currentKpi, previousKpi] = await Promise.all([
    computeKpi(targetEmployeeId, from, to, effectiveEmpType),
    computeKpi(targetEmployeeId, prevFrom, prevTo, effectiveEmpType),
  ]);

  // If manager/HR/admin: calculate scoped employees and team average
  let scopedEmployees: Array<{ id: string; full_name: string | null; email: string; department_id: string | null }> = [];
  let teamAverage: { overallScore: number | null; onTimeRate: number | null; completionRate: number | null } | null = null;

  if (caller.role !== "employee") {
    let empQuery = (supabaseAdmin.from("employees") as any)
      .select("id, full_name, email, department_id, manager_id")
      .eq("status", "active");

    if (caller.role === "manager") {
      if (caller.departmentId) {
        empQuery = empQuery.or(`manager_id.eq.${caller.userId},department_id.eq.${caller.departmentId},id.eq.${caller.userId}`);
      } else {
        empQuery = empQuery.or(`manager_id.eq.${caller.userId},id.eq.${caller.userId}`);
      }
    }

    if (deptFilter && (caller.role === "admin" || caller.role === "hr")) {
      empQuery = empQuery.eq("department_id", deptFilter);
    }

    const { data: empList } = await empQuery.order("full_name");
    scopedEmployees = empList || [];

    // Compute team average for up to 10 sample peers to avoid heavy load
    const samplePeers = scopedEmployees.slice(0, 10);
    if (samplePeers.length > 0) {
      const peerKpis = await Promise.all(
        samplePeers.map((p) => computeKpi(p.id, from, to))
      );
      const validScores = peerKpis.map((k) => k.overallScore).filter((s): s is number => s != null);
      const validOnTime = peerKpis.map((k) => k.metrics.on_time_check_in_rate.value).filter((s): s is number => s != null);
      const validComp = peerKpis.map((k) => k.metrics.tasks_completed_vs_assigned.value).filter((s): s is number => s != null);

      teamAverage = {
        overallScore: validScores.length > 0 ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : null,
        onTimeRate: validOnTime.length > 0 ? Math.round(validOnTime.reduce((a, b) => a + b, 0) / validOnTime.length) : null,
        completionRate: validComp.length > 0 ? Math.round(validComp.reduce((a, b) => a + b, 0) / validComp.length) : null,
      };
    }
  }

  // Trend vs previous period
  const trend = {
    overallScore:
      currentKpi.overallScore != null && previousKpi.overallScore != null
        ? currentKpi.overallScore - previousKpi.overallScore
        : null,
  };

  return NextResponse.json({
    employee: targetEmp || { id: targetEmployeeId, full_name: "Employee", email: "" },
    current: currentKpi,
    previous: previousKpi,
    trend,
    teamAverage,
    scopedEmployees,
    viewerRole: caller.role,
  });
}

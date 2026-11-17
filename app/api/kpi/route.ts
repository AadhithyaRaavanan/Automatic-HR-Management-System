// ============================================================================
// GET /api/kpi: Scoped Automatic KPI Metrics & Trends
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/lib/kpi/auth-helper";
import { computeKpi, KpiComputeResult } from "@/lib/kpi/compute";
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
  const targetEmployeeId = searchParams.get("employee_id") || caller.userId;
  const employeeType = searchParams.get("employee_type") || undefined;
  const deptFilter = searchParams.get("department") || undefined;

  // Server-side access verification
  const isAllowed = await verifyEmployeeAccess(caller, targetEmployeeId);
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden: Access denied to target employee KPI" }, { status: 403 });
  }

  // Date range parsing (default: start of month to today)
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const from = searchParams.get("from") || startOfMonth;
  const to = searchParams.get("to") || today;

  // Previous period calculation (same number of days immediately preceding `from`)
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  const diffTime = Math.max(1, toDate.getTime() - fromDate.getTime());
  const prevToDate = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
  const prevFromDate = new Date(prevToDate.getTime() - diffTime);

  const prevTo = prevToDate.toISOString().slice(0, 10);
  const prevFrom = prevFromDate.toISOString().slice(0, 10);

  // Target employee info
  const { data: targetEmp } = await (supabaseAdmin.from("employees") as any)
    .select("id, full_name, email, department_id, job_title_id, status")
    .eq("id", targetEmployeeId)
    .maybeSingle();

  // Compute current and previous period KPI
  const [currentKpi, previousKpi] = await Promise.all([
    computeKpi(targetEmployeeId, from, to, employeeType),
    computeKpi(targetEmployeeId, prevFrom, prevTo, employeeType),
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

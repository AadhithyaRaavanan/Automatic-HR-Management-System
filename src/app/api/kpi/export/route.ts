// ============================================================================
// GET /api/kpi/export: Export Current KPI Metrics to CSV
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/features/kpi/auth-helper";
import { computeKpi } from "@/features/kpi/compute";
import { sanitizeSpreadsheetCell } from "@/lib/utils";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getKolkataPresetDates } from "@/features/kpi/date-helper";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const defaultDates = getKolkataPresetDates("month");
  const { searchParams } = new URL(request.url);
  const targetEmployeeId = searchParams.get("employee_id") || caller.userId;
  const from = searchParams.get("from") || defaultDates.from;
  const to = searchParams.get("to") || defaultDates.to;
  const employeeType = searchParams.get("employee_type") || undefined;

  const isAllowed = await verifyEmployeeAccess(caller, targetEmployeeId);
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden: Access denied" }, { status: 403 });
  }

  const [empRes, kpiResult] = await Promise.all([
    (supabaseAdmin.from("employees") as any)
      .select("full_name, email")
      .eq("id", targetEmployeeId)
      .maybeSingle(),
    computeKpi(targetEmployeeId, from, to, employeeType),
  ]);

  const empName = empRes.data?.full_name || empRes.data?.email || "Employee";

  const rows: string[] = [
    `"Employee","${sanitizeSpreadsheetCell(empName)}"`,
    `"Period","${from} to ${to}"`,
    `"Overall Score","${kpiResult.overallScore != null ? kpiResult.overallScore + "%" : "No data"}"`,
    "",
    `"Metric","Category","Value","Target","Status","Adjusted","Adjustment Reason"`,
  ];

  for (const m of kpiResult.metricsList) {
    const val = m.value != null ? `${m.value}${m.unit ? " " + m.unit : ""}` : "No data";
    const tgt = m.target != null ? `${m.target}${m.unit ? " " + m.unit : ""}` : "—";
    const adj = m.adjusted ? "Yes" : "No";
    const reason = m.adjustmentReason ? m.adjustmentReason.replace(/"/g, '""') : "";

    rows.push(
      `"${sanitizeSpreadsheetCell(m.label)}","${m.category}","${val}","${tgt}","${m.status}","${adj}","${reason}"`
    );
  }

  const csv = rows.join("\r\n");
  const filename = `kpi_${targetEmployeeId}_${from}_${to}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

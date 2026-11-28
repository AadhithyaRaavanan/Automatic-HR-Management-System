// ============================================================================
// GET /api/kpi/export: Export Current KPI Metrics & Hours Breakdown to CSV
// Uses the same authoritative computeKpi engine as Overview & Detail Drawer.
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
  const periodId = searchParams.get("periodId");
  const from = searchParams.get("from") || defaultDates.from;
  const to = searchParams.get("to") || defaultDates.to;
  const employeeType = searchParams.get("employee_type") || undefined;

  if (periodId) {
    const { data: periodRow } = await (supabaseAdmin.from("kpi_periods") as any)
      .select("organization_id")
      .eq("id", periodId)
      .maybeSingle();
    if (periodRow?.organization_id && periodRow.organization_id !== caller.organizationId) {
      return NextResponse.json({ error: "Forbidden: KPI period belongs to another organization." }, { status: 403 });
    }
  }

  const isAllowed = await verifyEmployeeAccess(caller, targetEmployeeId);
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden: Access denied" }, { status: 403 });
  }

  const empRes = await (supabaseAdmin.from("employees") as any)
    .select("full_name, email, organization_id, employment_category")
    .eq("id", targetEmployeeId)
    .maybeSingle();

  const kpiResult = await computeKpi(
    targetEmployeeId,
    from,
    to,
    employeeType || empRes.data?.employment_category || undefined,
    empRes.data?.organization_id || caller.organizationId
  );

  const empName = empRes.data?.full_name || empRes.data?.email || "Employee";
  const hb = kpiResult.hoursBreakdown;

  const rows: string[] = [
    `"Employee","${sanitizeSpreadsheetCell(empName)}"`,
    `"Employment Category","${sanitizeSpreadsheetCell(kpiResult.employeeType)}"`,
    `"Period","${from} to ${to}"`,
    `"Data Status","${kpiResult.dataStatus}"`,
    `"Overall Score","${kpiResult.overallScore != null ? kpiResult.overallScore + "%" : kpiResult.dataStatus === "unavailable" ? "Unavailable" : "No data"}"`,
    `"Target Score","${kpiResult.overallTarget}%"`,
    `"Policy Effective From","${kpiResult.configEffectiveDate || "Default"}"`,
    `"Hours Breakdown","Worked ${(hb.workedMinutes / 60).toFixed(1)}h + Leave Credit ${(hb.leaveCreditMinutes / 60).toFixed(1)}h + Holiday Credit ${(hb.holidayCreditMinutes / 60).toFixed(1)}h = Effective ${(hb.effectiveMinutes / 60).toFixed(1)}h / Target ${(hb.targetMinutes / 60).toFixed(1)}h"`,
    "",
    `"Metric","Category","Value","Target","Status","Adjusted","Adjustment Reason"`,
  ];

  for (const m of kpiResult.metricsList) {
    const val = m.value != null ? `${m.value}${m.unit && m.unit !== "count" ? (m.unit === "%" ? "%" : " " + m.unit) : ""}` : m.displayValue || "No data";
    const tgt = m.target != null ? `${m.target}${m.unit && m.unit !== "count" ? (m.unit === "%" ? "%" : " " + m.unit) : ""}` : "—";
    const adj = m.adjusted ? "Yes" : "No";
    const reason = m.adjustmentReason ? sanitizeSpreadsheetCell(m.adjustmentReason.replace(/"/g, '""')) : "";

    rows.push(
      `"${sanitizeSpreadsheetCell(m.label)}","${m.category}","${sanitizeSpreadsheetCell(val)}","${sanitizeSpreadsheetCell(tgt)}","${m.status}","${adj}","${reason}"`
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

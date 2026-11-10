import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sanitizeSpreadsheetCell } from "@/lib/utils";
import { computeWeightedKpiScore, getKpiMetricMeta } from "@/lib/kpi/helpers";
import ExcelJS from "exceljs";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["hr", "admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  const periodId = request.nextUrl.searchParams.get("periodId")?.trim() || null;

  if (periodId) {
    const { data: periodRow, error: periodErr } = await supabaseAdmin
      .from("kpi_periods")
      .select("id, organization_id, name, status")
      .eq("id", periodId)
      .maybeSingle();

    if (periodErr) {
      return NextResponse.json({ error: periodErr.message }, { status: 500 });
    }
    if (!periodRow || periodRow.organization_id !== context.organizationId) {
      return NextResponse.json(
        { error: "Forbidden: KPI period not found in caller organization." },
        { status: 403 }
      );
    }
  }

  let scoresQuery = supabaseAdmin
    .from("kpi_scores")
    .select(
      `
      id,
      period_id,
      employee_id,
      kpi_definition_id,
      actual_value,
      target_value,
      score,
      computed_at,
      kpi_periods!inner(id, name, period_type, start_date, end_date, status),
      kpi_definitions!inner(id, name, source_metric, direction, weight),
      employees!kpi_scores_employee_id_fkey(id, full_name, email)
    `
    )
    .eq("organization_id", context.organizationId)
    .order("computed_at", { ascending: false });

  if (periodId) {
    scoresQuery = scoresQuery.eq("period_id", periodId);
  }

  let reviewsQuery = supabaseAdmin
    .from("kpi_reviews")
    .select(
      `
      id,
      period_id,
      employee_id,
      reviewer_id,
      rating,
      comment,
      updated_at,
      employees!kpi_reviews_employee_id_fkey(full_name, email),
      kpi_periods!inner(name)
    `
    )
    .eq("organization_id", context.organizationId);

  if (periodId) {
    reviewsQuery = reviewsQuery.eq("period_id", periodId);
  }

  const [{ data: scoreRows, error: scoresErr }, { data: reviewRows, error: reviewsErr }] =
    await Promise.all([scoresQuery, reviewsQuery]);

  if (scoresErr) {
    return NextResponse.json({ error: scoresErr.message }, { status: 500 });
  }
  if (reviewsErr) {
    return NextResponse.json({ error: reviewsErr.message }, { status: 500 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Automatic HR Management System";
  workbook.created = new Date();

  // Sheet 1: Employee Weighted Summary
  const summarySheet = workbook.addWorksheet("Employee Scorecard Summary", {
    views: [{ showGridLines: true }],
  });

  summarySheet.columns = [
    { header: "Period", key: "period_name", width: 22 },
    { header: "Status", key: "period_status", width: 12 },
    { header: "Employee Name", key: "employee_name", width: 26 },
    { header: "Employee Email", key: "employee_email", width: 30 },
    { header: "Metrics Evaluated", key: "metric_count", width: 18 },
    { header: "Weighted Score (%)", key: "weighted_score", width: 20 },
    { header: "Manager Rating (/5)", key: "rating", width: 20 },
    { header: "Review Comment", key: "comment", width: 42 },
  ];

  const summaryHeader = summarySheet.getRow(1);
  summaryHeader.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  summaryHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF6366F1" },
  };
  summaryHeader.height = 24;
  summaryHeader.alignment = { vertical: "middle", horizontal: "center" };

  const reviewByKey = new Map<string, any>();
  for (const rev of reviewRows || []) {
    reviewByKey.set(`${rev.period_id}:${rev.employee_id}`, rev);
  }

  const grouped = new Map<
    string,
    {
      periodName: string;
      periodStatus: string;
      employeeName: string;
      employeeEmail: string;
      items: Array<{ score: number; weight: number }>;
      review: any;
    }
  >();

  for (const row of scoreRows || []) {
    const r = row as any;
    const key = `${r.period_id}:${r.employee_id}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        periodName: r.kpi_periods?.name || "Period",
        periodStatus: r.kpi_periods?.status || "open",
        employeeName: r.employees?.full_name || "Employee",
        employeeEmail: r.employees?.email || "",
        items: [],
        review: reviewByKey.get(key) || null,
      });
    }
    grouped.get(key)!.items.push({
      score: Number(r.score || 0),
      weight: Number(r.kpi_definitions?.weight || 1),
    });
  }

  for (const entry of Array.from(grouped.values())) {
    const weighted = computeWeightedKpiScore(entry.items);
    summarySheet.addRow({
      period_name: sanitizeSpreadsheetCell(entry.periodName),
      period_status: sanitizeSpreadsheetCell(entry.periodStatus),
      employee_name: sanitizeSpreadsheetCell(entry.employeeName),
      employee_email: sanitizeSpreadsheetCell(entry.employeeEmail),
      metric_count: entry.items.length,
      weighted_score: weighted ?? 0,
      rating: entry.review ? Number(entry.review.rating) : "",
      comment: entry.review ? sanitizeSpreadsheetCell(entry.review.comment || "") : "",
    });
  }

  // Sheet 2: Detailed KPI Metric Snapshots
  const detailSheet = workbook.addWorksheet("KPI Metric Details", {
    views: [{ showGridLines: true }],
  });

  detailSheet.columns = [
    { header: "Score ID", key: "id", width: 36 },
    { header: "Period", key: "period_name", width: 22 },
    { header: "Period Status", key: "period_status", width: 14 },
    { header: "Employee Name", key: "employee_name", width: 24 },
    { header: "Employee Email", key: "employee_email", width: 28 },
    { header: "KPI Definition", key: "kpi_name", width: 28 },
    { header: "Source Metric", key: "source_metric", width: 24 },
    { header: "Direction", key: "direction", width: 18 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Actual Value", key: "actual_value", width: 14 },
    { header: "Target Value", key: "target_value", width: 14 },
    { header: "Score (0-100)", key: "score", width: 14 },
    { header: "Computed At", key: "computed_at", width: 22 },
  ];

  const detailHeader = detailSheet.getRow(1);
  detailHeader.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  detailHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF14123A" },
  };
  detailHeader.height = 24;
  detailHeader.alignment = { vertical: "middle", horizontal: "center" };

  for (const row of scoreRows || []) {
    const r = row as any;
    const metricMeta = getKpiMetricMeta(r.kpi_definitions?.source_metric || "");
    detailSheet.addRow({
      id: r.id,
      period_name: sanitizeSpreadsheetCell(r.kpi_periods?.name || "Period"),
      period_status: sanitizeSpreadsheetCell(r.kpi_periods?.status || "open"),
      employee_name: sanitizeSpreadsheetCell(r.employees?.full_name || "Employee"),
      employee_email: sanitizeSpreadsheetCell(r.employees?.email || ""),
      kpi_name: sanitizeSpreadsheetCell(r.kpi_definitions?.name || "KPI"),
      source_metric: sanitizeSpreadsheetCell(metricMeta.label),
      direction: sanitizeSpreadsheetCell(r.kpi_definitions?.direction || ""),
      weight: Number(r.kpi_definitions?.weight || 1),
      actual_value: Number(r.actual_value ?? 0),
      target_value: Number(r.target_value ?? 0),
      score: Number(r.score ?? 0),
      computed_at: r.computed_at ? format(new Date(r.computed_at), "yyyy-MM-dd HH:mm") : "",
    });
  }

  await supabaseAdmin.from("audit_logs").insert({
    organization_id: context.organizationId,
    actor_id: context.userId,
    action: "KPI_EXPORTED",
    table_name: "kpi_scores",
    record_id: periodId || context.userId,
    old_data: null,
    new_data: {
      period_id: periodId,
      score_rows: (scoreRows || []).length,
      review_rows: (reviewRows || []).length,
      exported_at: new Date().toISOString(),
    },
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `kpi-scorecard-${format(new Date(), "yyyy-MM-dd")}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

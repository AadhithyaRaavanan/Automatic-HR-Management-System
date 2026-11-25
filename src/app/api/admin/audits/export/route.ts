import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sanitizeCsvCell } from "@/lib/utils";
import ExcelJS from "exceljs";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  const { searchParams } = new URL(request.url);
  const formatType = (searchParams.get("format") || "csv").toLowerCase();
  const actionFilter = searchParams.get("action");
  const tableFilter = searchParams.get("tableName");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  // Build query strictly scoped to caller's organization
  let query = supabaseAdmin
    .from("audit_logs")
    .select("id, actor_id, action, table_name, record_id, old_data, new_data, created_at")
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (actionFilter) {
    query = query.eq("action", actionFilter);
  }
  if (tableFilter) {
    query = query.eq("table_name", tableFilter);
  }
  if (startDate) {
    query = query.gte("created_at", startDate);
  }
  if (endDate) {
    query = query.lte("created_at", endDate);
  }

  const { data: logs, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: `Failed to fetch audit logs: ${error.message}` },
      { status: 500 }
    );
  }

  const records = logs || [];

  // Audit log the export action
  await supabaseAdmin.from("audit_logs").insert({
    organization_id: context.organizationId,
    actor_id: context.userId,
    action: "AUDIT_LOGS_EXPORTED",
    table_name: "audit_logs",
    record_id: context.userId,
    old_data: null,
    new_data: { format: formatType, record_count: records.length, exported_at: new Date().toISOString() },
  });

  if (formatType === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Automatic HR Management System";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Audit Logs", {
      views: [{ showGridLines: true }],
    });

    sheet.columns = [
      { header: "Timestamp (UTC)", key: "created_at", width: 24 },
      { header: "Actor ID", key: "actor_id", width: 38 },
      { header: "Action", key: "action", width: 28 },
      { header: "Target Table", key: "table_name", width: 24 },
      { header: "Record ID", key: "record_id", width: 38 },
      { header: "Old Data (JSON)", key: "old_data", width: 40 },
      { header: "New Data (JSON)", key: "new_data", width: 40 },
    ];

    records.forEach((r) => {
      sheet.addRow({
        created_at: r.created_at,
        actor_id: r.actor_id || "system",
        action: sanitizeCsvCell(r.action),
        table_name: sanitizeCsvCell(r.table_name),
        record_id: r.record_id || "",
        old_data: r.old_data ? sanitizeCsvCell(JSON.stringify(r.old_data)) : "",
        new_data: r.new_data ? sanitizeCsvCell(JSON.stringify(r.new_data)) : "",
      });
    });

    sheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const timestampStr = format(new Date(), "yyyyMMdd-HHmmss");

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="audit_logs_${timestampStr}.xlsx"`,
      },
    });
  }

  // Standard CSV format with formula injection sanitization
  const headers = ["Timestamp (UTC)", "Actor ID", "Action", "Target Table", "Record ID", "Old Data", "New Data"];
  const csvLines = [headers.join(",")];

  records.forEach((r) => {
    const row = [
      sanitizeCsvCell(r.created_at),
      sanitizeCsvCell(r.actor_id || "system"),
      sanitizeCsvCell(r.action),
      sanitizeCsvCell(r.table_name),
      sanitizeCsvCell(r.record_id || ""),
      sanitizeCsvCell(r.old_data ? JSON.stringify(r.old_data) : ""),
      sanitizeCsvCell(r.new_data ? JSON.stringify(r.new_data) : ""),
    ];
    csvLines.push(row.join(","));
  });

  const csvContent = csvLines.join("\r\n");
  const timestampStr = format(new Date(), "yyyyMMdd-HHmmss");

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit_logs_${timestampStr}.csv"`,
    },
  });
}


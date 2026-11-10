import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sanitizeCsvCell, sanitizeSpreadsheetCell } from "@/lib/utils";
import ExcelJS from "exceljs";
import { format, startOfMonth, endOfMonth, parseISO, isValid } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["hr", "admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  const { searchParams } = new URL(request.url);
  const formatType = (searchParams.get("format") || "xlsx").toLowerCase();
  const rawMonth = searchParams.get("month");

  let monthParam = format(new Date(), "yyyy-MM");
  let monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  let monthEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");

  if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
    const parsed = parseISO(`${rawMonth}-01`);
    if (isValid(parsed)) {
      monthParam = rawMonth;
      monthStart = format(startOfMonth(parsed), "yyyy-MM-dd");
      monthEnd = format(endOfMonth(parsed), "yyyy-MM-dd");
    }
  }

  // Query real tenant-scoped attendance_days records for the selected month
  const { data: days, error: queryError } = await supabaseAdmin
    .from("attendance_days")
    .select(`
      employee_id,
      work_date,
      status,
      total_minutes,
      is_late,
      locked,
      employees!attendance_days_employee_id_fkey(full_name, email)
    `)
    .eq("organization_id", context.organizationId)
    .gte("work_date", monthStart)
    .lte("work_date", monthEnd)
    .order("work_date", { ascending: true });

  if (queryError) {
    return NextResponse.json(
      { error: `Failed to export attendance records: ${queryError.message}` },
      { status: 500 }
    );
  }

  const records = (days || []).map((row: any) => ({
    name: row.employees?.full_name || "Unknown Employee",
    email: row.employees?.email || "",
    date: row.work_date,
    status: row.status,
    totalMinutes: Number(row.total_minutes || 0),
    isLate: row.is_late ? "Yes" : "No",
    locked: row.locked ? "Yes" : "No",
  }));

  // Record audit trail entry
  await supabaseAdmin.from("audit_logs").insert({
    organization_id: context.organizationId,
    actor_id: context.userId,
    action: "ATTENDANCE_EXPORTED",
    table_name: "attendance_days",
    record_id: context.userId,
    old_data: null,
    new_data: {
      format: formatType,
      month: monthParam,
      record_count: records.length,
      exported_at: new Date().toISOString(),
    },
  });

  // 1. CSV Stream Format
  if (formatType === "csv") {
    const csvHeader = "Employee Name,Work Email,Work Date,Status,Total Minutes,Total Hours,Is Late,Locked\n";
    const csvRows = records
      .map((r) =>
        [
          sanitizeCsvCell(r.name),
          sanitizeCsvCell(r.email),
          sanitizeCsvCell(r.date),
          sanitizeCsvCell(r.status),
          String(r.totalMinutes),
          (r.totalMinutes / 60).toFixed(1),
          sanitizeCsvCell(r.isLate),
          sanitizeCsvCell(r.locked),
        ].join(",")
      )
      .join("\n");

    return new NextResponse(csvHeader + csvRows, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attendance-${monthParam}.csv"`,
      },
    });
  }

  // 2. Styled ExcelJS .xlsx Format
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RemoteHR System";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Monthly Attendance", {
    views: [{ showGridLines: true }],
  });

  worksheet.columns = [
    { header: "Employee Name", key: "name", width: 24 },
    { header: "Work Email", key: "email", width: 28 },
    { header: "Date", key: "date", width: 14 },
    { header: "Day Status", key: "status", width: 16 },
    { header: "Total Minutes", key: "totalMinutes", width: 16 },
    { header: "Hours", key: "hours", width: 12 },
    { header: "Late Arrival", key: "isLate", width: 14 },
    { header: "Payroll Locked", key: "locked", width: 16 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF14123A" },
    };
    cell.font = {
      name: "Arial",
      color: { argb: "FFFFFFFF" },
      bold: true,
      size: 11,
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF6C5CE7" } },
    };
  });

  records.forEach((rec, idx) => {
    const row = worksheet.addRow({
      name: sanitizeSpreadsheetCell(rec.name),
      email: sanitizeSpreadsheetCell(rec.email),
      date: rec.date,
      status: sanitizeSpreadsheetCell(rec.status),
      totalMinutes: rec.totalMinutes,
      hours: Number((rec.totalMinutes / 60).toFixed(1)),
      isLate: rec.isLate,
      locked: rec.locked,
    });

    row.height = 20;

    if (idx % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF6F7FB" },
        };
      });
    }

    row.eachCell((cell) => {
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { vertical: "middle" };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFE2E4F0" } },
      };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="attendance-${monthParam}.xlsx"`,
    },
  });
}


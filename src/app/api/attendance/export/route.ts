import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sanitizeCsvCell, sanitizeSpreadsheetCell } from "@/lib/utils";
import ExcelJS from "exceljs";
import { format, startOfMonth, endOfMonth, parseISO, isValid } from "date-fns";

export const dynamic = "force-dynamic";

const EXPORT_PAGE_SIZE = 500;

function filterAndNormalizeExportDays(
  days: any[],
  opts: { department?: string; search?: string }
) {
  const deptFilter = opts.department?.trim() || "";
  const searchFilter = opts.search?.trim().toLowerCase() || "";

  return (days || [])
    .filter((row: any) => {
      const joinedOn = row.employees?.joined_on ? String(row.employees.joined_on).slice(0, 10) : null;
      if (row.status === "absent" && Number(row.total_minutes || 0) === 0 && joinedOn && row.work_date < joinedOn) {
        return false;
      }
      return true;
    })
    .map((row: any) => ({
      name: row.employees?.full_name || "Unknown Employee",
      email: row.employees?.email || "",
      department: row.employees?.departments?.name || "General",
      date: row.work_date,
      status: row.status,
      totalMinutes: Number(row.total_minutes || 0),
      isLate: row.is_late ? "Yes" : "No",
      locked: row.locked ? "Yes" : "No",
    }))
    .filter((r) => {
      if (deptFilter && deptFilter !== "All" && r.department !== deptFilter) {
        return false;
      }
      if (
        searchFilter &&
        !r.name.toLowerCase().includes(searchFilter) &&
        !r.department.toLowerCase().includes(searchFilter) &&
        !r.date.includes(searchFilter)
      ) {
        return false;
      }
      return true;
    });
}

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["hr", "admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  const { searchParams } = new URL(request.url);
  const formatType = (searchParams.get("format") || "xlsx").toLowerCase();
  const rawMonth = searchParams.get("month");
  const deptFilter = searchParams.get("department")?.trim() || "";
  const searchFilter = searchParams.get("search")?.trim().toLowerCase() || "";
  const employeeIdFilter = searchParams.get("employeeId")?.trim() || "";
  const statusFilter = searchParams.get("status")?.trim().toLowerCase() || "";

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

  // Deterministic pagination across all matching rows (avoids PostgREST 1,000-row cap)
  const buildDaysQuery = () => {
    let q: any = (supabaseAdmin.from("attendance_days") as any)
      .select(`
        employee_id,
        work_date,
        status,
        total_minutes,
        is_late,
        locked,
        employees!attendance_days_employee_id_fkey(full_name, email, joined_on, departments:department_id(name))
      `)
      .eq("organization_id", context.organizationId)
      .gte("work_date", monthStart)
      .lte("work_date", monthEnd);

    if (employeeIdFilter && typeof q.eq === "function") {
      q = q.eq("employee_id", employeeIdFilter);
    }
    if (statusFilter && statusFilter !== "all" && typeof q.eq === "function") {
      q = q.eq("status", statusFilter);
    }
    if (q && typeof q.order === "function") {
      q = q.order("work_date", { ascending: true });
    }
    if (q && typeof q.order === "function") {
      q = q.order("employee_id", { ascending: true });
    }
    return q;
  };

  const allDays: any[] = [];
  let offset = 0;
  let queryError: any = null;

  while (true) {
    const pageQuery = buildDaysQuery();
    const supportsRange = Boolean(pageQuery && typeof pageQuery.range === "function");
    const pageRes = supportsRange
      ? await pageQuery.range(offset, offset + EXPORT_PAGE_SIZE - 1)
      : await pageQuery;

    if (pageRes?.error) {
      queryError = pageRes.error;
      break;
    }

    const chunk = Array.isArray(pageRes?.data) ? pageRes.data : [];
    allDays.push(...chunk);

    if (!supportsRange || chunk.length < EXPORT_PAGE_SIZE) {
      break;
    }
    offset += EXPORT_PAGE_SIZE;
  }

  if (queryError) {
    return NextResponse.json(
      { error: `Failed to export attendance records: ${queryError.message}` },
      { status: 500 }
    );
  }

  const records = filterAndNormalizeExportDays(allDays, {
    department: deptFilter,
    search: searchFilter,
  });

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
    const csvHeader = "Employee Name,Work Email,Department,Work Date,Status,Total Minutes,Total Hours,Is Late,Locked\n";
    const csvRows = records
      .map((r) =>
        [
          sanitizeCsvCell(r.name),
          sanitizeCsvCell(r.email),
          sanitizeCsvCell(r.department),
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
    { header: "Department", key: "department", width: 18 },
    { header: "Date", key: "date", width: 14 },
    { header: "Status", key: "status", width: 14 },
    { header: "Logged Hours", key: "hours", width: 14 },
    { header: "Late Arrival", key: "isLate", width: 14 },
    { header: "Month Lock", key: "locked", width: 14 },
  ];

  // Style Header Row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 24;

  // Add Rows with Spreadsheet Formula Neutralization
  records.forEach((rec) => {
    worksheet.addRow({
      name: sanitizeSpreadsheetCell(rec.name),
      email: sanitizeSpreadsheetCell(rec.email),
      department: sanitizeSpreadsheetCell(rec.department),
      date: sanitizeSpreadsheetCell(rec.date),
      status: sanitizeSpreadsheetCell(String(rec.status || "").toUpperCase()),
      hours: rec.totalMinutes > 0 ? `${(rec.totalMinutes / 60).toFixed(1)} hrs` : "0.0 hrs",
      isLate: sanitizeSpreadsheetCell(rec.isLate),
      locked: sanitizeSpreadsheetCell(rec.locked),
    });
  });

  // Conditional Formatting / Alternate row striping
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: "middle", horizontal: "left" };
      row.height = 20;
      if (rowNumber % 2 === 0) {
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      }
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(Buffer.from(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="attendance-${monthParam}.xlsx"`,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import ExcelJS from "exceljs";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["hr", "admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  // Fetch leave requests for caller organization
  const { data: requests, error: reqErr } = await supabaseAdmin
    .from("leave_requests")
    .select(`
      id,
      start_date,
      end_date,
      day_part,
      total_days,
      reason,
      status,
      created_at,
      employees!leave_requests_employee_id_fkey(full_name, email),
      leave_types!leave_requests_leave_type_id_fkey(name, code)
    `)
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false });

  if (reqErr) {
    return NextResponse.json({ error: reqErr.message }, { status: 500 });
  }

  // Build Excel Workbook with ExcelJS
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Automatic HR Management System";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Leave Requests", {
    views: [{ showGridLines: true }],
  });

  sheet.columns = [
    { header: "Request ID", key: "id", width: 36 },
    { header: "Employee Name", key: "employee_name", width: 25 },
    { header: "Employee Email", key: "employee_email", width: 30 },
    { header: "Leave Type", key: "leave_type", width: 16 },
    { header: "Start Date", key: "start_date", width: 14 },
    { header: "End Date", key: "end_date", width: 14 },
    { header: "Day Part", key: "day_part", width: 14 },
    { header: "Total Days", key: "total_days", width: 12 },
    { header: "Reason", key: "reason", width: 35 },
    { header: "Status", key: "status", width: 14 },
    { header: "Submitted At", key: "created_at", width: 22 },
  ];

  // Header styling
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF6366F1" }, // Indigo / Brand purple
  };
  headerRow.height = 24;
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  // Add rows with sanitized cell content to neutralize formula injection
  (requests || []).forEach((r: any) => {
    const rawReason = r.reason || "";
    // Neutralize formula characters if string starts with =, +, -, @, \t, \r
    const safeReason = /^[=+\-@\t\r]/.test(rawReason) ? `'${rawReason}` : rawReason;
    const safeName = /^[=+\-@\t\r]/.test(r.employees?.full_name || "")
      ? `'${r.employees?.full_name}`
      : r.employees?.full_name || "N/A";

    sheet.addRow({
      id: r.id,
      employee_name: safeName,
      employee_email: r.employees?.email || "N/A",
      leave_type: r.leave_types?.name || r.leave_types?.code || "Leave",
      start_date: r.start_date,
      end_date: r.end_date,
      day_part: r.day_part,
      total_days: Number(r.total_days),
      reason: safeReason,
      status: r.status,
      created_at: r.created_at ? format(new Date(r.created_at), "yyyy-MM-dd HH:mm") : "",
    });
  });

  // Write audit log
  await supabaseAdmin.from("audit_logs").insert({
    organization_id: context.organizationId,
    actor_id: context.userId,
    action: "LEAVE_EXPORTED",
    table_name: "leave_requests",
    record_id: context.userId,
    old_data: null,
    new_data: { count: (requests || []).length, exported_at: new Date().toISOString() },
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `leave-export-${format(new Date(), "yyyy-MM-dd")}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

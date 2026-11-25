import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { inviteSingleEmployee } from "@/features/admin/invite-employee";
import {
  buildBulkImportErrorCsv,
  BulkEmployeeValidatedRow,
  parseCsvText,
  validateBulkEmployeeRows,
} from "@/lib/csv/parse-csv";

export const dynamic = "force-dynamic";

const MAX_BULK_ROWS = 250;

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json();
    const dryRun = body?.dryRun !== false; // default to preview unless explicitly false

    let rawRows: Array<Record<string, string>> = [];
    if (typeof body?.csvText === "string" && body.csvText.trim().length > 0) {
      const parsed = parseCsvText(body.csvText);
      rawRows = parsed.rows;
    } else if (Array.isArray(body?.rows)) {
      rawRows = body.rows.map((r: Record<string, any>) => ({
        email: String(r.email ?? ""),
        full_name: String(r.full_name ?? r.fullName ?? ""),
        role: String(r.role ?? "employee"),
        work_mode: String(r.work_mode ?? r.workMode ?? "remote"),
        timezone: String(r.timezone ?? "Asia/Kolkata"),
        department: String(r.department ?? r.department_code ?? ""),
        work_target_minutes: String(r.work_target_minutes ?? r.workTargetMinutes ?? "480"),
      }));
    } else {
      return NextResponse.json(
        { error: "Validation Error: Provide non-empty 'csvText' or 'rows' array." },
        { status: 400 }
      );
    }

    if (rawRows.length === 0) {
      return NextResponse.json(
        { error: "Validation Error: No employee data rows found in CSV." },
        { status: 400 }
      );
    }

    if (rawRows.length > MAX_BULK_ROWS) {
      return NextResponse.json(
        { error: `Validation Error: Maximum ${MAX_BULK_ROWS} rows supported per batch.` },
        { status: 400 }
      );
    }

    // Fetch current organization departments and all emails for tenant-isolation check
    const [{ data: orgDepts }, { data: orgEmployees }, { data: otherEmployees }] = await Promise.all([
      supabaseAdmin
        .from("departments")
        .select("id, code, name")
        .eq("organization_id", context.organizationId),
      supabaseAdmin
        .from("employees")
        .select("email")
        .eq("organization_id", context.organizationId),
      supabaseAdmin
        .from("employees")
        .select("email")
        .neq("organization_id", context.organizationId),
    ]);

    const departmentsByCode = new Map<string, string>();
    const departmentsByName = new Map<string, string>();
    for (const d of orgDepts || []) {
      if (d.code) departmentsByCode.set(d.code.trim().toLowerCase(), d.id);
      if (d.name) departmentsByName.set(d.name.trim().toLowerCase(), d.id);
    }

    const existingOrgEmails = new Set<string>(
      (orgEmployees || []).map((e) => String(e.email || "").trim().toLowerCase()).filter(Boolean)
    );
    const otherOrgEmails = new Set<string>(
      (otherEmployees || []).map((e) => String(e.email || "").trim().toLowerCase()).filter(Boolean)
    );

    const validatedRows = validateBulkEmployeeRows(rawRows, {
      departmentsByCode,
      departmentsByName,
      existingOrgEmails,
      otherOrgEmails,
    });

    const validRows = validatedRows.filter((r) => r.valid);
    const invalidRows = validatedRows.filter((r) => !r.valid);

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        totalRows: validatedRows.length,
        validCount: validRows.length,
        invalidCount: invalidRows.length,
        rows: validatedRows,
        errorCsv: invalidRows.length > 0 ? buildBulkImportErrorCsv(validatedRows) : null,
      });
    }

    // Live import: reuse inviteSingleEmployee() for each valid row
    const results: BulkEmployeeValidatedRow[] = [];
    const importedUserIds: string[] = [];
    let importedCount = 0;

    for (const row of validatedRows) {
      if (!row.valid) {
        results.push(row);
        continue;
      }

      const inviteRes = await inviteSingleEmployee(context, {
        email: row.email,
        fullName: row.fullName,
        role: row.role,
        workMode: row.workMode,
        timezone: row.timezone,
        departmentId: row.departmentId,
        workTargetMinutes: row.workTargetMinutes,
      });

      if (inviteRes.ok) {
        importedCount += 1;
        importedUserIds.push(inviteRes.userId);
        results.push(row);
      } else {
        results.push({
          ...row,
          valid: false,
          errors: [...row.errors, inviteRes.error],
        });
      }
    }

    const failedRows = results.filter((r) => !r.valid);

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "BULK_EMPLOYEES_IMPORTED",
      table_name: "employees",
      record_id: context.organizationId,
      old_data: null,
      new_data: {
        total_rows: validatedRows.length,
        imported_count: importedCount,
        failed_count: failedRows.length,
        imported_user_ids: importedUserIds,
      },
    });

    return NextResponse.json({
      success: true,
      dryRun: false,
      totalRows: validatedRows.length,
      importedCount,
      failedCount: failedRows.length,
      rows: results,
      errorCsv: failedRows.length > 0 ? buildBulkImportErrorCsv(results) : null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Internal Server Error: ${err.message || String(err)}` },
      { status: 500 }
    );
  }
}


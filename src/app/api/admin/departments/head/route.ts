import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/departments/head?departmentId=<id>
 * Returns active department head details and chronological assignment audit history.
 */
export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr", "manager"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  const { searchParams } = new URL(request.url);
  const departmentId = searchParams.get("departmentId");

  if (!departmentId) {
    return NextResponse.json({ error: "Missing departmentId query parameter" }, { status: 400 });
  }

  try {
    // 1. Fetch Department & Current Head
    const { data: dept, error: deptErr } = await (supabaseAdmin as any)
      .from("departments")
      .select(`
        id,
        name,
        code,
        department_head_id,
        head:department_head_id(
          id,
          full_name,
          email,
          status,
          job_titles:job_title_id(title_name)
        )
      `)
      .eq("id", departmentId)
      .maybeSingle();

    if (deptErr || !dept) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    // 2. Fetch Historical Assignment Audit Records from audit_logs
    const { data: auditRecords } = await (supabaseAdmin as any)
      .from("audit_logs")
      .select("*")
      .eq("table_name", "departments")
      .eq("record_id", departmentId)
      .in("action", ["DEPARTMENT_HEAD_ASSIGNED", "DEPARTMENT_HEAD_REASSIGNED", "DEPARTMENT_HEAD_REMOVED"])
      .order("created_at", { ascending: false });

    // 3. Resolve actors for history
    const actorIds = new Set<string>();
    for (const r of auditRecords || []) {
      if (r.actor_id) actorIds.add(r.actor_id);
    }
    const { data: actors } = await (supabaseAdmin as any)
      .from("employees")
      .select("id, full_name, email")
      .in("id", Array.from(actorIds));

    const actorMap = new Map<string, string>();
    for (const a of actors || []) {
      actorMap.set(a.id, a.full_name || a.email);
    }

    const history = (auditRecords || []).map((r: any) => {
      const isRemoval = r.action === "DEPARTMENT_HEAD_REMOVED";
      const empId = isRemoval ? r.old_data?.previous_head_id : r.new_data?.employee_id;
      const empName = isRemoval ? r.old_data?.previous_head_name : r.new_data?.employee_name;
      const designation = isRemoval ? (r.old_data?.previous_designation || "Department Head") : (r.new_data?.designation || "Department Head");
      const startDate = r.new_data?.effective_start_date || r.created_at?.slice(0, 10);
      const endDate = isRemoval ? (r.old_data?.effective_end_date || r.created_at?.slice(0, 10)) : null;

      return {
        id: r.id,
        action: r.action,
        employeeId: empId || null,
        employeeName: empName || "Team Member",
        designation: designation || "Department Head",
        effectiveStartDate: startDate,
        effectiveEndDate: endDate,
        assignedByName: actorMap.get(r.actor_id) || "Admin",
        notes: r.new_data?.notes || r.old_data?.notes || null,
        createdAt: r.created_at,
      };
    });

    return NextResponse.json({
      department: {
        id: dept.id,
        name: dept.name,
        code: dept.code,
        headId: dept.department_head_id || null,
        headName: dept.head?.full_name || null,
        headEmail: dept.head?.email || null,
        headStatus: dept.head?.status || null,
        headDesignation: dept.head?.job_titles?.title_name || (dept.head ? "Department Head" : null),
      },
      history,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch department head data" }, { status: 500 });
  }
}

/**
 * POST /api/admin/departments/head
 * Assigns or reassigns an active employee as Department Head.
 */
export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json().catch(() => ({}));
    const { departmentId, employeeId, designation, effectiveStartDate, notes } = body;

    if (!departmentId) {
      return NextResponse.json({ error: "Department ID is required." }, { status: 400 });
    }
    if (!employeeId) {
      return NextResponse.json({ error: "Employee selection is required." }, { status: 400 });
    }

    const startDate = effectiveStartDate || new Date().toISOString().slice(0, 10);

    // 1. Validate employee: must exist and be ACTIVE
    const { data: emp, error: empErr } = await (supabaseAdmin as any)
      .from("employees")
      .select(`
        id,
        full_name,
        email,
        status,
        department_id,
        job_title_id,
        job_titles:job_title_id(id, title_name)
      `)
      .eq("id", employeeId)
      .maybeSingle();

    if (empErr || !emp) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    if (emp.status !== "active") {
      return NextResponse.json(
        { error: `Cannot assign inactive employee (${emp.full_name} is ${emp.status}). Only active employees can be assigned as Department Head.` },
        { status: 400 }
      );
    }

    // 2. Validate department
    const { data: dept, error: deptErr } = await (supabaseAdmin as any)
      .from("departments")
      .select(`
        id,
        name,
        code,
        department_head_id,
        head:department_head_id(id, full_name, job_titles:job_title_id(title_name))
      `)
      .eq("id", departmentId)
      .maybeSingle();

    if (deptErr || !dept) {
      return NextResponse.json({ error: "Department not found." }, { status: 404 });
    }

    // Check duplicate active assignment
    if (dept.department_head_id === employeeId) {
      // If already assigned and designation is unchanged
      const currentDesignation = dept.head?.job_titles?.title_name;
      if (!designation || designation === currentDesignation) {
        return NextResponse.json(
          { error: `${emp.full_name} is already the active Department Head of ${dept.name}.` },
          { status: 400 }
        );
      }
    }

    const isReassignment = Boolean(dept.department_head_id && dept.department_head_id !== employeeId);
    const prevHeadId = dept.department_head_id || null;
    const prevHeadName = dept.head?.full_name || null;
    const prevDesignation = dept.head?.job_titles?.title_name || null;

    // 3. Resolve Designation
    const resolvedDesignation =
      designation?.trim() ||
      emp.job_titles?.title_name ||
      "Department Head";

    // 4. Update Department record with new department_head_id
    const { error: updateDeptErr } = await (supabaseAdmin as any)
      .from("departments")
      .update({
        department_head_id: employeeId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", departmentId);

    if (updateDeptErr) {
      return NextResponse.json({ error: updateDeptErr.message }, { status: 400 });
    }

    // 5. Update or link employee department if not already assigned
    if (emp.department_id !== departmentId) {
      await (supabaseAdmin as any)
        .from("employees")
        .update({
          department_id: departmentId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", employeeId);
    }

    // 6. Record Historical Audit Event
    const actionType = isReassignment ? "DEPARTMENT_HEAD_REASSIGNED" : "DEPARTMENT_HEAD_ASSIGNED";
    await (supabaseAdmin as any)
      .from("audit_logs")
      .insert({
        actor_id: context.userId,
        action: actionType,
        table_name: "departments",
        record_id: departmentId,
        organization_id: context.organizationId,
        old_data: {
          previous_head_id: prevHeadId,
          previous_head_name: prevHeadName,
          previous_designation: prevDesignation,
          effective_end_date: startDate,
        },
        new_data: {
          department_id: departmentId,
          department_name: dept.name,
          employee_id: employeeId,
          employee_name: emp.full_name,
          designation: resolvedDesignation,
          effective_start_date: startDate,
          notes: notes?.trim() || `Assigned as Department Head by ${context.email || "Admin"}.`,
        },
      });

    return NextResponse.json({
      success: true,
      message: isReassignment
        ? `Department Head for ${dept.name} successfully reassigned to ${emp.full_name}.`
        : `Department Head for ${dept.name} successfully assigned to ${emp.full_name}.`,
      departmentId,
      headId: employeeId,
      headName: emp.full_name,
      headDesignation: resolvedDesignation,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to assign department head." }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/departments/head?departmentId=<id>
 * Removes the active Department Head from a department.
 */
export async function DELETE(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  const { searchParams } = new URL(request.url);
  const departmentId = searchParams.get("departmentId");

  if (!departmentId) {
    return NextResponse.json({ error: "Missing departmentId parameter." }, { status: 400 });
  }

  try {
    const { data: dept, error: fetchErr } = await (supabaseAdmin as any)
      .from("departments")
      .select(`
        id,
        name,
        code,
        department_head_id,
        head:department_head_id(id, full_name, job_titles:job_title_id(title_name))
      `)
      .eq("id", departmentId)
      .maybeSingle();

    if (fetchErr || !dept) {
      return NextResponse.json({ error: "Department not found." }, { status: 404 });
    }

    if (!dept.department_head_id) {
      return NextResponse.json({ error: "Department has no active Department Head to remove." }, { status: 400 });
    }

    const prevHeadId = dept.department_head_id;
    const prevHeadName = dept.head?.full_name || "Team Member";
    const prevDesignation = dept.head?.job_titles?.title_name || "Department Head";
    const today = new Date().toISOString().slice(0, 10);

    // 1. Clear department_head_id
    const { error: updateErr } = await (supabaseAdmin as any)
      .from("departments")
      .update({
        department_head_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", departmentId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    // 2. Record removal in audit_logs
    await (supabaseAdmin as any)
      .from("audit_logs")
      .insert({
        actor_id: context.userId,
        action: "DEPARTMENT_HEAD_REMOVED",
        table_name: "departments",
        record_id: departmentId,
        organization_id: context.organizationId,
        old_data: {
          previous_head_id: prevHeadId,
          previous_head_name: prevHeadName,
          previous_designation: prevDesignation,
          effective_end_date: today,
          notes: "Department Head removed by Administrator.",
        },
        new_data: {
          department_head_id: null,
          status: "vacant",
        },
      });

    return NextResponse.json({
      success: true,
      message: `Department Head removed from ${dept.name}. Position is now Vacant.`,
      departmentId,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to remove department head." }, { status: 500 });
  }
}

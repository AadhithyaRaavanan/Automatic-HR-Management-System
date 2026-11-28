import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { getAdminClient, supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseAdminConfigError } from "@/lib/supabase/admin-config";
import { isDemoModeEnabled } from "@/lib/config/demo";

async function safeDbOp(op: PromiseLike<{ error?: any }>): Promise<{ error?: any }> {
  try {
    return (await op) || {};
  } catch (err: any) {
    return { error: err };
  }
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr", "manager"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const { organizationId: orgId, role: userRole, userId } = authResult.context;

    let managerDeptId: string | null = null;
    if (userRole === "manager") {
      const { data: empRecord } = await (supabaseAdmin as any)
        .from("employees")
        .select("department_id")
        .eq("id", userId)
        .eq("organization_id", orgId)
        .maybeSingle();
      managerDeptId = empRecord?.department_id || null;
    }

    // 1. Fetch departments
    let deptsQuery = (supabaseAdmin as any)
      .from("departments")
      .select("id, name, code, parent_department_id, department_head_id, created_at")
      .eq("organization_id", orgId)
      .order("name");

    if (managerDeptId) {
      deptsQuery = deptsQuery.eq("id", managerDeptId);
    }

    const { data: depts, error: deptsErr } = await deptsQuery;

    if (deptsErr) {
      return NextResponse.json({ departments: [] });
    }

    // 2. Fetch employees for headcount & head names & designations (scoped to caller's organization)
    const { data: emps } = await (supabaseAdmin as any)
      .from("employees")
      .select("id, full_name, email, department_id, job_titles:job_title_id(title_name)")
      .eq("organization_id", orgId)
      .eq("status", "active");

    // 3. Fetch roles/job_titles count per department
    const { data: titles } = await (supabaseAdmin as any)
      .from("job_titles")
      .select("id, title_name, department_id")
      .eq("organization_id", orgId);

    const empMap = new Map<string, { id: string; full_name: string; email: string; designation: string }>();
    const headCounts = new Map<string, number>();
    (emps || []).forEach((e: any) => {
      empMap.set(e.id, {
        id: e.id,
        full_name: e.full_name,
        email: e.email,
        designation: e.job_titles?.title_name || "Department Head",
      });
      if (e.department_id) {
        headCounts.set(e.department_id, (headCounts.get(e.department_id) || 0) + 1);
      }
    });

    const roleCounts = new Map<string, number>();
    (titles || []).forEach((t: any) => {
      if (t.department_id) {
        roleCounts.set(t.department_id, (roleCounts.get(t.department_id) || 0) + 1);
      }
    });

    const deptNameMap = new Map<string, string>((depts || []).map((d: any) => [d.id, d.name]));

    const mapped = (depts || []).map((d: any) => {
      const headEmp = d.department_head_id ? empMap.get(d.department_head_id) : null;
      const parentName = d.parent_department_id ? deptNameMap.get(d.parent_department_id) || null : null;

      return {
        id: d.id,
        name: d.name,
        code: d.code,
        headId: d.department_head_id || null,
        headName: headEmp?.full_name || null,
        headDesignation: headEmp?.designation || null,
        headEmail: headEmp?.email || null,
        head: headEmp
          ? {
              id: headEmp.id,
              full_name: headEmp.full_name,
              designation: headEmp.designation,
              email: headEmp.email,
            }
          : null,
        parentId: d.parent_department_id || null,
        parentName: parentName,
        parent_department_id: d.parent_department_id || null,
        parent: parentName ? { id: d.parent_department_id, name: parentName } : null,
        memberCount: headCounts.get(d.id) || 0,
        rolesCount: roleCounts.get(d.id) || 0,
        createdAt: d.created_at,
      };
    });

    return NextResponse.json({ departments: mapped });
  } catch (err: any) {
    return NextResponse.json({ departments: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json();
    const { name, code, parentId, headId } = body;

    const trimmedName = String(name || "").trim();
    const trimmedCode = String(code || "").trim().toUpperCase();

    if (!trimmedName || !trimmedCode) {
      return NextResponse.json(
        { error: "Department name and code are required." },
        { status: 400 }
      );
    }

    const { data: created, error: insertErr } = await (supabaseAdmin as any)
      .from("departments")
      .insert({
        organization_id: context.organizationId,
        name: trimmedName,
        code: trimmedCode,
        parent_department_id: parentId || null,
        department_head_id: headId || null,
      })
      .select("id, name, code, parent_department_id, department_head_id")
      .single();

    if (insertErr) {
      if (insertErr.code === "23505" || insertErr.message?.includes("unique")) {
        return NextResponse.json(
          { error: `Department '${trimmedName}' or code '${trimmedCode}' already exists.` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: insertErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, department: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create department" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json();
    const { id, name, code, parentId, headId } = body;

    if (!id) {
      return NextResponse.json({ error: "Department ID is required." }, { status: 400 });
    }

    const trimmedName = String(name || "").trim();
    const trimmedCode = String(code || "").trim().toUpperCase();

    const { data: updated, error: updateErr } = await (supabaseAdmin as any)
      .from("departments")
      .update({
        name: trimmedName,
        code: trimmedCode,
        parent_department_id: parentId || null,
        department_head_id: headId || null,
      })
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .select("id, name, code, parent_department_id, department_head_id")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, department: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update department" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  const adminConfigError = getSupabaseAdminConfigError();
  if (adminConfigError) {
    return NextResponse.json({ error: adminConfigError }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();

    if (!id) {
      return NextResponse.json({ error: "Department ID is required." }, { status: 400 });
    }

    const adminClient = getAdminClient() as any;

    const { data: existing, error: findErr } = await adminClient
      .from("departments")
      .select("id, name, code, organization_id")
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (findErr) {
      return NextResponse.json({ error: findErr.message }, { status: 400 });
    }

    if (!existing) {
      return NextResponse.json({ error: "Department not found in your organization." }, { status: 404 });
    }

    const normalizedName = String(existing.name || "").trim().toLowerCase();
    const normalizedCode = String(existing.code || "").trim().toUpperCase();
    if (normalizedName === "zen xea root" || normalizedCode === "ROOT") {
      return NextResponse.json(
        { error: "The core root department cannot be deleted." },
        { status: 400 }
      );
    }

    // Safely unlink dependent references before deleting the department
    await Promise.all([
      safeDbOp(
        adminClient
          .from("employees")
          .update({ department_id: null })
          .eq("department_id", id)
          .eq("organization_id", context.organizationId)
      ),
      safeDbOp(
        adminClient
          .from("organization_members")
          .update({ department_id: null })
          .eq("department_id", id)
          .eq("organization_id", context.organizationId)
      ),
      safeDbOp(
        adminClient
          .from("departments")
          .update({ parent_department_id: null })
          .eq("parent_department_id", id)
          .eq("organization_id", context.organizationId)
      ),
      safeDbOp(
        adminClient
          .from("job_titles")
          .update({ department_id: null })
          .eq("department_id", id)
          .eq("organization_id", context.organizationId)
      ),
      safeDbOp(
        adminClient
          .from("teams")
          .update({ department_id: null })
          .eq("department_id", id)
          .eq("organization_id", context.organizationId)
      ),
      safeDbOp(
        adminClient
          .from("projects")
          .update({ department_id: null })
          .eq("department_id", id)
          .eq("organization_id", context.organizationId)
      ),
    ]);

    const { error: delErr } = await adminClient
      .from("departments")
      .delete()
      .eq("id", id)
      .eq("organization_id", context.organizationId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    await safeDbOp(
      adminClient.from("audit_logs").insert({
        organization_id: context.organizationId,
        actor_id: context.userId,
        action: "DEPARTMENT_DELETED",
        table_name: "departments",
        record_id: id,
        old_data: existing,
        new_data: null,
      })
    );

    revalidatePath("/ems");
    revalidatePath("/ems/departments");
    revalidatePath("/ems/employees");
    revalidatePath("/ems/organization");
    revalidatePath("/employees");
    revalidatePath("/admin/departments");
    revalidatePath("/admin/users");

    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to delete department" }, { status: 500 });
  }
}

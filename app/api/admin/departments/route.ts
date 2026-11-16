import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isDemoModeEnabled } from "@/lib/config/demo";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    let orgId: string | null = null;
    if (user) {
      const { data: member } = await supabaseAdmin
        .from("organization_members")
        .select("organization_id, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      if (member?.organization_id) orgId = member.organization_id;
    }

    if (!orgId) {
      orgId = "00000000-0000-0000-0000-000000000001";
    }

    // 1. Fetch departments
    const { data: depts, error: deptsErr } = await (supabaseAdmin as any)
      .from("departments")
      .select("id, name, code, parent_department_id, department_head_id, created_at")
      .eq("organization_id", orgId)
      .order("name");

    if (deptsErr) {
      return NextResponse.json({ departments: [] });
    }

    // 2. Fetch employees for headcount & head names
    const { data: emps } = await (supabaseAdmin as any)
      .from("employees")
      .select("id, full_name, email, department_id")
      .eq("status", "active");

    // 3. Fetch roles/job_titles count per department
    const { data: titles } = await (supabaseAdmin as any)
      .from("job_titles")
      .select("id, title_name, department_id")
      .eq("organization_id", orgId);

    const empMap = new Map<string, string>();
    const headCounts = new Map<string, number>();
    (emps || []).forEach((e: any) => {
      empMap.set(e.id, e.full_name);
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

    const mapped = (depts || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      headId: d.department_head_id || null,
      headName: d.department_head_id ? empMap.get(d.department_head_id) || null : null,
      parentId: d.parent_department_id || null,
      parentName: d.parent_department_id ? deptNameMap.get(d.parent_department_id) || null : null,
      memberCount: headCounts.get(d.id) || 0,
      rolesCount: roleCounts.get(d.id) || 0,
      createdAt: d.created_at,
    }));

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

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Department ID is required." }, { status: 400 });
    }

    // 1. Unlink employees referencing this department
    await (supabaseAdmin as any)
      .from("employees")
      .update({ department_id: null })
      .eq("department_id", id);

    // 2. Unlink subdepartments
    await (supabaseAdmin as any)
      .from("departments")
      .update({ parent_department_id: null })
      .eq("parent_department_id", id);

    // 3. Unlink job titles or delete
    await (supabaseAdmin as any)
      .from("job_titles")
      .update({ department_id: null })
      .eq("department_id", id);

    // 4. Delete department
    const { error: delErr } = await (supabaseAdmin as any)
      .from("departments")
      .delete()
      .eq("id", id)
      .eq("organization_id", context.organizationId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to delete department" }, { status: 500 });
  }
}

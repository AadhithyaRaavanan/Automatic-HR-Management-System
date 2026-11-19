import { NextRequest, NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireApprovedUser(request);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { employee, user, role } = authResult;
    const orgId = employee?.organization_id || user?.user_metadata?.organization_id;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    // Fetch existing recurrence
    const { data: rec, error: fetchErr } = await (supabaseAdmin as any)
      .from("task_recurrences")
      .select("*")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (fetchErr || !rec) {
      return NextResponse.json({ error: "Recurrence not found." }, { status: 404 });
    }

    // Permission check: creator, HR, admin, or manager of assignee
    const isCreator = rec.created_by === user.id;
    const isHrOrAdmin = ["admin", "hr"].includes(role);
    let isManager = false;

    if (role === "manager" && rec.assignee_id) {
      const { data: assignee } = await (supabaseAdmin as any)
        .from("employees")
        .select("manager_id")
        .eq("id", rec.assignee_id)
        .single();
      if (assignee?.manager_id === user.id) {
        isManager = true;
      }
    }

    if (!isCreator && !isHrOrAdmin && !isManager) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to modify this recurrence." },
        { status: 403 }
      );
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.is_active !== undefined) {
      updates.is_active = Boolean(body.is_active);
    }
    if (body.end_date !== undefined) {
      updates.end_date = body.end_date || null;
    }
    if (body.last_created_task_id !== undefined) {
      updates.last_created_task_id = body.last_created_task_id;
    }
    if (body.next_run_date !== undefined) {
      updates.next_run_date = body.next_run_date;
    }

    const { data: updated, error } = await (supabaseAdmin as any)
      .from("task_recurrences")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ recurrence: updated });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update recurrence" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireApprovedUser(request);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { user, role, employee } = authResult;
    const orgId = employee?.organization_id || user?.user_metadata?.organization_id;
    const { id } = await params;

    // Soft delete / deactivate recurrence to preserve foreign keys
    const { data: rec, error } = await (supabaseAdmin as any)
      .from("task_recurrences")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", orgId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: "Recurrence stopped.", recurrence: rec });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to stop recurrence" },
      { status: 500 }
    );
  }
}

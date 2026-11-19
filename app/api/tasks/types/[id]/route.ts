import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { context } = authResult;
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.name !== undefined) {
      const trimmed = typeof body.name === "string" ? body.name.trim() : "";
      if (!trimmed) {
        return NextResponse.json({ error: "Task type name is required." }, { status: 400 });
      }
      updates.name = trimmed;
    }

    if (body.department_id !== undefined) {
      updates.department_id = body.department_id || null;
    }

    if (body.default_priority !== undefined) {
      if (["low", "medium", "high", "urgent"].includes(body.default_priority)) {
        updates.default_priority = body.default_priority;
      }
    }

    if (body.default_estimate_minutes !== undefined) {
      if (body.default_estimate_minutes === null || body.default_estimate_minutes === "") {
        updates.default_estimate_minutes = null;
      } else {
        const val = Number(body.default_estimate_minutes);
        if (isNaN(val) || val < 1 || val > 1440) {
          return NextResponse.json(
            { error: "Default estimate must be between 1 and 1440 minutes." },
            { status: 400 }
          );
        }
        updates.default_estimate_minutes = Math.round(val);
      }
    }

    if (body.due_rule_working_days !== undefined) {
      if (body.due_rule_working_days === null || body.due_rule_working_days === "") {
        updates.due_rule_working_days = null;
      } else {
        const val = Number(body.due_rule_working_days);
        if (isNaN(val) || val < 0 || val > 30) {
          return NextResponse.json(
            { error: "Due date rule must be between 0 and 30 working days." },
            { status: 400 }
          );
        }
        updates.due_rule_working_days = Math.round(val);
      }
    }

    if (body.description_template !== undefined) {
      updates.description_template = body.description_template
        ? String(body.description_template).trim()
        : null;
    }

    if (body.checklist !== undefined) {
      updates.checklist = Array.isArray(body.checklist)
        ? body.checklist
            .filter((item: any) => typeof item === "string" && item.trim().length > 0)
            .map((s: any) => s.trim())
        : [];
    }

    if (body.is_active !== undefined) {
      updates.is_active = Boolean(body.is_active);
    }

    if (typeof body.sort_order === "number") {
      updates.sort_order = body.sort_order;
    }

    const { data: updated, error } = await (supabaseAdmin as any)
      .from("task_types")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ type: updated });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update task type" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { context } = authResult;
    const { id } = await params;

    // Check if any tasks reference this task_type_id
    const { count, error: countErr } = await (supabaseAdmin as any)
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("task_type_id", id)
      .eq("organization_id", context.organizationId);

    // If tasks reference this type or if count check succeeds, always deactivate
    if ((count && count > 0) || !countErr) {
      const { data: deactivated, error } = await (supabaseAdmin as any)
        .from("task_types")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", context.organizationId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: "Task type deactivated (preserved historical task links).",
        type: deactivated,
      });
    }

    // Otherwise delete directly
    const { error: delErr } = await (supabaseAdmin as any)
      .from("task_types")
      .delete()
      .eq("id", id)
      .eq("organization_id", context.organizationId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: "Task type removed." });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to delete task type" },
      { status: 500 }
    );
  }
}

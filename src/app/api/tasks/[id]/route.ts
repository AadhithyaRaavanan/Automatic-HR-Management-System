import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const authResult = await verifyAdminRouteCaller(request, ["admin"]);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { context } = authResult;
    const { id } = await params;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Task ID is required." }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await (supabaseAdmin as any)
      .from("tasks")
      .select("*")
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { error: fetchError.message || "Failed to look up task." },
        { status: 500 }
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: "Task not found in your organization." },
        { status: 404 }
      );
    }

    const { error: deleteError } = await (supabaseAdmin as any)
      .from("tasks")
      .delete()
      .eq("id", id)
      .eq("organization_id", context.organizationId);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message || "Failed to delete task." },
        { status: 500 }
      );
    }

    await (supabaseAdmin as any).from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "TASK_DELETED",
      table_name: "tasks",
      record_id: id,
      old_data: existing,
      new_data: null,
    });

    return NextResponse.json({
      success: true,
      deleted_task_id: id,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unexpected error deleting task." },
      { status: 500 }
    );
  }
}

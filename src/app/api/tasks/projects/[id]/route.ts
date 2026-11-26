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
      return NextResponse.json({ error: "Project ID is required." }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await (supabaseAdmin as any)
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { error: fetchError.message || "Failed to look up project." },
        { status: 500 }
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: "Project not found in your organization." },
        { status: 404 }
      );
    }

    const { data: deletedTasks, error: deleteTasksError } = await (supabaseAdmin as any)
      .from("tasks")
      .delete()
      .eq("project_id", id)
      .eq("organization_id", context.organizationId)
      .select("id");

    if (deleteTasksError) {
      return NextResponse.json(
        { error: deleteTasksError.message || "Failed to delete project tasks." },
        { status: 500 }
      );
    }

    const { error: deleteError } = await (supabaseAdmin as any)
      .from("projects")
      .delete()
      .eq("id", id)
      .eq("organization_id", context.organizationId);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message || "Failed to delete project." },
        { status: 500 }
      );
    }

    const deletedTasksCount = Array.isArray(deletedTasks) ? deletedTasks.length : 0;

    await (supabaseAdmin as any).from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "PROJECT_DELETED",
      table_name: "projects",
      record_id: id,
      old_data: { ...existing, deleted_tasks_count: deletedTasksCount },
      new_data: null,
    });

    return NextResponse.json({
      success: true,
      deleted_project_id: id,
      deleted_tasks_count: deletedTasksCount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unexpected error deleting project." },
      { status: 500 }
    );
  }
}

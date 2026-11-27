import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";

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

    const { id } = await params;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Task ID is required." }, { status: 400 });
    }

    const { data, error } = await (authResult.supabase as any).rpc("delete_task", { p_task_id: id });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "22P02" ? 400 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unexpected error deleting task." },
      { status: 500 }
    );
  }
}

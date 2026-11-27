import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { getSupabaseAdminConfigError } from "@/lib/supabase/admin-config";
import { permanentlyDeleteEmployee } from "@/features/admin/delete-employee";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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
    const { targetUserId } = await request.json();

    if (!targetUserId) {
      return NextResponse.json(
        { error: "Validation Error: 'targetUserId' is required." },
        { status: 400 }
      );
    }

    const result = await permanentlyDeleteEmployee(context, targetUserId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Failed to permanently delete user." },
        { status: result.status }
      );
    }

    revalidatePath("/employees");
    revalidatePath("/ems/employees");
    revalidatePath("/admin/users");
    revalidatePath("/tasks");

    return NextResponse.json({
      success: true,
      message: `User ${result.deletedUserId} and all associated records permanently deleted.`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to permanently delete user." },
      { status: 500 }
    );
  }
}

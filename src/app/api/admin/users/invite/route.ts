import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { inviteSingleEmployee } from "@/features/admin/invite-employee";
import { getSupabaseAdminConfigError } from "@/lib/supabase/admin-config";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  const adminConfigError = getSupabaseAdminConfigError();
  if (adminConfigError) {
    return NextResponse.json(
      { success: false, error: adminConfigError },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const result = await inviteSingleEmployee(context, {
      email: body.email,
      fullName: body.fullName,
      phone: body.phone,
      role: body.role,
      employmentCategory: body.employmentCategory,
      workMode: body.workMode,
      timezone: body.timezone,
      departmentId: body.departmentId || null,
      managerId: body.managerId || null,
      primaryLocationId: body.primaryLocationId || null,
      workTargetMinutes: body.workTargetMinutes,
      expectedOfficeDays: body.expectedOfficeDays,
      requiredOfficeDaysPerWeek: body.requiredOfficeDaysPerWeek,
      shiftStartTime: body.shiftStartTime,
      shiftEndTime: body.shiftEndTime,
      jobTitleId: body.jobTitleId || null,
      salary: body.salary,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    try {
      revalidatePath("/ems");
      revalidatePath("/ems/employees");
      revalidatePath("/employees");
      revalidatePath("/admin/users");
    } catch {
      // Skip cache revalidation when invoked outside an active Next.js static generation store
    }

    return NextResponse.json({
      success: true,
      userId: result.userId,
      employee: result.employee,
      inviteLink: result.inviteLink,
      emailSent: result.emailSent,
      message: result.message,
      data: result.data,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Internal Server Error: ${err.message || String(err)}` },
      { status: 500 }
    );
  }
}

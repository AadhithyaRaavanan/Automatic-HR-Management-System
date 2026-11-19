import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { inviteSingleEmployee } from "@/lib/admin/invite-employee";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json();
    const result = await inviteSingleEmployee(context, {
      email: body.email,
      fullName: body.fullName,
      role: body.role,
      employmentCategory: body.employmentCategory,
      workMode: body.workMode,
      timezone: body.timezone,
      departmentId: body.departmentId,
      managerId: body.managerId,
      primaryLocationId: body.primaryLocationId,
      workTargetMinutes: body.workTargetMinutes,
      expectedOfficeDays: body.expectedOfficeDays,
      requiredOfficeDaysPerWeek: body.requiredOfficeDaysPerWeek,
      shiftStartTime: body.shiftStartTime,
      shiftEndTime: body.shiftEndTime,
      jobTitleId: body.jobTitleId,
      salary: body.salary,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      userId: result.userId,
      inviteLink: result.inviteLink,
      emailSent: result.emailSent,
      message: result.message,
      data: result.data,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Internal Server Error: ${err.message || String(err)}` },
      { status: 500 }
    );
  }
}

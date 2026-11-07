import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json();
    const {
      email,
      fullName,
      role = "employee",
      workMode = "remote",
      timezone = "UTC",
      departmentId,
      managerId,
      primaryLocationId,
      workTargetMinutes = 480,
      expectedOfficeDays = [1, 2, 3, 4, 5],
      requiredOfficeDaysPerWeek = 0,
    } = body;

    if (!email || !fullName) {
      return NextResponse.json(
        { error: "Validation Error: 'email' and 'fullName' are required fields." },
        { status: 400 }
      );
    }

    // Verify user does not already belong to another organization or this organization
    const { data: existingMember } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id, role, status")
      .eq("user_id", context.userId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    // 1. Invite user via Supabase Auth Admin API
    let invitedUserId: string;
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          full_name: fullName,
          user_role: role,
        },
      }
    );

    if (inviteError) {
      // If user already exists in auth.users, retrieve their ID
      if (inviteError.message?.toLowerCase().includes("already registered") || inviteError.status === 422) {
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 100 });
        const existing = listData?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (!existing) {
          return NextResponse.json({ error: `Invite failed: ${inviteError.message}` }, { status: 400 });
        }
        invitedUserId = existing.id;
      } else {
        return NextResponse.json({ error: `Invite failed: ${inviteError.message}` }, { status: 400 });
      }
    } else {
      invitedUserId = inviteData.user.id;
    }

    // 2. Provision invited employee in database via service_role-only function
    const { data: provisionData, error: provisionError } = await (supabaseAdmin.rpc as any)(
      "provision_invited_employee",
      {
        p_user_id: invitedUserId,
        p_organization_id: context.organizationId,
        p_email: email,
        p_full_name: fullName,
        p_role: role,
        p_work_mode: workMode,
        p_timezone: timezone,
        p_department_id: departmentId || null,
        p_manager_id: managerId || null,
        p_primary_location_id: primaryLocationId || null,
        p_work_target_minutes: Number(workTargetMinutes),
        p_expected_office_days: expectedOfficeDays,
        p_required_office_days_per_week: Number(requiredOfficeDaysPerWeek),
      }
    );

    if (provisionError) {
      return NextResponse.json(
        { error: `Database provisioning failed: ${provisionError.message}` },
        { status: 400 }
      );
    }

    // 3. Write audit row
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "MEMBER_INVITED",
      table_name: "employees",
      record_id: invitedUserId,
      old_data: null,
      new_data: {
        email,
        full_name: fullName,
        role,
        work_mode: workMode,
        invited_at: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      message: `User ${email} invited and provisioned successfully.`,
      data: provisionData,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Internal Server Error: ${err.message || String(err)}` },
      { status: 500 }
    );
  }
}


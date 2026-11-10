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

    const normalizedEmail = String(email).trim().toLowerCase();

    // 0. Check existing employee record by email BEFORE inviting (prevents cross-tenant hijack even if Auth listUsers fails)
    const { data: preExistingEmployee } = await supabaseAdmin
      .from("employees")
      .select("id, organization_id")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (preExistingEmployee && preExistingEmployee.organization_id !== context.organizationId) {
      return NextResponse.json(
        { error: "Conflict: Employee email already belongs to another organization." },
        { status: 409 }
      );
    }

    // 1. Invite user via Supabase Auth Admin API
    let invitedUserId: string;
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      normalizedEmail,
      {
        data: {
          full_name: fullName,
          user_role: role,
        },
      }
    );

    if (inviteError) {
      const errMsg = inviteError.message?.toLowerCase() || "";
      const errCode = (inviteError as any).code || "";
      // If user already exists in auth.users, resolve via pre-existing employee or paginate listUsers
      if (errMsg.includes("already registered") || errCode === "email_exists" || inviteError.status === 422) {
        if (preExistingEmployee?.id) {
          invitedUserId = preExistingEmployee.id;
        } else {
          let foundUser: any = null;
          let page = 1;
          const perPage = 100;
          while (!foundUser) {
            const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
              page,
              perPage,
            });
            if (listErr || !listData?.users || listData.users.length === 0) {
              break;
            }
            foundUser = listData.users.find((u) => u.email?.toLowerCase() === normalizedEmail) || null;
            if (listData.users.length < perPage) {
              break;
            }
            page += 1;
          }
          if (!foundUser) {
            return NextResponse.json({ error: `Invite failed: ${inviteError.message}` }, { status: 400 });
          }
          invitedUserId = foundUser.id;
        }
      } else {
        return NextResponse.json({ error: `Invite failed: ${inviteError.message}` }, { status: 400 });
      }
    } else {
      invitedUserId = inviteData.user.id;
    }

    // Check cross-tenant uniqueness: refuse if user already belongs to another organization
    const { data: existingMember } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id, role, status")
      .eq("user_id", invitedUserId)
      .maybeSingle();

    if (existingMember && existingMember.organization_id !== context.organizationId) {
      return NextResponse.json(
        { error: "Conflict: User already belongs to another organization." },
        { status: 409 }
      );
    }

    const { data: existingEmployee } = await supabaseAdmin
      .from("employees")
      .select("organization_id")
      .eq("id", invitedUserId)
      .maybeSingle();

    if (existingEmployee && existingEmployee.organization_id !== context.organizationId) {
      return NextResponse.json(
        { error: "Conflict: Employee record already belongs to another organization." },
        { status: 409 }
      );
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
      userId: invitedUserId,
      message: `User ${normalizedEmail} invited and provisioned successfully.`,
      data: provisionData,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Internal Server Error: ${err.message || String(err)}` },
      { status: 500 }
    );
  }
}


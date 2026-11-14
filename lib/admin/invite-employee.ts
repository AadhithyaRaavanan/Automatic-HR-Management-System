import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { AuthenticatedCallerContext } from "@/lib/auth/admin-guard";
import { sendWelcomeCredentialsEmail } from "@/lib/email/resend";

export interface InviteEmployeeInput {
  email: string;
  fullName: string;
  role?: string;
  workMode?: string;
  timezone?: string;
  departmentId?: string | null;
  managerId?: string | null;
  primaryLocationId?: string | null;
  workTargetMinutes?: number;
  expectedOfficeDays?: number[];
  requiredOfficeDaysPerWeek?: number;
  shiftStartTime?: string;
  shiftEndTime?: string;
}

export type InviteEmployeeResult =
  | {
      ok: true;
      userId: string;
      temporaryPassword?: string;
      message: string;
      emailSent: boolean;
      data: any;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export async function inviteSingleEmployee(
  context: AuthenticatedCallerContext,
  input: InviteEmployeeInput,
  options?: { auditAction?: string }
): Promise<InviteEmployeeResult> {
  const {
    email,
    fullName,
    role = "employee",
    workMode = "remote",
    timezone = "UTC",
    departmentId = null,
    managerId = null,
    primaryLocationId = null,
    workTargetMinutes = 480,
    expectedOfficeDays = [1, 2, 3, 4, 5],
    requiredOfficeDaysPerWeek = 0,
    shiftStartTime = "09:00:00",
    shiftEndTime = "17:00:00",
  } = input;

  if (!email || !fullName) {
    return {
      ok: false,
      status: 400,
      error: "Validation Error: 'email' and 'fullName' are required fields.",
    };
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedName = String(fullName).trim();

  if (!normalizedEmail || !normalizedName) {
    return {
      ok: false,
      status: 400,
      error: "Validation Error: 'email' and 'fullName' cannot be blank.",
    };
  }

  // Validate foreign keys belong to caller's organization before provisioning
  if (departmentId) {
    const { data: dept } = await supabaseAdmin
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (!dept) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden: Department does not belong to your organization.",
      };
    }
  }

  if (managerId) {
    const { data: mgr } = await supabaseAdmin
      .from("employees")
      .select("id")
      .eq("id", managerId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (!mgr) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden: Manager does not belong to your organization.",
      };
    }
  }

  if (primaryLocationId) {
    const { data: loc } = await supabaseAdmin
      .from("locations")
      .select("id")
      .eq("id", primaryLocationId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (!loc) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden: Location does not belong to your organization.",
      };
    }
  }

  // 0. Check existing employee record by email BEFORE inviting (prevents cross-tenant hijack)
  const { data: preExistingEmployee } = await supabaseAdmin
    .from("employees")
    .select("id, organization_id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (preExistingEmployee && preExistingEmployee.organization_id !== context.organizationId) {
    return {
      ok: false,
      status: 409,
      error: "Conflict: Employee email already belongs to another organization.",
    };
  }

  // 1. Create or invite user via Supabase Auth Admin API
  let invitedUserId: string;
  const temporaryPassword = `Temp${Math.random().toString(36).slice(-8)}!${Math.floor(10 + Math.random() * 90)}`;
  const now = new Date();
  const tempPasswordExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  // Attempt direct user creation with auto-confirmed email & temporary password
  const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: normalizedEmail,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: {
      full_name: normalizedName,
      user_role: role,
      must_change_password: true,
      temp_password_created_at: now.toISOString(),
      temp_password_expires_at: tempPasswordExpiresAt,
    },
  });

  if (createError) {
    // If user already exists or createUser was denied, try inviteUserByEmail fallback
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      normalizedEmail,
      {
        data: {
          full_name: normalizedName,
          user_role: role,
          must_change_password: true,
          temp_password_created_at: now.toISOString(),
          temp_password_expires_at: tempPasswordExpiresAt,
        },
      }
    );

    if (inviteError) {
      const errMsg = inviteError.message?.toLowerCase() || "";
      const errCode = (inviteError as any).code || "";
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
            return { ok: false, status: 400, error: `Invite failed: ${inviteError.message}` };
          }
          invitedUserId = foundUser.id;
        }
      } else {
        return { ok: false, status: 400, error: `User creation failed: ${createError.message || inviteError.message}` };
      }
    } else {
      invitedUserId = inviteData.user.id;
    }
  } else {
    invitedUserId = createData.user.id;
  }

  // Check cross-tenant uniqueness across organization_members and employees
  const { data: existingMember } = await supabaseAdmin
    .from("organization_members")
    .select("organization_id, role, status")
    .eq("user_id", invitedUserId)
    .maybeSingle();

  if (existingMember && existingMember.organization_id !== context.organizationId) {
    return {
      ok: false,
      status: 409,
      error: "Conflict: User already belongs to another organization.",
    };
  }

  const { data: existingEmployee } = await supabaseAdmin
    .from("employees")
    .select("organization_id")
    .eq("id", invitedUserId)
    .maybeSingle();

  if (existingEmployee && existingEmployee.organization_id !== context.organizationId) {
    return {
      ok: false,
      status: 409,
      error: "Conflict: Employee record already belongs to another organization.",
    };
  }

  // 2. Provision invited employee in database via service_role-only RPC
  const { data: provisionData, error: provisionError } = await (supabaseAdmin.rpc as any)(
    "provision_invited_employee",
    {
      p_user_id: invitedUserId,
      p_organization_id: context.organizationId,
      p_email: normalizedEmail,
      p_full_name: normalizedName,
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
    return {
      ok: false,
      status: 400,
      error: `Database provisioning failed: ${provisionError.message}`,
    };
  }

  // Persist shift schedule if specified
  if (shiftStartTime || shiftEndTime) {
    const startVal = shiftStartTime ? (shiftStartTime.length === 5 ? `${shiftStartTime}:00` : shiftStartTime) : "09:00:00";
    const endVal = shiftEndTime ? (shiftEndTime.length === 5 ? `${shiftEndTime}:00` : shiftEndTime) : "17:00:00";
    await Promise.all([
      (supabaseAdmin.from("organization_members") as any)
        .update({ shift_start_time: startVal, shift_end_time: endVal, updated_at: new Date().toISOString() })
        .eq("user_id", invitedUserId)
        .eq("organization_id", context.organizationId),
      (supabaseAdmin.from("employees") as any)
        .update({ shift_start_time: startVal, shift_end_time: endVal, updated_at: new Date().toISOString() })
        .eq("id", invitedUserId)
        .eq("organization_id", context.organizationId),
    ]);
  }

  // 3. Dispatch credentials email via Resend
  const emailResult = await sendWelcomeCredentialsEmail({
    to: normalizedEmail,
    fullName: normalizedName,
    role,
    temporaryPassword,
    shiftStartTime: shiftStartTime.slice(0, 5),
    shiftEndTime: shiftEndTime.slice(0, 5),
  });

  // 4. Write audit row
  await supabaseAdmin.from("audit_logs").insert({
    organization_id: context.organizationId,
    actor_id: context.userId,
    action: options?.auditAction || "MEMBER_INVITED",
    table_name: "employees",
    record_id: invitedUserId,
    old_data: null,
    new_data: {
      email: normalizedEmail,
      full_name: normalizedName,
      role,
      work_mode: workMode,
      timezone,
      shift_start_time: shiftStartTime,
      shift_end_time: shiftEndTime,
      email_dispatched: emailResult.success,
      department_id: departmentId || null,
      invited_at: new Date().toISOString(),
    },
  });

  return {
    ok: true,
    userId: invitedUserId,
    temporaryPassword,
    emailSent: emailResult.success,
    message: emailResult.success
      ? `User ${normalizedEmail} created and credentials email sent via Resend.`
      : `User ${normalizedEmail} created successfully.`,
    data: provisionData,
  };
}


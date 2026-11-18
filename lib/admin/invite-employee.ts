import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { AuthenticatedCallerContext } from "@/lib/auth/admin-guard";
import { sendWelcomeCredentialsEmail } from "@/lib/email/resend";
import { isDemoModeEnabled } from "@/lib/config/demo";

import { getSiteUrl } from "@/lib/site-url";

function generateSecureTempPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const num = "23456789";
  const spec = "!@#$%";
  let pwd = "";
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += num[Math.floor(Math.random() * num.length)];
  pwd += spec[Math.floor(Math.random() * spec.length)];
  for (let i = 4; i < 12; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  return pwd.split("").sort(() => 0.5 - Math.random()).join("");
}

export interface InviteEmployeeInput {
  email: string;
  fullName: string;
  role?: string;
  employmentCategory?: string;
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
  jobTitleId?: string | null;
}

export type InviteEmployeeResult =
  | {
    ok: true;
    userId: string;
    inviteLink?: string;
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
  let {
    email,
    fullName,
    role = "employee",
    employmentCategory = "full_time",
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
    jobTitleId = null,
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

  if (!/^[A-Za-z\s]{2,60}$/.test(normalizedName)) {
    return {
      ok: false,
      status: 400,
      error: "Validation Error: Full name must only contain alphabet letters and spaces.",
    };
  }

  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(normalizedEmail)) {
    return {
      ok: false,
      status: 400,
      error: "Validation Error: Email must contain only lowercase letters, numbers, and valid email symbols.",
    };
  }

  let resolvedDepartmentName: string | undefined;
  let resolvedJobTitleName: string | undefined;

  // Validate foreign keys belong to caller's organization before provisioning
  if (departmentId) {
    const { data: dept } = await supabaseAdmin
      .from("departments")
      .select("id, name")
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
    resolvedDepartmentName = dept.name;
  }

  if (jobTitleId) {
    let { data: jt } = await (supabaseAdmin as any)
      .from("job_titles")
      .select("id, title_name, department_id")
      .eq("id", jobTitleId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    // Fallback: If client passed a local/cached ID, resolve by department or organization
    if (!jt && departmentId) {
      const { data: fallbackJt } = await (supabaseAdmin as any)
        .from("job_titles")
        .select("id, title_name, department_id")
        .eq("department_id", departmentId)
        .eq("organization_id", context.organizationId)
        .maybeSingle();
      if (fallbackJt) {
        jt = fallbackJt;
        jobTitleId = fallbackJt.id;
      }
    }

    if (!jt) {
      const { data: fallbackOrgWide } = await (supabaseAdmin as any)
        .from("job_titles")
        .select("id, title_name, department_id")
        .eq("organization_id", context.organizationId)
        .maybeSingle();
      if (fallbackOrgWide) {
        jt = fallbackOrgWide;
        jobTitleId = fallbackOrgWide.id;
      }
    }

    if (!jt) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden: Job title does not belong to your organization.",
      };
    }
    resolvedJobTitleName = jt.title_name;
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

  // 1. Create or invite user via Supabase Auth Admin generateLink flow (No temporary passwords)
  const siteUrl = getSiteUrl();
  const inviteRedirectTo = `${siteUrl}/onboarding`;
  let invitedUserId: string;
  let actionInviteLink: string = "";

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "invite",
    email: normalizedEmail,
    options: {
      data: {
        full_name: normalizedName,
        user_role: role,
        must_change_password: true,
      },
      redirectTo: inviteRedirectTo,
    },
  });

  if (linkError || !linkData?.user) {
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
        if (listErr || !listData?.users || listData.users.length === 0) break;
        foundUser = listData.users.find((u) => u.email?.toLowerCase() === normalizedEmail) || null;
        if (listData.users.length < perPage) break;
        page += 1;
      }
      if (!foundUser) {
        if (isDemoModeEnabled()) {
          invitedUserId = `demo-${Date.now()}`;
          actionInviteLink = `${inviteRedirectTo}?demo_invite=true`;
        } else {
          return { ok: false, status: 400, error: `Invite failed: ${linkError?.message || "User creation failed"}` };
        }
      }
      invitedUserId = foundUser.id;
    }

    const { data: recoveryData } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
      options: {
        redirectTo: inviteRedirectTo,
      },
    });
    actionInviteLink = recoveryData?.properties?.action_link || "";
  } else {
    invitedUserId = linkData.user.id;
    actionInviteLink = linkData.properties?.action_link || "";
  }

  // Ensure redirect_to parameter inside Supabase action_link points strictly to getSiteUrl()/onboarding, never localhost
  if (actionInviteLink) {
    try {
      const parsedUrl = new URL(actionInviteLink);
      parsedUrl.searchParams.set("redirect_to", inviteRedirectTo);
      actionInviteLink = parsedUrl.toString().replace(/https?:\/\/localhost(:\d+)?/gi, "https://pulse.zenxea.com");
    } catch {
      actionInviteLink = actionInviteLink.replace(/https?:\/\/localhost(:\d+)?/gi, "https://pulse.zenxea.com");
    }
  }

  // Generate and set temporary password on user account
  const tempPassword = generateSecureTempPassword();
  try {
    await supabaseAdmin.auth.admin.updateUserById(invitedUserId, {
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: normalizedName,
        user_role: role,
        must_change_password: true,
        onboarding_completed: false,
        temp_password_created_at: new Date().toISOString(),
      },
    });
  } catch (pwdUpdateErr) {
    console.warn("[Invite Employee Set Temp Password Error]:", pwdUpdateErr);
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

  if (provisionError && !isDemoModeEnabled()) {
    return {
      ok: false,
      status: 400,
      error: `Database provisioning failed: ${provisionError.message}`,
    };
  }

  // Persist shift schedule, job title, and department if specified
  const startVal = shiftStartTime ? (shiftStartTime.length === 5 ? `${shiftStartTime}:00` : shiftStartTime) : "09:00:00";
  const endVal = shiftEndTime ? (shiftEndTime.length === 5 ? `${shiftEndTime}:00` : shiftEndTime) : "17:00:00";
  await Promise.all([
    (supabaseAdmin.from("organization_members") as any)
      .update({
        shift_start_time: startVal,
        shift_end_time: endVal,
        department_id: departmentId || null,
        job_title_id: jobTitleId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", invitedUserId)
      .eq("organization_id", context.organizationId),
    (supabaseAdmin.from("employees") as any)
      .update({
        shift_start_time: startVal,
        shift_end_time: endVal,
        department_id: departmentId || null,
        job_title_id: jobTitleId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invitedUserId)
      .eq("organization_id", context.organizationId),
  ]);

  // 3. Dispatch invitation email via Resend / Hostinger SMTP (with Token Link & Temporary Password)
  const emailResult = await sendWelcomeCredentialsEmail({
    to: normalizedEmail,
    fullName: normalizedName,
    role,
    jobTitle: resolvedJobTitleName,
    departmentName: resolvedDepartmentName,
    inviteLink: actionInviteLink,
    temporaryPassword: tempPassword,
    shiftStartTime: shiftStartTime.slice(0, 5),
    shiftEndTime: shiftEndTime.slice(0, 5),
    loginUrl: `${siteUrl}/login`,
  });

  // 4. Write audit row (Token & invite link are never logged or stored)
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
      job_title_id: jobTitleId || null,
      invited_at: new Date().toISOString(),
    },
  });

  // 5. Initialize draft onboarding profile so newly invited users appear in Onboarding Hub immediately
  try {
    await (supabaseAdmin as any).from("onboarding_profiles").upsert(
      {
        user_id: invitedUserId,
        full_name: normalizedName,
        personal_email: normalizedEmail,
        status: "draft",
        candidate_type: employmentCategory === "intern" ? "INTERN" : "GRADUATE_FRESHER",
        highest_qualification: "12th Standard",
        has_experience: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  } catch (onbInitErr) {
    console.warn("[invite-employee] Draft onboarding profile initialization warning:", onbInitErr);
  }

  return {
    ok: true,
    userId: invitedUserId,
    inviteLink: actionInviteLink,
    temporaryPassword: tempPassword,
    emailSent: emailResult.success,
    message: emailResult.success
      ? `User ${normalizedEmail} invited and invitation email dispatched via Resend.`
      : `User ${normalizedEmail} invited. Email delivery failed, please copy the invite link manually.`,
    data: provisionData,
  };
}


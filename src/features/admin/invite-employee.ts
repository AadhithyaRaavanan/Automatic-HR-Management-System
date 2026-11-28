import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminConfigError } from "@/lib/supabase/admin-config";
import { AuthenticatedCallerContext } from "@/features/auth/admin-guard";
import { sendWelcomeCredentialsEmail } from "@/lib/email/resend";
import { getSiteUrl } from "@/lib/site-url";

export interface InviteEmployeeInput {
  email: string;
  fullName: string;
  phone?: string | null;
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
  salary?: number | string | null;
}

export type InviteEmployeeResult =
  | {
      ok: true;
      userId: string;
      employee: any;
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

function sanitizeTime(t?: string, defaultVal: string = "09:00:00"): string {
  if (!t) return defaultVal;
  const trimmed = t.trim();
  if (trimmed.length === 5) return `${trimmed}:00`;
  if (trimmed.length >= 8) return trimmed.slice(0, 8);
  return defaultVal;
}

function isMissingRelationError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || "");
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    /could not find the table|relation .* does not exist/i.test(msg)
  );
}

function isMissingColumnOrRelError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || "");
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    err.code === "PGRST200" ||
    isMissingRelationError(err) ||
    /column .* does not exist|could not find the .* column|could not find a relationship|schema cache/i.test(msg)
  );
}

export async function inviteSingleEmployee(
  context: AuthenticatedCallerContext,
  input: InviteEmployeeInput,
  options?: { auditAction?: string }
): Promise<InviteEmployeeResult> {
  const configError = getSupabaseAdminConfigError();
  if (configError) {
    return {
      ok: false,
      status: 500,
      error: configError,
    };
  }
  const supabaseAdmin = getAdminClient();

  let {
    email,
    fullName,
    phone = null,
    role = "employee",
    employmentCategory = "full_time",
    workMode = "remote",
    timezone = "Asia/Kolkata",
    departmentId = null,
    managerId = null,
    primaryLocationId = null,
    workTargetMinutes = 480,
    expectedOfficeDays = [1, 2, 3, 4, 5],
    requiredOfficeDaysPerWeek = 0,
    shiftStartTime = "09:00:00",
    shiftEndTime = "17:00:00",
    jobTitleId = null,
    salary = null,
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
  const normalizedPhone = phone ? String(phone).trim() : null;
  departmentId = departmentId ? String(departmentId).trim() || null : null;
  jobTitleId = jobTitleId ? String(jobTitleId).trim() || null : null;
  managerId = managerId ? String(managerId).trim() || null : null;
  primaryLocationId = primaryLocationId ? String(primaryLocationId).trim() || null : null;

  if (!normalizedEmail || !normalizedName) {
    return {
      ok: false,
      status: 400,
      error: "Validation Error: 'email' and 'fullName' cannot be blank.",
    };
  }

  if (normalizedPhone && !/^\+?[1-9][0-9]{6,14}$/.test(normalizedPhone)) {
    return {
      ok: false,
      status: 400,
      error: "Validation Error: Contact phone must be 7–15 digits in valid international format.",
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

  if (!["employee", "team_lead", "manager", "hr", "admin"].includes(role)) {
    return {
      ok: false,
      status: 400,
      error: `Validation Error: Invalid role '${role}'.`,
    };
  }

  if (!["full_time", "part_time", "contract", "intern"].includes(employmentCategory)) {
    return {
      ok: false,
      status: 400,
      error: `Validation Error: Invalid employment category '${employmentCategory}'.`,
    };
  }

  if (context.role !== "admin" && role === "admin") {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: Only administrators can invite admin users.",
    };
  }

  let resolvedDepartmentName: string | undefined;
  let resolvedJobTitleName: string | undefined;

  // Validate foreign keys when provided
  if (departmentId) {
    const { data: dept, error: deptErr } = await supabaseAdmin
      .from("departments")
      .select("id, name")
      .eq("id", departmentId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (deptErr && !isMissingRelationError(deptErr)) {
      return {
        ok: false,
        status: 400,
        error: `Department lookup failed: ${deptErr.message}`,
      };
    }
    if (!deptErr && !dept) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden: Department does not belong to your organization.",
      };
    }
    if (dept) resolvedDepartmentName = dept.name;
    else departmentId = null;
  }

  if (jobTitleId) {
    const { data: initialJt, error: jtLookupErr } = await (supabaseAdmin as any)
      .from("job_titles")
      .select("id, title_name, department_id")
      .eq("id", jobTitleId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (jtLookupErr && isMissingRelationError(jtLookupErr)) {
      jobTitleId = null;
    } else {
      let jt = initialJt;
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
  }

  if (managerId) {
    let mgrQuery = await supabaseAdmin
      .from("employees")
      .select("id, organization_id")
      .eq("id", managerId)
      .maybeSingle();
    if (mgrQuery.error && isMissingColumnOrRelError(mgrQuery.error)) {
      mgrQuery = (await supabaseAdmin
        .from("employees")
        .select("id")
        .eq("id", managerId)
        .maybeSingle()) as any;
    }
    if (
      !mgrQuery.data ||
      ((mgrQuery.data as any).organization_id &&
        (mgrQuery.data as any).organization_id !== context.organizationId)
    ) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden: Manager does not belong to your organization.",
      };
    }
  }

  if (primaryLocationId) {
    const { data: loc, error: locErr } = await supabaseAdmin
      .from("locations")
      .select("id")
      .eq("id", primaryLocationId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();
    if (locErr && isMissingRelationError(locErr)) {
      primaryLocationId = null;
    } else if (!loc) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden: Location does not belong to your organization.",
      };
    }
  }

  // 0. Check existing employee record by email BEFORE inviting (handles starter schema without organization_id)
  let preExistingEmployee: { id: string; organization_id?: string | null } | null = null;
  {
    const empByEmailRes = await supabaseAdmin
      .from("employees")
      .select("id, organization_id")
      .ilike("email", normalizedEmail)
      .maybeSingle();
    if (!empByEmailRes.error) {
      preExistingEmployee = empByEmailRes.data;
    } else if (isMissingColumnOrRelError(empByEmailRes.error)) {
      const baseEmpByEmail = await supabaseAdmin
        .from("employees")
        .select("id")
        .ilike("email", normalizedEmail)
        .maybeSingle();
      preExistingEmployee = baseEmpByEmail.data;
    }
  }

  if (
    preExistingEmployee?.organization_id &&
    preExistingEmployee.organization_id !== context.organizationId
  ) {
    return {
      ok: false,
      status: 409,
      error: "Conflict: Employee email already belongs to another organization.",
    };
  }

  // 1. Create or invite user via Supabase Auth Admin generateLink flow
  const siteUrl = getSiteUrl();
  const inviteRedirectTo = `${siteUrl}/onboarding`;
  let invitedUserId: string;
  let actionInviteLink = "";
  let createdNewAuthUser = false;

  // Check if user already exists by email in Auth or employees/organization_members BEFORE mutating Auth state
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "invite",
    email: normalizedEmail,
    options: {
      data: {
        full_name: normalizedName,
        user_role: role,
        employment_category: employmentCategory,
        phone: normalizedPhone,
        must_change_password: true,
      },
      redirectTo: inviteRedirectTo,
    },
  });

  if (!linkError && linkData?.user?.id) {
    invitedUserId = linkData.user.id;
    actionInviteLink = linkData.properties?.action_link || "";
    createdNewAuthUser = true;
  } else {
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

      if (!foundUser?.id) {
        return {
          ok: false,
          status: 400,
          error: `Auth invite failed: ${linkError?.message || "Unable to create or locate Supabase Auth user."}`,
        };
      }
      invitedUserId = foundUser.id;
    }
  }

  const rollbackNewlyCreatedAuthUser = async () => {
    if (!createdNewAuthUser || !invitedUserId) return;
    try {
      await (supabaseAdmin as any).from("onboarding_profiles").delete().eq("user_id", invitedUserId);
    } catch {}
    try {
      await (supabaseAdmin.from("employees") as any).delete().eq("id", invitedUserId);
    } catch {}
    try {
      await (supabaseAdmin.from("organization_members") as any)
        .delete()
        .eq("user_id", invitedUserId)
        .eq("organization_id", context.organizationId);
    } catch {}
    try {
      await (supabaseAdmin.from("user_roles") as any).delete().eq("user_id", invitedUserId);
    } catch {}
    try {
      await supabaseAdmin.auth.admin.deleteUser(invitedUserId);
    } catch (delErr: any) {
      console.error("[inviteSingleEmployee] Rollback deleteUser failed:", delErr?.message || delErr);
    }
  };

  // Verify cross-tenant boundaries BEFORE generating a magic link or updating Auth credentials/metadata
  const { data: otherMembers, error: exMemErr } = await supabaseAdmin
    .from("organization_members")
    .select("organization_id, role, status")
    .eq("user_id", invitedUserId);

  const hasOrgMembersTable = !exMemErr || !isMissingRelationError(exMemErr);

  if (exMemErr && !isMissingRelationError(exMemErr)) {
    await rollbackNewlyCreatedAuthUser();
    return {
      ok: false,
      status: 500,
      error: `Failed to verify organization membership: ${exMemErr.message}`,
    };
  }

  const conflictingMembership = (otherMembers || []).find(
    (m: any) => m.organization_id && m.organization_id !== context.organizationId
  );
  if (conflictingMembership) {
    await rollbackNewlyCreatedAuthUser();
    return {
      ok: false,
      status: 409,
      error: "Conflict: User already belongs to another organization.",
    };
  }

  let existingEmployeeOrgId: string | null = null;
  const existingEmpCheck = await supabaseAdmin
    .from("employees")
    .select("organization_id")
    .eq("id", invitedUserId)
    .maybeSingle();

  if (existingEmpCheck.error && !isMissingColumnOrRelError(existingEmpCheck.error)) {
    await rollbackNewlyCreatedAuthUser();
    return {
      ok: false,
      status: 500,
      error: `Failed to verify employee uniqueness: ${existingEmpCheck.error.message}`,
    };
  }
  existingEmployeeOrgId = (existingEmpCheck.data as any)?.organization_id || null;

  if (existingEmployeeOrgId && existingEmployeeOrgId !== context.organizationId) {
    await rollbackNewlyCreatedAuthUser();
    return {
      ok: false,
      status: 409,
      error: "Conflict: Employee record already belongs to another organization.",
    };
  }

  if (!createdNewAuthUser) {
    const { data: recoveryData } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
      options: { redirectTo: inviteRedirectTo },
    });
    actionInviteLink = recoveryData?.properties?.action_link || "";
  }

  if (actionInviteLink) {
    try {
      const parsedUrl = new URL(actionInviteLink);
      parsedUrl.searchParams.set("redirect_to", inviteRedirectTo);
      actionInviteLink = parsedUrl.toString().replace(/https?:\/\/localhost(:\d+)?/gi, "https://pulse.zenxea.com");
    } catch {
      actionInviteLink = actionInviteLink.replace(/https?:\/\/localhost(:\d+)?/gi, "https://pulse.zenxea.com");
    }
  }

  // Generate and set temporary password + metadata (including app_metadata.user_role) on user account
  const tempPassword = generateSecureTempPassword();
  try {
    const { error: updateAuthErr } = await supabaseAdmin.auth.admin.updateUserById(invitedUserId, {
      password: tempPassword,
      email_confirm: true,
      app_metadata: {
        user_role: role,
        onboarding_approved: true,
      },
      user_metadata: {
        full_name: normalizedName,
        user_role: role,
        employment_category: employmentCategory,
        phone: normalizedPhone,
        must_change_password: true,
        onboarding_completed: false,
        temp_password_created_at: new Date().toISOString(),
      },
    });
    if (updateAuthErr) {
      await rollbackNewlyCreatedAuthUser();
      return {
        ok: false,
        status: 400,
        error: `Failed to initialize Auth credentials: ${updateAuthErr.message}`,
      };
    }
  } catch (pwdUpdateErr: any) {
    await rollbackNewlyCreatedAuthUser();
    return {
      ok: false,
      status: 500,
      error: `Failed to initialize Auth credentials: ${pwdUpdateErr?.message || String(pwdUpdateErr)}`,
    };
  }

  // 2. Persist membership/role + employees record with schema-adaptive fallbacks & strict error checks
  const startVal = sanitizeTime(shiftStartTime, "09:00:00");
  const endVal = sanitizeTime(shiftEndTime, "17:00:00");
  const effectiveTz = !timezone || timezone === "UTC" ? "Asia/Kolkata" : timezone;
  const nowIso = new Date().toISOString();
  const baseSecurityRole = role === "team_lead" ? "employee" : role;

  let provisionData: any = null;
  if (hasOrgMembersTable) {
    const rpcRes = await (supabaseAdmin.rpc as any)("provision_invited_employee", {
      p_user_id: invitedUserId,
      p_organization_id: context.organizationId,
      p_email: normalizedEmail,
      p_full_name: normalizedName,
      p_role: baseSecurityRole,
      p_work_mode: workMode,
      p_timezone: effectiveTz,
      p_department_id: departmentId,
      p_manager_id: managerId,
      p_primary_location_id: primaryLocationId,
      p_work_target_minutes: Number(workTargetMinutes),
      p_expected_office_days: expectedOfficeDays,
      p_required_office_days_per_week: Number(requiredOfficeDaysPerWeek),
    });
    if (!rpcRes.error) {
      provisionData = rpcRes.data;
    }

    let { error: omUpsertErr } = await (supabaseAdmin.from("organization_members") as any).upsert(
      {
        organization_id: context.organizationId,
        user_id: invitedUserId,
        role: role,
        status: "active",
        shift_start_time: startVal,
        shift_end_time: endVal,
        department_id: departmentId,
        job_title_id: jobTitleId,
        updated_at: nowIso,
      },
      { onConflict: "organization_id,user_id" }
    );

    if (omUpsertErr && isMissingColumnOrRelError(omUpsertErr)) {
      const retryOm = await (supabaseAdmin.from("organization_members") as any).upsert(
        {
          organization_id: context.organizationId,
          user_id: invitedUserId,
          role: baseSecurityRole,
          status: "active",
          updated_at: nowIso,
        },
        { onConflict: "organization_id,user_id" }
      );
      omUpsertErr = retryOm.error;
    }

    if (omUpsertErr) {
      await rollbackNewlyCreatedAuthUser();
      return {
        ok: false,
        status: 400,
        error: `Failed to save organization membership: ${omUpsertErr.message}`,
      };
    }
  } else {
    // Starter schema uses public.user_roles table (user_id, role). Write strictly with service-role client.
    const isPermissionErr = (e: any) =>
      Boolean(e && (e.code === "42501" || /permission denied|row-level security/i.test(String(e.message || ""))));

    try {
      await (supabaseAdmin.from("user_roles") as any).delete().eq("user_id", invitedUserId);
    } catch {}
    const urRes = await (supabaseAdmin.from("user_roles") as any).upsert(
      { user_id: invitedUserId, role: baseSecurityRole },
      { onConflict: "user_id,role", ignoreDuplicates: true }
    );

    if (urRes?.error && urRes.error.code !== "23505") {
      if (isPermissionErr(urRes.error)) {
        console.warn(
          "[inviteSingleEmployee] user_roles table write denied by database ACL; role remains persisted in Auth app_metadata:",
          urRes.error.message
        );
      } else {
        await rollbackNewlyCreatedAuthUser();
        return {
          ok: false,
          status: 400,
          error: `Failed to save user role: ${urRes.error.message}`,
        };
      }
    }
  }

  // Persist employees record (progressive fallback from full multi-tenant schema -> base schema)
  const fullEmployeePayload = {
    id: invitedUserId,
    organization_id: context.organizationId,
    email: normalizedEmail,
    full_name: normalizedName,
    phone: normalizedPhone,
    work_mode: workMode,
    timezone: effectiveTz,
    department_id: departmentId,
    job_title_id: jobTitleId,
    manager_id: managerId,
    primary_location_id: primaryLocationId,
    work_target_minutes: Number(workTargetMinutes),
    expected_office_days: expectedOfficeDays,
    required_office_days_per_week: Number(requiredOfficeDaysPerWeek),
    shift_start_time: startVal,
    shift_end_time: endVal,
    status: "active",
    updated_at: nowIso,
  };

  const upsertEmployeesWithClient = async (client: any) => {
    let res = await (client.from("employees") as any).upsert(
      {
        ...fullEmployeePayload,
        employment_category: employmentCategory,
      },
      { onConflict: "id" }
    );

    if (res.error && isMissingColumnOrRelError(res.error)) {
      res = await (client.from("employees") as any).upsert(fullEmployeePayload, {
        onConflict: "id",
      });
    }

    if (res.error && isMissingColumnOrRelError(res.error)) {
      // Starter schema employees table: id, full_name, email, avatar_url, manager_id, timezone, work_target_minutes, status, joined_on, updated_at
      res = await (client.from("employees") as any).upsert(
        {
          id: invitedUserId,
          email: normalizedEmail,
          full_name: normalizedName,
          manager_id: managerId,
          timezone: effectiveTz,
          work_target_minutes: Number(workTargetMinutes),
          status: "active",
          updated_at: nowIso,
        },
        { onConflict: "id" }
      );
    }

    return res;
  };

  let empUpsertRes = await upsertEmployeesWithClient(supabaseAdmin);
  const empUpsertErr = empUpsertRes.error;

  if (empUpsertErr) {
    await rollbackNewlyCreatedAuthUser();
    const isAclErr =
      empUpsertErr.code === "42501" ||
      /permission denied|row-level security/i.test(String(empUpsertErr.message || ""));
    return {
      ok: false,
      status: isAclErr ? 403 : 400,
      error: isAclErr
        ? `Failed to save employee record: ${empUpsertErr.message}. Verify SUPABASE_SERVICE_ROLE_KEY belongs to this project and database grants allow service_role inserts on public.employees (see supabase/migrations/20261127000005_fix_user_roles_grants.sql).`
        : `Failed to save employee record: ${empUpsertErr.message}`,
    };
  }

  // Verify the persisted employee row actually exists in Postgres using the privileged server client
  const verifyRes = await (async () => {
    const extRes = await (supabaseAdmin.from("employees") as any)
      .select(
        "id, organization_id, email, full_name, phone, work_mode, timezone, department_id, job_title_id, shift_start_time, shift_end_time, status, joined_on, departments:department_id(id, name, code), job_titles:job_title_id(id, title_name)"
      )
      .eq("id", invitedUserId)
      .maybeSingle();

    if (!extRes.error) {
      return { data: extRes.data, error: null };
    }
    if (isMissingColumnOrRelError(extRes.error)) {
      return await (supabaseAdmin.from("employees") as any)
        .select("id, email, full_name, timezone, work_target_minutes, status, joined_on")
        .eq("id", invitedUserId)
        .maybeSingle();
    }
    return extRes;
  })();
  const verifiedEmployee = verifyRes?.data;
  const verifyEmpErr = verifyRes?.error;

  if (verifyEmpErr || !verifiedEmployee) {
    await rollbackNewlyCreatedAuthUser();
    return {
      ok: false,
      status: 500,
      error: `Employee persistence verification failed: ${verifyEmpErr?.message || "Employee record not found after insert."}`,
    };
  }

  // 3. Ensure draft onboarding profile exists when onboarding_profiles table is present
  const { data: existingOnb, error: onbSelectErr } = await (supabaseAdmin as any)
    .from("onboarding_profiles")
    .select("id, status, education_details")
    .eq("user_id", invitedUserId)
    .maybeSingle();

  if (!onbSelectErr || !isMissingRelationError(onbSelectErr)) {
    const mergedEduDetails = {
      ...(existingOnb?.education_details && typeof existingOnb.education_details === "object"
        ? existingOnb.education_details
        : {}),
      employment_category: employmentCategory,
    };

    const { error: onbErr } = await (supabaseAdmin as any).from("onboarding_profiles").upsert(
      {
        user_id: invitedUserId,
        full_name: normalizedName,
        personal_email: normalizedEmail,
        phone: normalizedPhone,
        status: existingOnb?.status && existingOnb.status !== "draft" ? existingOnb.status : "draft",
        candidate_type: employmentCategory === "intern" ? "INTERN" : "GRADUATE_FRESHER",
        education_details: mergedEduDetails,
        highest_qualification: "12th Standard",
        has_experience: false,
        created_at: existingOnb ? undefined : nowIso,
        updated_at: nowIso,
      },
      { onConflict: "user_id" }
    );

    if (onbErr && !isMissingRelationError(onbErr)) {
      await rollbackNewlyCreatedAuthUser();
      return {
        ok: false,
        status: 400,
        error: `Failed to initialize onboarding profile: ${onbErr.message}`,
      };
    }
  }

  // 4. Dispatch invitation email via Resend / Hostinger SMTP
  const emailResult = await sendWelcomeCredentialsEmail({
    to: normalizedEmail,
    fullName: normalizedName,
    role,
    jobTitle: resolvedJobTitleName,
    departmentName: resolvedDepartmentName,
    inviteLink: actionInviteLink,
    temporaryPassword: tempPassword,
    shiftStartTime: startVal.slice(0, 5),
    shiftEndTime: endVal.slice(0, 5),
    loginUrl: `${siteUrl}/login`,
  });

  // 5. Write audit row (best-effort; falls back cleanly if audit_logs lacks organization_id)
  try {
    const auditPayload = {
      actor_id: context.userId,
      action: options?.auditAction || "MEMBER_INVITED",
      table_name: "employees",
      record_id: invitedUserId,
      old_data: null,
      new_data: {
        email: normalizedEmail,
        full_name: normalizedName,
        phone: normalizedPhone,
        role,
        employment_category: employmentCategory,
        work_mode: workMode,
        timezone: effectiveTz,
        shift_start_time: startVal,
        shift_end_time: endVal,
        email_dispatched: emailResult.success,
        department_id: departmentId,
        job_title_id: jobTitleId,
        salary_inr: salary ? Number(salary) : null,
        invited_at: nowIso,
      },
    };

    const { error: auditErr } = await supabaseAdmin.from("audit_logs").insert({
      organization_id: context.organizationId,
      ...auditPayload,
    });
    if (auditErr && isMissingColumnOrRelError(auditErr)) {
      await (supabaseAdmin.from("audit_logs") as any).insert(auditPayload);
    }
  } catch (auditErr: any) {
    console.warn("[inviteSingleEmployee] Audit log warning:", auditErr?.message || auditErr);
  }

  return {
    ok: true,
    userId: invitedUserId,
    employee: {
      ...verifiedEmployee,
      phone: verifiedEmployee.phone || normalizedPhone,
      employment_category: employmentCategory,
      role,
    },
    inviteLink: actionInviteLink,
    temporaryPassword: tempPassword,
    emailSent: emailResult.success,
    message: emailResult.success
      ? `User ${normalizedEmail} invited and invitation email dispatched via Resend.`
      : `User ${normalizedEmail} provisioned. Email delivery failed, please copy the invite link manually.`,
    data: provisionData || verifiedEmployee,
  };
}

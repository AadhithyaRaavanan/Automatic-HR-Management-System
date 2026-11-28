import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database, EmployeeRole } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";

export const ORG_SELECTION_COOKIE = "pulse_org_id";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantMembershipSummary {
  organizationId: string;
  organizationName: string;
  role: EmployeeRole;
  departmentId: string | null;
}

export interface TenantCallerContext {
  userId: string;
  email: string;
  organizationId: string;
  organizationName: string;
  organizationTimezone: string;
  role: EmployeeRole;
  departmentId: string | null;
  aal: string;
  memberships: TenantMembershipSummary[];
  employee: any | null;
}

export interface ResolveTenantOptions {
  allowedRoles?: EmployeeRole[];
  skipOnboardingCheck?: boolean;
  requireAal2ForPrivileged?: boolean;
}

/**
 * Authorizes scheduled / cron endpoints strictly via CRON_SECRET.
 * Fails closed even if CRON_SECRET is missing in environment configuration.
 */
export function requireCronAuthorization(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Cron execution blocked: CRON_SECRET is not configured." },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-cron-secret");
  const isAuthorized =
    authHeader === `Bearer ${cronSecret}` || secretHeader === cronSecret;

  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
  }
  return null;
}

/**
 * Single authoritative server-side tenant & RBAC context resolver.
 * - Verifies caller identity cryptographically via Supabase auth.
 * - Reads active memberships ONLY from `organization_members` (never editable user_metadata).
 * - Enforces explicit organization selection when a user holds multiple active memberships.
 * - Rejects deactivated employees, inactive organizations, unapproved onboarding, and missing AAL2.
 */
export async function resolveTenantCaller(
  request: NextRequest,
  options: ResolveTenantOptions = {}
): Promise<
  | { context: TenantCallerContext; user: any; supabase: ReturnType<typeof createServerClient<Database>> }
  | { response: NextResponse }
> {
  const response = NextResponse.next();
  const authHeader = request.headers.get("authorization");
  const bearerToken =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
    {
      ...(bearerToken
        ? {
            global: {
              headers: {
                Authorization: `Bearer ${bearerToken}`,
              },
            },
          }
        : {}),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  let user: any = null;
  let authError: any = null;

  if (bearerToken && typeof (supabaseAdmin as any)?.auth?.getUser === "function") {
    const tokenRes = await supabaseAdmin.auth.getUser(bearerToken);
    user = tokenRes?.data?.user || null;
    authError = tokenRes?.error || null;
  }
  if (!user) {
    const cookieRes = await supabase.auth.getUser();
    user = cookieRes?.data?.user || null;
    authError = authError || cookieRes?.error || null;
  }

  if (authError || !user) {
    return {
      response: NextResponse.json(
        { error: "Unauthorized: Invalid or missing authentication credentials." },
        { status: 401 }
      ),
    };
  }

  const dbClient: any = typeof (supabaseAdmin as any)?.from === "function" ? supabaseAdmin : supabase;
  const rawRequestedOrgId =
    request.headers.get("x-organization-id")?.trim() ||
    request.cookies.get(ORG_SELECTION_COOKIE)?.value?.trim() ||
    null;

  if (rawRequestedOrgId && !UUID_REGEX.test(rawRequestedOrgId)) {
    return {
      response: NextResponse.json(
        { error: "Invalid organization selection identifier." },
        { status: 400 }
      ),
    };
  }

  // Fetch ALL active memberships with joined organization state (graceful fallback if minimal test mock lacks .order)
  let membersQuery = dbClient
    .from("organization_members")
    .select(
      "organization_id, role, status, department_id, organizations(id, name, status, require_mfa_for_privileged, timezone)"
    )
    .eq("user_id", user.id)
    .eq("status", "active");

  const queryRes =
    typeof membersQuery.order === "function"
      ? await membersQuery.order("created_at", { ascending: true })
      : typeof membersQuery.maybeSingle === "function"
      ? await membersQuery.maybeSingle()
      : await membersQuery;

  const memberError = queryRes?.error || null;
  const membersRows: any[] = Array.isArray(queryRes?.data)
    ? queryRes.data
    : queryRes?.data
    ? [queryRes.data]
    : [];

  if (memberError && (memberError as any).code === "SUPABASE_ADMIN_NOT_CONFIGURED") {
    return {
      response: NextResponse.json(
        { success: false, error: memberError.message },
        { status: 500 }
      ),
    };
  }

  const activeMemberships: Array<{
    organizationId: string;
    organizationName: string;
    organizationTimezone: string;
    requireMfa: boolean;
    role: EmployeeRole;
    departmentId: string | null;
  }> = [];

  for (const m of membersRows || []) {
    const org = (m as any).organizations;
    if (org && org.status && !["active", "trial"].includes(String(org.status).toLowerCase())) {
      continue;
    }
    activeMemberships.push({
      organizationId: m.organization_id,
      organizationName: org?.name || "Organization",
      organizationTimezone: org?.timezone || "Asia/Kolkata",
      requireMfa: typeof org?.require_mfa_for_privileged === "boolean" ? org.require_mfa_for_privileged : true,
      role: String(m.role || "employee").toLowerCase() as EmployeeRole,
      departmentId: m.department_id || null,
    });
  }

  if (activeMemberships.length === 0) {
    return {
      response: NextResponse.json(
        { error: "Forbidden: No active organization membership found." },
        { status: 403 }
      ),
    };
  }

  // Explicit organization selection enforcement
  let selected = activeMemberships[0];
  if (rawRequestedOrgId) {
    const matched = activeMemberships.find((m) => m.organizationId === rawRequestedOrgId);
    if (!matched) {
      return {
        response: NextResponse.json(
          { error: "Forbidden: Requested organization is not an active membership for this account." },
          { status: 403 }
        ),
      };
    }
    selected = matched;
  } else if (activeMemberships.length > 1) {
    return {
      response: NextResponse.json(
        {
          error: "Multiple active organization memberships found. Please select an active organization.",
          code: "ORG_SELECTION_REQUIRED",
          organizations: activeMemberships.map((m) => ({
            organizationId: m.organizationId,
            organizationName: m.organizationName,
            role: m.role,
          })),
        },
        { status: 409 }
      ),
    };
  }

  // Load employee profile scoped strictly to selected organization
  let empRow: any = null;
  try {
    const empQ = dbClient
      .from("employees")
      .select("id, organization_id, full_name, email, status, department_id, manager_id, onboarding_completed, timezone")
      .eq("id", user.id);
    const empFinal = typeof empQ.eq === "function" ? empQ.eq("organization_id", selected.organizationId) : empQ;
    const empRes = typeof empFinal.maybeSingle === "function" ? await empFinal.maybeSingle() : await empFinal;
    empRow = empRes?.data || null;
  } catch {}

  if (empRow && ["inactive", "deactivated", "suspended", "terminated"].includes(String(empRow.status || "").toLowerCase())) {
    return {
      response: NextResponse.json(
        { error: "Forbidden: Employee account is inactive in this organization." },
        { status: 403 }
      ),
    };
  }

  // Role authorization check
  if (options.allowedRoles && !options.allowedRoles.includes(selected.role)) {
    return {
      response: NextResponse.json(
        {
          error:
            options.allowedRoles.length === 1 && options.allowedRoles[0] === "admin"
              ? "Forbidden: Only Admins can perform this action."
              : `Forbidden: Action requires one of [${options.allowedRoles.join(", ")}] roles.`,
        },
        { status: 403 }
      ),
    };
  }

  // Onboarding approval gate (strictly DB-verified unless admin or skipped)
  if (!options.skipOnboardingCheck && selected.role !== "admin") {
    const isClaimApproved = (user.app_metadata as any)?.onboarding_approved === true;
    let isApproved = isClaimApproved && (!empRow || empRow.status === "active");

    if (!isApproved) {
      const { data: onbProf } = await dbClient
        .from("onboarding_profiles")
        .select("status")
        .eq("user_id", user.id)
        .maybeSingle();

      const profStatus = String(onbProf?.status || "").toLowerCase();
      const empActive = empRow?.status === "active";
      if (profStatus === "approved" && empActive) {
        isApproved = true;
      }
    }

    if (!isApproved) {
      return {
        response: NextResponse.json(
          {
            error: "Onboarding not approved. Wait until approval.",
            code: "ONBOARDING_NOT_APPROVED",
          },
          { status: 403 }
        ),
      };
    }
  }

  // Verified AAL check from claims / MFA API
  let currentAal = "aal1";
  let hasEnrolledFactor = false;
  try {
    const authAny = supabase.auth as any;
    if (typeof authAny.getClaims === "function") {
      const { data: claimsData, error: claimsErr } = await authAny.getClaims(bearerToken);
      if (!claimsErr && claimsData?.claims?.aal) {
        currentAal = String(claimsData.claims.aal);
      }
    }
    if (typeof supabase.auth.mfa?.getAuthenticatorAssuranceLevel === "function") {
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalData?.currentLevel && currentAal === "aal1") {
        currentAal = aalData.currentLevel;
      }
      if (aalData?.nextLevel === "aal2") {
        hasEnrolledFactor = true;
      }
    }
  } catch {}

  const isDemo = isDemoModeEnabled();
  if (options.requireAal2ForPrivileged) {
    const mfaRequired =
      !isDemo &&
      selected.requireMfa &&
      (hasEnrolledFactor || selected.role === "admin" || selected.role === "hr");

    if (mfaRequired && currentAal !== "aal2") {
      return {
        response: NextResponse.json(
          { error: "Forbidden: Elevated action requires active AAL2 multi-factor authentication." },
          { status: 403 }
        ),
      };
    }
  }

  return {
    user,
    supabase,
    context: {
      userId: user.id,
      email: user.email || empRow?.email || "",
      organizationId: selected.organizationId,
      organizationName: selected.organizationName,
      organizationTimezone: empRow?.timezone || selected.organizationTimezone || "Asia/Kolkata",
      role: selected.role,
      departmentId: empRow?.department_id || selected.departmentId || null,
      aal: currentAal,
      memberships: activeMemberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organizationName,
        role: m.role,
        departmentId: m.departmentId,
      })),
      employee: empRow || null,
    },
  };
}

/**
 * Verifies a target employee belongs strictly to the caller's active organization,
 * and checks optional self / manager scoping before any read, URL signing, or write.
 */
export async function verifyTargetEmployeeInOrg(
  context: {
    userId: string;
    organizationId: string;
    role: EmployeeRole;
    departmentId?: string | null;
  },
  targetEmployeeId: string,
  opts: { allowSelf?: boolean; managerScoped?: boolean } = {}
): Promise<{ allowed: boolean; employee: any | null }> {
  if (!context.organizationId || !targetEmployeeId || !UUID_REGEX.test(targetEmployeeId)) {
    return { allowed: false, employee: null };
  }

  const { data: targetEmp } = await (supabaseAdmin.from("employees") as any)
    .select("id, organization_id, department_id, manager_id, status, email, full_name")
    .eq("id", targetEmployeeId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();

  if (!targetEmp) {
    // Also check if candidate exists in onboarding phase with an org membership in this org
    const { data: orgMem } = await (supabaseAdmin.from("organization_members") as any)
      .select("user_id, organization_id, role, department_id, status")
      .eq("user_id", targetEmployeeId)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (!orgMem) {
      return { allowed: false, employee: null };
    }
    if (opts.allowSelf && context.userId === targetEmployeeId) {
      return { allowed: true, employee: { id: targetEmployeeId, organization_id: context.organizationId, department_id: orgMem.department_id } };
    }
    if (context.role === "admin" || context.role === "hr") {
      return { allowed: true, employee: { id: targetEmployeeId, organization_id: context.organizationId, department_id: orgMem.department_id } };
    }
    return { allowed: false, employee: null };
  }

  if (opts.allowSelf && context.userId === targetEmployeeId) {
    return { allowed: true, employee: targetEmp };
  }

  if (context.role === "admin" || context.role === "hr") {
    return { allowed: true, employee: targetEmp };
  }

  if (context.role === "manager" || context.role === "team_lead") {
    if (!opts.managerScoped) {
      return { allowed: true, employee: targetEmp };
    }
    if (targetEmp.manager_id === context.userId) {
      return { allowed: true, employee: targetEmp };
    }
    if (context.departmentId && targetEmp.department_id === context.departmentId) {
      return { allowed: true, employee: targetEmp };
    }
    return { allowed: false, employee: targetEmp };
  }

  return { allowed: false, employee: targetEmp };
}

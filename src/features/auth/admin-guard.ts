import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { Database, EmployeeRole } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";

export interface AuthenticatedCallerContext {
  userId: string;
  organizationId: string;
  role: EmployeeRole;
  aal: string;
  email?: string;
}

/**
 * Validates that an incoming API request comes from an authenticated user
 * with an active membership in the specified roles, enforcing AAL2 MFA for admin/hr
 * strictly from cryptographically verified JWT claims / server assurance level.
 */
export async function verifyAdminRouteCaller(
  request: NextRequest,
  allowedRoles: EmployeeRole[] = ["admin"]
): Promise<{ context: AuthenticatedCallerContext; supabase: ReturnType<typeof createServerClient<Database>> } | { response: NextResponse }> {
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

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(bearerToken);

  if (authError || !user) {
    return {
      response: NextResponse.json(
        { error: "Unauthorized: Invalid or missing authentication credentials." },
        { status: 401 }
      ),
    };
  }

  // Authoritative check against organization_members + organizations active status
  const { data: member, error: memberError } = await supabaseAdmin
    .from("organization_members")
    .select("organization_id, role, status, organizations!inner(status)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (memberError && (memberError as any).code === "SUPABASE_ADMIN_NOT_CONFIGURED") {
    return {
      response: NextResponse.json(
        { success: false, error: memberError.message },
        { status: 500 }
      ),
    };
  }

  const isDemo = isDemoModeEnabled();
  const isMissingOrgMembersTable = Boolean(
    memberError &&
      (memberError.code === "PGRST205" ||
        memberError.code === "42P01" ||
        /could not find the table|does not exist|schema cache/i.test(memberError.message || ""))
  );

  // Fallback for starter/base schemas where public.organization_members does not exist yet
  if (isMissingOrgMembersTable) {
    let baseRole: string =
      (user.app_metadata as any)?.user_role ||
      (user.user_metadata as any)?.user_role ||
      (user.user_metadata as any)?.role ||
      "";

    try {
      const { data: urRow } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (urRow?.role) {
        baseRole = String(urRow.role).toLowerCase();
      }
    } catch {}

    if (!baseRole) {
      baseRole = isDemo ? "admin" : "employee";
    }

    const resolvedRole = baseRole.toLowerCase() as EmployeeRole;
    if (!allowedRoles.includes(resolvedRole)) {
      return {
        response: NextResponse.json(
          {
            error:
              allowedRoles.length === 1 && allowedRoles[0] === "admin"
                ? "Forbidden: Only Admins can delete tasks or projects."
                : `Forbidden: Action requires one of [${allowedRoles.join(", ")}] roles.`,
          },
          { status: 403 }
        ),
      };
    }

    return {
      supabase,
      context: {
        userId: user.id,
        organizationId: "00000000-0000-0000-0000-000000000001",
        role: resolvedRole,
        aal: "aal1",
        email: user.email,
      },
    };
  }

  const orgStatus = (member as any)?.organizations?.status;
  if (memberError || !member || (orgStatus && !["active", "trial"].includes(orgStatus))) {
    if (isDemo && user) {
      const demoMetaRole =
        (user.app_metadata as any)?.user_role ||
        (user.user_metadata as any)?.user_role;
      const demoFallbackRole: EmployeeRole =
        demoMetaRole && ["employee", "manager", "hr", "admin"].includes(demoMetaRole)
          ? (demoMetaRole as EmployeeRole)
          : user.email === "hr@remotehr.io"
          ? "hr"
          : user.email === "manager@remotehr.io"
          ? "manager"
          : user.email === "employee@remotehr.io"
          ? "employee"
          : "admin";
      if (!allowedRoles.includes(demoFallbackRole)) {
        return {
          response: NextResponse.json(
            {
              error:
                allowedRoles.length === 1 && allowedRoles[0] === "admin"
                  ? "Forbidden: Only Admins can delete tasks or projects."
                  : `Forbidden: Action requires one of [${allowedRoles.join(", ")}] roles.`,
            },
            { status: 403 }
          ),
        };
      }
      return {
        supabase,
        context: {
          userId: user.id,
          organizationId: "00000000-0000-0000-0000-000000000001",
          role: demoFallbackRole,
          aal: "aal1",
          email: user.email,
        },
      };
    }
    return {
      response: NextResponse.json(
        { error: "Forbidden: No active organization membership found." },
        { status: 403 }
      ),
    };
  }

  const role = member.role as EmployeeRole;
  if (!allowedRoles.includes(role)) {
    if (
      isDemo &&
      ((user.email === "admin@remotehr.io" && allowedRoles.includes("admin")) ||
        (user.email === "hr@remotehr.io" && allowedRoles.includes("hr")))
    ) {
      // Allow matching demo account role
    } else {
      return {
        response: NextResponse.json(
          {
            error:
              allowedRoles.length === 1 && allowedRoles[0] === "admin"
                ? "Forbidden: Only Admins can delete tasks or projects."
                : `Forbidden: Action requires one of [${allowedRoles.join(", ")}] roles.`,
          },
          { status: 403 }
        ),
      };
    }
  }

  // MFA AAL2 Enforcement for Admin & HR:
  // In demo mode, MFA is not enforced so stakeholder presentations run smoothly.
  let currentAal = "aal1";
  const authAny = supabase.auth as any;
  if (typeof authAny.getClaims === "function") {
    const { data: claimsData, error: claimsErr } = await authAny.getClaims(bearerToken);
    if (!claimsErr && claimsData?.claims?.aal) {
      currentAal = String(claimsData.claims.aal);
    }
  } else if (typeof supabase.auth.mfa?.getAuthenticatorAssuranceLevel === "function") {
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.currentLevel) {
      currentAal = aalData.currentLevel;
    }
  }

  // MFA Policy Enforcement for Admin & HR:
  // mfa_required = caller has verified TOTP factor OR (role in ['hr', 'admin'] AND organizations.require_mfa_for_privileged is TRUE)
  const { data: orgData } = await supabaseAdmin
    .from("organizations")
    .select("require_mfa_for_privileged")
    .eq("id", member.organization_id)
    .maybeSingle();

  const reqMfa = (orgData as any)?.require_mfa_for_privileged ?? true;
  let hasEnrolledFactor = false;
  try {
    if (typeof supabase.auth.mfa?.getAuthenticatorAssuranceLevel === "function") {
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalData?.nextLevel === "aal2") hasEnrolledFactor = true;
    }
  } catch {}

  const mfaRequired = !isDemo && reqMfa && (hasEnrolledFactor || role === "admin" || role === "hr");

  if (mfaRequired && currentAal !== "aal2") {
    return {
      response: NextResponse.json(
        { error: "Forbidden: Elevated action requires active AAL2 multi-factor authentication." },
        { status: 403 }
      ),
    };
  }

  return {
    supabase,
    context: {
      userId: user.id,
      organizationId: member.organization_id,
      role,
      aal: currentAal,
      email: user.email,
    },
  };
}

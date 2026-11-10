import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { Database, EmployeeRole } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
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

  const orgStatus = (member as any)?.organizations?.status;
  if (memberError || !member || (orgStatus && !["active", "trial"].includes(orgStatus))) {
    return {
      response: NextResponse.json(
        { error: "Forbidden: No active organization membership found." },
        { status: 403 }
      ),
    };
  }

  const role = member.role as EmployeeRole;
  if (!allowedRoles.includes(role)) {
    return {
      response: NextResponse.json(
        { error: `Forbidden: Action requires one of [${allowedRoles.join(", ")}] roles.` },
        { status: 403 }
      ),
    };
  }

  // MFA AAL2 Enforcement for Admin & HR:
  // Read strictly from cryptographically verified JWT claims (`getClaims`) or server MFA assurance level.
  // Never trust mutable `user.app_metadata?.aal`.
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

  if ((role === "admin" || role === "hr") && currentAal !== "aal2") {
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

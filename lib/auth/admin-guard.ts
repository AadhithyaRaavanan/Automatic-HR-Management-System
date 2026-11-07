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
 * with an active membership in the specified roles, enforcing AAL2 MFA for admin/hr.
 */
export async function verifyAdminRouteCaller(
  request: NextRequest,
  allowedRoles: EmployeeRole[] = ["admin"]
): Promise<{ context: AuthenticatedCallerContext } | { response: NextResponse }> {
  let response = NextResponse.next();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
    {
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
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      response: NextResponse.json(
        { error: "Unauthorized: Invalid or missing authentication credentials." },
        { status: 401 }
      ),
    };
  }

  // Authoritative check against organization_members database table
  const { data: member, error: memberError } = await supabaseAdmin
    .from("organization_members")
    .select("organization_id, role, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (memberError || !member) {
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

  // MFA AAL2 Enforcement for Admin & HR: Unconditionally require aal2
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const currentAal = aalData?.currentLevel || (user.app_metadata?.aal as string) || "aal1";

  if ((role === "admin" || role === "hr") && currentAal !== "aal2") {
    return {
      response: NextResponse.json(
        { error: "Forbidden: Elevated action requires active AAL2 multi-factor authentication." },
        { status: 403 }
      ),
    };
  }

  return {
    context: {
      userId: user.id,
      organizationId: member.organization_id,
      role,
      aal: currentAal,
      email: user.email,
    },
  };
}

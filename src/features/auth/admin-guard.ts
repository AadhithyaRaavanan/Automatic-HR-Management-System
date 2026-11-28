import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database, EmployeeRole } from "@/types/database.types";
import { resolveTenantCaller } from "@/features/auth/tenant-context";

export interface AuthenticatedCallerContext {
  userId: string;
  organizationId: string;
  role: EmployeeRole;
  aal: string;
  email?: string;
  departmentId?: string | null;
}

/**
 * Validates that an incoming API request comes from an authenticated user
 * with an active membership in the specified roles, strictly resolving tenant context
 * from `organization_members` + active organization selection and enforcing AAL2 MFA
 * for privileged roles.
 */
export async function verifyAdminRouteCaller(
  request: NextRequest,
  allowedRoles: EmployeeRole[] = ["admin"]
): Promise<
  | { context: AuthenticatedCallerContext; supabase: ReturnType<typeof createServerClient<Database>> }
  | { response: NextResponse }
> {
  const result = await resolveTenantCaller(request, {
    allowedRoles,
    skipOnboardingCheck: true,
    requireAal2ForPrivileged: true,
  });

  if ("response" in result) {
    return result;
  }

  return {
    supabase: result.supabase,
    context: {
      userId: result.context.userId,
      organizationId: result.context.organizationId,
      role: result.context.role,
      aal: result.context.aal,
      email: result.context.email,
      departmentId: result.context.departmentId,
    },
  };
}

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database, EmployeeRole } from "@/types/database.types";
import { resolveTenantCaller } from "@/features/auth/tenant-context";

export interface ApprovedUserContext {
  user: any;
  employee?: any;
  role: EmployeeRole;
  userId: string;
  organizationId: string;
  departmentId: string | null;
  supabase: ReturnType<typeof createServerClient<Database>>;
}

/**
 * Shared API guard enforcing that the caller is authenticated, belongs to a single
 * active or explicitly selected organization, is not deactivated, and has completed
 * approved onboarding (Admin exempt from onboarding gate).
 */
export async function requireApprovedUser(
  request: NextRequest
): Promise<ApprovedUserContext | { response: NextResponse }> {
  const result = await resolveTenantCaller(request, {
    skipOnboardingCheck: false,
    requireAal2ForPrivileged: false,
  });

  if ("response" in result) {
    return result;
  }

  return {
    user: result.user,
    employee: result.context.employee,
    role: result.context.role,
    userId: result.context.userId,
    organizationId: result.context.organizationId,
    departmentId: result.context.departmentId,
    supabase: result.supabase,
  };
}

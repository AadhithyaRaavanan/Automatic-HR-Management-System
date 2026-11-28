// ============================================================================
// KPI Server API Authentication & Scoping Helper
// Unified on resolveTenantCaller + strict organization isolation.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveTenantCaller } from "@/features/auth/tenant-context";

export interface CallerContext {
  userId: string;
  email: string;
  role: "admin" | "hr" | "manager" | "employee";
  departmentId: string | null;
  organizationId: string;
}

export async function getKpiCallerContext(
  request: NextRequest
): Promise<{ caller: CallerContext | null; errorResponse: NextResponse | null }> {
  try {
    const result = await resolveTenantCaller(request, {
      skipOnboardingCheck: false,
      requireAal2ForPrivileged: false,
    });

    if ("response" in result) {
      return { caller: null, errorResponse: result.response };
    }

    const mappedRole =
      result.context.role === "team_lead" ? "manager" : (result.context.role as CallerContext["role"]);

    return {
      caller: {
        userId: result.context.userId,
        email: result.context.email,
        role: mappedRole,
        departmentId: result.context.departmentId,
        organizationId: result.context.organizationId,
      },
      errorResponse: null,
    };
  } catch {
    return {
      caller: null,
      errorResponse: NextResponse.json({ error: "Internal Server Error" }, { status: 500 }),
    };
  }
}

export async function verifyEmployeeAccess(
  caller: CallerContext,
  targetEmployeeId: string
): Promise<boolean> {
  if (!caller.organizationId || !targetEmployeeId) {
    return false;
  }

  if (caller.userId === targetEmployeeId) {
    return true;
  }

  if (caller.role === "employee") {
    return false;
  }

  // Strictly enforce organization isolation for every non-self access (including admin & HR)
  const { data: targetEmp } = await (supabaseAdmin.from("employees") as any)
    .select("id, manager_id, department_id, organization_id")
    .eq("id", targetEmployeeId)
    .maybeSingle();

  if (!targetEmp || targetEmp.organization_id !== caller.organizationId) {
    return false;
  }

  if (caller.role === "admin" || caller.role === "hr") {
    return true;
  }

  if (caller.role === "manager") {
    if (targetEmp.manager_id === caller.userId) return true;
    if (caller.departmentId && targetEmp.department_id === caller.departmentId) return true;
    return false;
  }

  return false;
}

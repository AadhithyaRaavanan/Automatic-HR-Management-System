// ============================================================================
// KPI Server API Authentication & Scoping Helper
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
    let response = NextResponse.next();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next();
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    // 1. Bearer Token Auth first
    const authHeader = request.headers.get("Authorization");
    let user = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const { data: tokenUser } = await supabaseAdmin.auth.getUser(token);
      user = tokenUser?.user || null;
    }

    // 2. Fallback to session cookie
    if (!user) {
      const { data: cookieUser } = await supabase.auth.getUser();
      user = cookieUser?.user || null;
    }

    if (!user) {
      return {
        caller: null,
        errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    // Fetch caller employee & organization member details
    const [empRes, memberRes] = await Promise.all([
      (supabaseAdmin.from("employees") as any)
        .select("id, email, department_id, organization_id")
        .eq("id", user.id)
        .maybeSingle(),
      (supabaseAdmin.from("organization_members") as any)
        .select("role, organization_id, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle(),
    ]);

    const role = (memberRes.data?.role || "employee").toLowerCase() as CallerContext["role"];
    const orgId = memberRes.data?.organization_id || empRes.data?.organization_id || "";

    const caller: CallerContext = {
      userId: user.id,
      email: user.email || "",
      role,
      departmentId: empRes.data?.department_id || null,
      organizationId: orgId,
    };

    return { caller, errorResponse: null };
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
  // Employee can only access themselves
  if (caller.role === "employee") {
    return caller.userId === targetEmployeeId;
  }

  // Admin and HR have org-wide access
  if (caller.role === "admin" || caller.role === "hr") {
    return true;
  }

  // Manager: self, direct reports, or same department
  if (caller.role === "manager") {
    if (caller.userId === targetEmployeeId) return true;

    const { data: targetEmp } = await (supabaseAdmin.from("employees") as any)
      .select("id, manager_id, department_id")
      .eq("id", targetEmployeeId)
      .maybeSingle();

    if (!targetEmp) return false;

    if (targetEmp.manager_id === caller.userId) return true;
    if (caller.departmentId && targetEmp.department_id === caller.departmentId) return true;

    return false;
  }

  return false;
}

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Resolves the direct manager(s) and department head for a given employee.
 * Follows the same scoping logic used across leave and request reviews.
 * If no manager or department head is found, falls back to HR users.
 */
export async function getManagersOf(employeeId: string): Promise<string[]> {
  try {
    if (!employeeId) return [];

    const { data: emp, error: empErr } = await (supabaseAdmin.from("employees") as any)
      .select("id, manager_id, department_id, organization_id")
      .eq("id", employeeId)
      .maybeSingle();

    if (empErr || !emp) {
      return getHrUsers();
    }

    const managerIds = new Set<string>();

    // 1. Direct reports manager
    if (emp.manager_id && emp.manager_id !== employeeId) {
      managerIds.add(emp.manager_id);
    }

    // 2. Department head
    if (emp.department_id) {
      const { data: dept } = await (supabaseAdmin.from("departments") as any)
        .select("department_head_id")
        .eq("id", emp.department_id)
        .maybeSingle();

      if (dept?.department_head_id && dept.department_head_id !== employeeId) {
        managerIds.add(dept.department_head_id);
      }
    }

    // Fall back to HR if no managers assigned
    if (managerIds.size === 0) {
      return getHrUsers(emp.organization_id);
    }

    return Array.from(managerIds);
  } catch (error) {
    console.error("[getManagersOf] Error resolving managers:", error);
    return getHrUsers();
  }
}

/**
 * Returns all active HR users for the organization (or global fallback).
 */
export async function getHrUsers(organizationId?: string | null): Promise<string[]> {
  try {
    const hrIds = new Set<string>();

    // Check organization_members
    let memberQuery = (supabaseAdmin.from("organization_members") as any)
      .select("user_id")
      .eq("role", "hr");
    if (organizationId) {
      memberQuery = memberQuery.eq("organization_id", organizationId);
    }
    const { data: members } = await memberQuery;
    if (members) {
      members.forEach((m: any) => {
        if (m.user_id) hrIds.add(m.user_id);
      });
    }

    // Check employees table
    let empQuery = (supabaseAdmin.from("employees") as any)
      .select("id")
      .eq("status", "active")
      .or("role.eq.hr,user_role.eq.hr");
    if (organizationId) {
      empQuery = empQuery.eq("organization_id", organizationId);
    }
    const { data: emps } = await empQuery;
    if (emps) {
      emps.forEach((e: any) => {
        if (e.id) hrIds.add(e.id);
      });
    }

    return Array.from(hrIds);
  } catch (error) {
    console.error("[getHrUsers] Error resolving HR users:", error);
    return [];
  }
}

/**
 * Returns all active Admin users for the organization (or global fallback).
 */
export async function getAdmins(organizationId?: string | null): Promise<string[]> {
  try {
    const adminIds = new Set<string>();

    let memberQuery = (supabaseAdmin.from("organization_members") as any)
      .select("user_id")
      .eq("role", "admin");
    if (organizationId) {
      memberQuery = memberQuery.eq("organization_id", organizationId);
    }
    const { data: members } = await memberQuery;
    if (members) {
      members.forEach((m: any) => {
        if (m.user_id) adminIds.add(m.user_id);
      });
    }

    let empQuery = (supabaseAdmin.from("employees") as any)
      .select("id")
      .eq("status", "active")
      .or("role.eq.admin,user_role.eq.admin");
    if (organizationId) {
      empQuery = empQuery.eq("organization_id", organizationId);
    }
    const { data: emps } = await empQuery;
    if (emps) {
      emps.forEach((e: any) => {
        if (e.id) adminIds.add(e.id);
      });
    }

    return Array.from(adminIds);
  } catch (error) {
    console.error("[getAdmins] Error resolving Admins:", error);
    return [];
  }
}

/**
 * Returns all active employees in the system (for broadcast announcements / holidays).
 */
export async function getAllActiveEmployees(organizationId?: string | null): Promise<string[]> {
  try {
    let query = (supabaseAdmin.from("employees") as any)
      .select("id")
      .eq("status", "active");
    if (organizationId) {
      query = query.eq("organization_id", organizationId);
    }
    const { data } = await query;
    return (data || []).map((e: any) => e.id).filter(Boolean);
  } catch (error) {
    console.error("[getAllActiveEmployees] Error:", error);
    return [];
  }
}

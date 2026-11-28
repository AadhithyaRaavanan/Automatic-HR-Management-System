import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Resolves the direct manager(s) and department head for a given employee,
 * strictly scoped to the employee's organization. Fails closed (returns [])
 * if the employee or organization cannot be determined.
 */
export async function getManagersOf(
  employeeId: string,
  expectedOrganizationId?: string | null
): Promise<string[]> {
  try {
    if (!employeeId) return [];

    let empQuery = (supabaseAdmin.from("employees") as any)
      .select("id, manager_id, department_id, organization_id")
      .eq("id", employeeId);

    if (expectedOrganizationId) {
      empQuery = empQuery.eq("organization_id", expectedOrganizationId);
    }

    const { data: emp, error: empErr } = await empQuery.maybeSingle();

    if (empErr || !emp || !emp.organization_id) {
      return expectedOrganizationId ? getHrUsers(expectedOrganizationId) : [];
    }

    const managerIds = new Set<string>();

    // 1. Direct manager (must be active in the same organization)
    if (emp.manager_id && emp.manager_id !== employeeId) {
      const { data: mgrEmp } = await (supabaseAdmin.from("employees") as any)
        .select("id")
        .eq("id", emp.manager_id)
        .eq("organization_id", emp.organization_id)
        .eq("status", "active")
        .maybeSingle();
      if (mgrEmp?.id) {
        managerIds.add(mgrEmp.id);
      }
    }

    // 2. Department head within the same organization
    if (emp.department_id) {
      const { data: dept } = await (supabaseAdmin.from("departments") as any)
        .select("department_head_id")
        .eq("id", emp.department_id)
        .eq("organization_id", emp.organization_id)
        .maybeSingle();

      if (dept?.department_head_id && dept.department_head_id !== employeeId) {
        managerIds.add(dept.department_head_id);
      }
    }

    // Fall back to HR strictly within the same organization
    if (managerIds.size === 0) {
      return getHrUsers(emp.organization_id);
    }

    return Array.from(managerIds);
  } catch (error) {
    console.error("[getManagersOf] Error resolving managers:", error);
    return [];
  }
}

/**
 * Returns all active HR users for the given organization.
 * Never returns cross-tenant HR recipients when organizationId is omitted.
 */
export async function getHrUsers(organizationId?: string | null): Promise<string[]> {
  try {
    if (!organizationId) return [];
    const hrIds = new Set<string>();

    const { data: members } = await (supabaseAdmin.from("organization_members") as any)
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("role", "hr")
      .eq("status", "active");

    if (members) {
      for (const m of members) {
        if (m.user_id) hrIds.add(m.user_id);
      }
    }

    return Array.from(hrIds);
  } catch (error) {
    console.error("[getHrUsers] Error resolving HR users:", error);
    return [];
  }
}

/**
 * Returns all active Admin users for the given organization.
 */
export async function getAdmins(organizationId?: string | null): Promise<string[]> {
  try {
    if (!organizationId) return [];
    const adminIds = new Set<string>();

    const { data: members } = await (supabaseAdmin.from("organization_members") as any)
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .eq("status", "active");

    if (members) {
      for (const m of members) {
        if (m.user_id) adminIds.add(m.user_id);
      }
    }

    return Array.from(adminIds);
  } catch (error) {
    console.error("[getAdmins] Error resolving Admins:", error);
    return [];
  }
}

const VALID_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Resolves authorized HR/Admin recipient email addresses strictly inside the
 * given organization. Never falls back to global deployment mailboxes.
 */
export async function getAuthorizedOnboardingEmailRecipients(
  organizationId?: string | null
): Promise<string[]> {
  if (!organizationId) return [];

  try {
    const { data: members } = await (supabaseAdmin.from("organization_members") as any)
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .in("role", ["hr", "admin"])
      .eq("status", "active");

    if (!members || members.length === 0) return [];

    const hrIds = members
      .filter((m: any) => String(m.role || "").toLowerCase() === "hr" && m.user_id)
      .map((m: any) => m.user_id);
    const adminIds = members
      .filter((m: any) => String(m.role || "").toLowerCase() === "admin" && m.user_id)
      .map((m: any) => m.user_id);

    const resolveEmailsForIds = async (ids: string[]): Promise<string[]> => {
      if (ids.length === 0) return [];
      const emailSet = new Set<string>();

      const { data: empRows } = await (supabaseAdmin.from("employees") as any)
        .select("id, email, status")
        .eq("organization_id", organizationId)
        .in("id", ids)
        .eq("status", "active");

      const foundByEmpId = new Map<string, string>();
      for (const emp of empRows || []) {
        const clean = String(emp.email || "").trim();
        if (VALID_EMAIL_RE.test(clean)) {
          foundByEmpId.set(emp.id, clean);
          emailSet.add(clean);
        }
      }

      // Check auth user email only for active org HR/Admins lacking an active employee email row
      for (const uid of ids) {
        if (foundByEmpId.has(uid)) continue;
        try {
          const { data: authData } = await supabaseAdmin.auth.admin.getUserById(uid);
          const authEmail = String(authData?.user?.email || "").trim();
          if (VALID_EMAIL_RE.test(authEmail)) {
            emailSet.add(authEmail);
          }
        } catch {
          // Ignore single user lookup failure
        }
      }

      return Array.from(emailSet);
    };

    const hrEmails = await resolveEmailsForIds(hrIds);
    if (hrEmails.length > 0) return hrEmails;

    return await resolveEmailsForIds(adminIds);
  } catch (error) {
    console.error("[getAuthorizedOnboardingEmailRecipients] Error resolving recipients:", error);
    return [];
  }
}

/**
 * Returns all active employees for the given organization.
 * Fails closed when organizationId is omitted.
 */
export async function getAllActiveEmployees(organizationId?: string | null): Promise<string[]> {
  try {
    if (!organizationId) return [];
    const { data } = await (supabaseAdmin.from("employees") as any)
      .select("id")
      .eq("organization_id", organizationId)
      .eq("status", "active");
    return (data || []).map((e: any) => e.id).filter(Boolean);
  } catch (error) {
    console.error("[getAllActiveEmployees] Error:", error);
    return [];
  }
}

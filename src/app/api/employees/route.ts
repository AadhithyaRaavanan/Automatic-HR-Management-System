import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { getStoredUsers, getStoredDepartments, getStoredJobTitles } from "@/lib/storage/demo-store";
import { requireApprovedUser } from "@/features/auth/require-approved-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const BASE_EMPLOYEE_SELECT = `
  id,
  organization_id,
  email,
  full_name,
  avatar_url,
  phone,
  emergency_contact,
  work_mode,
  timezone,
  status,
  joined_on,
  primary_location_id,
  manager_id,
  department_id,
  job_title_id,
  departments:department_id(id, name, code, parent_department_id),
  job_titles:job_title_id(id, title_name)
`;

const STARTER_EMPLOYEE_SELECT = `
  id,
  email,
  full_name,
  avatar_url,
  timezone,
  work_target_minutes,
  status,
  joined_on,
  manager_id
`;

const EXTENDED_EMPLOYEE_SELECT = `
  id,
  organization_id,
  email,
  full_name,
  avatar_url,
  phone,
  emergency_contact,
  work_mode,
  timezone,
  status,
  joined_on,
  employment_category,
  employee_number,
  primary_location_id,
  manager_id,
  department_id,
  job_title_id,
  departments:department_id(id, name, code, parent_department_id),
  job_titles:job_title_id(id, title_name)
`;

async function safeQuery<T = any>(promiseLike: PromiseLike<T>): Promise<T | null> {
  try {
    return await promiseLike;
  } catch {
    return null;
  }
}

function buildEmployeeQuery(
  client: any,
  selectColumns: string,
  filters: {
    orgId: string | null;
    managerDeptId: string | null;
    departmentId: string | null;
    status: string | null;
  }
) {
  let query = client
    .from("employees")
    .select(selectColumns)
    .order("joined_on", { ascending: false });

  if (filters.orgId) {
    query = query.eq("organization_id", filters.orgId);
  }
  if (filters.managerDeptId) {
    query = query.eq("department_id", filters.managerDeptId);
  } else if (filters.departmentId) {
    query = query.eq("department_id", filters.departmentId);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  return query;
}

export async function GET(request: NextRequest) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }

  const { user, supabase: callerSupabase, role: approvedRole } = approvedCheck;
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim().toLowerCase() || "";
  const departmentId = searchParams.get("departmentId");
  const role = searchParams.get("role")?.trim().toLowerCase() || "";
  const category = searchParams.get("category")?.trim().toLowerCase() || "";
  const status = searchParams.get("status")?.trim().toLowerCase() || "";

  try {
    const isDemo = isDemoModeEnabled();
    const adminConfigured = isSupabaseAdminConfigured();
    const dbClient: any = adminConfigured ? supabaseAdmin : callerSupabase;

    // Resolve authoritative membership, role, and organization_id from tenant-scoped guard
    const userRole: string = String(approvedRole || "employee").toLowerCase();
    const orgId: string | null = approvedCheck.organizationId || null;

    if (userRole === "employee") {
      return NextResponse.json(
        { error: "Forbidden: Employee access denied." },
        { status: 403 }
      );
    }

    if (!orgId) {
      return NextResponse.json(
        { error: "Forbidden: Active organization context is required." },
        { status: 403 }
      );
    }

    let managerDeptId: string | null = null;
    if (userRole === "manager" && user?.id) {
      const empRecordRes: any = await safeQuery(
        dbClient
          .from("employees")
          .select("department_id")
          .eq("id", user.id)
          .eq("organization_id", orgId)
          .maybeSingle()
      );
      managerDeptId = empRecordRes?.data?.department_id || null;
    }

    // Query employees using LEFT JOINs (departments & job_titles nullable) with safe schema fallback
    const filters = { orgId, managerDeptId, departmentId, status: status || null };

    const executeEmployeeFetch = async (client: any) => {
      try {
        let res = await buildEmployeeQuery(client, EXTENDED_EMPLOYEE_SELECT, filters);
        if (
          res?.error &&
          /column .* does not exist|could not find|relationship|schema cache/i.test(res.error.message || "")
        ) {
          res = await buildEmployeeQuery(client, BASE_EMPLOYEE_SELECT, filters);
        }
        if (
          res?.error &&
          /column .* does not exist|could not find|relationship|schema cache/i.test(res.error.message || "")
        ) {
          let starterQuery = client
            .from("employees")
            .select(STARTER_EMPLOYEE_SELECT)
            .eq("organization_id", filters.orgId)
            .order("joined_on", { ascending: false });
          if (filters.managerDeptId) {
            starterQuery = starterQuery.eq("department_id", filters.managerDeptId);
          } else if (filters.departmentId) {
            starterQuery = starterQuery.eq("department_id", filters.departmentId);
          }
          if (filters.status) {
            starterQuery = starterQuery.eq("status", filters.status);
          }
          res = await starterQuery;
        }
        return res;
      } catch (err: any) {
        return { data: null, error: err };
      }
    };

    let empQueryRes: any = await executeEmployeeFetch(dbClient);

    // If admin query failed (e.g. invalid service key), fall back cleanly to caller's authenticated SSR client
    if (empQueryRes?.error && dbClient !== callerSupabase) {
      const fallbackRes: any = await executeEmployeeFetch(callerSupabase);
      if (!fallbackRes?.error) {
        empQueryRes = fallbackRes;
      }
    }

    if (empQueryRes?.error && !isDemo) {
      const msg = String(empQueryRes.error.message || "Failed to fetch employees");
      const isAuthz =
        empQueryRes.error.code === "42501" ||
        /permission denied|row-level security|forbidden/i.test(msg);
      return NextResponse.json(
        { error: msg },
        { status: isAuthz ? 403 : 500 }
      );
    }

    let emps: any[] = empQueryRes?.data || [];

    // Fetch authoritative active org memberships, onboarding categories, and legacy roles
    const queryClientForMeta = empQueryRes?.error ? callerSupabase : dbClient;

    const orgMembersRes = await safeQuery(
      queryClientForMeta
        .from("organization_members")
        .select(
          "user_id, role, status, department_id, job_title_id, shift_start_time, shift_end_time, departments:department_id(id, name, code, parent_department_id), job_titles:job_title_id(id, title_name)"
        )
        .eq("organization_id", orgId)
    );

    const orgMembers: any[] = orgMembersRes?.data || [];
    const roleMap = new Map<string, string>();
    for (const m of orgMembers) {
      if (m.user_id && m.role) {
        roleMap.set(m.user_id, String(m.role).toLowerCase());
      }
    }

    const orgUserIdsForOnb = Array.from(
      new Set<string>([
        ...emps.map((e: any) => e.id).filter(Boolean),
        ...orgMembers.map((m: any) => m.user_id).filter(Boolean),
      ])
    );
    const onbProfilesRes = orgUserIdsForOnb.length > 0
      ? await safeQuery(
          queryClientForMeta
            .from("onboarding_profiles")
            .select("user_id, full_name, personal_email, candidate_type, education_details, phone")
            .in("user_id", orgUserIdsForOnb)
        )
      : { data: [] };

    const authUserMetaMap = new Map<string, any>();

    const onboardingMap = new Map<string, any>();
    for (const p of onbProfilesRes?.data || []) {
      if (p?.user_id) onboardingMap.set(p.user_id, p);
    }

    // Sync any active organization_members (such as the tenant admin) missing from employees table
    if (orgId && adminConfigured && orgMembers.length > 0) {
      const existingEmpIds = new Set(emps.map((e: any) => e.id));
      const missingActiveMembers = orgMembers.filter(
        (m: any) =>
          m?.user_id &&
          (m.status === "active" || !m.status) &&
          !existingEmpIds.has(m.user_id) &&
          !managerDeptId &&
          (!departmentId || m.department_id === departmentId) &&
          (!status || status === "active")
      );

      if (missingActiveMembers.length > 0) {
        const syncedRows: any[] = [];
        for (const m of missingActiveMembers) {
          try {
            let authUser: any = m.user_id === user?.id ? user : null;
            if (!authUser) {
              const { data: uRes } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
              authUser = uRes?.user || null;
            }
            if (!authUser?.email) continue;

            const onb = onboardingMap.get(m.user_id);
            const resolvedName =
              onb?.full_name ||
              authUser.user_metadata?.full_name ||
              authUser.user_metadata?.name ||
              authUser.email.split("@")[0];

            const upsertPayload = {
              id: m.user_id,
              organization_id: orgId,
              email: authUser.email,
              full_name: resolvedName,
              status: "active",
              work_mode: "remote",
              timezone: authUser.user_metadata?.timezone || "Asia/Kolkata",
              department_id: m.department_id || null,
              job_title_id: m.job_title_id || null,
              shift_start_time: m.shift_start_time || "09:00:00",
              shift_end_time: m.shift_end_time || "17:00:00",
              onboarding_completed: true,
            };

            const { error: syncErr } = await (supabaseAdmin.from("employees") as any)
              .upsert(upsertPayload, { onConflict: "id", ignoreDuplicates: true });

            if (!syncErr) {
              syncedRows.push({
                ...upsertPayload,
                phone: onb?.phone || null,
                joined_on: new Date().toISOString().slice(0, 10),
                departments: m.departments || null,
                job_titles: m.job_titles || null,
              });
            }
          } catch {}
        }
        if (syncedRows.length > 0) {
          emps = [...syncedRows, ...emps];
        }
      }
    }

    let employeeList = emps.map((e: any) => {
      const onb = onboardingMap.get(e.id);
      const authMeta = authUserMetaMap.get(e.id)?.user_metadata || {};
      const authAppMeta = authUserMetaMap.get(e.id)?.app_metadata || {};
      const eduDetails = onb?.education_details || {};
      const resolvedCategory =
        e.employment_category ||
        eduDetails?.employment_category ||
        authMeta?.employment_category ||
        (onb?.candidate_type === "INTERN" ? "intern" : "full_time");

      return {
        ...e,
        phone: e.phone || onb?.phone || null,
        employment_category: resolvedCategory,
        role:
          roleMap.get(e.id) ||
          (authAppMeta?.user_role || "employee").toLowerCase(),
      };
    });

    // Fallback to demo store only when database returned zero rows in demo mode
    if (employeeList.length === 0 && isDemo) {
      const storedUsers = getStoredUsers();
      const storedDepts = getStoredDepartments();
      const storedTitles = getStoredJobTitles();

      employeeList = storedUsers.map((u, idx) => {
        const d = storedDepts.find((dept) => dept.id === u.departmentId || dept.name === u.department);
        const t = storedTitles.find((title) => title.id === u.jobTitleId || title.title_name === u.jobTitle);
        return {
          id: u.id,
          email: u.email,
          full_name: u.name,
          avatar_url: null,
          phone: "+91 98765 43210",
          emergency_contact: "+91 98765 00000",
          work_mode: u.workMode || "remote",
          timezone: u.timezone || "Asia/Kolkata",
          status: u.status || "active",
          joined_on: "2026-01-15",
          employment_category: u.employmentCategory || (idx === 3 ? "intern" : "full_time"),
          employee_number: u.employeeNumber || (idx === 3 ? `ZX-INT-00${idx + 1}` : `ZX-EMP-00${idx + 1}`),
          manager_id: null,
          department_id: d?.id || null,
          job_title_id: t?.id || null,
          departments: d ? { id: d.id, name: d.name, code: d.code } : null,
          job_titles: t ? { id: t.id, title_name: t.title_name } : null,
          role: u.role || "employee",
        };
      });

      if (managerDeptId) {
        employeeList = employeeList.filter((e: any) => e.department_id === managerDeptId);
      } else if (departmentId) {
        employeeList = employeeList.filter((e: any) => e.department_id === departmentId);
      }
      if (status) {
        employeeList = employeeList.filter((e: any) => (e.status || "").toLowerCase() === status);
      }
    }

    // Apply search, role, and category filters safely in memory
    if (search) {
      employeeList = employeeList.filter(
        (e: any) =>
          e.full_name?.toLowerCase().includes(search) ||
          e.email?.toLowerCase().includes(search) ||
          e.employee_number?.toLowerCase().includes(search) ||
          e.departments?.name?.toLowerCase().includes(search) ||
          e.job_titles?.title_name?.toLowerCase().includes(search)
      );
    }

    if (role) {
      employeeList = employeeList.filter((e: any) => (e.role || "").toLowerCase() === role);
    }

    if (category) {
      employeeList = employeeList.filter(
        (e: any) => (e.employment_category || "full_time").toLowerCase() === category
      );
    }

    return NextResponse.json(
      { employees: employeeList },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0",
          "CDN-Cache-Control": "no-store",
          "Vercel-CDN-Cache-Control": "no-store",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch employees" },
      { status: 500 }
    );
  }
}

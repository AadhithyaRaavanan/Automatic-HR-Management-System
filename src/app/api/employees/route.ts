import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { getStoredUsers, getStoredDepartments, getStoredJobTitles } from "@/lib/storage/demo-store";
import { requireApprovedUser } from "@/features/auth/require-approved-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.toLowerCase();
  const departmentId = searchParams.get("departmentId");
  const role = searchParams.get("role");
  const category = searchParams.get("category");
  const status = searchParams.get("status");

  try {
    const isDemo = isDemoModeEnabled();

    // Authenticate caller
    let user = null;
    let userRole = "employee";
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "").trim();
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      user = userData?.user || null;
    }
    if (!user) {
      const supabase = await createClient();
      const { data: cookieUser } = await supabase.auth.getUser();
      user = cookieUser?.user || null;
    }

    if (user) {
      const { data: member } = await supabaseAdmin
        .from("organization_members")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      userRole = (member?.role || user.user_metadata?.role || user.user_metadata?.user_role || "employee").toLowerCase();
    }

    if (userRole === "employee") {
      return NextResponse.json({ error: "Forbidden: Employee access denied." }, { status: 403 });
    }

    let managerDeptId: string | null = null;
    if (userRole === "manager" && user) {
      const { data: empRecord } = await (supabaseAdmin as any)
        .from("employees")
        .select("department_id")
        .eq("id", user.id)
        .maybeSingle();
      managerDeptId = empRecord?.department_id || null;
    }

    // Query real Supabase database
    let query = (supabaseAdmin as any)
      .from("employees")
      .select(`
        id,
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
      `)
      .order("joined_on", { ascending: false });

    if (managerDeptId) {
      query = query.eq("department_id", managerDeptId);
    } else if (departmentId) {
      query = query.eq("department_id", departmentId);
    }
    if (category) {
      query = query.eq("employment_category", category);
    }
    if (status) {
      query = query.eq("status", status);
    }

    const { data: emps, error } = await query;

    // Fetch authoritative roles from organization_members and user_roles
    const [orgMembersRes, userRolesRes] = await Promise.all([
      (supabaseAdmin as any).from("organization_members").select("user_id, role"),
      (supabaseAdmin as any).from("user_roles").select("user_id, role"),
    ]);

    const roleMap = new Map<string, string>();
    for (const m of orgMembersRes.data || []) {
      if (m.user_id && m.role) {
        roleMap.set(m.user_id, String(m.role).toLowerCase());
      }
    }
    for (const ur of userRolesRes.data || []) {
      if (ur.user_id && ur.role && !roleMap.has(ur.user_id)) {
        roleMap.set(ur.user_id, String(ur.role).toLowerCase());
      }
    }

    let employeeList = (emps || []).map((e: any) => ({
      ...e,
      role: roleMap.get(e.id) || "employee",
    }));

    // Fallback or merge with demo store if empty or demo mode
    if ((!employeeList || employeeList.length === 0) && isDemo) {
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
      }
    }

    // Client search filter
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
      employeeList = employeeList.filter((e: any) => e.role === role);
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
    return NextResponse.json({ error: err.message || "Failed to fetch employees" }, { status: 500 });
  }
}

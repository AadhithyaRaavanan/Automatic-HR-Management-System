import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { getStoredUsers, getStoredDepartments, getStoredJobTitles } from "@/lib/storage/demo-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.toLowerCase();
  const departmentId = searchParams.get("departmentId");
  const role = searchParams.get("role");
  const category = searchParams.get("category");
  const status = searchParams.get("status");

  try {
    const isDemo = isDemoModeEnabled();

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
        employment_category,
        employee_number,
        manager_id,
        department_id,
        job_title_id,
        departments:department_id(id, name, code, parent_department_id),
        job_titles:job_title_id(id, title_name)
      `)
      .order("joined_on", { ascending: false });

    if (departmentId) {
      query = query.eq("department_id", departmentId);
    }
    if (category) {
      query = query.eq("employment_category", category);
    }
    if (status) {
      query = query.eq("status", status);
    }

    const { data: emps, error } = await query;

    let employeeList = emps || [];

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

    return NextResponse.json({ employees: employeeList });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch employees" }, { status: 500 });
  }
}

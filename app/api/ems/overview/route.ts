import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { getStoredUsers, getStoredDepartments, getStoredTeams } from "@/lib/storage/demo-store";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const approvedCheck = await requireApprovedUser(request);
    if ("response" in approvedCheck) {
      return approvedCheck.response;
    }

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

    // Role gate: employee denied
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

    // 1. Fetch counts from real database
    const [empsRes, deptsRes, teamsRes, onbRes, internsRes, titlesRes] = await Promise.all([
      (supabaseAdmin as any)
        .from("employees")
        .select("id, status, department_id, manager_id, work_mode, job_title_id"),
      (supabaseAdmin as any)
        .from("departments")
        .select("id, name, department_head_id, parent_department_id"),
      (supabaseAdmin as any)
        .from("teams")
        .select("id, name, team_lead_id, department_id"),
      (supabaseAdmin as any)
        .from("onboarding_profiles")
        .select("id, status")
        .eq("status", "submitted"),
      (supabaseAdmin as any)
        .from("internships")
        .select("id, status, end_date"),
      (supabaseAdmin as any)
        .from("job_titles")
        .select("id, title_name"),
    ]);

    let emps = empsRes.data || [];
    let depts = deptsRes.data || [];
    let teams = teamsRes.data || [];
    let onbPending = onbRes.data || [];
    let internships = internsRes.data || [];
    const jobTitles = titlesRes.data || [];

    // Fallback to demo store if database empty or demo mode
    if (emps.length === 0 && isDemo) {
      const storedUsers = getStoredUsers();
      const storedDepts = getStoredDepartments();
      const storedTeams = getStoredTeams();

      emps = storedUsers.map((u, idx) => ({
        id: u.id,
        status: u.status || "active",
        employment_category: u.employmentCategory || (idx === 3 ? "intern" : "full_time"),
        department_id: u.departmentId,
        manager_id: null,
      }));

      depts = storedDepts.map((d: any) => ({
        id: d.id,
        name: d.name,
        department_head_id: d.headId || d.department_head_id || null,
        parent_department_id: d.parentId || d.parent_department_id || null,
      }));

      teams = storedTeams.map((t: any) => ({
        id: t.id,
        name: t.name,
        team_lead_id: t.leadId || t.teamLeadId || null,
        department_id: t.departmentId || t.deptId || null,
      }));
    }

    // Scoping for manager
    if (userRole === "manager" && managerDeptId) {
      emps = emps.filter((e: any) => e.department_id === managerDeptId);
      depts = depts.filter((d: any) => d.id === managerDeptId);
      teams = teams.filter((t: any) => t.department_id === managerDeptId);
    }

    const totalEmployees = emps.length;
    const activeEmployees = emps.filter((e: any) => e.status === "active").length;

    const internTitleIds = new Set(
      (jobTitles || [])
        .filter((t: any) => /intern/i.test(t.title_name))
        .map((t: any) => t.id)
    );

    const activeInterns = emps.filter(
      (e: any) => e.employment_category === "intern" || internTitleIds.has(e.job_title_id)
    ).length;
    const partTimeEmployees = emps.filter((e: any) => e.employment_category === "part_time").length;
    const contractEmployees = emps.filter((e: any) => e.employment_category === "contract").length;
    const fullTimeEmployees = Math.max(
      0,
      totalEmployees - (activeInterns + partTimeEmployees + contractEmployees)
    );

    const vacantLeadership =
      depts.filter((d: any) => !d.department_head_id).length +
      teams.filter((t: any) => !t.team_lead_id).length;

    // Department Distribution
    const deptDistribution = depts.map((d: any) => {
      const count = emps.filter((e: any) => e.department_id === d.id).length;
      return {
        id: d.id,
        name: d.name,
        count,
        hasHead: Boolean(d.department_head_id),
      };
    });

    return NextResponse.json({
      stats: {
        totalEmployees,
        activeEmployees,
        fullTimeEmployees,
        partTimeEmployees,
        contractEmployees,
        activeInterns,
        totalDepartments: depts.length,
        totalTeams: teams.length,
        pendingOnboarding: onbPending.length,
        vacantLeadership,
      },
      deptDistribution,
      categoryDistribution: [
        { name: "Full-Time", count: fullTimeEmployees, color: "#10b981" },
        { name: "Intern", count: activeInterns, color: "#f59e0b" },
        { name: "Contract", count: contractEmployees, color: "#8b5cf6" },
        { name: "Part-Time", count: partTimeEmployees, color: "#3b82f6" },
      ],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch EMS stats" }, { status: 500 });
  }
}

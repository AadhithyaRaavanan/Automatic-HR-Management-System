import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { getStoredUsers, getStoredDepartments, getStoredTeams } from "@/lib/storage/demo-store";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminRouteCaller(request, ["admin", "hr", "manager"]);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { organizationId: orgId, role: userRole, userId } = authResult.context;
    const isDemo = isDemoModeEnabled();

    let managerDeptId: string | null = null;
    if (userRole === "manager") {
      const { data: empRecord } = await (supabaseAdmin as any)
        .from("employees")
        .select("department_id")
        .eq("id", userId)
        .eq("organization_id", orgId)
        .maybeSingle();
      managerDeptId = empRecord?.department_id || null;
    }

    // 1. Fetch counts strictly scoped to caller's organization
    const [empsRes, deptsRes, teamsRes, internsRes, titlesRes] = await Promise.all([
      (supabaseAdmin as any)
        .from("employees")
        .select("id, status, department_id, manager_id, work_mode, job_title_id")
        .eq("organization_id", orgId),
      (supabaseAdmin as any)
        .from("departments")
        .select("id, name, department_head_id, parent_department_id")
        .eq("organization_id", orgId),
      (supabaseAdmin as any)
        .from("teams")
        .select("id, name, team_lead_id, department_id")
        .eq("organization_id", orgId),
      (supabaseAdmin as any)
        .from("internships")
        .select("id, status, end_date")
        .eq("organization_id", orgId),
      (supabaseAdmin as any)
        .from("job_titles")
        .select("id, title_name")
        .eq("organization_id", orgId),
    ]);

    const orgEmpIds = (empsRes.data || []).map((e: any) => e.id).filter(Boolean);
    const onbRes = orgEmpIds.length > 0
      ? await (supabaseAdmin as any)
          .from("onboarding_profiles")
          .select("id, status")
          .in("user_id", orgEmpIds)
          .eq("status", "submitted")
      : { data: [] };

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

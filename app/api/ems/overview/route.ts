import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { getStoredUsers, getStoredDepartments, getStoredTeams } from "@/lib/storage/demo-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const isDemo = isDemoModeEnabled();

    // 1. Fetch counts from real database
    const [empsRes, deptsRes, teamsRes, onbRes, internsRes] = await Promise.all([
      (supabaseAdmin as any)
        .from("employees")
        .select("id, status, employment_category, department_id, manager_id"),
      (supabaseAdmin as any)
        .from("departments")
        .select("id, name, department_head_id, parent_department_id"),
      (supabaseAdmin as any)
        .from("teams")
        .select("id, name, team_lead_id, department_id"),
      (supabaseAdmin as any)
        .from("onboarding_profiles")
        .select("id, onboarding_status")
        .in("onboarding_status", ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED"]),
      (supabaseAdmin as any)
        .from("internships")
        .select("id, status, end_date"),
    ]);

    let emps = empsRes.data || [];
    let depts = deptsRes.data || [];
    let teams = teamsRes.data || [];
    let onbPending = onbRes.data || [];
    let internships = internsRes.data || [];

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

    const totalEmployees = emps.length;
    const activeEmployees = emps.filter((e: any) => e.status === "active").length;
    const fullTimeEmployees = emps.filter((e: any) => e.employment_category === "full_time").length;
    const partTimeEmployees = emps.filter((e: any) => e.employment_category === "part_time").length;
    const contractEmployees = emps.filter((e: any) => e.employment_category === "contract").length;
    const activeInterns = emps.filter((e: any) => e.employment_category === "intern").length;

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

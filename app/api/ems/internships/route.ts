import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";

export const dynamic = "force-dynamic";

function calculateEndDate(startDateStr: string | null | undefined, months = 3): string {
  try {
    const d = startDateStr ? new Date(startDateStr) : new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  } catch {
    return "Ongoing";
  }
}

export async function GET(request: NextRequest) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }
  try {
    // 1. Try querying dedicated internships table if it exists
    let tableInternships: any[] = [];
    try {
      const { data, error } = await (supabaseAdmin as any)
        .from("internships")
        .select(`
          *,
          employee:employee_id(id, full_name, email, employee_number, work_mode, departments:department_id(name)),
          mentor:mentor_id(id, full_name, email)
        `)
        .order("start_date", { ascending: false });

      if (!error && Array.isArray(data)) {
        tableInternships = data;
      }
    } catch {}

    const recordedEmployeeIds = new Set(tableInternships.map((i: any) => i.employee_id));

    // 2. Query job titles matching "intern"
    const { data: internTitles } = await (supabaseAdmin as any)
      .from("job_titles")
      .select("id, title_name")
      .ilike("title_name", "%intern%");

    const internTitleIds = (internTitles || []).map((t: any) => t.id);

    // 3. Query all employees provisioned with an intern job title
    let internEmployees: any[] = [];
    if (internTitleIds.length > 0) {
      const { data: emps, error: empErr } = await (supabaseAdmin as any)
        .from("employees")
        .select(`
          id,
          full_name,
          email,
          work_mode,
          status,
          joined_on,
          created_at,
          job_title_id,
          department_id,
          manager_id,
          departments:department_id(id, name),
          job_titles:job_title_id(id, title_name),
          manager:manager_id(id, full_name, email)
        `)
        .in("job_title_id", internTitleIds);

      if (!empErr && Array.isArray(emps)) {
        internEmployees = emps;
      }
    }

    // 4. Transform employees into internship objects for those not in table
    const mappedInterns = internEmployees
      .filter((emp: any) => !recordedEmployeeIds.has(emp.id))
      .map((emp: any) => {
        const startDate =
          emp.joined_on || emp.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
        return {
          id: `intern-${emp.id}`,
          organization_id: "00000000-0000-0000-0000-000000000001",
          employee_id: emp.id,
          employee: {
            id: emp.id,
            full_name: emp.full_name,
            email: emp.email,
            employee_number: `ZX-INT-${emp.id.slice(0, 4).toUpperCase()}`,
            work_mode: emp.work_mode || "remote",
            departments: emp.departments,
            job_title: emp.job_titles?.title_name || "Intern",
          },
          mentor: emp.manager
            ? {
                id: emp.manager.id,
                full_name: emp.manager.full_name,
                email: emp.manager.email,
              }
            : null,
          start_date: startDate,
          end_date: calculateEndDate(startDate, 3),
          duration_months: 3,
          status: emp.status === "active" ? "Active" : emp.status || "Active",
          certificate_issued: false,
          training_plan: `Standard ${emp.job_titles?.title_name || "Internship"} Training Curriculum`,
          assigned_skills: ["Core Competencies", "Workplace Communication"],
          job_title: emp.job_titles?.title_name || "Intern",
        };
      });

    const allInternships = [...tableInternships, ...mappedInterns];

    return NextResponse.json({ internships: allInternships });
  } catch (err: any) {
    console.error("[api/ems/internships] Failed to fetch internships:", err);
    return NextResponse.json({ internships: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employeeId, mentorId, startDate, endDate, durationMonths, trainingPlan, assignedSkills } =
      body;

    if (!employeeId || !startDate || !endDate) {
      return NextResponse.json({ error: "Missing required internship dates" }, { status: 400 });
    }

    try {
      const { data, error } = await (supabaseAdmin as any)
        .from("internships")
        .upsert(
          {
            organization_id: "00000000-0000-0000-0000-000000000001",
            employee_id: employeeId,
            mentor_id: mentorId || null,
            start_date: startDate,
            end_date: endDate,
            duration_months: Number(durationMonths) || 3,
            training_plan: trainingPlan || null,
            assigned_skills: assignedSkills || [],
            status: "Active",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "employee_id" }
        )
        .select()
        .single();

      if (!error && data) {
        return NextResponse.json({ success: true, internship: data });
      }
    } catch {}

    // Fallback if internships table not yet migrated: update manager_id on employee record
    if (mentorId) {
      await (supabaseAdmin as any)
        .from("employees")
        .update({ manager_id: mentorId })
        .eq("id", employeeId);
    }

    return NextResponse.json({
      success: true,
      internship: {
        id: `intern-${employeeId}`,
        employee_id: employeeId,
        mentor_id: mentorId || null,
        start_date: startDate,
        end_date: endDate,
        duration_months: Number(durationMonths) || 3,
        status: "Active",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update internship" }, { status: 500 });
  }
}

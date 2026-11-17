import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const employeeId = params.id;
  if (!employeeId) {
    return NextResponse.json({ error: "Missing employee ID" }, { status: 400 });
  }

  try {
    // 1. Employee Core Details
    const { data: emp, error: empErr } = await (supabaseAdmin as any)
      .from("employees")
      .select(`
        *,
        departments:department_id(id, name, code, parent_department_id),
        job_titles:job_title_id(id, title_name),
        manager:manager_id(id, full_name, email)
      `)
      .eq("id", employeeId)
      .maybeSingle();

    // 2. Onboarding profile & documents
    const { data: onb } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", employeeId)
      .maybeSingle();

    const { data: docs } = await (supabaseAdmin as any)
      .from("onboarding_documents")
      .select("*")
      .eq("user_id", employeeId);

    // 3. Internship details if any
    const { data: internship } = await (supabaseAdmin as any)
      .from("internships")
      .select("*, mentor:mentor_id(id, full_name, email)")
      .eq("employee_id", employeeId)
      .maybeSingle();

    // 4. Career History
    const { data: careerHistory } = await (supabaseAdmin as any)
      .from("employee_career_history")
      .select(`
        *,
        previous_department:previous_department_id(name),
        new_department:new_department_id(name),
        previous_job_title:previous_job_title_id(title_name),
        new_job_title:new_job_title_id(title_name)
      `)
      .eq("employee_id", employeeId)
      .order("effective_date", { ascending: false });

    // 5. Attendance Summary
    const { data: recentAttendance } = await (supabaseAdmin as any)
      .from("attendance_days")
      .select("*")
      .eq("employee_id", employeeId)
      .order("work_date", { ascending: false })
      .limit(30);

    // 6. Permissions
    const { data: permissions } = await (supabaseAdmin as any)
      .from("permission_requests")
      .select("*")
      .eq("employee_id", employeeId)
      .order("permission_date", { ascending: false });

    // 7. Tasks
    const { data: tasks } = await (supabaseAdmin as any)
      .from("tasks")
      .select("*")
      .eq("assignee_id", employeeId)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      employee: emp,
      onboarding: onb,
      documents: docs || [],
      internship: internship || null,
      careerHistory: careerHistory || [],
      recentAttendance: recentAttendance || [],
      permissions: permissions || [],
      tasks: tasks || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch 360 profile" }, { status: 500 });
  }
}

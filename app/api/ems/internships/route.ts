import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }
  try {
    const { data: internships, error } = await (supabaseAdmin as any)
      .from("internships")
      .select(`
        *,
        employee:employee_id(id, full_name, email, employee_number, work_mode, departments:department_id(name)),
        mentor:mentor_id(id, full_name, email)
      `)
      .order("start_date", { ascending: false });

    return NextResponse.json({ internships: internships || [] });
  } catch (err: any) {
    return NextResponse.json({ internships: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employeeId, mentorId, startDate, endDate, durationMonths, trainingPlan, assignedSkills } = body;

    if (!employeeId || !startDate || !endDate) {
      return NextResponse.json({ error: "Missing required internship dates" }, { status: 400 });
    }

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

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, internship: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update internship" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";
import { getSignedUrl } from "@/lib/onboarding-storage";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }
  const employeeId = params.id;
  if (!employeeId) {
    return NextResponse.json({ error: "Missing employee ID" }, { status: 400 });
  }

  try {
    // 1. Employee Core Details
    let emp: any = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId);
    if (isUuid) {
      const { data } = await (supabaseAdmin as any)
        .from("employees")
        .select(`
          *,
          departments:department_id(id, name, code, parent_department_id),
          job_titles:job_title_id(id, title_name),
          manager:manager_id(id, full_name, email)
        `)
        .eq("id", employeeId)
        .maybeSingle();
      emp = data;
    } else {
      const { data } = await (supabaseAdmin as any)
        .from("employees")
        .select(`
          *,
          departments:department_id(id, name, code, parent_department_id),
          job_titles:job_title_id(id, title_name),
          manager:manager_id(id, full_name, email)
        `)
        .ilike("id", `${employeeId}%`)
        .maybeSingle();
      emp = data;
    }

    const targetUserId = emp?.id || employeeId;

    // 2. Onboarding profile & documents
    let { data: onb } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!onb && emp?.email) {
      const { data: onbByEmail } = await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .select("*")
        .eq("personal_email", emp.email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      onb = onbByEmail;
    }

    const actualUserId = onb?.user_id || targetUserId;

    const { data: rawDocs } = await (supabaseAdmin as any)
      .from("onboarding_documents")
      .select("*")
      .eq("user_id", actualUserId)
      .order("uploaded_at", { ascending: true });

    // Filter qualification docs to match candidate's chosen highest qualification
    const highestQual = onb?.highest_qualification || onb?.education_details?.highest_qualification || "12th Standard";
    const qualDocMap: Record<string, string> = {
      "10th Standard": "cert_10th",
      "12th Standard": "cert_12th",
      "Diploma": "cert_diploma",
      "Undergraduate Degree": "cert_undergraduate",
      "Postgraduate Degree": "cert_postgraduate",
      "Doctorate / PhD": "cert_doctorate",
      "Other Certification": "cert_other",
    };
    const expectedQualDoc = qualDocMap[highestQual] || "cert_12th";
    const allQualDocTypes = new Set([
      "cert_10th", "cert_12th", "cert_diploma", "cert_undergraduate", "cert_postgraduate", "cert_doctorate", "cert_other"
    ]);

    const filteredDocs = (rawDocs || []).filter((d: any) => {
      if (allQualDocTypes.has(d.doc_type)) {
        return d.doc_type === expectedQualDoc;
      }
      return true;
    });

    const docs = await Promise.all(
      filteredDocs.map(async (d: any) => {
        let signedUrl = "";
        try {
          signedUrl = await getSignedUrl(d.storage_path, 3600);
        } catch {}
        return {
          ...d,
          signedUrl,
        };
      })
    );

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

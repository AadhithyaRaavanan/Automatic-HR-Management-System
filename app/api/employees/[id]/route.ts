import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
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
  const rawId = params?.id || "";
  const cleanId = decodeURIComponent(rawId).trim().replace(/\s+/g, "-");
  if (!cleanId) {
    return NextResponse.json({ error: "Missing employee ID" }, { status: 400 });
  }

  try {
    // 1. Employee Core Details
    let emp: any = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
    if (isUuid) {
      const { data } = await (supabaseAdmin as any)
        .from("employees")
        .select(`
          *,
          departments:department_id(id, name, code, parent_department_id),
          job_titles:job_title_id(id, title_name),
          manager:manager_id(id, full_name, email)
        `)
        .eq("id", cleanId)
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
        .ilike("id", `${cleanId}%`)
        .maybeSingle();
      emp = data;
    }

    const targetUserId = emp?.id || cleanId;

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

    if (onb) {
      const edu = onb.education_details || {};
      if (!onb.pan_number && (edu.pan_number || edu.pan)) {
        onb.pan_number = edu.pan_number || edu.pan;
      }
      if (!onb.bank_account_number && (edu.bank_account_number || edu.accountNumber || edu.account_number)) {
        onb.bank_account_number = edu.bank_account_number || edu.accountNumber || edu.account_number;
      }
      if (!onb.bank_name && (edu.bank_name || edu.bankName)) {
        onb.bank_name = edu.bank_name || edu.bankName;
      }
      if (!onb.bank_ifsc && (edu.bank_ifsc || edu.ifsc)) {
        onb.bank_ifsc = edu.bank_ifsc || edu.ifsc;
      }
    }

    const actualUserId = onb?.user_id || targetUserId;

    const { data: rawDocs } = await (supabaseAdmin as any)
      .from("onboarding_documents")
      .select("*")
      .eq("user_id", actualUserId)
      .order("uploaded_at", { ascending: true });

    const verifiedDocsMap = onb?.education_details?.verified_docs || {};

    const docs = await Promise.all(
      (rawDocs || []).map(async (d: any) => {
        let signedUrl = "";
        try {
          signedUrl = await getSignedUrl(d.storage_path, 3600);
        } catch {}
        const review = verifiedDocsMap[d.id];
        let status = "VERIFIED";
        if (review) {
          if (review.status === "approved") status = "VERIFIED";
          else if (review.status === "rejected") status = "REJECTED";
          else if (review.status === "pending") status = "PENDING REVIEW";
        } else if (d.status === "pending" || d.document_status === "pending") {
          status = "PENDING REVIEW";
        }
        return {
          ...d,
          doc_label: review?.doc_label || d.doc_label || d.doc_type,
          document_status: status,
          rejection_reason: review?.rejection_reason || null,
          signedUrl,
        };
      })
    );

    // 3. Internship details if any
    const { data: internship } = await (supabaseAdmin as any)
      .from("internships")
      .select("*, mentor:mentor_id(id, full_name, email)")
      .eq("employee_id", targetUserId)
      .maybeSingle();

    // 4. Career History (from table if available, otherwise from education_details.career_timeline)
    let careerHistory: any[] = [];
    try {
      const { data: ch, error: chErr } = await (supabaseAdmin as any)
        .from("employee_career_history")
        .select(`
          *,
          previous_department:previous_department_id(name),
          new_department:new_department_id(name),
          previous_job_title:previous_job_title_id(title_name),
          new_job_title:new_job_title_id(title_name)
        `)
        .eq("employee_id", targetUserId)
        .order("effective_date", { ascending: false });
      if (!chErr && Array.isArray(ch) && ch.length > 0) {
        careerHistory = ch;
      }
    } catch {}

    if (careerHistory.length === 0 && Array.isArray(onb?.education_details?.career_timeline)) {
      careerHistory = onb.education_details.career_timeline;
    }

    if (careerHistory.length === 0 && emp) {
      careerHistory = [
        {
          id: `initial-${emp.id}`,
          effective_date: emp.joined_on || "2026-11-02",
          event_type: "Joined Zenxea",
          notes: `Provisioned as ${emp.job_titles?.title_name || "Specialist"} in ${emp.departments?.name || "Management"} department.`,
        },
      ];
      if (onb?.status === "approved") {
        careerHistory.unshift({
          id: `onb-${emp.id}`,
          effective_date: onb.updated_at ? onb.updated_at.slice(0, 10) : "2026-11-19",
          event_type: "Onboarding Verification Complete",
          notes: "Mandatory identity, banking, and academic credentials verified.",
        });
      }
    }

    // 5. Attendance Summary (attendance_days)
    const { data: recentAttendance } = await (supabaseAdmin as any)
      .from("attendance_days")
      .select("*")
      .eq("employee_id", targetUserId)
      .order("work_date", { ascending: false })
      .limit(60);

    // 6. Attendance Sessions
    const { data: recentSessions } = await (supabaseAdmin as any)
      .from("attendance_sessions")
      .select("*")
      .eq("employee_id", targetUserId)
      .order("session_date", { ascending: false })
      .limit(60);

    // 7. Permissions (from table or education_details.hourly_permissions)
    let permissions: any[] = [];
    try {
      const { data: pr, error: prErr } = await (supabaseAdmin as any)
        .from("permission_requests")
        .select("*")
        .eq("employee_id", targetUserId)
        .order("permission_date", { ascending: false });
      if (!prErr && Array.isArray(pr) && pr.length > 0) {
        permissions = pr;
      }
    } catch {}

    if (permissions.length === 0 && Array.isArray(onb?.education_details?.hourly_permissions)) {
      permissions = onb.education_details.hourly_permissions;
    }

    // 8. Tasks
    let tasks: any[] = [];
    try {
      const { data: t } = await (supabaseAdmin as any)
        .from("tasks")
        .select("*")
        .eq("assignee_id", targetUserId)
        .order("created_at", { ascending: false });
      tasks = t || [];
    } catch {}

    // 9. Department and Job Title Lists for Edit Form
    const { data: allDepartments } = await (supabaseAdmin as any)
      .from("departments")
      .select("id, name, code, parent_department_id")
      .order("name", { ascending: true });

    const { data: allJobTitles } = await (supabaseAdmin as any)
      .from("job_titles")
      .select("id, title_name, department_id")
      .order("title_name", { ascending: true });

    const { data: allManagers } = await (supabaseAdmin as any)
      .from("employees")
      .select("id, full_name, email")
      .eq("status", "active")
      .order("full_name", { ascending: true });

    const resolvedCategory = onb?.education_details?.employment_category || (internship ? "intern" : "full_time");
    const enhancedEmp = emp
      ? {
          ...emp,
          employment_category: emp.employment_category || resolvedCategory,
        }
      : null;

    return NextResponse.json({
      employee: enhancedEmp,
      onboarding: onb,
      documents: docs || [],
      internship: internship || null,
      careerHistory: careerHistory || [],
      recentAttendance: recentAttendance || [],
      recentSessions: recentSessions || [],
      permissions: permissions || [],
      tasks: tasks || [],
      departments: allDepartments || [],
      jobTitles: allJobTitles || [],
      managers: (allManagers || []).filter((m: any) => m.id !== targetUserId),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch 360 profile" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Allow Admin and HR to update profile parameters
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  const rawId = params?.id || "";
  const cleanId = decodeURIComponent(rawId).trim().replace(/\s+/g, "-");
  if (!cleanId) {
    return NextResponse.json({ error: "Missing employee ID" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
    let emp: any = null;
    if (isUuid) {
      const { data } = await (supabaseAdmin as any)
        .from("employees")
        .select("*, job_titles:job_title_id(title_name), departments:department_id(name)")
        .eq("id", cleanId)
        .maybeSingle();
      emp = data;
    } else {
      const { data } = await (supabaseAdmin as any)
        .from("employees")
        .select("*, job_titles:job_title_id(title_name), departments:department_id(name)")
        .ilike("id", `${cleanId}%`)
        .maybeSingle();
      emp = data;
    }

    if (!emp) {
      return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
    }

    const targetUserId = emp.id;

    // Handle adding a custom career event
    if (body.action === "add_career_event") {
      const { event_type, effective_date, notes } = body;
      if (!event_type || !effective_date) {
        return NextResponse.json({ error: "Event type and effective date are required." }, { status: 400 });
      }

      const { data: onb } = await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .select("*")
        .eq("user_id", targetUserId)
        .maybeSingle();

      const edu = onb?.education_details || {};
      const timeline = Array.isArray(edu.career_timeline) ? [...edu.career_timeline] : [];
      timeline.unshift({
        id: `car-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        effective_date,
        event_type,
        notes: notes || "Career milestone logged by HR.",
        created_at: new Date().toISOString(),
      });
      edu.career_timeline = timeline;

      await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .update({ education_details: edu, updated_at: new Date().toISOString() })
        .eq("user_id", targetUserId);

      return NextResponse.json({ success: true, career_timeline: timeline });
    }

    // Prepare Employee updates
    const empUpdates: any = {
      updated_at: new Date().toISOString(),
    };

    if (body.full_name !== undefined) empUpdates.full_name = body.full_name.trim();
    if (body.department_id !== undefined) empUpdates.department_id = body.department_id || null;
    if (body.job_title_id !== undefined) empUpdates.job_title_id = body.job_title_id || null;
    if (body.work_mode !== undefined) empUpdates.work_mode = body.work_mode;
    // Note: employment_category is persisted via onboarding_profiles.education_details (employees table does not have an employment_category column)
    if (body.manager_id !== undefined) empUpdates.manager_id = body.manager_id || null;
    if (body.shift_start_time !== undefined) empUpdates.shift_start_time = body.shift_start_time;
    if (body.shift_end_time !== undefined) empUpdates.shift_end_time = body.shift_end_time;
    if (body.timezone !== undefined) empUpdates.timezone = body.timezone;
    if (body.work_target_minutes !== undefined) empUpdates.work_target_minutes = Number(body.work_target_minutes) || 480;
    if (body.status !== undefined) empUpdates.status = body.status;
    if (body.phone !== undefined) empUpdates.phone = body.phone;
    if (body.emergency_contact !== undefined) empUpdates.emergency_contact = body.emergency_contact;

    const { error: empErr } = await (supabaseAdmin as any)
      .from("employees")
      .update(empUpdates)
      .eq("id", targetUserId);

    if (empErr) {
      return NextResponse.json({ error: empErr.message }, { status: 400 });
    }

    // Fetch existing onboarding profile to update or insert
    const { data: onb } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", targetUserId)
      .maybeSingle();

    const edu = onb?.education_details || {};
    const onbUpdates: any = {
      updated_at: new Date().toISOString(),
    };

    if (body.employment_category !== undefined) {
      edu.employment_category = body.employment_category;
    }
    if (body.bank_name !== undefined) onbUpdates.bank_name = body.bank_name;
    if (body.bank_account_number !== undefined) onbUpdates.bank_account_number = body.bank_account_number;
    if (body.bank_ifsc !== undefined) onbUpdates.bank_ifsc = body.bank_ifsc;
    if (body.pan_number !== undefined) onbUpdates.pan_number = body.pan_number;
    if (body.phone !== undefined) onbUpdates.phone = body.phone;
    if (body.highest_qualification !== undefined) {
      onbUpdates.highest_qualification = body.highest_qualification;
      edu.highest_qualification = body.highest_qualification;
    }
    if (Array.isArray(body.all_qualifications)) {
      edu.all_qualifications = body.all_qualifications;
    }

    // Check for designation or department change to automatically append to Career Timeline
    if (
      (body.job_title_id && body.job_title_id !== emp.job_title_id) ||
      (body.department_id && body.department_id !== emp.department_id)
    ) {
      const timeline = Array.isArray(edu.career_timeline) ? [...edu.career_timeline] : [];
      timeline.unshift({
        id: `car-${Date.now()}`,
        effective_date: new Date().toISOString().slice(0, 10),
        event_type: "Role / Department Updated",
        notes: `Parameters adjusted by HR Admin (${authResult.context.email || "Admin"}).`,
        created_at: new Date().toISOString(),
      });
      edu.career_timeline = timeline;
    }

    onbUpdates.education_details = edu;

    if (onb) {
      await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .update(onbUpdates)
        .eq("user_id", targetUserId);
    } else {
      await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .insert({
          user_id: targetUserId,
          full_name: empUpdates.full_name || emp.full_name,
          personal_email: emp.email,
          candidate_type: body.employment_category === "intern" ? "STUDENT_INTERN" : "EXPERIENCED",
          status: "approved",
          ...onbUpdates,
        });
    }

    return NextResponse.json({ success: true, message: "Profile parameters updated successfully." });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update employee" }, { status: 500 });
  }
}

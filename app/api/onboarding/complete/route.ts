import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendOnboardingSubmittedEmail } from "@/lib/email/resend";
import { QUALIFICATION_DOC_MAP, HighestQualification } from "@/lib/onboarding-types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    let response = NextResponse.next();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next();
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await request.json().catch(() => ({}));
    const { declaration } = payload;

    if (!declaration) {
      return NextResponse.json(
        { error: "You must accept the declaration to submit your onboarding for verification." },
        { status: 400 }
      );
    }

    // 1. Fetch current profile
    const { data: onbProfile } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!onbProfile) {
      return NextResponse.json(
        { error: "Onboarding profile not found. Please complete the form steps first." },
        { status: 400 }
      );
    }

    // 2. Fetch uploaded documents
    const { data: docs } = await (supabaseAdmin as any)
      .from("onboarding_documents")
      .select("*")
      .eq("user_id", user.id);

    const uploadedDocs = docs || [];
    const docTypesUploaded = new Set(uploadedDocs.map((d: any) => d.doc_type));

    // 3. Validate Mandatory Information
    if (!onbProfile.full_name || !onbProfile.dob || !onbProfile.phone || !onbProfile.personal_email || !onbProfile.current_address || !onbProfile.permanent_address) {
      return NextResponse.json(
        { error: "Mandatory personal information is incomplete. Please complete Step 1." },
        { status: 400 }
      );
    }

    if (!onbProfile.emergency_contact_name || !onbProfile.emergency_contact_relationship || !onbProfile.emergency_contact_phone) {
      return NextResponse.json(
        { error: "Emergency contact details are required. Please complete Step 1." },
        { status: 400 }
      );
    }

    // Photo & Resume checks
    if (!docTypesUploaded.has("photo")) {
      return NextResponse.json(
        { error: "Passport-size photo (PDF) is required. Please upload it in Step 1." },
        { status: 400 }
      );
    }

    if (!docTypesUploaded.has("resume")) {
      return NextResponse.json(
        { error: "Candidate Resume / CV (PDF) is required. Please upload it under passport-size photo in Step 1." },
        { status: 400 }
      );
    }

    // Educational Qualification check
    const highestQual = (onbProfile.highest_qualification || "Undergraduate Degree") as HighestQualification;
    const requiredQualDoc = QUALIFICATION_DOC_MAP[highestQual]?.docType || "cert_undergraduate";
    if (!docTypesUploaded.has(requiredQualDoc)) {
      return NextResponse.json(
        { error: `Missing highest qualification document: ${QUALIFICATION_DOC_MAP[highestQual]?.label || "Certificate"}. Please upload it in Step 2.` },
        { status: 400 }
      );
    }

    // Employment History check
    if (onbProfile.has_experience) {
      if (!onbProfile.previous_company_name || !onbProfile.previous_designation) {
        return NextResponse.json(
          { error: "Previous employment company and designation are required for experienced candidates." },
          { status: 400 }
        );
      }

      const hasExpCert = docTypesUploaded.has("experience_cert");
      const hasExplanation = Boolean(onbProfile.experience_explanation?.trim());
      if (!hasExpCert && !hasExplanation) {
        return NextResponse.json(
          { error: "Experience certificate (or an explanation note for HR) is required in Step 3." },
          { status: 400 }
        );
      }
    }

    // Identity check (PAN is mandatory)
    if (!onbProfile.pan_number || !docTypesUploaded.has("pan_card")) {
      return NextResponse.json(
        { error: "PAN number and PAN Card PDF are mandatory. Please complete Step 4." },
        { status: 400 }
      );
    }

    // Bank Details check
    if (!onbProfile.bank_account_holder || !onbProfile.bank_account_number || !onbProfile.bank_ifsc || !onbProfile.bank_name) {
      return NextResponse.json(
        { error: "Bank account holder, account number, IFSC, and bank name are mandatory. Please complete Step 5." },
        { status: 400 }
      );
    }

    if (!docTypesUploaded.has("bank_proof")) {
      return NextResponse.json(
        { error: "Bank proof (passbook front page or cancelled cheque PDF) is mandatory. Please upload it in Step 5." },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const currentStatus = onbProfile.onboarding_status || onbProfile.status || "NOT_STARTED";
    const nextStatus = currentStatus === "CORRECTION_REQUIRED" ? "RESUBMITTED" : "SUBMITTED";

    // 4. Update onboarding profile to SUBMITTED / RESUBMITTED
    await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .update({
        onboarding_status: nextStatus,
        status: nextStatus.toLowerCase(),
        declaration_agreed: true,
        submitted_at: nowIso,
        updated_at: nowIso,
      })
      .eq("user_id", user.id);

    // 5. Fetch employee details for notification
    const { data: empRecord } = await (supabaseAdmin.from("employees") as any)
      .select("id, organization_id, full_name, email, departments:department_id(name), job_titles:job_title_id(title_name)")
      .eq("id", user.id)
      .maybeSingle();

    const candidateName = onbProfile.full_name || empRecord?.full_name || user.user_metadata?.full_name || "Employee";
    const employeeIdFormatted = empRecord?.id ? `EMP-${empRecord.id.slice(0, 6).toUpperCase()}` : `EMP-${user.id.slice(0, 6).toUpperCase()}`;
    const departmentName = empRecord?.departments?.name || "General";
    const designationName = empRecord?.job_titles?.title_name || "Employee";

    // 6. Record Audit Log
    try {
      await (supabaseAdmin as any).from("employee_onboarding_audit").insert({
        employee_id: user.id,
        action: nextStatus === "RESUBMITTED" ? "RESUBMITTED_FOR_VERIFICATION" : "SUBMITTED_FOR_VERIFICATION",
        performed_by: user.id,
        previous_status: currentStatus,
        new_status: nextStatus,
        remarks: "Employee completed onboarding submission.",
      });
    } catch {}

    // 7. Trigger In-App Notification to HR Admins
    try {
      // Find HR and Admin users
      const { data: hrAdmins } = await (supabaseAdmin.from("employees") as any)
        .select("id, organization_id")
        .or("role.eq.admin,role.eq.hr,user_role.eq.admin,user_role.eq.hr");

      if (hrAdmins && hrAdmins.length > 0) {
        const notifInserts = hrAdmins.map((hr: any) => ({
          organization_id: hr.organization_id || empRecord?.organization_id,
          user_id: hr.id,
          type: "onboarding_submission",
          title: "NEW EMPLOYEE ONBOARDING SUBMISSION",
          body: `An employee has completed the onboarding form and submitted documents for verification.\n• Name: ${candidateName}\n• ID: ${employeeIdFormatted}\n• Department: ${departmentName}\n• Designation: ${designationName}\n• Status: ${nextStatus}`,
          link: `/hr/onboarding?employeeId=${user.id}`,
          created_at: nowIso,
        }));
        await (supabaseAdmin as any).from("notifications").insert(notifInserts);
      }
    } catch (notifErr) {
      console.warn("[Onboarding Notification Error]:", notifErr);
    }

    // 8. Trigger Email Notification to HR
    try {
      await sendOnboardingSubmittedEmail({
        candidateName,
        candidateEmail: onbProfile.personal_email || user.email || "",
        candidateType: onbProfile.candidate_type || "GRADUATE_FRESHER",
      });
    } catch (emailErr) {
      console.warn("[Onboarding Email Error]:", emailErr);
    }

    return NextResponse.json({
      success: true,
      onboarding_status: nextStatus,
      message: "Onboarding submitted successfully for HR Admin verification.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to submit onboarding." },
      { status: 500 }
    );
  }
}

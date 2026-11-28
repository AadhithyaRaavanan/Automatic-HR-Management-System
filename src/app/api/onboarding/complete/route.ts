import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/features/notifications/notify";
import { getHrUsers } from "@/features/notifications/recipients";
import { sendOnboardingSubmittedEmail } from "@/lib/email/resend";
import { QUALIFICATION_DOC_MAP, HighestQualification } from "@/features/onboarding/types";

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

    const authHeader = request.headers.get("Authorization");
    let user = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const { data: tokenUser } = await supabaseAdmin.auth.getUser(token);
      user = tokenUser?.user || null;
    }
    if (!user) {
      const { data: cookieUser } = await supabase.auth.getUser();
      user = cookieUser?.user || null;
    }
    if (!user) {
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
    let { data: onbProfile } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!onbProfile) {
      // If draft was not saved in DB yet, auto-create it from payload now
      const initialName = payload.full_name || user.user_metadata?.full_name || "Employee";
      const initialEdu = {
        highest_qualification: payload.highest_qualification || "12th Standard",
        emergency_contact_name: payload.emergency_contact_name || null,
        emergency_contact_relationship: payload.emergency_contact_relationship || null,
        emergency_contact_phone: payload.emergency_contact_phone || null,
        bank_branch: payload.bank_branch || null,
        has_experience: Boolean(payload.has_experience),
        experience_explanation: payload.experience_explanation || null,
      };

      const initialPayload = {
        user_id: user.id,
        candidate_type: payload.has_experience ? "EXPERIENCED" : "GRADUATE_FRESHER",
        full_name: initialName,
        dob: payload.dob || null,
        gender: payload.gender || null,
        phone: payload.phone || null,
        personal_email: payload.personal_email || user.email,
        current_address: payload.current_address || null,
        permanent_address: payload.permanent_address || null,
        blood_group: payload.blood_group || null,
        pan_number: payload.pan_number || null,
        aadhaar_number: payload.aadhaar_number || null,
        bank_account_holder: payload.bank_account_holder || null,
        bank_account_number: payload.bank_account_number || null,
        bank_ifsc: payload.bank_ifsc || null,
        bank_name: payload.bank_name || null,
        uan_number: payload.uan_number || null,
        education_details: initialEdu,
        previous_company_name: payload.previous_company_name || null,
        previous_designation: payload.previous_designation || null,
        previous_start_date: payload.previous_start_date || null,
        previous_end_date: payload.previous_end_date || null,
        previous_hr_email: payload.previous_hr_email || null,
        previous_hr_phone: payload.previous_hr_phone || null,
        previous_employee_id: payload.previous_employee_id || null,
        status: "draft",
        updated_at: new Date().toISOString(),
      };

      const { data: createdProf, error: createErr } = await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .upsert(initialPayload, { onConflict: "user_id" })
        .select()
        .maybeSingle();

      if (createErr) {
        console.error("[POST /api/onboarding/complete] Auto-create draft profile failed:", createErr.message);
      }
      onbProfile = createdProf || initialPayload;
    }

    // 2. Fetch uploaded documents
    const { data: docs } = await (supabaseAdmin as any)
      .from("onboarding_documents")
      .select("*")
      .eq("user_id", user.id);

    const uploadedDocs = docs || [];
    const docTypesUploaded = new Set(uploadedDocs.map((d: any) => d.doc_type));

    // 3. Validate Mandatory Information
    const { data: empRecord } = await (supabaseAdmin.from("employees") as any)
      .select("id, organization_id, full_name, email, phone, emergency_contact, departments:department_id(name), job_titles:job_title_id(title_name)")
      .eq("id", user.id)
      .maybeSingle();

    const edu = (onbProfile.education_details as any) || {};
    const emergencyFromEmp = empRecord?.emergency_contact || "";
    const emergencyName =
      payload.emergency_contact_name ||
      onbProfile.emergency_contact_name ||
      edu.emergency_contact_name ||
      (emergencyFromEmp ? emergencyFromEmp.split("-")[0]?.trim() : "") ||
      "Family Contact";
    const emergencyRel =
      payload.emergency_contact_relationship ||
      onbProfile.emergency_contact_relationship ||
      edu.emergency_contact_relationship ||
      "Family";
    const emergencyPhone =
      payload.emergency_contact_phone ||
      onbProfile.emergency_contact_phone ||
      edu.emergency_contact_phone ||
      (emergencyFromEmp ? emergencyFromEmp.split("-")[1]?.trim() : "") ||
      payload.phone ||
      onbProfile.phone ||
      "+919876500000";

    const resolvedFullName = payload.full_name || onbProfile.full_name || empRecord?.full_name || "Employee";
    const resolvedDob = payload.dob || onbProfile.dob || "2000-01-01";
    const resolvedPhone = payload.phone || onbProfile.phone || empRecord?.phone || "+919876543210";
    const resolvedPersonalEmail = payload.personal_email || onbProfile.personal_email || user.email;
    const resolvedCurrentAddress = payload.current_address || onbProfile.current_address || "Provided";
    const resolvedPermanentAddress = payload.permanent_address || onbProfile.permanent_address || resolvedCurrentAddress;

    if (!resolvedFullName || !resolvedPhone || !resolvedPersonalEmail) {
      return NextResponse.json(
        { error: "Mandatory personal information is incomplete. Please complete Step 1." },
        { status: 400 }
      );
    }

    // Photo & Resume checks
    if (!docTypesUploaded.has("photo")) {
      return NextResponse.json(
        { error: "Passport-size photo (PDF, JPG, or PNG) is required. Please upload it in Step 1." },
        { status: 400 }
      );
    }

    if (!docTypesUploaded.has("resume")) {
      return NextResponse.json(
        { error: "Candidate Resume / CV (PDF, JPG, or PNG) is required. Please upload it under passport-size photo in Step 1." },
        { status: 400 }
      );
    }

    // Educational Qualification check
    const highestQual = (
      payload.highest_qualification ||
      onbProfile.highest_qualification ||
      edu.highest_qualification ||
      (docTypesUploaded.has("cert_12th") ? "12th Standard" : "Undergraduate Degree")
    ) as HighestQualification;
    const requiredQualDoc = QUALIFICATION_DOC_MAP[highestQual]?.docType;

    const QUAL_DOC_TYPES = new Set([
      "cert_12th",
      "cert_10th",
      "cert_diploma",
      "cert_undergraduate",
      "cert_postgraduate",
      "cert_doctorate",
      "cert_other",
      "12th_mark_sheet",
      "12th_marksheet",
      "marksheet",
      "education_cert",
      "qualification_proof",
    ]);

    const hasSpecificDoc = requiredQualDoc ? docTypesUploaded.has(requiredQualDoc) : false;
    const hasAnyQualDoc = uploadedDocs.some(
      (d: any) =>
        QUAL_DOC_TYPES.has(d.doc_type) ||
        (d.doc_type && d.doc_type.startsWith("cert_")) ||
        (d.file_name && (d.file_name.toLowerCase().includes("12th") || d.file_name.toLowerCase().includes("certificate") || d.file_name.toLowerCase().includes("mark")))
    );

    if (!hasSpecificDoc && !hasAnyQualDoc) {
      return NextResponse.json(
        { error: `Missing highest qualification document: ${QUALIFICATION_DOC_MAP[highestQual]?.label || "Certificate"}. Please upload it in Step 2.` },
        { status: 400 }
      );
    }

    // Employment History check
    const hasExp = onbProfile.has_experience !== undefined ? onbProfile.has_experience : edu.has_experience;
    if (hasExp) {
      if (!onbProfile.previous_company_name || !onbProfile.previous_designation) {
        return NextResponse.json(
          { error: "Previous employment company and designation are required for experienced candidates." },
          { status: 400 }
        );
      }

      const hasExpCert = docTypesUploaded.has("experience_cert");
      const hasExplanation = Boolean((onbProfile.experience_explanation || edu.experience_explanation)?.trim());
      if (!hasExpCert && !hasExplanation) {
        return NextResponse.json(
          { error: "Experience certificate (or an explanation note for HR) is required in Step 3." },
          { status: 400 }
        );
      }
    }

    // Identity check (PAN is mandatory)
    const resolvedPan = payload.pan_number || onbProfile.pan_number;
    if (!resolvedPan || !docTypesUploaded.has("pan_card")) {
      return NextResponse.json(
        { error: "PAN number and PAN Card document are mandatory. Please complete Step 4." },
        { status: 400 }
      );
    }

    // Identity check (Aadhaar is mandatory)
    const resolvedAadhaar = payload.aadhaar_number || onbProfile.aadhaar_number;
    if (!resolvedAadhaar || resolvedAadhaar.trim().length !== 12 || !docTypesUploaded.has("aadhaar_card")) {
      return NextResponse.json(
        { error: "Aadhaar number (12 digits) and Aadhaar Card document are mandatory. Please complete Step 4." },
        { status: 400 }
      );
    }

    // Bank Details check
    const resolvedHolder = payload.bank_account_holder || onbProfile.bank_account_holder;
    const resolvedAccount = payload.bank_account_number || onbProfile.bank_account_number;
    const resolvedIfsc = payload.bank_ifsc || onbProfile.bank_ifsc;
    const resolvedBank = payload.bank_name || onbProfile.bank_name;

    if (!resolvedHolder || !resolvedAccount || !resolvedIfsc || !resolvedBank) {
      return NextResponse.json(
        { error: "Bank account holder, account number, IFSC, and bank name are mandatory. Please complete Step 5." },
        { status: 400 }
      );
    }

    if (!docTypesUploaded.has("bank_proof")) {
      return NextResponse.json(
        { error: "Bank proof (passbook front page or cancelled cheque) is mandatory. Please upload it in Step 5." },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const currentStatus = onbProfile.onboarding_status || onbProfile.status || "NOT_STARTED";
    const nextStatus = currentStatus === "CORRECTION_REQUIRED" ? "RESUBMITTED" : "SUBMITTED";

    const mergedEdu = {
      ...edu,
      highest_qualification: highestQual,
      emergency_contact_name: emergencyName,
      emergency_contact_relationship: emergencyRel,
      emergency_contact_phone: emergencyPhone,
      bank_branch: payload.bank_branch || onbProfile.bank_branch || edu.bank_branch,
    };

    // 4. Update onboarding profile to submitted
    const updateProfileData: Record<string, any> = {
      full_name: resolvedFullName,
      highest_qualification: highestQual,
      dob: resolvedDob,
      gender: payload.gender || onbProfile.gender || null,
      phone: resolvedPhone,
      personal_email: resolvedPersonalEmail,
      emergency_contact_name: emergencyName,
      emergency_contact_relationship: emergencyRel,
      emergency_contact_phone: emergencyPhone,
      current_address: resolvedCurrentAddress,
      permanent_address: resolvedPermanentAddress,
      blood_group: payload.blood_group || onbProfile.blood_group || null,
      pan_number: resolvedPan,
      aadhaar_number: payload.aadhaar_number || onbProfile.aadhaar_number || null,
      bank_account_holder: resolvedHolder,
      bank_account_number: resolvedAccount,
      bank_ifsc: resolvedIfsc,
      bank_name: resolvedBank,
      uan_number: payload.uan_number || onbProfile.uan_number || null,
      education_details: mergedEdu,
      status: "submitted",
      onboarding_status: "UNDER_REVIEW",
      submitted_at: nowIso,
      updated_at: nowIso,
    };

    // Purge non-matching qualification docs so only the chosen certificate remains in DB
    if (requiredQualDoc) {
      const otherQualDocTypes = [
        "cert_10th",
        "cert_12th",
        "cert_diploma",
        "cert_undergraduate",
        "cert_postgraduate",
        "cert_doctorate",
        "cert_other",
      ].filter((dt) => dt !== requiredQualDoc);

      await (supabaseAdmin as any)
        .from("onboarding_documents")
        .delete()
        .eq("user_id", user.id)
        .in("doc_type", otherQualDocTypes);
    }

    const { error: updateErr } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .update(updateProfileData)
      .eq("user_id", user.id);

    if (updateErr) {
      console.error("[POST /api/onboarding/complete] Failed to update onboarding profile:", updateErr.message);
    }

    // 5. Update employees details (Note: onboarding_completed and active status are granted ONLY upon final HR approval)
    try {
      const empEmergency = emergencyName && emergencyPhone ? `${emergencyName} - ${emergencyPhone}` : undefined;
      const empUpdatePayload: Record<string, any> = {
        full_name: resolvedFullName,
        phone: resolvedPhone,
      };
      if (empEmergency) {
        empUpdatePayload.emergency_contact = empEmergency;
      }

      await (supabaseAdmin.from("employees") as any)
        .update(empUpdatePayload)
        .eq("id", user.id);

      // Reset any rejected documents back to 'pending' upon candidate resubmission
      await (supabaseAdmin as any)
        .from("onboarding_documents")
        .update({
          document_status: "pending",
          rejection_reason: null,
          reviewed_at: null,
        })
        .eq("user_id", user.id)
        .eq("document_status", "rejected");

      await supabaseAdmin.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...user.user_metadata,
          onboarding_status: "SUBMITTED",
        },
      });
    } catch (grantErr) {
      console.warn("[Onboarding Complete] Error updating employee info on submission:", grantErr);
    }

    // 6. Employee details for notification (empRecord resolved above)
    const candidateName = resolvedFullName || onbProfile.full_name || empRecord?.full_name || user.user_metadata?.full_name || "Employee";
    const employeeIdFormatted = empRecord?.id ? `EMP-${empRecord.id.slice(0, 6).toUpperCase()}` : `EMP-${user.id.slice(0, 6).toUpperCase()}`;
    const departmentName = empRecord?.departments?.name || "General";
    const designationName = empRecord?.job_titles?.title_name || "Employee";

    // 6. Record Audit Log
    let resolvedOrgId: string | null = empRecord?.organization_id || null;
    if (!resolvedOrgId) {
      const { data: mem } = await (supabaseAdmin as any)
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      resolvedOrgId = mem?.organization_id || null;
    }

    try {
      await (supabaseAdmin as any).from("employee_onboarding_audit").insert({
        organization_id: resolvedOrgId,
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
      const hrUserIds = await getHrUsers(resolvedOrgId);
      if (hrUserIds.length > 0) {
        await notify({
          userIds: hrUserIds,
          type: "onboarding_submission",
          typeGroup: "onboarding",
          title: "New Employee Onboarding Submission",
          body: `Candidate ${candidateName} has submitted their profile and documents for verification.\nDepartment: ${departmentName} | Designation: ${designationName}`,
          link: `/hr/onboarding?employeeId=${user.id}`,
          entityType: "onboarding_profiles",
          entityId: user.id,
          actorId: user.id,
        });
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

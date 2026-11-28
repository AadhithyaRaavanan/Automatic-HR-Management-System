import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/features/notifications/notify";
import { getHrUsers, getAuthorizedOnboardingEmailRecipients } from "@/features/notifications/recipients";
import { sendOnboardingSubmittedEmail } from "@/lib/email/resend";
import { QUALIFICATION_DOC_MAP, HighestQualification } from "@/features/onboarding/types";
import { resolveOnboardingCaller } from "@/features/auth/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveOnboardingCaller(request);
    if ("response" in authResult) {
      return authResult.response;
    }
    const { user, context } = authResult;

    const payload = await request.json().catch(() => ({}));
    const { declaration } = payload;

    if (!declaration) {
      return NextResponse.json(
        { error: "You must accept the declaration to submit your onboarding for verification." },
        { status: 400 }
      );
    }

    const resolvedOrgId: string | null = context.organizationId;

    // 1. Fetch current profile (strictly scoped to resolved organization)
    let profSelectQ = (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", user.id);
    if (resolvedOrgId) {
      profSelectQ = profSelectQ.eq("organization_id", resolvedOrgId);
    }
    let { data: onbProfile } = await profSelectQ.maybeSingle();

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

      const initialPayload: Record<string, any> = {
        user_id: user.id,
        ...(resolvedOrgId ? { organization_id: resolvedOrgId } : {}),
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
        .upsert(initialPayload, {
          onConflict: resolvedOrgId ? "organization_id,user_id" : "user_id",
        })
        .select()
        .maybeSingle();

      if (createErr) {
        return NextResponse.json(
          { error: `Failed to initialize onboarding profile: ${createErr.message}` },
          { status: 500 }
        );
      }
      onbProfile = createdProf || initialPayload;
    }

    // 2. Fetch uploaded documents (strictly scoped to resolved organization)
    let docsSelectQ = (supabaseAdmin as any)
      .from("onboarding_documents")
      .select("*")
      .eq("user_id", user.id);
    if (resolvedOrgId) {
      docsSelectQ = docsSelectQ.eq("organization_id", resolvedOrgId);
    }
    const { data: docs } = await docsSelectQ;

    const uploadedDocs = docs || [];
    const docTypesUploaded = new Set(uploadedDocs.map((d: any) => d.doc_type));

    // 3. Validate Mandatory Information (use tenant-scoped employee profile from context)
    const empRecord = context.employee;

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
    const rawStatusLower = String(onbProfile.status || "").toLowerCase();
    const rawOnboardingStatusUpper = String(onbProfile.onboarding_status || "").toUpperCase();
    const currentStatus = onbProfile.onboarding_status || onbProfile.status || "NOT_STARTED";
    const isAlreadySubmitted =
      (rawStatusLower === "submitted" || rawOnboardingStatusUpper === "UNDER_REVIEW") &&
      rawStatusLower !== "changes_requested" &&
      rawOnboardingStatusUpper !== "CORRECTION_REQUIRED";
    const nextStatus =
      rawStatusLower === "changes_requested" || rawOnboardingStatusUpper === "CORRECTION_REQUIRED"
        ? "RESUBMITTED"
        : "SUBMITTED";

    // Idempotent retry protection: if an approved/already-submitted non-rejected retry arrives,
    // verify durable audit exists rather than silently duplicating audit entries.
    let auditAlreadyRecorded = false;
    if (isAlreadySubmitted) {
      let existingAuditQ = (supabaseAdmin as any)
        .from("employee_onboarding_audit")
        .select("id")
        .eq("employee_id", user.id)
        .in("action", ["SUBMITTED_FOR_VERIFICATION", "RESUBMITTED_FOR_VERIFICATION"]);
      if (resolvedOrgId) {
        existingAuditQ = existingAuditQ.eq("organization_id", resolvedOrgId);
      }
      const { data: existingAudit } = await existingAuditQ.limit(1).maybeSingle();
      if (existingAudit?.id) {
        auditAlreadyRecorded = true;
      }
    }

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

      let delOtherQualQ = (supabaseAdmin as any)
        .from("onboarding_documents")
        .delete()
        .eq("user_id", user.id)
        .in("doc_type", otherQualDocTypes);
      if (resolvedOrgId) {
        delOtherQualQ = delOtherQualQ.eq("organization_id", resolvedOrgId);
      }
      await delOtherQualQ;
    }

    const previousSnapshot = {
      status: onbProfile.status || "draft",
      onboarding_status: onbProfile.onboarding_status || "NOT_STARTED",
      submitted_at: onbProfile.submitted_at || null,
    };

    let profUpdQ = (supabaseAdmin as any)
      .from("onboarding_profiles")
      .update(updateProfileData)
      .eq("user_id", user.id);
    if (resolvedOrgId) {
      profUpdQ = profUpdQ.eq("organization_id", resolvedOrgId);
    }
    const { error: updateErr } = await profUpdQ;

    if (updateErr) {
      return NextResponse.json(
        { error: `Failed to save onboarding submission: ${updateErr.message}` },
        { status: 500 }
      );
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

      let empCompleteUpdQ = (supabaseAdmin.from("employees") as any)
        .update(empUpdatePayload)
        .eq("id", user.id);
      if (resolvedOrgId) {
        empCompleteUpdQ = empCompleteUpdQ.eq("organization_id", resolvedOrgId);
      }
      await empCompleteUpdQ;

      // Reset any rejected documents back to 'pending' upon candidate resubmission
      let resetDocsQ = (supabaseAdmin as any)
        .from("onboarding_documents")
        .update({
          document_status: "pending",
          rejection_reason: null,
          reviewed_at: null,
        })
        .eq("user_id", user.id)
        .eq("document_status", "rejected");
      if (resolvedOrgId) {
        resetDocsQ = resetDocsQ.eq("organization_id", resolvedOrgId);
      }
      await resetDocsQ;

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
    const departmentName = empRecord?.departments?.name || "General";
    const designationName = empRecord?.job_titles?.title_name || "Employee";

    // 7. Record Durable Audit Log (checked explicitly; rollback submission status if audit write fails)
    if (!auditAlreadyRecorded) {
      const { error: auditErr } = await (supabaseAdmin as any)
        .from("employee_onboarding_audit")
        .insert({
          organization_id: resolvedOrgId,
          employee_id: user.id,
          action: nextStatus === "RESUBMITTED" ? "RESUBMITTED_FOR_VERIFICATION" : "SUBMITTED_FOR_VERIFICATION",
          performed_by: user.id,
          previous_status: currentStatus,
          new_status: nextStatus,
          remarks: "Employee completed onboarding submission.",
        });

      if (auditErr) {
        let rollbackQ = (supabaseAdmin as any)
          .from("onboarding_profiles")
          .update(previousSnapshot)
          .eq("user_id", user.id);
        if (resolvedOrgId) {
          rollbackQ = rollbackQ.eq("organization_id", resolvedOrgId);
        }
        await rollbackQ;
        return NextResponse.json(
          { error: `Failed to record onboarding audit trail: ${auditErr.message}` },
          { status: 500 }
        );
      }
    }

    // 8. Trigger In-App Notification to HR Admins strictly inside resolved organization
    let inAppNotifiedCount = 0;
    try {
      const hrUserIds = resolvedOrgId ? await getHrUsers(resolvedOrgId) : [];
      if (hrUserIds.length > 0 && !auditAlreadyRecorded) {
        await notify({
          userIds: hrUserIds,
          organizationId: resolvedOrgId,
          type: "onboarding_submission",
          typeGroup: "onboarding",
          title: "New Employee Onboarding Submission",
          body: `Candidate ${candidateName} has submitted their profile and documents for verification.\nDepartment: ${departmentName} | Designation: ${designationName}`,
          link: `/hr/onboarding?employeeId=${user.id}`,
          entityType: "onboarding_profiles",
          entityId: user.id,
          actorId: user.id,
        });
        inAppNotifiedCount = hrUserIds.length;
      }
    } catch (notifErr) {
      console.warn("[Onboarding Notification Error]:", notifErr);
    }

    // 9. Trigger Email Notification ONLY to authorized HR/Admin recipients in the selected organization
    const emailRecipients = resolvedOrgId ? await getAuthorizedOnboardingEmailRecipients(resolvedOrgId) : [];
    const emailResult = await sendOnboardingSubmittedEmail({
      to: emailRecipients,
      organizationName: context.organizationName || undefined,
      candidateName,
      candidateEmail: onbProfile.personal_email || user.email || "",
      candidateType: onbProfile.candidate_type || "GRADUATE_FRESHER",
    });

    const warnings: string[] = [];
    if (!emailResult.success && emailResult.error) {
      warnings.push(emailResult.error);
    }

    return NextResponse.json({
      success: true,
      onboarding_status: nextStatus,
      idempotentReplay: auditAlreadyRecorded,
      message: "Onboarding submitted successfully for HR Admin verification.",
      notifications: {
        inAppCount: inAppNotifiedCount,
        email: {
          sent: emailResult.success,
          recipients: emailRecipients,
          code: emailResult.code || (emailResult.success ? "SENT" : "FAILED"),
          error: emailResult.error || null,
        },
      },
      warnings,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to submit onboarding." },
      { status: 500 }
    );
  }
}

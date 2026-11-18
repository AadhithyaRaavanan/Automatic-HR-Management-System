import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSignedUrl } from "@/lib/onboarding-storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    // Fetch onboarding profiles and employees separately to avoid missing foreign key relation cache errors
    const { data: candidates, error: fetchErr } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const { data: empList } = await (supabaseAdmin.from("employees") as any)
      .select(`
        id,
        full_name,
        email,
        phone,
        status,
        onboarding_completed,
        departments:department_id(name),
        job_titles:job_title_id(title_name)
      `);

    const { data: orgMembers } = await (supabaseAdmin.from("organization_members") as any)
      .select("user_id, role");
    const roleMap = new Map<string, string>();
    for (const m of orgMembers || []) {
      if (m.user_id && m.role) {
        roleMap.set(m.user_id, (m.role || "").toLowerCase());
      }
    }

    const empMap = new Map<string, any>();
    for (const emp of empList || []) {
      empMap.set(emp.id, emp);
    }

    const { data: allDocs } = await (supabaseAdmin as any)
      .from("onboarding_documents")
      .select("*")
      .order("uploaded_at", { ascending: true });

    const docsByUserId = new Map<string, any[]>();
    for (const doc of allDocs || []) {
      if (!docsByUserId.has(doc.user_id)) {
        docsByUserId.set(doc.user_id, []);
      }
      docsByUserId.get(doc.user_id)!.push(doc);
    }

    // Enhance each candidate record with documents, signed URLs, and progress metrics
    const enhancedCandidates = await Promise.all(
      (candidates || []).map(async (c: any) => {
        const emp = empMap.get(c.user_id);
        const rawDocs = docsByUserId.get(c.user_id) || [];

        // Resolve signed URLs for each doc
        const docsWithUrls = await Promise.all(
          rawDocs.map(async (doc: any) => {
            let signedUrl = "";
            try {
              signedUrl = await getSignedUrl(doc.storage_path, 3600);
            } catch {}
            return {
              id: doc.id,
              doc_type: doc.doc_type,
              document_name: doc.document_name || doc.doc_type.replace(/_/g, " "),
              file_name: doc.file_name,
              storage_path: doc.storage_path,
              file_size: Number(doc.file_size || 0),
              document_status: doc.document_status || "pending",
              rejection_reason: doc.rejection_reason || null,
              salary_month: doc.salary_month || null,
              salary_year: doc.salary_year || null,
              uploaded_at: doc.uploaded_at,
              signedUrl,
            };
          })
        );

        // Calculate progress percentage
        // Required docs: PAN + Bank Proof + Highest Qual Cert (+ Experience Cert if experienced)
        let totalRequired = 3;
        if (c.has_experience) totalRequired += 1;
        const approvedCount = docsWithUrls.filter((d) => d.document_status === "approved").length;
        const uploadedCount = docsWithUrls.length;
        const completionPercentage = Math.min(100, Math.round((uploadedCount / totalRequired) * 100));

        const rawStatus = (c.onboarding_status || c.status || "NOT_STARTED").toUpperCase();

        return {
          id: c.id,
          user_id: c.user_id,
          full_name: c.full_name || emp?.full_name || "New Candidate",
          email: c.personal_email || emp?.email || "",
          employee_id: emp?.id ? `EMP-${emp.id.slice(0, 6).toUpperCase()}` : `EMP-${c.user_id.slice(0, 6).toUpperCase()}`,
          department: emp?.departments?.name || "General",
          designation: emp?.job_titles?.title_name || "Employee",
          status: (c.status || "draft").toLowerCase(),
          onboarding_status: rawStatus,
          approval_email_sent_at: c.approval_email_sent_at || null,
          approved_at: c.approved_at || null,
          highest_qualification: c.highest_qualification || "Undergraduate Degree",
          has_experience: Boolean(c.has_experience),
          submission_date: c.submitted_at || c.created_at,
          completion_percentage: completionPercentage,
          documents: docsWithUrls,
          approved_docs_count: approvedCount,
          total_docs_count: uploadedCount,
          drive_folder_url: process.env.ONBOARDING_DRIVE_FOLDER_URL || null,
          storage_folder: c.storage_folder || null,
          personal_details: {
            dob: c.dob,
            gender: c.gender,
            phone: c.phone || emp?.phone,
            current_address: c.current_address,
            permanent_address: c.permanent_address,
            emergency_contact_name: c.emergency_contact_name,
            emergency_contact_relationship: c.emergency_contact_relationship,
            emergency_contact_phone: c.emergency_contact_phone,
            blood_group: c.blood_group,
          },
          employment_details: {
            has_experience: c.has_experience,
            previous_company_name: c.previous_company_name,
            previous_designation: c.previous_designation,
            previous_start_date: c.previous_start_date,
            previous_end_date: c.previous_end_date,
            previous_hr_email: c.previous_hr_email,
            previous_hr_phone: c.previous_hr_phone,
            experience_explanation: c.experience_explanation,
          },
          bank_details: {
            bank_account_holder: c.bank_account_holder,
            bank_account_number: c.bank_account_number,
            bank_ifsc: c.bank_ifsc,
            bank_name: c.bank_name,
            bank_branch: c.bank_branch,
            uan_number: c.uan_number,
            pan_number: c.pan_number,
            aadhaar_number: c.aadhaar_number,
          },
        };
      })
    );

    // Filter out Admin, HR, and Manager staff accounts, and ensure deleted candidate records are purged
    const candidateList = enhancedCandidates.filter((c) => {
      const emp = empMap.get(c.user_id);
      const memberRole = roleMap.get(c.user_id) || "";
      const email = (c.email || emp?.email || "").toLowerCase();
      const fullName = (c.full_name || emp?.full_name || "").toLowerCase();
      const empId = (c.employee_id || "").toUpperCase();
      const userId = (c.user_id || "").toLowerCase();

      const isInternalManagement =
        memberRole === "admin" ||
        memberRole === "hr" ||
        memberRole === "manager" ||
        c.user_id === "952a33f0-3af4-4a69-a382-26fef3b7fa11" ||
        email.includes("aadhithya.raavanan") ||
        email.includes("hr.demo") ||
        email.includes("manager.demo");

      const isDeletedCandidate =
        email.includes("james") ||
        fullName.includes("james") ||
        empId.includes("015E71") ||
        userId.startsWith("015e71");

      return !isInternalManagement && !isDeletedCandidate;
    });

    // Summary Metrics: pending reflects 'submitted' items only
    const summary = {
      total: candidateList.length,
      pending: candidateList.filter(
        (c) => c.status === "submitted" || c.onboarding_status === "SUBMITTED"
      ).length,
      under_review: candidateList.filter((c) => c.onboarding_status === "UNDER_REVIEW").length,
      correction_required: candidateList.filter((c) => c.status === "changes_requested" || c.onboarding_status === "CORRECTION_REQUIRED").length,
      approved: candidateList.filter((c) => c.status === "approved" || ["VERIFIED", "COMPLETED"].includes(c.onboarding_status)).length,
      completed: candidateList.filter((c) => c.status === "approved" || c.onboarding_status === "COMPLETED").length,
    };

    return NextResponse.json(
      {
        candidates: candidateList,
        summary,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to retrieve onboarding candidates." },
      { status: 500 }
    );
  }
}

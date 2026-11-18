import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/notify";
import { QUALIFICATION_DOC_MAP, HighestQualification } from "@/lib/onboarding-types";
import { sendOnboardingApprovalEmail, sendAdminOnboardingDossierEmail } from "@/lib/email/resend";
import { getSignedUrl } from "@/lib/onboarding-storage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  const reviewerId = authResult.context.userId;

  try {
    const body = await request.json().catch(() => ({}));
    const { userId, note } = body;

    if (!userId) {
      return NextResponse.json({ error: "Missing required parameter 'userId'." }, { status: 400 });
    }

    // Nobody can approve their own onboarding
    if (reviewerId === userId) {
      return NextResponse.json(
        { error: "You cannot approve your own onboarding profile." },
        { status: 403 }
      );
    }

    // 1. Fetch candidate onboarding profile
    const { data: profile, error: profErr } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (profErr || !profile) {
      return NextResponse.json({ error: "Onboarding profile not found." }, { status: 404 });
    }

    // 2. Fetch candidate's uploaded documents
    const { data: docs } = await (supabaseAdmin as any)
      .from("onboarding_documents")
      .select("*")
      .eq("user_id", userId);

    const uploadedDocs = docs || [];

    if (uploadedDocs.length === 0) {
      return NextResponse.json(
        { error: "Cannot complete approval: No documents have been uploaded." },
        { status: 400 }
      );
    }

    const verifiedDocsMap = (profile.education_details?.verified_docs) || {};

    // Server-side check: Final approval is blocked unless EVERY document is individually approved
    const unapprovedDocs = uploadedDocs.filter((d: any) => {
      const status = d.document_status || verifiedDocsMap[d.id]?.status;
      return status !== "approved";
    });

    if (unapprovedDocs.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot complete approval: ${unapprovedDocs.length} document(s) have not been individually approved.`,
        },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    // 3. Update onboarding_profiles to approved and record approval metadata
    const updatedEducation = {
      ...(profile.education_details || {}),
      verified_docs: verifiedDocsMap,
      approval_meta: {
        approved_by: reviewerId,
        approved_at: nowIso,
        verified_by: reviewerId,
        verified_at: nowIso,
        completed_at: nowIso,
      },
    };

    const { error: profUpdateErr } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .update({
        status: "approved",
        education_details: updatedEducation,
        updated_at: nowIso,
      })
      .eq("user_id", userId);

    if (profUpdateErr) {
      console.error("[approve] Failed to update onboarding_profile:", profUpdateErr);
      throw new Error("Failed to update onboarding profile status.");
    }

    // 4. Update profiles, employees (status = 'active', onboarding_completed = true), and app_metadata claim
    await Promise.all([
      (supabaseAdmin as any).from("profiles").upsert(
        {
          id: userId,
          user_id: userId,
          onboarding_completed: true,
          tutorial_completed: false,
          updated_at: nowIso,
        },
        { onConflict: "id" }
      ),
      (supabaseAdmin as any)
        .from("employees")
        .update({
          status: "active",
          onboarding_completed: true,
          updated_at: nowIso,
        })
        .eq("id", userId),
      supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: {
          onboarding_approved: true,
        },
        user_metadata: {
          onboarding_completed: true,
          onboarding_status: "COMPLETED",
        },
      }),
    ]);

    // 5. Audit Log
    try {
      await (supabaseAdmin as any).from("employee_onboarding_audit").insert({
        employee_id: userId,
        action: "ONBOARDING_APPROVED_AND_ACTIVATED",
        performed_by: reviewerId,
        previous_status: profile.status || "submitted",
        new_status: "approved",
        remarks: note?.trim() || "HR Admin approved all documents and activated employee account.",
      });
    } catch {}

    // 6. In-App Notification to Employee: "Welcome, you now have access" linking to /dashboard
    try {
      await notify({
        userIds: [userId],
        type: "onboarding_status",
        typeGroup: "onboarding",
        title: "Welcome, you now have access",
        body: "Your onboarding has been approved by HR and your Pulse account is now active.",
        link: "/dashboard",
        entityType: "onboarding_profiles",
        entityId: userId,
        actorId: reviewerId,
      });
    } catch (notifErr) {
      console.warn("[Onboarding Approval Notification Error]:", notifErr);
    }

    // Fetch candidate details for email notifications
    const { data: candEmp } = await (supabaseAdmin.from("employees") as any)
      .select(`
        id,
        full_name,
        email,
        departments:department_id(name),
        job_titles:job_title_id(title_name)
      `)
      .eq("id", userId)
      .maybeSingle();

    // 7. Approval Email: Send transactional welcome email to employee
    let emailSent = Boolean(profile.approval_email_sent_at);

    if (!emailSent) {
      const toEmail = candEmp?.email || profile.personal_email;
      const firstName = (candEmp?.full_name || profile.full_name || "Team Member").split(" ")[0];

      if (toEmail) {
        try {
          const emailRes = await sendOnboardingApprovalEmail({
            to: toEmail,
            firstName,
            departmentName: candEmp?.departments?.name,
            jobTitle: candEmp?.job_titles?.title_name,
          });

          if (emailRes.success) {
            emailSent = true;
            try {
              await (supabaseAdmin as any)
                .from("onboarding_profiles")
                .update({ approval_email_sent_at: nowIso })
                .eq("user_id", userId);
            } catch {}
          } else {
            console.warn("[Onboarding Approval Email Warning]:", emailRes.error);
          }
        } catch (emailErr) {
          console.error("[Onboarding Approval Email Error]:", emailErr);
          emailSent = false;
        }
      }
    }

    // 8. Admin Dossier Email: Send all candidate files and details to the admin from HR
    let adminDossierSent = false;
    try {
      // Find all Super Admin emails (defaults to aadhithya.raavanan@gmail.com)
      let adminEmails = ["aadhithya.raavanan@gmail.com"];
      try {
        const { data: adminList } = await supabaseAdmin.auth.admin.listUsers();
        const found = (adminList?.users || [])
          .filter(
            (u: any) =>
              u.app_metadata?.user_role === "admin" ||
              u.user_metadata?.role === "admin" ||
              u.email === "aadhithya.raavanan@gmail.com"
          )
          .map((u: any) => u.email)
          .filter(Boolean);
        if (found.length > 0) {
          adminEmails = Array.from(new Set(found));
        }
      } catch {}

      // Get reviewer's display name
      let reviewerDisplayName = "HR Team";
      try {
        const { data: revEmp } = await (supabaseAdmin.from("employees") as any)
          .select("full_name, email")
          .eq("id", reviewerId)
          .maybeSingle();
        reviewerDisplayName = revEmp?.full_name || revEmp?.email || "HR Team";
      } catch {}

      const candidateFullName = candEmp?.full_name || profile.full_name || "New Employee";
      const candidateEmailAddr = candEmp?.email || profile.personal_email || "";
      const candidatePhoneNum = profile.phone || "";
      const formattedEmpId = candEmp?.id
        ? `EMP-${candEmp.id.slice(0, 6).toUpperCase()}`
        : `EMP-${userId.slice(0, 6).toUpperCase()}`;
      const departmentNameStr = candEmp?.departments?.name || "General";
      const jobTitleStr = candEmp?.job_titles?.title_name || "Employee";

      // Download uploaded candidate documents to attach directly to the email
      const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
      const documentLinks: Array<{ name: string; url?: string }> = [];

      for (const doc of uploadedDocs) {
        let signedUrl = "";
        try {
          signedUrl = await getSignedUrl(doc.storage_path, 7 * 86400); // 7-day valid preview link
        } catch {}

        documentLinks.push({
          name: doc.document_name || doc.file_name,
          url: signedUrl || undefined,
        });

        try {
          const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
            .from("onboarding-docs")
            .download(doc.storage_path);

          if (fileBlob && !dlErr) {
            const arrayBuf = await fileBlob.arrayBuffer();
            attachments.push({
              filename: doc.file_name,
              content: Buffer.from(arrayBuf),
              contentType: doc.mime_type || "application/octet-stream",
            });
          }
        } catch (dlErr) {
          console.warn(`[Admin Dossier] Error downloading doc ${doc.file_name}:`, dlErr);
        }
      }

      // Dispatch dossier email to admin account(s)
      for (const targetAdminEmail of adminEmails) {
        const res = await sendAdminOnboardingDossierEmail({
          to: targetAdminEmail,
          candidateName: candidateFullName,
          candidateEmail: candidateEmailAddr,
          candidatePhone: candidatePhoneNum,
          employeeId: formattedEmpId,
          departmentName: departmentNameStr,
          jobTitle: jobTitleStr,
          reviewedByName: reviewerDisplayName,
          approvedAt: nowIso,
          candidateUserId: userId,
          documents: documentLinks,
          attachments,
        });

        if (res.success) {
          adminDossierSent = true;
        } else {
          console.warn(`[Admin Dossier] Failed to deliver to ${targetAdminEmail}:`, res.error);
        }
      }
    } catch (dossierErr) {
      console.error("[Admin Dossier Error]:", dossierErr);
    }

    return NextResponse.json({
      success: true,
      message: "Employee onboarding approved and activated successfully.",
      onboarding_status: "COMPLETED",
      emailSent,
      adminDossierSent,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to approve onboarding." },
      { status: 500 }
    );
  }
}

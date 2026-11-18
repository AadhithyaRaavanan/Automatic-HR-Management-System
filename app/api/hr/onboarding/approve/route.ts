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

    // Check candidate role hierarchy:
    // If candidate is HR, ONLY an Admin can approve! For employee & manager, HR or Admin can approve.
    const reviewerRole = authResult.context.role;
    let candidateRole = "employee";
    try {
      const { data: memberData } = await (supabaseAdmin as any)
        .from("organization_members")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();
      if (memberData?.role) {
        candidateRole = memberData.role.toLowerCase();
      } else {
        const { data: candAuth } = await supabaseAdmin.auth.admin.getUserById(userId);
        candidateRole = (
          candAuth?.user?.app_metadata?.user_role ||
          candAuth?.user?.user_metadata?.role ||
          "employee"
        ).toLowerCase();
      }
    } catch {}

    if (candidateRole === "hr" && reviewerRole !== "admin") {
      return NextResponse.json(
        { error: "HR onboarding profiles can only be approved by an Admin." },
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
    // Preserve existing shift_start_time, shift_end_time, and timezone assigned during employee creation
    const { data: existingEmp } = await (supabaseAdmin as any)
      .from("employees")
      .select("shift_start_time, shift_end_time, timezone")
      .eq("id", userId)
      .maybeSingle();

    const empUpdatePayload: Record<string, any> = {
      status: "active",
      onboarding_completed: true,
      updated_at: nowIso,
    };
    if (!existingEmp?.shift_start_time) {
      empUpdatePayload.shift_start_time = "09:00:00";
    }
    if (!existingEmp?.shift_end_time) {
      empUpdatePayload.shift_end_time = "17:00:00";
    }
    if (!existingEmp?.timezone) {
      empUpdatePayload.timezone = "Asia/Kolkata";
    }

    const memUpdatePayload: Record<string, any> = {
      status: "active",
      updated_at: nowIso,
    };
    if (existingEmp?.shift_start_time) {
      memUpdatePayload.shift_start_time = existingEmp.shift_start_time;
    }
    if (existingEmp?.shift_end_time) {
      memUpdatePayload.shift_end_time = existingEmp.shift_end_time;
    }

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
        .update(empUpdatePayload)
        .eq("id", userId),
      (supabaseAdmin as any)
        .from("organization_members")
        .update(memUpdatePayload)
        .eq("user_id", userId),
      supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: {
          onboarding_approved: true,
        },
        user_metadata: {
          onboarding_completed: true,
          onboarding_status: "COMPLETED",
          must_change_password: true,
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

    // 7. Background Tasks: Send ONE transactional welcome email to employee & Admin Dossier asynchronously
    // so the approval endpoint responds instantly (< 100ms) without keeping the reviewer waiting.
    (async () => {
      try {
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
                try {
                  await (supabaseAdmin as any)
                    .from("onboarding_profiles")
                    .update({ approval_email_sent_at: nowIso })
                    .eq("user_id", userId);
                } catch {}
              }
            } catch (emailErr) {
              console.error("[Onboarding Approval Email Error]:", emailErr);
            }
          }
        }
      } catch (err) {
        console.warn("[Background approval email error]:", err);
      }
    })().catch(() => {});

    // 8. Admin Dossier Email & Storage Purge: Dispatched asynchronously in background
    // so the approval endpoint responds instantly (< 300ms) without keeping the reviewer waiting.
    (async () => {
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

        let adminDossierSent = false;
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

        // 9. Post-Approval Storage Purge: Now that files have been attached & dispatched to Admin email,
        // purge the binary files from Supabase Storage so zero storage space is consumed in Supabase.
        if (adminDossierSent && attachments.length > 0) {
          try {
            const pathsToRemove = uploadedDocs
              .map((d: any) => d.storage_path)
              .filter(Boolean);

            if (pathsToRemove.length > 0) {
              console.log(`[Admin Dossier] Purging ${pathsToRemove.length} storage files from Supabase onboarding-docs...`);
              const { error: removeErr } = await supabaseAdmin.storage
                .from("onboarding-docs")
                .remove(pathsToRemove);

              if (removeErr) {
                console.warn("[Admin Dossier] Storage removal warning:", removeErr);
              } else {
                console.log("[Admin Dossier] Successfully purged documents from Supabase Storage.");
              }
            }
          } catch (purgeErr) {
            console.warn("[Admin Dossier] Storage purge error:", purgeErr);
          }
        }
      } catch (dossierErr) {
        console.error("[Admin Dossier Background Error]:", dossierErr);
      }
    })().catch(() => {});

    return NextResponse.json({
      success: true,
      message: "Employee onboarding approved and activated successfully.",
      onboarding_status: "COMPLETED",
      emailSent: true,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to approve onboarding." },
      { status: 500 }
    );
  }
}

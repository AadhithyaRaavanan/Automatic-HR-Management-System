import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/notify";
import { QUALIFICATION_DOC_MAP, HighestQualification } from "@/lib/onboarding-types";

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

    // Verify all mandatory document types are present and approved
    // Mandatory: PAN + Bank Proof + Highest Qualification Certificate
    const highestQual = (profile.highest_qualification || "Undergraduate Degree") as HighestQualification;
    const requiredQualDocType = QUALIFICATION_DOC_MAP[highestQual]?.docType || "cert_undergraduate";

    const panDoc = uploadedDocs.find((d: any) => d.doc_type === "pan_card");
    const bankDoc = uploadedDocs.find((d: any) => d.doc_type === "bank_proof");
    const qualDoc = uploadedDocs.find((d: any) => d.doc_type === requiredQualDocType);
    const photoDoc = uploadedDocs.find((d: any) => d.doc_type === "photo");
    const resumeDoc = uploadedDocs.find((d: any) => d.doc_type === "resume");

    if (photoDoc && photoDoc.document_status !== "approved") {
      return NextResponse.json(
        { error: "Cannot complete approval: Passport-size photo is not yet approved." },
        { status: 400 }
      );
    }

    if (resumeDoc && resumeDoc.document_status !== "approved") {
      return NextResponse.json(
        { error: "Cannot complete approval: Candidate resume is not yet approved." },
        { status: 400 }
      );
    }

    if (!panDoc || panDoc.document_status !== "approved") {
      return NextResponse.json(
        { error: "Cannot complete approval: PAN card document is either missing or has not been approved." },
        { status: 400 }
      );
    }

    if (!bankDoc || bankDoc.document_status !== "approved") {
      return NextResponse.json(
        { error: "Cannot complete approval: Bank proof document is either missing or has not been approved." },
        { status: 400 }
      );
    }

    if (!qualDoc || qualDoc.document_status !== "approved") {
      return NextResponse.json(
        { error: `Cannot complete approval: Highest qualification certificate (${QUALIFICATION_DOC_MAP[highestQual]?.label || "Degree Certificate"}) is not yet approved.` },
        { status: 400 }
      );
    }

    if (profile.has_experience) {
      const expDoc = uploadedDocs.find((d: any) => d.doc_type === "experience_cert");
      const hasExplanation = Boolean(profile.experience_explanation?.trim());
      if (!hasExplanation && (!expDoc || expDoc.document_status !== "approved")) {
        return NextResponse.json(
          { error: "Cannot complete approval: Experience certificate has not been approved." },
          { status: 400 }
        );
      }
    }

    // Ensure no document is in rejected state
    const hasRejectedDocs = uploadedDocs.some((d: any) => d.document_status === "rejected");
    if (hasRejectedDocs) {
      return NextResponse.json(
        { error: "Cannot complete approval: There are rejected documents that need candidate correction first." },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    // 3. Update onboarding_profiles to COMPLETED / VERIFIED
    await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .update({
        onboarding_status: "COMPLETED",
        status: "approved",
        verified_by: reviewerId,
        verified_at: nowIso,
        completed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("user_id", userId);

    // 4. Update profiles and employees onboarding_completed = true
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
          onboarding_completed: true,
          updated_at: nowIso,
        })
        .eq("id", userId),
      supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          onboarding_completed: true,
        },
      }),
    ]);

    // 5. Audit Log
    try {
      await (supabaseAdmin as any).from("employee_onboarding_audit").insert({
        employee_id: userId,
        action: "ONBOARDING_APPROVED_AND_COMPLETED",
        performed_by: reviewerId,
        previous_status: profile.onboarding_status || "SUBMITTED",
        new_status: "COMPLETED",
        remarks: note?.trim() || "HR Admin completed document verification and activated employee profile.",
      });
    } catch {}

    // 6. In-App + Email Notification to Employee
    try {
      await notify({
        userIds: [userId],
        type: "onboarding_approved",
        typeGroup: "onboarding",
        title: "Welcome Aboard – Onboarding Approved!",
        body: "Your submitted documents have been fully verified and your profile is approved. You now have full access to your workplace dashboard.",
        link: "/",
        entityType: "onboarding_profiles",
        entityId: userId,
        actorId: reviewerId,
      });
    } catch (notifErr) {
      console.warn("[Onboarding Approval Notification Error]:", notifErr);
    }

    return NextResponse.json({
      success: true,
      message: "Employee onboarding approved and activated successfully.",
      onboarding_status: "COMPLETED",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to approve onboarding." },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/notify";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  const reviewerId = authResult.context.userId;

  try {
    const body = await request.json().catch(() => ({}));
    const { documentId, action, rejectionReason } = body;

    if (!documentId || !action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid payload. 'documentId' and valid 'action' ('approve' | 'reject') are required." },
        { status: 400 }
      );
    }

    if (action === "reject" && (!rejectionReason || rejectionReason.trim().length < 5)) {
      return NextResponse.json(
        { error: "A feedback note (min 5 characters) is required when rejecting a document." },
        { status: 400 }
      );
    }

    // 1. Fetch document record
    const { data: doc, error: fetchErr } = await (supabaseAdmin as any)
      .from("onboarding_documents")
      .select("*")
      .eq("id", documentId)
      .maybeSingle();

    if (fetchErr || !doc) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    // Block modifying documents if candidate profile is already approved
    const { data: profile } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("status")
      .eq("user_id", doc.user_id)
      .maybeSingle();

    if (profile?.status === "approved") {
      return NextResponse.json(
        { error: "Cannot modify documents for an already approved onboarding profile." },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const newStatus = action === "approve" ? "approved" : "rejected";

    // 2. Update document status
    await (supabaseAdmin as any)
      .from("onboarding_documents")
      .update({
        document_status: newStatus,
        rejection_reason: action === "reject" ? rejectionReason.trim() : null,
        reviewed_by: reviewerId,
        reviewed_at: nowIso,
      })
      .eq("id", documentId);

    // 3. If rejected, update candidate's onboarding status to changes_requested / CORRECTION_REQUIRED and notify them
    if (action === "reject") {
      await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .update({
          onboarding_status: "CORRECTION_REQUIRED",
          status: "changes_requested",
          updated_at: nowIso,
        })
        .eq("user_id", doc.user_id);

      // Audit Log
      try {
        await (supabaseAdmin as any).from("employee_onboarding_audit").insert({
          employee_id: doc.user_id,
          action: "DOCUMENT_REJECTED",
          performed_by: reviewerId,
          previous_status: "SUBMITTED",
          new_status: "CORRECTION_REQUIRED",
          remarks: `Document '${doc.file_name}' rejected: ${rejectionReason.trim()}`,
        });
      } catch {}

      // In-app notification to the employee
      try {
        await notify({
          userIds: [doc.user_id],
          type: "onboarding_doc_rejected",
          typeGroup: "onboarding",
          title: "Document Correction Required",
          body: `Your document '${doc.document_name || doc.file_name}' requires attention.\nFeedback: ${rejectionReason.trim()}\nPlease upload the corrected file.`,
          link: "/onboarding",
          entityType: "onboarding_documents",
          entityId: documentId,
          actorId: reviewerId,
        });
      } catch (notifErr) {
        console.warn("[Document Rejection Notification Error]:", notifErr);
      }
    } else {
      // Document Approved
      try {
        await (supabaseAdmin as any).from("employee_onboarding_audit").insert({
          employee_id: doc.user_id,
          action: "DOCUMENT_APPROVED",
          performed_by: reviewerId,
          previous_status: "SUBMITTED",
          new_status: "UNDER_REVIEW",
          remarks: `Document '${doc.file_name}' approved by reviewer.`,
        });
      } catch {}

      try {
        await notify({
          userIds: [doc.user_id],
          type: "onboarding_doc_approved",
          typeGroup: "onboarding",
          title: "Document Verified",
          body: `Your document '${doc.document_name || doc.file_name}' has been verified and approved.`,
          link: "/onboarding",
          entityType: "onboarding_documents",
          entityId: documentId,
          actorId: reviewerId,
        });
      } catch (notifErr) {
        console.warn("[Document Approval Notification Error]:", notifErr);
      }

      // Update onboarding status to UNDER_REVIEW if currently SUBMITTED/RESUBMITTED
      const { data: prof } = await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .select("onboarding_status")
        .eq("user_id", doc.user_id)
        .maybeSingle();

      if (["SUBMITTED", "RESUBMITTED"].includes(prof?.onboarding_status)) {
        await (supabaseAdmin as any)
          .from("onboarding_profiles")
          .update({
            onboarding_status: "UNDER_REVIEW",
            updated_at: nowIso,
          })
          .eq("user_id", doc.user_id);
      }
    }

    return NextResponse.json({
      success: true,
      document_status: newStatus,
      rejection_reason: action === "reject" ? rejectionReason.trim() : null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to verify document." },
      { status: 500 }
    );
  }
}

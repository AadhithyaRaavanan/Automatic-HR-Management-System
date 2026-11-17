import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

    if (action === "reject" && (!rejectionReason || !rejectionReason.trim())) {
      return NextResponse.json(
        { error: "A rejection reason is mandatory when rejecting a document." },
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

    // 3. If rejected, update candidate's onboarding status to CORRECTION_REQUIRED and notify them
    if (action === "reject") {
      await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .update({
          onboarding_status: "CORRECTION_REQUIRED",
          status: "rejected",
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
        const { data: empRecord } = await (supabaseAdmin.from("employees") as any)
          .select("organization_id")
          .eq("id", doc.user_id)
          .maybeSingle();

        await (supabaseAdmin as any).from("notifications").insert({
          organization_id: empRecord?.organization_id,
          user_id: doc.user_id,
          type: "onboarding_status",
          title: "ONBOARDING DOCUMENT CORRECTION REQUIRED",
          body: `Your document '${doc.document_name || doc.file_name}' requires correction.\nReason: ${rejectionReason.trim()}\nPlease upload the corrected document.`,
          link: "/onboarding",
          created_at: nowIso,
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

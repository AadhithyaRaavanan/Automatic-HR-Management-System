import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { verifyTargetEmployeeInOrg } from "@/features/auth/tenant-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/features/notifications/notify";

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
      return NextResponse.json(
        { error: "Missing required parameter 'userId'." },
        { status: 400 }
      );
    }

    if (!note || note.trim().length < 5) {
      return NextResponse.json(
        { error: "A note with at least 5 characters is required to request changes." },
        { status: 400 }
      );
    }

    const trimmedNote = note.trim();

    const targetCheck = await verifyTargetEmployeeInOrg(authResult.context, userId, { allowSelf: false });
    if (!targetCheck.allowed) {
      return NextResponse.json(
        { error: "Forbidden: Candidate does not belong to your organization." },
        { status: 403 }
      );
    }

    const orgId = authResult.context.organizationId;

    // 1. Fetch candidate profile (scoped to active organization)
    const { data: profile, error: profErr } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (profErr || !profile) {
      return NextResponse.json({ error: "Onboarding profile not found." }, { status: 404 });
    }

    if (profile.status === "approved") {
      return NextResponse.json(
        { error: "Cannot request changes for an already approved onboarding profile." },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    // 2. Update status to changes_requested
    const { error: reqUpdErr } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .update({
        status: "changes_requested",
        updated_at: nowIso,
      })
      .eq("user_id", userId)
      .eq("organization_id", orgId);

    if (reqUpdErr) {
      return NextResponse.json({ error: reqUpdErr.message }, { status: 500 });
    }

    // 3. Durable Audit Log
    const { error: auditErr } = await (supabaseAdmin as any).from("employee_onboarding_audit").insert({
      organization_id: orgId,
      employee_id: userId,
      action: "ONBOARDING_CHANGES_REQUESTED",
      performed_by: reviewerId,
      previous_status: profile.status || "submitted",
      new_status: "changes_requested",
      remarks: trimmedNote,
    });
    if (auditErr) {
      return NextResponse.json({ error: `Failed to record onboarding audit: ${auditErr.message}` }, { status: 500 });
    }

    // 4. In-App Notification to Candidate (never include sensitive bank/id details)
    try {
      await notify({
        userIds: [userId],
        organizationId: orgId,
        type: "onboarding_status",
        typeGroup: "onboarding",
        title: "Changes Requested on Onboarding Documents",
        body: `HR reviewed your onboarding submission and requested changes: ${trimmedNote}`,
        link: "/onboarding/pending",
        entityType: "onboarding_profiles",
        entityId: userId,
        actorId: reviewerId,
      });
    } catch (notifErr) {
      console.warn("[Onboarding Request Changes Notification Error]:", notifErr);
    }

    return NextResponse.json({
      success: true,
      message: "Onboarding changes requested successfully.",
      status: "changes_requested",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to request changes." },
      { status: 500 }
    );
  }
}

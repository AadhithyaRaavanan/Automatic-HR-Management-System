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

    // 1. Fetch candidate profile
    const { data: profile, error: profErr } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", userId)
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
    await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .update({
        status: "changes_requested",
        updated_at: nowIso,
      })
      .eq("user_id", userId);

    // 3. Audit Log
    try {
      await (supabaseAdmin as any).from("employee_onboarding_audit").insert({
        employee_id: userId,
        action: "ONBOARDING_CHANGES_REQUESTED",
        performed_by: reviewerId,
        previous_status: profile.status || "submitted",
        new_status: "changes_requested",
        remarks: trimmedNote,
      });
    } catch {}

    // 4. In-App Notification to Candidate (never include sensitive bank/id details)
    try {
      await notify({
        userIds: [userId],
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

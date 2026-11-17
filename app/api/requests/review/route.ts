import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/notify";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    let response = NextResponse.next();
    const authHeader = request.headers.get("authorization");
    let user: any = null;

    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      const { data: authData, error: tokenErr } = await supabaseAdmin.auth.getUser(token);
      if (!tokenErr && authData?.user) {
        user = authData.user;
      }
    }

    if (!user) {
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

      const { data: authData } = await supabase.auth.getUser();
      user = authData?.user;
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { requestId, action, reviewNote } = body;

    if (!requestId || !action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid review request payload. Action must be 'approve' or 'reject'." },
        { status: 400 }
      );
    }

    const trimmedNote = typeof reviewNote === "string" ? reviewNote.trim() : "";
    if (!trimmedNote || trimmedNote.length < 5) {
      return NextResponse.json(
        { error: "A decision note of at least 5 characters is strictly required." },
        { status: 400 }
      );
    }

    // Fetch regularization request
    const { data: regReq, error: fetchErr } = await (supabaseAdmin.from("regularization_requests") as any)
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (fetchErr || !regReq) {
      return NextResponse.json({ error: "Regularization request not found." }, { status: 404 });
    }

    if (regReq.employee_id === user.id) {
      return NextResponse.json(
        { error: "Separation of duties: You cannot approve or reject your own request." },
        { status: 403 }
      );
    }

    // Role-based review permission scoping
    const { data: member } = await (supabaseAdmin.from("organization_members") as any)
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const callerRole = member?.role || "employee";
    if (callerRole === "employee") {
      return NextResponse.json(
        { error: "Forbidden: Employees cannot review regularization requests." },
        { status: 403 }
      );
    }

    if (callerRole === "manager") {
      const { data: empRecord } = await (supabaseAdmin.from("employees") as any)
        .select("manager_id")
        .eq("id", regReq.employee_id)
        .maybeSingle();

      if (!empRecord || empRecord.manager_id !== user.id) {
        return NextResponse.json(
          { error: "Forbidden: Managers can only review requests for their direct reports." },
          { status: 403 }
        );
      }
    }

    const nowIso = new Date().toISOString();
    const targetStatus = action === "approve" ? "approved" : "rejected";

    // Update regularization request
    const { error: updateErr } = await (supabaseAdmin.from("regularization_requests") as any)
      .update({
        status: targetStatus,
        review_note: trimmedNote,
        reviewed_by: user.id,
        reviewed_at: nowIso,
      })
      .eq("id", requestId);

    if (updateErr) {
      return NextResponse.json(
        { error: `Failed to update request: ${updateErr.message}` },
        { status: 500 }
      );
    }

    // If approved, update attendance_sessions / attendance_days if needed
    if (action === "approve") {
      try {
        await (supabaseAdmin.from("attendance_days") as any)
          .upsert({
            employee_id: regReq.employee_id,
            work_date: regReq.work_date,
            status: "present",
            total_minutes: 480,
            updated_at: nowIso,
          });
      } catch (attErr) {
        console.warn("[Attendance Session Update via Regularization]:", attErr);
      }
    }

    // Write audit log
    const orgId = regReq.organization_id || regReq.employees?.organization_id;
    if (orgId) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: orgId,
        actor_id: user.id,
        action: action === "approve" ? "REGULARIZATION_APPROVED" : "REGULARIZATION_REJECTED",
        table_name: "regularization_requests",
        record_id: requestId,
        old_data: { status: regReq.status },
        new_data: {
          status: targetStatus,
          review_note: trimmedNote,
          reviewed_by: user.id,
          reviewed_at: nowIso,
        },
      });
    }

    // Trigger Notification to Employee
    try {
      await notify({
        userIds: [regReq.employee_id],
        type: targetStatus === "approved" ? "request_approved" : "request_rejected",
        typeGroup: "requests",
        title: targetStatus === "approved" ? "Attendance Regularization Approved" : "Attendance Regularization Rejected",
        body: `Your attendance regularization for ${regReq.work_date || "date"} has been ${targetStatus}.\nReviewer note: "${trimmedNote}"`,
        link: "/requests",
        entityType: "regularization_requests",
        entityId: requestId,
        actorId: user.id,
      });
    } catch (notifErr) {
      console.warn("[Regularization Review Notification Error]:", notifErr);
    }

    return NextResponse.json({
      success: true,
      status: targetStatus,
      review_note: trimmedNote,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error during regularization review." },
      { status: 500 }
    );
  }
}

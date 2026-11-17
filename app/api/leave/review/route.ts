import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

    // Fetch the leave request
    const { data: leaveReq, error: fetchErr } = await (supabaseAdmin.from("leave_requests") as any)
      .select("*, employees(full_name, organization_id)")
      .eq("id", requestId)
      .maybeSingle();

    if (fetchErr || !leaveReq) {
      return NextResponse.json({ error: "Leave request not found." }, { status: 404 });
    }

    if (leaveReq.employee_id === user.id) {
      return NextResponse.json(
        { error: "Separation of duties: You cannot approve or reject your own leave request." },
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
        { error: "Forbidden: Employees cannot review leave requests." },
        { status: 403 }
      );
    }

    if (callerRole === "manager") {
      const { data: empRecord } = await (supabaseAdmin.from("employees") as any)
        .select("manager_id")
        .eq("id", leaveReq.employee_id)
        .maybeSingle();

      if (!empRecord || empRecord.manager_id !== user.id) {
        return NextResponse.json(
          { error: "Forbidden: Managers can only review leave requests for their direct reports." },
          { status: 403 }
        );
      }
    }

    const nowIso = new Date().toISOString();
    const targetStatus = action === "approve" ? "approved" : "rejected";

    // Update leave request
    const { error: updateErr } = await (supabaseAdmin.from("leave_requests") as any)
      .update({
        status: targetStatus,
        review_note: trimmedNote,
        reviewed_by: user.id,
        reviewed_at: nowIso,
      })
      .eq("id", requestId);

    if (updateErr) {
      return NextResponse.json(
        { error: `Failed to update leave request: ${updateErr.message}` },
        { status: 500 }
      );
    }

    // If approved, deduct balance
    if (action === "approve") {
      try {
        const { data: balance } = await (supabaseAdmin.from("leave_balances") as any)
          .select("used")
          .eq("employee_id", leaveReq.employee_id)
          .eq("leave_type_id", leaveReq.leave_type_id)
          .maybeSingle();

        if (balance) {
          const newUsed = Number(balance.used || 0) + Number(leaveReq.total_days);
          await (supabaseAdmin.from("leave_balances") as any)
            .update({
              used: newUsed,
              updated_at: nowIso,
            })
            .eq("employee_id", leaveReq.employee_id)
            .eq("leave_type_id", leaveReq.leave_type_id);
        }
      } catch (balErr) {
        console.warn("[Leave Review Balance Update]:", balErr);
      }
    }

    // Write audit log
    const orgId = leaveReq.organization_id || leaveReq.employees?.organization_id;
    if (orgId) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: orgId,
        actor_id: user.id,
        action: action === "approve" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
        table_name: "leave_requests",
        record_id: requestId,
        old_data: { status: leaveReq.status },
        new_data: {
          status: targetStatus,
          review_note: trimmedNote,
          reviewed_by: user.id,
          reviewed_at: nowIso,
        },
      });
    }

    return NextResponse.json({
      success: true,
      status: targetStatus,
      review_note: trimmedNote,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error during leave review." },
      { status: 500 }
    );
  }
}

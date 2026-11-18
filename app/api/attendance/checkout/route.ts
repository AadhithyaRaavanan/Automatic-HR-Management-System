import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkIdempotency, recordIdempotency } from "@/lib/api/idempotency";
import { evaluateEarlyCheckout } from "@/lib/date/timezone";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }
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

    const idempotencyKey = request.headers.get("idempotency-key");
    const cachedResponse = await checkIdempotency(idempotencyKey, user.id, "/api/attendance/checkout");
    if (cachedResponse) {
      return cachedResponse;
    }

    let body: { confirm_early?: boolean; reason?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Empty or non-JSON body is valid
      body = {};
    }

    // 1. Fetch active session
    const { data: activeSession, error: sessionErr } = await (supabaseAdmin as any)
      .from("attendance_sessions")
      .select("id, employee_id, check_in_at, work_date, organization_id, note")
      .eq("employee_id", user.id)
      .is("check_out_at", null)
      .order("check_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionErr || !activeSession) {
      return NextResponse.json(
        { error: "No active session found to check out", code: "NO_ACTIVE_SESSION" },
        { status: 400 }
      );
    }

    // 2. Fetch employee shift settings
    const { data: emp } = await (supabaseAdmin as any)
      .from("employees")
      .select("shift_start_time, shift_end_time, timezone")
      .eq("id", user.id)
      .maybeSingle();

    const shiftStartTime = emp?.shift_start_time || "09:00:00";
    const shiftEndTime = emp?.shift_end_time || "17:00:00";
    const timezone = emp?.timezone || "Asia/Kolkata";

    // 3. Evaluate early checkout
    const earlyEval = evaluateEarlyCheckout(
      activeSession.check_in_at,
      shiftStartTime,
      shiftEndTime,
      timezone,
      new Date()
    );

    // 4. Server-side guard: Return 409 if checking out early without explicit confirmation
    if (earlyEval.isEarly && body.confirm_early !== true) {
      return NextResponse.json(
        {
          error: "EARLY_CHECKOUT",
          code: "EARLY_CHECKOUT",
          shift_end_time: earlyEval.shiftEndTimeFormatted,
          minutes_early: earlyEval.minutesEarly,
          formatted_early: earlyEval.formattedEarly,
          message: earlyEval.dialogMessage,
        },
        { status: 409 }
      );
    }

    // 5. Check out the session
    const nowIso = new Date().toISOString();
    const isEarlyCheckout = earlyEval.isEarly;
    const reason = body.reason?.trim() || null;

    let updatedNote = activeSession.note || "";
    if (isEarlyCheckout) {
      const earlyPayload = JSON.stringify({
        early_checkout: true,
        early_checkout_reason: reason,
        minutes_early: earlyEval.minutesEarly,
      });
      updatedNote = updatedNote ? `${updatedNote} [EARLY_CHECKOUT: ${earlyPayload}]` : earlyPayload;
    }

    // Attempt updating with early_checkout columns; fallback to note if columns don't exist
    const updatePayload: Record<string, any> = {
      check_out_at: nowIso,
      note: updatedNote,
    };
    if (isEarlyCheckout) {
      updatePayload.early_checkout = true;
      if (reason) updatePayload.early_checkout_reason = reason;
    }

    let { error: updateErr } = await (supabaseAdmin as any)
      .from("attendance_sessions")
      .update(updatePayload)
      .eq("id", activeSession.id);

    if (
      updateErr &&
      (updateErr.code === "PGRST204" ||
        updateErr.code === "42703" ||
        updateErr.message?.includes("early_checkout"))
    ) {
      // Column does not exist on remote schema yet: update without those columns
      const fallbackPayload = {
        check_out_at: nowIso,
        note: updatedNote,
      };
      const fallbackResult = await (supabaseAdmin as any)
        .from("attendance_sessions")
        .update(fallbackPayload)
        .eq("id", activeSession.id);
      updateErr = fallbackResult.error;
    }

    if (updateErr) {
      return NextResponse.json(
        { error: updateErr.message || "Failed to update attendance session" },
        { status: 500 }
      );
    }

    // Recalculate attendance day
    try {
      await (supabaseAdmin.rpc as any)("recalculate_day", {
        p_employee_id: user.id,
        p_work_date: activeSession.work_date,
      });
    } catch {
      // Ignore if RPC fails or not present
    }

    // Insert audit log
    try {
      await (supabaseAdmin as any).from("audit_logs").insert({
        organization_id: activeSession.organization_id,
        actor_id: user.id,
        action: "ATTENDANCE_CHECKED_OUT",
        table_name: "attendance_sessions",
        record_id: activeSession.id,
        new_data: {
          check_out_at: nowIso,
          early_checkout: isEarlyCheckout,
          early_checkout_reason: reason,
        },
      });
    } catch {
      // Ignore audit log error
    }

    // Calculate duration
    const startMs = new Date(activeSession.check_in_at).getTime();
    const endMs = new Date(nowIso).getTime();
    const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));

    const resultData = {
      success: true,
      session_id: activeSession.id,
      work_date: activeSession.work_date,
      duration_minutes: durationMinutes,
      early_checkout: isEarlyCheckout,
      early_checkout_reason: reason,
    };

    if (idempotencyKey) {
      await recordIdempotency(idempotencyKey, user.id, "/api/attendance/checkout", resultData);
    }

    return NextResponse.json(resultData);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}

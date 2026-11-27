import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { getAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { checkIdempotency, recordIdempotency } from "@/lib/api/idempotency";
import { evaluateEarlyCheckout } from "@/lib/date/timezone";
import { requireApprovedUser } from "@/features/auth/require-approved-user";
import {
  formatShortfallSummary,
  notifyAdminsOfEarlyCheckout,
} from "@/features/attendance/early-checkout-alert";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }

  const adminClient: any = isSupabaseAdminConfigured()
    ? getAdminClient()
    : approvedCheck.supabase;

  try {
    let response = NextResponse.next();
    const authHeader = request.headers.get("authorization");
    let user: any = approvedCheck.user || null;

    if (!user && authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      const { data: authData, error: tokenErr } = await adminClient.auth.getUser(token);
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
      body = {};
    }

    // 1. Fetch active session
    const { data: activeSession, error: sessionErr } = await adminClient
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

    // 2. Fetch employee profile, shift target, and existing day sessions in parallel
    const [empResult, memberResult, daySessionsResult] = await Promise.all([
      (async () => {
        const ext = await adminClient
          .from("employees")
          .select(
            "id, full_name, email, employee_number, department_id, organization_id, work_target_minutes, shift_start_time, shift_end_time, timezone, departments:department_id(name)"
          )
          .eq("id", user.id)
          .maybeSingle();
        if (!ext?.error) return ext;
        return await adminClient
          .from("employees")
          .select("id, full_name, email, work_target_minutes, timezone")
          .eq("id", user.id)
          .maybeSingle();
      })(),
      (async () => {
        try {
          const res = await adminClient
            .from("organization_members")
            .select("organization_id, shift_start_time, shift_end_time")
            .eq("user_id", user.id)
            .maybeSingle();
          return res?.error ? { data: null } : res;
        } catch {
          return { data: null };
        }
      })(),
      adminClient
        .from("attendance_sessions")
        .select("id, check_in_at, check_out_at")
        .eq("employee_id", user.id)
        .eq("work_date", activeSession.work_date),
    ]);

    const emp = empResult?.data || null;
    const member = memberResult?.data || null;
    const shiftStartTime = emp?.shift_start_time || member?.shift_start_time || "09:00:00";
    const shiftEndTime = emp?.shift_end_time || member?.shift_end_time || "17:00:00";
    const timezone = emp?.timezone && emp.timezone !== "UTC" ? emp.timezone : "Asia/Kolkata";
    const targetMinutes =
      Number(emp?.work_target_minutes) > 0 ? Number(emp.work_target_minutes) : 480;
    const organizationId =
      activeSession.organization_id || emp?.organization_id || member?.organization_id || null;

    const nowDate = new Date();
    const nowIso = nowDate.toISOString();

    // Compute active session duration + total worked duration for the day
    const startMs = new Date(activeSession.check_in_at).getTime();
    const endMs = nowDate.getTime();
    const sessionDurationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));

    let priorClosedMinutes = 0;
    for (const s of daySessionsResult?.data || []) {
      if (!s || s.id === activeSession.id || !s.check_in_at || !s.check_out_at) continue;
      const inMs = new Date(s.check_in_at).getTime();
      const outMs = new Date(s.check_out_at).getTime();
      if (!isNaN(inMs) && !isNaN(outMs) && outMs > inMs) {
        priorClosedMinutes += Math.round((outMs - inMs) / 60000);
      }
    }
    const totalWorkedMinutes = priorClosedMinutes + sessionDurationMinutes;

    // 3. Evaluate early checkout against shift end time AND shift target hours (default 8h = 480m)
    const earlyEval = evaluateEarlyCheckout(
      activeSession.check_in_at,
      shiftStartTime,
      shiftEndTime,
      timezone,
      nowDate
    );

    const isUnderTarget = totalWorkedMinutes < targetMinutes;
    const isEarlyCheckout = earlyEval.isEarly || isUnderTarget;
    const shortfall = formatShortfallSummary(totalWorkedMinutes, targetMinutes);
    const effectiveMinutesEarly = earlyEval.isEarly
      ? earlyEval.minutesEarly
      : shortfall.shortfallMinutes;

    // 4. Server-side guard: Return 409 if checking out early without explicit confirmation
    if (isEarlyCheckout && body.confirm_early !== true) {
      const earlyH = Math.floor(effectiveMinutesEarly / 60);
      const earlyM = effectiveMinutesEarly % 60;
      const formattedEarly = earlyEval.isEarly ? earlyEval.formattedEarly : `${earlyH} h ${earlyM} m`;
      const dialogMessage = earlyEval.isEarly
        ? earlyEval.dialogMessage
        : `You have worked ${shortfall.workedFormatted} of your ${shortfall.targetFormatted} target (${formattedEarly} early). Check out anyway?`;

      return NextResponse.json(
        {
          error: "EARLY_CHECKOUT",
          code: "EARLY_CHECKOUT",
          shift_end_time: earlyEval.shiftEndTimeFormatted,
          minutes_early: effectiveMinutesEarly,
          formatted_early: formattedEarly,
          worked_minutes: totalWorkedMinutes,
          target_minutes: targetMinutes,
          message: dialogMessage,
        },
        { status: 409 }
      );
    }

    // 5. Check out the session
    const reason = body.reason?.trim() || null;
    let updatedNote = activeSession.note || "";
    if (isEarlyCheckout) {
      const earlyPayload = JSON.stringify({
        early_checkout: true,
        early_checkout_reason: reason,
        minutes_early: effectiveMinutesEarly,
        worked_minutes: totalWorkedMinutes,
        target_minutes: targetMinutes,
      });
      updatedNote = updatedNote ? `${updatedNote} [EARLY_CHECKOUT: ${earlyPayload}]` : earlyPayload;
    }

    const updatePayload: Record<string, any> = {
      check_out_at: nowIso,
      note: updatedNote,
    };
    if (isEarlyCheckout) {
      updatePayload.early_checkout = true;
      if (reason) updatePayload.early_checkout_reason = reason;
    }

    let { error: updateErr } = await adminClient
      .from("attendance_sessions")
      .update(updatePayload)
      .eq("id", activeSession.id);

    if (
      updateErr &&
      (updateErr.code === "PGRST204" ||
        updateErr.code === "42703" ||
        updateErr.message?.includes("early_checkout"))
    ) {
      const fallbackResult = await adminClient
        .from("attendance_sessions")
        .update({
          check_out_at: nowIso,
          note: updatedNote,
        })
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
      await adminClient.rpc("recalculate_day", {
        p_employee_id: user.id,
        p_work_date: activeSession.work_date,
      });
    } catch {}

    // Insert audit log
    try {
      await adminClient.from("audit_logs").insert({
        organization_id: organizationId,
        actor_id: user.id,
        action: "ATTENDANCE_CHECKED_OUT",
        table_name: "attendance_sessions",
        record_id: activeSession.id,
        new_data: {
          check_out_at: nowIso,
          early_checkout: isEarlyCheckout,
          early_checkout_reason: reason,
          worked_minutes: totalWorkedMinutes,
          target_minutes: targetMinutes,
          shortfall_minutes: shortfall.shortfallMinutes,
        },
      });
    } catch {}

    // 6. Notify all active organization Admins (in-app + email) on early sign-out
    let adminAlerts = { notifiedAdminCount: 0, emailedAdminCount: 0 };
    if (isEarlyCheckout) {
      try {
        const employeeName =
          emp?.full_name?.trim() ||
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split("@")[0] ||
          "Employee";

        adminAlerts = await notifyAdminsOfEarlyCheckout({
          adminClient,
          organizationId,
          sessionId: activeSession.id,
          employee: {
            id: user.id,
            fullName: employeeName,
            email: emp?.email || user.email || "",
            employeeNumber: emp?.employee_number || null,
            departmentName: emp?.departments?.name || null,
            timezone,
          },
          checkInAtIso: activeSession.check_in_at,
          checkOutAtIso: nowIso,
          workedMinutes: totalWorkedMinutes,
          targetMinutes,
          shortfallMinutes: shortfall.shortfallMinutes || effectiveMinutesEarly,
          reason,
        });
      } catch (alertErr: any) {
        console.error("[Checkout] Failed to dispatch early sign-out alerts:", alertErr?.message || alertErr);
      }
    }

    const resultData = {
      success: true,
      session_id: activeSession.id,
      work_date: activeSession.work_date,
      duration_minutes: sessionDurationMinutes,
      worked_minutes: totalWorkedMinutes,
      target_minutes: targetMinutes,
      shortfall_minutes: shortfall.shortfallMinutes,
      early_summary: isEarlyCheckout ? shortfall.summaryText : null,
      isEarlyCheckout,
      early_checkout: isEarlyCheckout,
      early_checkout_reason: reason,
      admin_alerts: adminAlerts,
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

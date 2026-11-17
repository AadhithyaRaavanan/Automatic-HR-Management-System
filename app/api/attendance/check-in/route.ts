import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { evaluatePreCheckInLock, getEmployeeWorkDate } from "@/lib/date/timezone";

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

    let body: { note?: string } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    // 1. Fetch employee shift settings and organization
    const [{ data: emp }, { data: member }] = await Promise.all([
      (supabaseAdmin as any)
        .from("employees")
        .select("id, organization_id, shift_start_time, shift_end_time, timezone")
        .eq("id", user.id)
        .maybeSingle(),
      (supabaseAdmin as any)
        .from("organization_members")
        .select("shift_start_time, shift_end_time")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle(),
    ]);

    const shiftStartTime = member?.shift_start_time || emp?.shift_start_time || "09:00:00";
    const shiftEndTime = member?.shift_end_time || emp?.shift_end_time || "17:00:00";
    const timezone = emp?.timezone || "Asia/Kolkata";

    // 2. Server-side guard: Evaluate shift time lock
    const lockStatus = evaluatePreCheckInLock(shiftStartTime, shiftEndTime, timezone, new Date());

    if (lockStatus.isLocked) {
      return NextResponse.json(
        {
          error: "OUTSIDE_SHIFT_HOURS",
          code: "OUTSIDE_SHIFT_HOURS",
          message:
            lockStatus.message ||
            `Check-in is not allowed outside your shift hours (${shiftStartTime.slice(0, 5)} - ${shiftEndTime.slice(0, 5)}).`,
          reason: lockStatus.reason,
          shift_start_time: shiftStartTime,
          shift_end_time: shiftEndTime,
          timezone,
          open_time: lockStatus.openTimeString,
        },
        { status: 403 }
      );
    }

    // 3. Check if an active open session already exists
    const { data: activeSession } = await (supabaseAdmin as any)
      .from("attendance_sessions")
      .select("id")
      .eq("employee_id", user.id)
      .is("check_out_at", null)
      .maybeSingle();

    if (activeSession) {
      return NextResponse.json(
        { error: "Active session already exists. Please check out first.", code: "ACTIVE_SESSION_EXISTS" },
        { status: 400 }
      );
    }

    // 4. Create new attendance session
    const effectiveWorkDate = getEmployeeWorkDate(timezone);
    const nowIso = new Date().toISOString();
    const orgId = emp?.organization_id || "00000000-0000-0000-0000-000000000001";

    const { data: session, error: insertErr } = await (supabaseAdmin as any)
      .from("attendance_sessions")
      .insert({
        organization_id: orgId,
        employee_id: user.id,
        work_date: effectiveWorkDate,
        check_in_at: nowIso,
        source: "web",
        note: body.note || null,
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json(
        { error: insertErr.message || "Failed to create attendance session" },
        { status: 500 }
      );
    }

    // Recalculate day
    try {
      await (supabaseAdmin.rpc as any)("recalculate_day", {
        p_employee_id: user.id,
        p_work_date: effectiveWorkDate,
      });
    } catch {}

    // Audit log
    try {
      await (supabaseAdmin as any).from("audit_logs").insert({
        organization_id: orgId,
        actor_id: user.id,
        action: "ATTENDANCE_CHECKED_IN",
        table_name: "attendance_sessions",
        record_id: session.id,
        new_data: {
          employee_id: user.id,
          work_date: effectiveWorkDate,
          check_in_at: nowIso,
          source: "web",
        },
      });
    } catch {}

    return NextResponse.json({
      success: true,
      session_id: session.id,
      check_in_at: session.check_in_at,
      work_date: effectiveWorkDate,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireApprovedUser } from "@/features/auth/require-approved-user";
import {
  DEFAULT_MAX_BREAK_MINUTES,
  parseNoteBreaks,
  serializeNoteBreaks,
} from "@/features/attendance/break-note";
import { resolveOrgMaxBreakMinutes } from "@/features/attendance/break-timeout";

export const dynamic = "force-dynamic";

export interface AttendanceBreakPayload {
  id: string;
  type: "short_break" | "lunch_break";
  startTime: string;
  endTime?: string | null;
  durationMinutes?: number;
  status: "active" | "completed";
}

// GET active/completed breaks for current user today
export async function GET(request: NextRequest) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }
  try {
    let response = NextResponse.next();
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

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = getAdminClient();
    const todayStr = new Date().toISOString().slice(0, 10);

    // Resolve employee organization & max break limit
    const { data: empRow } = await (adminClient as any)
      .from("employees")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();

    const maxBreakMinutes = await resolveOrgMaxBreakMinutes(
      adminClient,
      empRow?.organization_id || null
    ).catch(() => DEFAULT_MAX_BREAK_MINUTES);

    // Fetch user's active session or today's sessions
    const { data: sessions } = await (adminClient as any)
      .from("attendance_sessions")
      .select("id, work_date, check_in_at, check_out_at, note")
      .eq("employee_id", user.id)
      .eq("work_date", todayStr)
      .order("check_in_at", { ascending: false });

    const allBreaks: AttendanceBreakPayload[] = [];
    for (const s of sessions || []) {
      const noteState = parseNoteBreaks(s.note);
      for (const b of noteState.breaks) {
        allBreaks.push({
          id: b.id || s.id,
          type: b.type,
          startTime: b.startTime,
          endTime: b.endTime,
          durationMinutes: b.durationMinutes,
          status: b.status,
        });
      }
    }

    const activeBreak = allBreaks.find((b) => b.status === "active") || null;
    const shortBreakCount = allBreaks.filter((b) => b.type === "short_break").length;
    const lunchBreakCount = allBreaks.filter((b) => b.type === "lunch_break").length;

    return NextResponse.json({
      breaks: allBreaks,
      activeBreak,
      maxBreakMinutes,
      shortBreakTaken: shortBreakCount >= 1,
      lunchBreakTaken: lunchBreakCount >= 1,
      canTakeShortBreak: shortBreakCount < 1 && !activeBreak,
      canTakeLunchBreak: lunchBreakCount < 1 && !activeBreak,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch break sessions." },
      { status: 500 }
    );
  }
}

// POST: Start or End a break
export async function POST(request: NextRequest) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }
  try {
    let response = NextResponse.next();
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

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { action, breakType } = body;
    const adminClient = getAdminClient();
    const todayStr = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    // 1. Fetch user's currently open/active attendance session
    const { data: activeSession, error: sessErr } = await (adminClient as any)
      .from("attendance_sessions")
      .select("id, employee_id, work_date, check_in_at, check_out_at, note")
      .eq("employee_id", user.id)
      .is("check_out_at", null)
      .order("check_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessErr || !activeSession) {
      return NextResponse.json(
        { error: "No active shift session found. You must be clocked in to take or end a break." },
        { status: 400 }
      );
    }

    const noteState = parseNoteBreaks(activeSession.note);

    if (action === "start") {
      if (!["short_break", "lunch_break"].includes(breakType)) {
        return NextResponse.json(
          { error: "Invalid break type. Allowed: short_break (15m), lunch_break (60m)" },
          { status: 400 }
        );
      }

      // Check if there's already an active ongoing break
      const currentActive = noteState.breaks.find((b) => b.status === "active");
      if (currentActive) {
        return NextResponse.json(
          { error: "You already have an active break session in progress. Please end it first." },
          { status: 400 }
        );
      }

      // Check daily break quotas
      if (breakType === "short_break") {
        const count = noteState.breaks.filter((b) => b.type === "short_break").length;
        if (count >= 1) {
          return NextResponse.json(
            { error: "You have already taken your 15-minute break for today." },
            { status: 400 }
          );
        }
      } else if (breakType === "lunch_break") {
        const count = noteState.breaks.filter((b) => b.type === "lunch_break").length;
        if (count >= 1) {
          return NextResponse.json(
            { error: "You have already taken your 1-hour lunch break for today." },
            { status: 400 }
          );
        }
      }

      const newBreakId = `brk_${Date.now()}`;
      noteState.breaks.push({
        id: newBreakId,
        type: breakType,
        startTime: nowIso,
        endTime: null,
        durationMinutes: 0,
        status: "active",
      });

      const updatedNote = serializeNoteBreaks({
        ...noteState,
        originalNote: noteState.originalNote || activeSession.note || "",
        lastSeenAt: nowIso,
        breaks: noteState.breaks,
      });

      let { error: updateErr } = await (adminClient as any)
        .from("attendance_sessions")
        .update({
          note: updatedNote,
          break_started_at: nowIso,
          last_seen_at: nowIso,
        })
        .eq("id", activeSession.id);

      if (
        updateErr &&
        (updateErr.code === "PGRST204" ||
          updateErr.code === "42703" ||
          /column .* does not exist|schema cache/i.test(String(updateErr.message || "")))
      ) {
        const fallback = await (adminClient as any)
          .from("attendance_sessions")
          .update({ note: updatedNote })
          .eq("id", activeSession.id);
        updateErr = fallback.error;
      }

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `${breakType === "short_break" ? "15-minute break" : "1-hour lunch break"} started!`,
        breakSession: {
          id: newBreakId,
          type: breakType,
          startTime: nowIso,
          status: "active",
        },
      });
    }

    if (action === "end") {
      const activeBreakIndex = noteState.breaks.findIndex((b) => b.status === "active");
      if (activeBreakIndex === -1) {
        return NextResponse.json(
          { error: "No active break session found to end." },
          { status: 404 }
        );
      }

      const targetBreak = noteState.breaks[activeBreakIndex];
      const startMs = new Date(targetBreak.startTime).getTime();
      const durationMinutes = Math.max(1, Math.round((new Date(nowIso).getTime() - startMs) / 60000));

      targetBreak.endTime = nowIso;
      targetBreak.durationMinutes = durationMinutes;
      targetBreak.status = "completed";

      const totalBreakMins = noteState.breaks.reduce(
        (acc, b) => acc + (Number(b.durationMinutes) || 0),
        0
      );

      const updatedNote = serializeNoteBreaks({
        ...noteState,
        originalNote: noteState.originalNote || "",
        lastSeenAt: nowIso,
        breaks: noteState.breaks,
      });

      let { error: updateErr } = await (adminClient as any)
        .from("attendance_sessions")
        .update({
          note: updatedNote,
          break_started_at: null,
          break_duration_minutes: totalBreakMins,
          last_seen_at: nowIso,
        })
        .eq("id", activeSession.id);

      if (
        updateErr &&
        (updateErr.code === "PGRST204" ||
          updateErr.code === "42703" ||
          /column .* does not exist|schema cache/i.test(String(updateErr.message || "")))
      ) {
        const fallback = await (adminClient as any)
          .from("attendance_sessions")
          .update({ note: updatedNote })
          .eq("id", activeSession.id);
        updateErr = fallback.error;
      }

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: "Break ended. Welcome back!",
        durationMinutes,
      });
    }

    return NextResponse.json({ error: "Action must be 'start' or 'end'." }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to process break request." },
      { status: 500 }
    );
  }
}

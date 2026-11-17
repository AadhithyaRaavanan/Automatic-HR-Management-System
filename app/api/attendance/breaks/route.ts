import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

    const todayStr = new Date().toISOString().slice(0, 10);

    // Retrieve break sessions stored under source 'web' where note has break payload
    const { data: sessions } = await (supabaseAdmin as any)
      .from("attendance_sessions")
      .select("id, work_date, check_in_at, check_out_at, note")
      .eq("employee_id", user.id)
      .eq("work_date", todayStr)
      .like("note", '%"breakType"%')
      .order("check_in_at", { ascending: false });

    const breaks: AttendanceBreakPayload[] = (sessions || []).map((s: any) => {
      let parsedNote: any = {};
      try {
        parsedNote = JSON.parse(s.note);
      } catch {}

      return {
        id: s.id,
        type: parsedNote.breakType || "short_break",
        startTime: s.check_in_at,
        endTime: s.check_out_at,
        durationMinutes: parsedNote.durationMinutes || (s.check_out_at ? Math.round((new Date(s.check_out_at).getTime() - new Date(s.check_in_at).getTime()) / 60000) : 0),
        status: s.check_out_at ? "completed" : "active",
      };
    });

    const activeBreak = breaks.find((b) => b.status === "active") || null;
    const shortBreakCount = breaks.filter((b) => b.type === "short_break").length;
    const lunchBreakCount = breaks.filter((b) => b.type === "lunch_break").length;

    return NextResponse.json({
      breaks,
      activeBreak,
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
    const { action, breakType, breakId } = body;

    const todayStr = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    if (action === "start") {
      if (!["short_break", "lunch_break"].includes(breakType)) {
        return NextResponse.json(
          { error: "Invalid break type. Allowed: short_break (15m), lunch_break (60m)" },
          { status: 400 }
        );
      }

      // Check existing breaks for today
      const { data: existing } = await (supabaseAdmin as any)
        .from("attendance_sessions")
        .select("id, check_out_at, note")
        .eq("employee_id", user.id)
        .eq("work_date", todayStr)
        .like("note", '%"breakType"%');

      const existingBreaks = (existing || []).map((s: any) => {
        try {
          return { ...s, parsed: JSON.parse(s.note) };
        } catch {
          return { ...s, parsed: {} };
        }
      });

      const activeBreak = existingBreaks.find((b: any) => !b.check_out_at);
      if (activeBreak) {
        return NextResponse.json(
          { error: "You already have an active break session. Please end it before taking another." },
          { status: 400 }
        );
      }

      // Enforce: 1 short break (15m) and 1 lunch break (1h) per day
      if (breakType === "short_break") {
        const count = existingBreaks.filter((b: any) => b.parsed.breakType === "short_break").length;
        if (count >= 1) {
          return NextResponse.json(
            { error: "You have already taken your 15-minute break for today." },
            { status: 400 }
          );
        }
      } else if (breakType === "lunch_break") {
        const count = existingBreaks.filter((b: any) => b.parsed.breakType === "lunch_break").length;
        if (count >= 1) {
          return NextResponse.json(
            { error: "You have already taken your 1-hour lunch break for today." },
            { status: 400 }
          );
        }
      }

      const notePayload = JSON.stringify({
        breakType,
        maxMinutes: breakType === "short_break" ? 15 : 60,
        status: "active",
      });

      const { data: created, error: insertErr } = await (supabaseAdmin as any)
        .from("attendance_sessions")
        .insert({
          organization_id: "00000000-0000-0000-0000-000000000001",
          employee_id: user.id,
          work_date: todayStr,
          check_in_at: nowIso,
          check_out_at: null,
          source: "web",
          note: notePayload,
        })
        .select()
        .single();

      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `${breakType === "short_break" ? "15-minute break" : "1-hour lunch break"} started!`,
        breakSession: {
          id: created.id,
          type: breakType,
          startTime: created.check_in_at,
          status: "active",
        },
      });
    }

    if (action === "end") {
      let targetId = breakId;
      if (!targetId) {
        // Find active break
        const { data: active } = await (supabaseAdmin as any)
          .from("attendance_sessions")
          .select("id, check_in_at, note")
          .eq("employee_id", user.id)
          .eq("work_date", todayStr)
          .is("check_out_at", null)
          .like("note", '%"breakType"%')
          .maybeSingle();

        if (!active) {
          return NextResponse.json({ error: "No active break session found to end." }, { status: 404 });
        }
        targetId = active.id;
      }

      const { data: session } = await (supabaseAdmin as any)
        .from("attendance_sessions")
        .select("id, check_in_at, note")
        .eq("id", targetId)
        .single();

      if (!session) {
        return NextResponse.json({ error: "Break session not found." }, { status: 404 });
      }

      let parsedNote: any = {};
      try {
        parsedNote = JSON.parse(session.note);
      } catch {}

      const durationMinutes = Math.max(1, Math.round((new Date(nowIso).getTime() - new Date(session.check_in_at).getTime()) / 60000));
      parsedNote.status = "completed";
      parsedNote.durationMinutes = durationMinutes;

      await (supabaseAdmin as any)
        .from("attendance_sessions")
        .update({
          check_out_at: nowIso,
          note: JSON.stringify(parsedNote),
        })
        .eq("id", targetId);

      return NextResponse.json({
        success: true,
        message: "Break session ended. Welcome back!",
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

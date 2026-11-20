import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";

export const dynamic = "force-dynamic";

export interface AttendanceBreakPayload {
  id: string;
  type: "short_break" | "lunch_break";
  startTime: string;
  endTime?: string | null;
  durationMinutes?: number;
  status: "active" | "completed";
}

interface ParsedBreakItem {
  id: string;
  type: "short_break" | "lunch_break";
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
  status: "active" | "completed";
}

interface NoteState {
  originalNote?: string;
  breaks: ParsedBreakItem[];
}

function parseNoteBreaks(rawNote: string | null): NoteState {
  if (!rawNote) return { originalNote: "", breaks: [] };
  try {
    const parsed = JSON.parse(rawNote);
    if (parsed && Array.isArray(parsed.breaks)) {
      return {
        originalNote: parsed.originalNote || "",
        breaks: parsed.breaks,
      };
    }
    // Legacy single-break payload format
    if (parsed && parsed.breakType) {
      return {
        originalNote: "",
        breaks: [
          {
            id: "legacy",
            type: parsed.breakType,
            startTime: new Date().toISOString(),
            endTime: parsed.status === "completed" ? new Date().toISOString() : null,
            durationMinutes: parsed.durationMinutes || 0,
            status: parsed.status || "completed",
          },
        ],
      };
    }
  } catch {}
  return { originalNote: rawNote, breaks: [] };
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

    const todayStr = new Date().toISOString().slice(0, 10);

    // Fetch user's active session or today's sessions
    const { data: sessions } = await (supabaseAdmin as any)
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
    const todayStr = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    // 1. Fetch user's currently open/active attendance session
    const { data: activeSession, error: sessErr } = await (supabaseAdmin as any)
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

      const updatedNote = JSON.stringify({
        originalNote: noteState.originalNote || activeSession.note || "",
        breaks: noteState.breaks,
      });

      const { error: updateErr } = await (supabaseAdmin as any)
        .from("attendance_sessions")
        .update({
          note: updatedNote,
        })
        .eq("id", activeSession.id);

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

      const updatedNote = JSON.stringify({
        originalNote: noteState.originalNote || "",
        breaks: noteState.breaks,
      });

      const { error: updateErr } = await (supabaseAdmin as any)
        .from("attendance_sessions")
        .update({
          note: updatedNote,
        })
        .eq("id", activeSession.id);

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

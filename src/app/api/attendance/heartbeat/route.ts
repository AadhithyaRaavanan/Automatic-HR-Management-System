import { NextRequest, NextResponse } from "next/server";
import { getAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { requireApprovedUser } from "@/features/auth/require-approved-user";
import { parseNoteBreaks, serializeNoteBreaks } from "@/features/attendance/break-note";
import { processSessionTimeouts } from "@/features/attendance/session-timeout";

export const dynamic = "force-dynamic";

function isMissingColumnErr(error: any): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    /column .* does not exist|schema cache/i.test(String(error.message || ""))
  );
}

/**
 * Lightweight heartbeat endpoint called every ~2 minutes while the user is online & active.
 * Checks for prior timeout expiration first so returning after >= 20m offline still triggers
 * automatic checkout instead of silently extending `last_seen_at`.
 */
export async function POST(request: NextRequest) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }

  try {
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json(
        { error: "Server configuration missing Supabase Admin credentials." },
        { status: 500 }
      );
    }

    const adminClient: any = getAdminClient();
    const userId = approvedCheck.user.id;
    const now = new Date();
    const nowIso = now.toISOString();

    // 1. Evaluate whether the employee's session already timed out while offline/idle
    const timeoutResult = await processSessionTimeouts({
      adminClient,
      employeeId: userId,
      now,
    });

    if (timeoutResult.timedOutCount > 0) {
      return NextResponse.json({
        success: true,
        timedOut: true,
        hasActiveSession: false,
        timedOutSessions: timeoutResult.timedOutSessions,
      });
    }

    // 2. Locate open session and refresh last_seen_at
    const { data: activeSession, error: fetchErr } = await adminClient
      .from("attendance_sessions")
      .select("id, note")
      .eq("employee_id", userId)
      .is("check_out_at", null)
      .order("check_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    if (!activeSession) {
      // Still update employee presence timestamp cleanly if column exists
      try {
        await adminClient
          .from("employees")
          .update({ last_seen_at: nowIso })
          .eq("id", userId);
      } catch {}

      return NextResponse.json({
        success: true,
        timedOut: false,
        hasActiveSession: false,
        lastSeenAt: nowIso,
      });
    }

    const noteState = parseNoteBreaks(activeSession.note);
    const updatedNote = serializeNoteBreaks({
      ...noteState,
      lastSeenAt: nowIso,
    });

    let updateRes = await adminClient
      .from("attendance_sessions")
      .update({
        last_seen_at: nowIso,
        note: updatedNote,
      })
      .eq("id", activeSession.id)
      .is("check_out_at", null);

    if (updateRes.error && isMissingColumnErr(updateRes.error)) {
      updateRes = await adminClient
        .from("attendance_sessions")
        .update({ note: updatedNote })
        .eq("id", activeSession.id)
        .is("check_out_at", null);
    }

    if (updateRes.error) {
      return NextResponse.json({ error: updateRes.error.message }, { status: 500 });
    }

    try {
      const empUpdate = await adminClient
        .from("employees")
        .update({ last_seen_at: nowIso })
        .eq("id", userId);
      if (empUpdate?.error && !isMissingColumnErr(empUpdate.error)) {
        console.warn("[Heartbeat] employees.last_seen_at update skipped:", empUpdate.error.message);
      }
    } catch {}

    return NextResponse.json({
      success: true,
      timedOut: false,
      hasActiveSession: true,
      sessionId: activeSession.id,
      lastSeenAt: nowIso,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to process attendance heartbeat." },
      { status: 500 }
    );
  }
}

import "server-only";

import {
  DEFAULT_MAX_BREAK_MINUTES,
  computeBreakElapsedMs,
  parseNoteBreaks,
  resolveBreakLimitMinutes,
  serializeNoteBreaks,
} from "@/features/attendance/break-note";
import {
  formatHoursMins,
  formatTimeInDeclaredTimezone,
} from "@/features/attendance/early-checkout-alert";
import { sendBreakTimeoutEmail } from "@/lib/email/resend";

export interface BreakTimeoutSessionResult {
  sessionId: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string | null;
  workDate: string;
  breakStartIso: string;
  autoCheckoutAtIso: string;
  allowedBreakMinutes: number;
  elapsedBreakMinutes: number;
  notificationInserted: boolean;
  emailSent: boolean;
}

export interface EnforceBreakTimeoutsResult {
  checkedCount: number;
  timedOutCount: number;
  maxBreakMinutesDefault: number;
  timedOutSessions: BreakTimeoutSessionResult[];
}

function isMissingColumnErr(error: any): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    /column .* does not exist|schema cache/i.test(String(error.message || ""))
  );
}

/**
 * Resolves the organization's configured max break threshold in minutes.
 * Precedence: positive BREAK_TIMEOUT_MINUTES env override -> attendance_policies.max_break_minutes
 * -> organizations.max_break_minutes -> 60m default.
 */
export async function resolveOrgMaxBreakMinutes(
  adminClient: any,
  organizationId: string | null
): Promise<number> {
  const envOverride = process.env.BREAK_TIMEOUT_MINUTES;
  if (envOverride) {
    const parsed = Number(envOverride);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Try attendance_policies.max_break_minutes first
  try {
    if (organizationId) {
      const { data: orgPolicy, error: orgPolicyErr } = await adminClient
        .from("attendance_policies")
        .select("max_break_minutes")
        .eq("is_active", true)
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!orgPolicyErr && orgPolicy?.max_break_minutes != null) {
        return resolveBreakLimitMinutes(orgPolicy.max_break_minutes);
      }
    }

    const { data: globalPolicy, error: globalPolicyErr } = await adminClient
      .from("attendance_policies")
      .select("max_break_minutes")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!globalPolicyErr && globalPolicy?.max_break_minutes != null) {
      return resolveBreakLimitMinutes(globalPolicy.max_break_minutes);
    }
  } catch {
    // Table/column may not exist yet in older schemas
  }

  // Fallback to organizations.max_break_minutes if present
  if (organizationId) {
    try {
      const { data: orgRow, error: orgErr } = await adminClient
        .from("organizations")
        .select("max_break_minutes")
        .eq("id", organizationId)
        .maybeSingle();

      if (!orgErr && orgRow?.max_break_minutes != null) {
        return resolveBreakLimitMinutes(orgRow.max_break_minutes);
      }
    } catch {
      // Column may not exist yet
    }
  }

  return DEFAULT_MAX_BREAK_MINUTES;
}

async function insertBreakTimeoutNotification(
  adminClient: any,
  payload: {
    userId: string;
    organizationId: string | null;
    sessionId: string;
    title: string;
    body: string;
  }
): Promise<boolean> {
  const fullRow: Record<string, any> = {
    user_id: payload.userId,
    type: "break_timeout",
    title: payload.title,
    body: payload.body,
    link: "/attendance",
    entity_type: "attendance_sessions",
    entity_id: payload.sessionId,
    actor_id: payload.userId,
    read_at: null,
    dedupe_key: `break-timeout:${payload.sessionId}`,
  };
  if (payload.organizationId) {
    fullRow.organization_id = payload.organizationId;
  }

  let res = await adminClient.from("notifications").insert(fullRow);
  if (!res?.error) return true;

  // Retry with constraint-safe notification types if CHECK constraint rejects 'break_timeout'
  if (res.error.code === "23514" || /check constraint/i.test(String(res.error.message || ""))) {
    res = await adminClient.from("notifications").insert({
      ...fullRow,
      type: "missed_checkout",
    });
    if (!res?.error) return true;
  }

  // Fallback to starter schema columns (user_id, type, title, body, read_at)
  if (isMissingColumnErr(res.error)) {
    const fallbackRes = await adminClient.from("notifications").insert({
      user_id: payload.userId,
      type: "missed_checkout",
      title: payload.title,
      body: payload.body,
      read_at: null,
    });
    return !fallbackRes?.error;
  }

  return false;
}

async function fetchOpenSessionsForTimeoutCheck(
  adminClient: any,
  employeeId?: string
): Promise<any[]> {
  let query = adminClient
    .from("attendance_sessions")
    .select(
      "id, employee_id, work_date, check_in_at, check_out_at, note, auto_logged_out, break_timeout_notified"
    )
    .is("check_out_at", null);

  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }

  let { data, error } = await query;

  // Fallback when migration columns are not present in remote DB yet
  if (error && isMissingColumnErr(error)) {
    let fallbackQuery = adminClient
      .from("attendance_sessions")
      .select("id, employee_id, work_date, check_in_at, check_out_at, note")
      .is("check_out_at", null);
    if (employeeId) {
      fallbackQuery = fallbackQuery.eq("employee_id", employeeId);
    }
    const fallback = await fallbackQuery;
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    throw new Error(error.message || "Failed to inspect open attendance sessions.");
  }

  return Array.isArray(data) ? data : [];
}

/**
 * Checks open attendance sessions currently on break where elapsed break duration
 * strictly exceeds the organization's configured max break limit, then idempotently:
 * 1) closes the break and checks out the session (`auto_logged_out = true`, `break_timeout_notified = true`)
 * 2) creates a single unread in-app notification for that employee
 * 3) sends a reminder email directly to that employee
 */
export async function enforceBreakTimeouts(options: {
  adminClient: any;
  employeeId?: string;
  now?: Date;
}): Promise<EnforceBreakTimeoutsResult> {
  const { adminClient, employeeId } = options;
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const openSessions = await fetchOpenSessionsForTimeoutCheck(adminClient, employeeId);
  const orgMaxBreakCache = new Map<string, number>();
  const defaultLimit = await resolveOrgMaxBreakMinutes(adminClient, null);
  orgMaxBreakCache.set("__default__", defaultLimit);

  const timedOutSessions: BreakTimeoutSessionResult[] = [];

  for (const session of openSessions) {
    if (!session || session.check_out_at) continue;

    const noteState = parseNoteBreaks(session.note);
    if (session.break_timeout_notified === true || noteState.breakTimeoutNotified === true) {
      continue;
    }

    const activeBreakIndex = noteState.breaks.findIndex((b) => b.status === "active");
    if (activeBreakIndex === -1) continue;

    const activeBreak = noteState.breaks[activeBreakIndex];
    const elapsedMs = computeBreakElapsedMs(activeBreak.startTime, nowMs);
    const exactElapsedMinutes = elapsedMs / 60000;

    // Fetch employee profile cleanly
    let employeeRow: any = null;
    try {
      const { data: emp } = await adminClient
        .from("employees")
        .select("id, organization_id, full_name, email, timezone")
        .eq("id", session.employee_id)
        .maybeSingle();
      employeeRow = emp;
    } catch {
      employeeRow = null;
    }

    const organizationId: string | null = employeeRow?.organization_id || null;
    const cacheKey = organizationId || "__default__";
    let maxBreakMinutes = orgMaxBreakCache.get(cacheKey);
    if (maxBreakMinutes === undefined) {
      maxBreakMinutes = await resolveOrgMaxBreakMinutes(adminClient, organizationId);
      orgMaxBreakCache.set(cacheKey, maxBreakMinutes);
    }

    if (!(exactElapsedMinutes > maxBreakMinutes)) {
      continue;
    }

    const roundedElapsedMinutes = Math.max(
      Math.floor(maxBreakMinutes) + 1,
      Math.round(exactElapsedMinutes)
    );

    // Close active break inside note state & persist idempotency flags
    const updatedBreaks = noteState.breaks.map((b, idx) =>
      idx === activeBreakIndex
        ? {
            ...b,
            endTime: nowIso,
            durationMinutes: roundedElapsedMinutes,
            status: "completed" as const,
          }
        : b
    );

    const updatedNote = serializeNoteBreaks({
      originalNote: noteState.originalNote,
      breaks: updatedBreaks,
      autoLoggedOut: true,
      breakTimeoutNotified: true,
      autoLogoutReason: "break_timeout",
      autoLogoutAt: nowIso,
    });

    // Atomically check out session (`check_out_at IS NULL` guard prevents duplicate execution)
    let updateRes = await adminClient
      .from("attendance_sessions")
      .update({
        check_out_at: nowIso,
        note: updatedNote,
        auto_logged_out: true,
        break_timeout_notified: true,
        auto_logout_reason: "break_timeout",
      })
      .eq("id", session.id)
      .is("check_out_at", null)
      .select("id");

    if (updateRes.error && isMissingColumnErr(updateRes.error)) {
      updateRes = await adminClient
        .from("attendance_sessions")
        .update({
          check_out_at: nowIso,
          note: updatedNote,
        })
        .eq("id", session.id)
        .is("check_out_at", null)
        .select("id");
    }

    if (updateRes.error || !updateRes.data || updateRes.data.length === 0) {
      // Another worker already checked out this session concurrently or update failed
      continue;
    }

    // Recalculate attendance day & log audit trail safely
    try {
      await adminClient.rpc("recalculate_day", {
        p_employee_id: session.employee_id,
        p_work_date: session.work_date,
      });
    } catch {}

    try {
      await adminClient.from("audit_logs").insert({
        actor_id: session.employee_id,
        action: "AUTO_CHECKOUT_BREAK_TIMEOUT",
        entity_type: "attendance_sessions",
        entity_id: session.id,
        metadata: {
          work_date: session.work_date,
          break_start_at: activeBreak.startTime,
          auto_checkout_at: nowIso,
          allowed_break_minutes: maxBreakMinutes,
          elapsed_break_minutes: roundedElapsedMinutes,
        },
      });
    } catch {}

    const employeeName = employeeRow?.full_name || employeeRow?.email || "Employee";
    const employeeEmail = employeeRow?.email ? String(employeeRow.email).trim() : null;
    const employeeTimezone = employeeRow?.timezone || "Asia/Kolkata";

    const notifTitle = "Auto Logged Out: Break Time Exceeded";
    const notifBody = `Your break exceeded the allowed ${maxBreakMinutes}m limit, so your shift was automatically ended and logged out. Please remember to end your break or log out properly next time.`;

    const notificationInserted = await insertBreakTimeoutNotification(adminClient, {
      userId: session.employee_id,
      organizationId,
      sessionId: session.id,
      title: notifTitle,
      body: notifBody,
    });

    let emailSent = false;
    if (employeeEmail) {
      try {
        const emailResult = await sendBreakTimeoutEmail({
          to: employeeEmail,
          employeeName,
          workDate: session.work_date,
          breakTypeLabel:
            activeBreak.type === "short_break" ? "Short Break" : "Lunch Break",
          breakStartFormatted: formatTimeInDeclaredTimezone(
            activeBreak.startTime,
            employeeTimezone
          ),
          autoCheckoutFormatted: formatTimeInDeclaredTimezone(nowIso, employeeTimezone),
          timezone: employeeTimezone,
          allowedLimitMinutes: maxBreakMinutes,
          elapsedBreakFormatted: formatHoursMins(roundedElapsedMinutes),
        });
        emailSent = Boolean(emailResult?.success);
      } catch (emailErr) {
        console.warn("[BreakTimeout] Email delivery skipped/failed:", emailErr);
      }
    }

    timedOutSessions.push({
      sessionId: session.id,
      employeeId: session.employee_id,
      employeeName,
      employeeEmail,
      workDate: session.work_date,
      breakStartIso: activeBreak.startTime,
      autoCheckoutAtIso: nowIso,
      allowedBreakMinutes: maxBreakMinutes,
      elapsedBreakMinutes: roundedElapsedMinutes,
      notificationInserted,
      emailSent,
    });
  }

  return {
    checkedCount: openSessions.length,
    timedOutCount: timedOutSessions.length,
    maxBreakMinutesDefault: defaultLimit,
    timedOutSessions,
  };
}

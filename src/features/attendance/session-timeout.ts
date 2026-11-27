import "server-only";

import {
  computeBreakElapsedMs,
  parseNoteBreaks,
  serializeNoteBreaks,
} from "@/features/attendance/break-note";
import { resolveOrgMaxBreakMinutes } from "@/features/attendance/break-timeout";
import { formatTimeInDeclaredTimezone } from "@/features/attendance/early-checkout-alert";
import { sendInactivityAutoLogoutEmail } from "@/lib/email/resend";

export const DEFAULT_INACTIVITY_TIMEOUT_MINUTES = 20;
export const DEFAULT_BREAK_OVERSTAY_GRACE_MINUTES = 15;
export const AUTO_LOGOUT_CHECKOUT_REASON =
  "Auto-logged out due to inactivity / break timeout";

export function resolveInactivityTimeoutMinutes(): number {
  const raw = process.env.INACTIVITY_TIMEOUT_MINUTES;
  if (raw) {
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return DEFAULT_INACTIVITY_TIMEOUT_MINUTES;
}

export function resolveBreakOverstayGraceMinutes(): number {
  const raw = process.env.BREAK_OVERSTAY_GRACE_MINUTES;
  if (raw) {
    const num = Number(raw);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return DEFAULT_BREAK_OVERSTAY_GRACE_MINUTES;
}

function isMissingColumnErr(error: any): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    /column .* does not exist|schema cache/i.test(String(error.message || ""))
  );
}

export interface TimedOutSessionSummary {
  sessionId: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string | null;
  organizationId: string | null;
  workDate: string;
  checkInAtIso: string;
  checkoutAtIso: string;
  timeoutType: "inactivity" | "break_timeout";
  checkoutReason: string;
  notificationInserted: boolean;
  emailSent: boolean;
}

export interface ProcessTimeoutsResult {
  checkedCount: number;
  timedOutCount: number;
  inactivityTimeoutMinutes: number;
  breakOverstayGraceMinutes: number;
  timedOutSessions: TimedOutSessionSummary[];
}

async function fetchOpenSessions(
  adminClient: any,
  options: { employeeId?: string; organizationId?: string }
): Promise<any[]> {
  let query = adminClient
    .from("attendance_sessions")
    .select(
      "id, employee_id, organization_id, work_date, check_in_at, check_out_at, note, last_seen_at, break_started_at, break_duration_minutes, auto_logged_out, auto_logout_notified, break_timeout_notified"
    )
    .is("check_out_at", null);

  if (options.employeeId) query = query.eq("employee_id", options.employeeId);
  if (options.organizationId) query = query.eq("organization_id", options.organizationId);

  let { data, error } = await query;

  if (error && isMissingColumnErr(error)) {
    let fallbackQuery = adminClient
      .from("attendance_sessions")
      .select("id, employee_id, work_date, check_in_at, check_out_at, note")
      .is("check_out_at", null);
    if (options.employeeId) fallbackQuery = fallbackQuery.eq("employee_id", options.employeeId);
    const fallback = await fallbackQuery;
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    throw new Error(error.message || "Failed to fetch open attendance sessions.");
  }
  return Array.isArray(data) ? data : [];
}

async function insertAutoLogoutNotification(
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
    type: "auto_logout",
    title: payload.title,
    body: payload.body,
    link: "/",
    entity_type: "attendance_sessions",
    entity_id: payload.sessionId,
    actor_id: payload.userId,
    read_at: null,
    dedupe_key: `auto-logout:${payload.sessionId}`,
  };
  if (payload.organizationId) {
    fullRow.organization_id = payload.organizationId;
  }

  let res = await adminClient.from("notifications").insert(fullRow);
  if (!res?.error) return true;

  if (res.error.code === "23514" || /check constraint/i.test(String(res.error.message || ""))) {
    res = await adminClient.from("notifications").insert({
      ...fullRow,
      type: "missed_checkout",
    });
    if (!res?.error) return true;
  }

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

/**
 * Queries open checked-in sessions across an organization (or scoped to one employee)
 * and closes any session that exceeded `INACTIVITY_TIMEOUT_MINUTES` (20m) without activity
 * or exceeded its active break window + `BREAK_OVERSTAY_GRACE_MINUTES` (15m).
 *
 * Uses `last_seen_at` / break expiry timestamp as `check_out_at` so worked hours are never
 * inflated, inserts an idempotent unread notification for that employee, and emails them.
 */
export async function processSessionTimeouts(options: {
  adminClient: any;
  employeeId?: string;
  organizationId?: string;
  now?: Date;
}): Promise<ProcessTimeoutsResult> {
  const { adminClient, employeeId, organizationId } = options;
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const inactivityTimeoutMinutes = resolveInactivityTimeoutMinutes();
  const breakGraceMinutes = resolveBreakOverstayGraceMinutes();

  const openSessions = await fetchOpenSessions(adminClient, {
    employeeId,
    organizationId,
  });

  const orgMaxBreakCache = new Map<string, number>();
  const timedOutSessions: TimedOutSessionSummary[] = [];

  for (const sess of openSessions) {
    if (!sess || sess.check_out_at) continue;

    const noteState = parseNoteBreaks(sess.note);
    if (
      sess.auto_logout_notified === true ||
      sess.break_timeout_notified === true ||
      noteState.autoLogoutNotified === true
    ) {
      continue;
    }

    // Load employee profile for org scoping, email, timezone, and employee.last_seen_at fallback
    let employeeRow: any = null;
    try {
      let empRes = await adminClient
        .from("employees")
        .select("id, organization_id, full_name, email, timezone, last_seen_at")
        .eq("id", sess.employee_id)
        .maybeSingle();
      if (empRes.error && isMissingColumnErr(empRes.error)) {
        empRes = await adminClient
          .from("employees")
          .select("id, organization_id, full_name, email, timezone")
          .eq("id", sess.employee_id)
          .maybeSingle();
      }
      employeeRow = empRes.data;
    } catch {
      employeeRow = null;
    }

    const empOrgId: string | null =
      sess.organization_id || employeeRow?.organization_id || organizationId || null;

    const activeBreakIdx = noteState.breaks.findIndex((b) => b.status === "active");
    const activeBreak = activeBreakIdx >= 0 ? noteState.breaks[activeBreakIdx] : null;
    const effectiveBreakStartIso = activeBreak?.startTime || sess.break_started_at || null;

    let timeoutType: "inactivity" | "break_timeout" | null = null;
    let checkoutMs = nowMs;
    let nextBreaks = noteState.breaks;
    let totalBreakMins = Number(sess.break_duration_minutes) || 0;

    if (effectiveBreakStartIso) {
      const cacheKey = empOrgId || "__default__";
      let orgMaxBreakMins = orgMaxBreakCache.get(cacheKey);
      if (orgMaxBreakMins === undefined) {
        orgMaxBreakMins = await resolveOrgMaxBreakMinutes(adminClient, empOrgId);
        orgMaxBreakCache.set(cacheKey, orgMaxBreakMins);
      }

      const allowedBreakDuration =
        activeBreak?.type === "short_break"
          ? Math.min(15, orgMaxBreakMins)
          : orgMaxBreakMins;
      const breakExpiryMinutes = allowedBreakDuration + breakGraceMinutes;

      const elapsedBreakMs = computeBreakElapsedMs(effectiveBreakStartIso, nowMs);
      if (elapsedBreakMs >= breakExpiryMinutes * 60_000) {
        timeoutType = "break_timeout";
        const breakStartMs = new Date(effectiveBreakStartIso).getTime();
        const expiryAtMs = breakStartMs + breakExpiryMinutes * 60_000;
        const checkInMs = new Date(sess.check_in_at).getTime();
        checkoutMs = Math.min(
          nowMs,
          Math.max(Number.isFinite(checkInMs) ? checkInMs : expiryAtMs, expiryAtMs)
        );

        const breakEndIso = new Date(checkoutMs).toISOString();
        const closedBreakMins = Math.max(1, Math.round((checkoutMs - breakStartMs) / 60_000));
        totalBreakMins = Math.max(totalBreakMins, closedBreakMins);
        if (activeBreakIdx >= 0) {
          nextBreaks = noteState.breaks.map((b, idx) =>
            idx === activeBreakIdx
              ? {
                  ...b,
                  endTime: breakEndIso,
                  durationMinutes: closedBreakMins,
                  status: "completed" as const,
                }
              : b
          );
        }
      }
    } else {
      const effectiveLastSeenIso =
        sess.last_seen_at ||
        noteState.lastSeenAt ||
        employeeRow?.last_seen_at ||
        sess.check_in_at;
      const lastSeenMs = new Date(effectiveLastSeenIso).getTime();
      if (Number.isFinite(lastSeenMs)) {
        const offlineMs = nowMs - lastSeenMs;
        if (offlineMs >= inactivityTimeoutMinutes * 60_000) {
          timeoutType = "inactivity";
          const checkInMs = new Date(sess.check_in_at).getTime();
          checkoutMs = Math.min(
            nowMs,
            Math.max(Number.isFinite(checkInMs) ? checkInMs : lastSeenMs, lastSeenMs)
          );
        }
      }
    }

    if (!timeoutType) continue;

    const checkoutAtIso = new Date(checkoutMs).toISOString();
    const updatedNote = serializeNoteBreaks({
      originalNote: noteState.originalNote,
      breaks: nextBreaks,
      lastSeenAt: sess.last_seen_at || noteState.lastSeenAt || undefined,
      autoLoggedOut: true,
      autoLogoutNotified: true,
      breakTimeoutNotified: timeoutType === "break_timeout",
      autoLogoutReason: timeoutType,
      checkoutReason: AUTO_LOGOUT_CHECKOUT_REASON,
      autoLogoutAt: checkoutAtIso,
    });

    const fullUpdate: Record<string, any> = {
      check_out_at: checkoutAtIso,
      status: "checked_out",
      auto_logged_out: true,
      auto_logout_notified: true,
      break_timeout_notified: timeoutType === "break_timeout",
      checkout_reason: AUTO_LOGOUT_CHECKOUT_REASON,
      auto_logout_reason: timeoutType,
      break_started_at: null,
      break_duration_minutes: totalBreakMins,
      note: updatedNote,
    };

    let updateRes = await adminClient
      .from("attendance_sessions")
      .update(fullUpdate)
      .eq("id", sess.id)
      .is("check_out_at", null)
      .select("id");

    if (updateRes.error && isMissingColumnErr(updateRes.error)) {
      updateRes = await adminClient
        .from("attendance_sessions")
        .update({
          check_out_at: checkoutAtIso,
          note: updatedNote,
        })
        .eq("id", sess.id)
        .is("check_out_at", null)
        .select("id");
    }

    if (updateRes.error || !updateRes.data || updateRes.data.length === 0) {
      continue;
    }

    try {
      await adminClient.rpc("recalculate_day", {
        p_employee_id: sess.employee_id,
        p_work_date: sess.work_date,
      });
    } catch {}

    try {
      await adminClient.from("audit_logs").insert({
        actor_id: sess.employee_id,
        action:
          timeoutType === "break_timeout"
            ? "AUTO_CHECKOUT_BREAK_TIMEOUT"
            : "AUTO_CHECKOUT_INACTIVITY_TIMEOUT",
        entity_type: "attendance_sessions",
        entity_id: sess.id,
        metadata: {
          work_date: sess.work_date,
          check_in_at: sess.check_in_at,
          auto_checkout_at: checkoutAtIso,
          checkout_reason: AUTO_LOGOUT_CHECKOUT_REASON,
          timeout_type: timeoutType,
        },
      });
    } catch {}

    const employeeName = employeeRow?.full_name || employeeRow?.email || "Employee";
    const employeeEmail = employeeRow?.email ? String(employeeRow.email).trim() : null;
    const employeeTimezone =
      employeeRow?.timezone && employeeRow.timezone !== "UTC"
        ? employeeRow.timezone
        : "Asia/Kolkata";

    const notifTitle = "Automatic Sign-Out Notice";
    const notifBody =
      "You were automatically logged out after being offline / past your break window for 20 minutes. Please remember to check out properly next time.";

    const notificationInserted = await insertAutoLogoutNotification(adminClient, {
      userId: sess.employee_id,
      organizationId: empOrgId,
      sessionId: sess.id,
      title: notifTitle,
      body: notifBody,
    });

    const emailReasonText =
      timeoutType === "break_timeout"
        ? "your active break exceeded the allowed break window"
        : `you remained offline or inactive for ${inactivityTimeoutMinutes} minutes`;

    let emailSent = false;
    if (employeeEmail) {
      try {
        const emailResult = await sendInactivityAutoLogoutEmail({
          to: employeeEmail,
          employeeName,
          workDate: sess.work_date,
          checkInFormatted: formatTimeInDeclaredTimezone(sess.check_in_at, employeeTimezone),
          autoCheckoutFormatted: formatTimeInDeclaredTimezone(checkoutAtIso, employeeTimezone),
          timezone: employeeTimezone,
          reasonText: emailReasonText,
        });
        emailSent = Boolean(emailResult?.success);
      } catch (err) {
        console.warn("[ProcessTimeouts] Email send skipped/failed:", err);
      }
    }

    timedOutSessions.push({
      sessionId: sess.id,
      employeeId: sess.employee_id,
      employeeName,
      employeeEmail,
      organizationId: empOrgId,
      workDate: sess.work_date,
      checkInAtIso: sess.check_in_at,
      checkoutAtIso,
      timeoutType,
      checkoutReason: AUTO_LOGOUT_CHECKOUT_REASON,
      notificationInserted,
      emailSent,
    });
  }

  return {
    checkedCount: openSessions.length,
    timedOutCount: timedOutSessions.length,
    inactivityTimeoutMinutes,
    breakOverstayGraceMinutes: breakGraceMinutes,
    timedOutSessions,
  };
}

export const DEFAULT_MAX_BREAK_MINUTES = 60;

export interface ParsedBreakItem {
  id: string;
  type: "short_break" | "lunch_break";
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
  status: "active" | "completed";
}

export interface NoteState {
  originalNote?: string;
  breaks: ParsedBreakItem[];
  lastSeenAt?: string;
  autoLoggedOut?: boolean;
  autoLogoutNotified?: boolean;
  breakTimeoutNotified?: boolean;
  autoLogoutReason?: string;
  checkoutReason?: string;
  autoLogoutAt?: string;
}

/**
 * Parses `attendance_sessions.note` JSON payload into normalized break history and metadata.
 */
export function parseNoteBreaks(rawNote: string | null | undefined): NoteState {
  if (!rawNote) return { originalNote: "", breaks: [] };
  try {
    const parsed = JSON.parse(rawNote);
    if (parsed && Array.isArray(parsed.breaks)) {
      return {
        originalNote: typeof parsed.originalNote === "string" ? parsed.originalNote : "",
        breaks: parsed.breaks,
        lastSeenAt: typeof parsed.lastSeenAt === "string" ? parsed.lastSeenAt : undefined,
        autoLoggedOut: Boolean(parsed.autoLoggedOut ?? parsed.auto_logged_out),
        autoLogoutNotified: Boolean(
          parsed.autoLogoutNotified ??
            parsed.auto_logout_notified ??
            parsed.breakTimeoutNotified ??
            parsed.break_timeout_notified
        ),
        breakTimeoutNotified: Boolean(
          parsed.breakTimeoutNotified ?? parsed.break_timeout_notified
        ),
        autoLogoutReason:
          typeof parsed.autoLogoutReason === "string" ? parsed.autoLogoutReason : undefined,
        checkoutReason:
          typeof parsed.checkoutReason === "string" ? parsed.checkoutReason : undefined,
        autoLogoutAt:
          typeof parsed.autoLogoutAt === "string" ? parsed.autoLogoutAt : undefined,
      };
    }
    if (parsed && typeof parsed === "object" && typeof parsed.lastSeenAt === "string") {
      return {
        originalNote: typeof parsed.originalNote === "string" ? parsed.originalNote : "",
        breaks: [],
        lastSeenAt: parsed.lastSeenAt,
        autoLoggedOut: Boolean(parsed.autoLoggedOut ?? parsed.auto_logged_out),
        autoLogoutNotified: Boolean(
          parsed.autoLogoutNotified ?? parsed.auto_logout_notified
        ),
        breakTimeoutNotified: Boolean(
          parsed.breakTimeoutNotified ?? parsed.break_timeout_notified
        ),
        autoLogoutReason:
          typeof parsed.autoLogoutReason === "string" ? parsed.autoLogoutReason : undefined,
        checkoutReason:
          typeof parsed.checkoutReason === "string" ? parsed.checkoutReason : undefined,
        autoLogoutAt:
          typeof parsed.autoLogoutAt === "string" ? parsed.autoLogoutAt : undefined,
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
            startTime: parsed.startTime || new Date().toISOString(),
            endTime:
              parsed.endTime ??
              (parsed.status === "completed" ? new Date().toISOString() : null),
            durationMinutes: parsed.durationMinutes || 0,
            status: parsed.status || "completed",
          },
        ],
      };
    }
  } catch {
    // Raw plain-text session note
  }
  return { originalNote: rawNote, breaks: [] };
}

/**
 * Serializes normalized break state back to `attendance_sessions.note` JSON.
 */
export function serializeNoteBreaks(state: NoteState): string {
  const payload: Record<string, any> = {
    originalNote: state.originalNote || "",
    breaks: state.breaks,
  };
  if (state.lastSeenAt) payload.lastSeenAt = state.lastSeenAt;
  if (state.autoLoggedOut) payload.autoLoggedOut = true;
  if (state.autoLogoutNotified) payload.autoLogoutNotified = true;
  if (state.breakTimeoutNotified) payload.breakTimeoutNotified = true;
  if (state.autoLogoutReason) payload.autoLogoutReason = state.autoLogoutReason;
  if (state.checkoutReason) payload.checkoutReason = state.checkoutReason;
  if (state.autoLogoutAt) payload.autoLogoutAt = state.autoLogoutAt;
  return JSON.stringify(payload);
}

/**
 * Resolves the first valid positive max break limit in minutes, falling back to 60.
 */
export function resolveBreakLimitMinutes(
  ...candidates: Array<number | string | null | undefined>
): number {
  for (const val of candidates) {
    if (val === null || val === undefined || val === "") continue;
    const num = typeof val === "number" ? val : Number(val);
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
  }
  return DEFAULT_MAX_BREAK_MINUTES;
}

/**
 * Computes elapsed break milliseconds strictly non-negative against `nowMs`.
 */
export function computeBreakElapsedMs(
  breakStartIso: string,
  nowMs: number = Date.now()
): number {
  const startedMs = new Date(breakStartIso).getTime();
  if (!Number.isFinite(startedMs)) return 0;
  return Math.max(0, nowMs - startedMs);
}

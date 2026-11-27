import { DEFAULT_MAX_BREAK_MINUTES, computeBreakElapsedMs } from "@/features/attendance/break-note";
import { createClient } from "@/lib/supabase/client";

export interface TriggerBreakTimeoutClientParams {
  activeBreakStartTime: string | null | undefined;
  maxBreakMinutes?: number | null;
  nowMs?: number;
  fetchImpl?: typeof fetch;
  signOutImpl?: () => Promise<any>;
  redirectImpl?: (url: string) => void;
}

/**
 * Evaluates whether the currently running break exceeds `maxBreakMinutes`.
 * When exceeded, enforces server-side checkout/notification, signs out Supabase Auth,
 * and redirects to `/login?reason=break_timeout`.
 */
export async function checkAndTriggerBreakTimeoutClient(
  params: TriggerBreakTimeoutClientParams
): Promise<{ exceeded: boolean; timedOut: boolean }> {
  const { activeBreakStartTime, maxBreakMinutes, nowMs = Date.now() } = params;
  if (!activeBreakStartTime) {
    return { exceeded: false, timedOut: false };
  }

  const limitMinutes =
    typeof maxBreakMinutes === "number" && Number.isFinite(maxBreakMinutes) && maxBreakMinutes > 0
      ? maxBreakMinutes
      : DEFAULT_MAX_BREAK_MINUTES;

  const elapsedMs = computeBreakElapsedMs(activeBreakStartTime, nowMs);
  if (!(elapsedMs / 60000 > limitMinutes)) {
    return { exceeded: false, timedOut: false };
  }

  const fetchFn = params.fetchImpl ?? fetch;
  try {
    const res = await fetchFn("/api/attendance/check-break-timeout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.timedOut) {
      return { exceeded: true, timedOut: false };
    }

    if (params.signOutImpl) {
      await params.signOutImpl().catch(() => {});
    } else {
      try {
        const supabase = createClient();
        await supabase.auth.signOut();
      } catch {}
    }

    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("remotehr_cached_role");
      } catch {}
    }

    const redirectFn =
      params.redirectImpl ??
      ((url: string) => {
        if (typeof window !== "undefined") {
          window.location.assign(url);
        }
      });
    redirectFn("/login?reason=break_timeout");

    return { exceeded: true, timedOut: true };
  } catch {
    return { exceeded: true, timedOut: false };
  }
}

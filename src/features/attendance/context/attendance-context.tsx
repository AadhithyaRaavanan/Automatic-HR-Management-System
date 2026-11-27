"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useAttendanceToday,
  TodayAttendanceData,
  AttendanceSessionItem,
} from "../hooks/use-attendance-today";
import { calculateElapsedSeconds } from "@/lib/date/timezone";
import {
  DEFAULT_MAX_BREAK_MINUTES,
  computeBreakElapsedMs,
  parseNoteBreaks,
} from "@/features/attendance/break-note";

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;
const BREAK_OVERSTAY_GRACE_MINUTES = 15;

interface AttendanceContextValue {
  data: TodayAttendanceData | undefined;
  isLoading: boolean;
  activeSession: AttendanceSessionItem | null;
  isCheckedIn: boolean;
  isOnBreak: boolean;
  activeBreak: any | null;
  maxBreakMinutes: number;
  elapsedSeconds: number;
  formattedTime: string;
  refetch: () => Promise<any>;
}

const AttendanceContext = React.createContext<AttendanceContextValue | null>(null);

function parseActiveSessionBreaks(rawNote: string | null) {
  const noteState = parseNoteBreaks(rawNote);
  let completedSec = 0;
  let activeBreak = null;
  for (const b of noteState.breaks) {
    if (b.status === "active") {
      activeBreak = b;
    } else if (b.status === "completed" && b.startTime && b.endTime) {
      const dur = Math.max(
        0,
        Math.floor((new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 1000)
      );
      completedSec += dur;
    }
  }
  return { activeBreak, completedBreakSeconds: completedSec };
}

export function AttendanceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useAttendanceToday();
  const activeSession = data?.activeSession || null;
  const isCheckedIn = Boolean(activeSession);
  const checkInAt = activeSession?.check_in_at || null;
  const [maxBreakMinutes, setMaxBreakMinutes] = React.useState<number>(DEFAULT_MAX_BREAK_MINUTES);
  const timeoutSyncInFlightRef = React.useRef<boolean>(false);
  const lastUserActivityMsRef = React.useRef<number>(Date.now());

  const { activeBreak, completedBreakSeconds } = React.useMemo(() => {
    return parseActiveSessionBreaks(activeSession?.note || null);
  }, [activeSession?.note]);

  const isOnBreak = Boolean(activeBreak);

  // Authoritatively calculate elapsed seconds from database UTC timestamp minus break durations
  const computeWorkedSeconds = React.useCallback(() => {
    if (!checkInAt) return 0;
    const grossElapsed = calculateElapsedSeconds(checkInAt);
    if (activeBreak && activeBreak.startTime) {
      // While on break, freeze shift timer at the moment break started
      const breakStartGross = Math.max(0, Math.floor((new Date(activeBreak.startTime).getTime() - new Date(checkInAt).getTime()) / 1000));
      return Math.max(0, breakStartGross - completedBreakSeconds);
    }
    return Math.max(0, grossElapsed - completedBreakSeconds);
  }, [checkInAt, activeBreak, completedBreakSeconds]);

  const [elapsedSeconds, setElapsedSeconds] = React.useState<number>(computeWorkedSeconds);

  React.useEffect(() => {
    setElapsedSeconds(computeWorkedSeconds());
    if (!checkInAt || isOnBreak) {
      // Pause shift timer ticker while on break!
      return;
    }

    const interval = setInterval(() => {
      setElapsedSeconds(computeWorkedSeconds());
    }, 1000);

    return () => clearInterval(interval);
  }, [checkInAt, isOnBreak, computeWorkedSeconds]);

  // Hydrate configured organization max break threshold when checked in
  React.useEffect(() => {
    if (!isCheckedIn) return;
    let cancelled = false;
    fetch("/api/attendance/breaks", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!cancelled && typeof payload?.maxBreakMinutes === "number" && payload.maxBreakMinutes > 0) {
          setMaxBreakMinutes(payload.maxBreakMinutes);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isCheckedIn, activeSession?.id, activeBreak?.id]);

  const syncTimeoutCheck = React.useCallback(async () => {
    if (timeoutSyncInFlightRef.current) return false;
    timeoutSyncInFlightRef.current = true;
    try {
      const res = await fetch("/api/attendance/process-timeouts", {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) return false;
      const payload = await res.json().catch(() => null);
      if (payload?.timedOut) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["attendance", "today"] }),
          queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        ]);
        toast.warning("Automatic Sign-Out Notice", {
          description:
            "You were automatically logged out due to inactivity or exceeding your break window.",
          id: "attendance-auto-logout",
          duration: 8000,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      timeoutSyncInFlightRef.current = false;
    }
  }, [queryClient]);

  // Process any stale sessions on initial load / tab focus BEFORE refreshing heartbeat
  React.useEffect(() => {
    void syncTimeoutCheck();
    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible") {
        void syncTimeoutCheck();
      }
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [syncTimeoutCheck]);

  // Reset idle timer on mouse/keyboard/tab focus while checked in and ping heartbeat every 2 mins when active
  React.useEffect(() => {
    if (!isCheckedIn) return;
    lastUserActivityMsRef.current = Date.now();

    const markActive = () => {
      lastUserActivityMsRef.current = Date.now();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousemove",
      "keydown",
      "mousedown",
      "touchstart",
      "focus",
    ];
    for (const evt of activityEvents) {
      window.addEventListener(evt, markActive, { passive: true });
    }

    const heartbeatInterval = setInterval(async () => {
      const idleMs = Date.now() - lastUserActivityMsRef.current;
      // Only extend last_seen_at if user had recent activity in this heartbeat window
      if (!isOnBreak && idleMs >= INACTIVITY_TIMEOUT_MS) {
        await syncTimeoutCheck();
        return;
      }
      if (idleMs > HEARTBEAT_INTERVAL_MS || document.visibilityState !== "visible") {
        return;
      }
      try {
        const res = await fetch("/api/attendance/heartbeat", {
          method: "POST",
          cache: "no-store",
        });
        if (res.ok) {
          const json = await res.json().catch(() => null);
          if (json?.timedOut) {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["attendance", "today"] }),
              queryClient.invalidateQueries({ queryKey: ["notifications"] }),
            ]);
          }
        }
      } catch {}
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(heartbeatInterval);
      for (const evt of activityEvents) {
        window.removeEventListener(evt, markActive);
      }
    };
  }, [isCheckedIn, isOnBreak, queryClient, syncTimeoutCheck]);

  // Monitor active break against allowed break duration + 15m grace window
  React.useEffect(() => {
    if (!isOnBreak || !activeBreak?.startTime) {
      return;
    }

    const allowedBaseMinutes =
      activeBreak.type === "short_break"
        ? Math.min(15, maxBreakMinutes)
        : maxBreakMinutes;
    const expiryMs = (allowedBaseMinutes + BREAK_OVERSTAY_GRACE_MINUTES) * 60_000;

    const evaluateBreakOverstay = async () => {
      const elapsedMs = computeBreakElapsedMs(activeBreak.startTime);
      if (elapsedMs >= expiryMs) {
        await syncTimeoutCheck();
      }
    };

    void evaluateBreakOverstay();
    const interval = setInterval(() => {
      void evaluateBreakOverstay();
    }, 15_000);

    return () => {
      clearInterval(interval);
    };
  }, [isOnBreak, activeBreak?.startTime, activeBreak?.type, maxBreakMinutes, syncTimeoutCheck]);

  const formattedTime = React.useMemo(() => {
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }, [elapsedSeconds]);

  const value = React.useMemo(
    () => ({
      data,
      isLoading,
      activeSession,
      isCheckedIn,
      isOnBreak,
      activeBreak,
      maxBreakMinutes,
      elapsedSeconds,
      formattedTime,
      refetch,
    }),
    [data, isLoading, activeSession, isCheckedIn, isOnBreak, activeBreak, maxBreakMinutes, elapsedSeconds, formattedTime, refetch]
  );

  return (
    <AttendanceContext.Provider value={value}>
      {children}
    </AttendanceContext.Provider>
  );
}

export function useAttendanceContext(): AttendanceContextValue {
  const context = React.useContext(AttendanceContext);
  if (!context) {
    throw new Error("useAttendanceContext must be used within an AttendanceProvider");
  }
  return context;
}

export function useOptionalAttendanceContext(): AttendanceContextValue | null {
  return React.useContext(AttendanceContext);
}


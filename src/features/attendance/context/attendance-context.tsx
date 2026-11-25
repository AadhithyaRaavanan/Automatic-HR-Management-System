"use client";

import * as React from "react";
import {
  useAttendanceToday,
  TodayAttendanceData,
  AttendanceSessionItem,
} from "../hooks/use-attendance-today";
import { calculateElapsedSeconds } from "@/lib/date/timezone";

interface AttendanceContextValue {
  data: TodayAttendanceData | undefined;
  isLoading: boolean;
  activeSession: AttendanceSessionItem | null;
  isCheckedIn: boolean;
  isOnBreak: boolean;
  activeBreak: any | null;
  elapsedSeconds: number;
  formattedTime: string;
  refetch: () => Promise<any>;
}

const AttendanceContext = React.createContext<AttendanceContextValue | null>(null);

function parseActiveSessionBreaks(rawNote: string | null) {
  if (!rawNote) return { activeBreak: null, completedBreakSeconds: 0 };
  try {
    const parsed = JSON.parse(rawNote);
    const breaks = Array.isArray(parsed?.breaks) ? parsed.breaks : [];
    let completedSec = 0;
    let activeBreak = null;
    for (const b of breaks) {
      if (b.status === "active") {
        activeBreak = b;
      } else if (b.status === "completed" && b.startTime && b.endTime) {
        const dur = Math.max(0, Math.floor((new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 1000));
        completedSec += dur;
      }
    }
    return { activeBreak, completedBreakSeconds: completedSec };
  } catch {
    return { activeBreak: null, completedBreakSeconds: 0 };
  }
}

export function AttendanceProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, refetch } = useAttendanceToday();
  const activeSession = data?.activeSession || null;
  const isCheckedIn = Boolean(activeSession);
  const checkInAt = activeSession?.check_in_at || null;

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
      elapsedSeconds,
      formattedTime,
      refetch,
    }),
    [data, isLoading, activeSession, isCheckedIn, isOnBreak, activeBreak, elapsedSeconds, formattedTime, refetch]
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


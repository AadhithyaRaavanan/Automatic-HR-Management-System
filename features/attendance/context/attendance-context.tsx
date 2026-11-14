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
  elapsedSeconds: number;
  formattedTime: string;
  refetch: () => Promise<any>;
}

const AttendanceContext = React.createContext<AttendanceContextValue | null>(null);

export function AttendanceProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, refetch } = useAttendanceToday();
  const activeSession = data?.activeSession || null;
  const isCheckedIn = Boolean(activeSession);
  const checkInAt = activeSession?.check_in_at || null;

  // Authoritatively calculate elapsed seconds from database UTC timestamp
  const [elapsedSeconds, setElapsedSeconds] = React.useState<number>(() => {
    return checkInAt ? calculateElapsedSeconds(checkInAt) : 0;
  });

  React.useEffect(() => {
    if (!checkInAt) {
      setElapsedSeconds(0);
      return;
    }

    setElapsedSeconds(calculateElapsedSeconds(checkInAt));

    const interval = setInterval(() => {
      setElapsedSeconds(calculateElapsedSeconds(checkInAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [checkInAt]);

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
      elapsedSeconds,
      formattedTime,
      refetch,
    }),
    [data, isLoading, activeSession, isCheckedIn, elapsedSeconds, formattedTime, refetch]
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


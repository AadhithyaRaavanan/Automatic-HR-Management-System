"use client";

import * as React from "react";
import { calculateElapsedSeconds } from "@/lib/date/timezone";
import { useAttendanceContext } from "../context/attendance-context";

export function useAttendanceTimer(checkInAtIso?: string | null) {
  let contextValue: ReturnType<typeof useAttendanceContext> | null = null;
  try {
    contextValue = useAttendanceContext();
  } catch {
    contextValue = null;
  }

  const [localSeconds, setLocalSeconds] = React.useState<number>(() => {
    return checkInAtIso ? calculateElapsedSeconds(checkInAtIso) : 0;
  });

  React.useEffect(() => {
    if (contextValue) return; // Managed by root AttendanceProvider
    if (!checkInAtIso) {
      setLocalSeconds(0);
      return;
    }

    setLocalSeconds(calculateElapsedSeconds(checkInAtIso));
    const interval = setInterval(() => {
      setLocalSeconds(calculateElapsedSeconds(checkInAtIso));
    }, 1000);

    return () => clearInterval(interval);
  }, [checkInAtIso, contextValue]);

  if (contextValue && (!checkInAtIso || checkInAtIso === contextValue.activeSession?.check_in_at)) {
    return {
      elapsedSeconds: contextValue.elapsedSeconds,
      formattedTime: contextValue.formattedTime,
      isRunning: contextValue.isCheckedIn && !contextValue.isOnBreak,
      isOnBreak: contextValue.isOnBreak,
    };
  }

  const hours = Math.floor(localSeconds / 3600);
  const minutes = Math.floor((localSeconds % 3600) / 60);
  const seconds = localSeconds % 60;
  const formattedTime = `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  return {
    elapsedSeconds: localSeconds,
    formattedTime,
    isRunning: Boolean(checkInAtIso),
  };
}

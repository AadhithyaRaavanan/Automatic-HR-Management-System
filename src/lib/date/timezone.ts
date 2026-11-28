import { format, differenceInMinutes, parseISO } from "date-fns";
import { toZonedTime, fromZonedTime, format as formatZoned } from "date-fns-tz";

/**
 * Converts a local YYYY-MM-DD date and HH:mm time in an IANA timezone to a UTC ISO string.
 */
export function localDateTimeToUtcIso(
  workDate: string,
  timeHHmm: string,
  timezone: string = "UTC"
): string {
  const cleanTime = timeHHmm.length === 5 ? `${timeHHmm}:00` : timeHHmm;
  try {
    return fromZonedTime(`${workDate}T${cleanTime}`, timezone || "UTC").toISOString();
  } catch {
    return new Date(`${workDate}T${cleanTime}Z`).toISOString();
  }
}

/**
 * Returns the work date (YYYY-MM-DD) calculated authoritatively in the employee's timezone.
 * For overnight night shifts (e.g. 17:00 to 01:00), punches between 00:00 and shift_end_time (01:00)
 * belong to yesterday's scheduled work session.
 */
export function getEmployeeWorkDate(
  timezone: string = "Asia/Kolkata",
  date: Date = new Date(),
  shiftStartTime?: string,
  shiftEndTime?: string
): string {
  const effectiveTz = !timezone ? "Asia/Kolkata" : timezone;
  try {
    const zonedDate = toZonedTime(date, effectiveTz);

    if (shiftStartTime && shiftEndTime && isNightShift(shiftStartTime, shiftEndTime)) {
      const [endH = 0, endM = 0] = shiftEndTime.split(":").map(Number);
      const currentMins = zonedDate.getHours() * 60 + zonedDate.getMinutes();
      const shiftEndMins = endH * 60 + endM;
      if (currentMins <= shiftEndMins) {
        const prevDay = new Date(zonedDate.getTime() - 24 * 60 * 60 * 1000);
        return format(prevDay, "yyyy-MM-dd");
      }
    }

    return format(zonedDate, "yyyy-MM-dd");
  } catch {
    return format(date, "yyyy-MM-dd");
  }
}

/**
 * Formats a total minute count into a clean human readable duration: "08h 30m"
 */
export function formatDurationMinutes(totalMinutes: number): string {
  const clamped = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${hours.toString().padStart(2, "0")}h ${minutes.toString().padStart(2, "0")}m`;
}

/**
 * Formats a timestamp into human-readable local time: "09:30 AM"
 */
export function formatTimeInTimezone(
  dateInput: string | Date,
  timezone?: string,
  formatString: string = "hh:mm a"
): string {
  const effectiveTz = timezone || "Asia/Kolkata";
  try {
    const date = typeof dateInput === "string" ? parseISO(dateInput) : dateInput;
    return formatZoned(toZonedTime(date, effectiveTz), formatString);
  } catch {
    return "--:--";
  }
}

/**
 * Calculates elapsed continuous seconds from a check_in_at timestamp to now
 */
export function calculateElapsedSeconds(checkInAtIso: string): number {
  try {
    const checkInDate = parseISO(checkInAtIso);
    const now = new Date();
    const diffMs = now.getTime() - checkInDate.getTime();
    return Math.max(0, Math.floor(diffMs / 1000));
  } catch {
    return 0;
  }
}

/**
 * Evaluates whether an arrival is late based on expected start time (e.g. 09:00 AM) and grace period
 */
export function isLateArrival(
  checkInAtIso: string,
  timezone: string = "Asia/Kolkata",
  expectedStartHour: number = 9,
  expectedStartMinute: number = 0,
  graceMinutes: number = 15
): boolean {
  try {
    const checkInDate = parseISO(checkInAtIso);
    const effectiveTz = timezone || "Asia/Kolkata";
    const zoned = toZonedTime(checkInDate, effectiveTz);
    const checkInHour = zoned.getHours();
    const checkInMinute = zoned.getMinutes();

    const actualTotalMinutes = checkInHour * 60 + checkInMinute;
    const allowedThreshold = expectedStartHour * 60 + expectedStartMinute + graceMinutes;

    return actualTotalMinutes > allowedThreshold;
  } catch {
    return false;
  }
}

/**
 * Validates session length and caps at 16 hours
 */
export function calculateSessionDuration(
  checkInAtIso: string,
  checkOutAtIso?: string | null,
  maxCapHours: number = 16
): { durationMinutes: number; wasCapped: boolean } {
  try {
    const start = parseISO(checkInAtIso);
    const end = checkOutAtIso ? parseISO(checkOutAtIso) : new Date();
    const diffMins = differenceInMinutes(end, start);

    const maxMinutes = maxCapHours * 60;
    if (diffMins > maxMinutes) {
      return { durationMinutes: maxMinutes, wasCapped: true };
    }
    return { durationMinutes: Math.max(0, diffMins), wasCapped: false };
  } catch {
    return { durationMinutes: 0, wasCapped: false };
  }
}

/**
 * Checks if a shift crosses midnight (night shift, e.g. 17:00 to 01:00)
 */
export function isNightShift(shiftStartTime: string, shiftEndTime: string): boolean {
  if (!shiftStartTime || !shiftEndTime) return false;
  const [startH, startM = 0] = shiftStartTime.split(":").map(Number);
  const [endH, endM = 0] = shiftEndTime.split(":").map(Number);
  return endH * 60 + endM < startH * 60 + startM;
}

/**
 * Computes human-readable 12-hour time when check-in opens (5 mins prior to shift start)
 * e.g. "09:00:00" -> "08:55 AM"
 */
export function getCheckInOpenTime(shiftStartTime: string = "09:00:00"): string {
  try {
    const [startH, startM = 0] = shiftStartTime.split(":").map(Number);
    let openMins = startH * 60 + startM - 5;
    if (openMins < 0) openMins += 24 * 60;
    const h24 = Math.floor(openMins / 60) % 24;
    const m = openMins % 60;
    const ampm = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")} ${ampm}`;
  } catch {
    return "08:55 AM";
  }
}

/**
 * Evaluates whether check-in is currently locked because it is outside shift time.
 * Supports standard shifts and overnight night shifts across timezones.
 */
export function evaluatePreCheckInLock(
  shiftStartTime: string = "09:00:00",
  shiftEndTime: string = "17:00:00",
  timezone: string = "Asia/Kolkata",
  currentDate: Date = new Date()
): {
  isLocked: boolean;
  openTimeString: string;
  isShiftStarted: boolean;
  reason?: "before_shift" | "after_shift";
  message?: string;
  shiftStartFormatted: string;
  shiftEndFormatted: string;
} {
  try {
    const [startH = 9, startM = 0] = (shiftStartTime || "09:00:00").split(":").map(Number);
    const [endH = 17, endM = 0] = (shiftEndTime || "17:00:00").split(":").map(Number);
    const effectiveTz = timezone || "Asia/Kolkata";
    const zoned = toZonedTime(currentDate, effectiveTz);
    const currentMins = zoned.getHours() * 60 + zoned.getMinutes();

    let openMins = startH * 60 + startM - 5;
    if (openMins < 0) openMins += 24 * 60;

    const shiftStartMins = startH * 60 + startM;
    const shiftEndMins = endH * 60 + endM;
    const crossesMidnight = shiftEndMins < shiftStartMins;

    const openTimeString = getCheckInOpenTime(shiftStartTime);
    const shiftStartFormatted = `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;
    const shiftEndFormatted = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

    if (crossesMidnight) {
      // Night shift e.g. 17:00 to 01:00
      // Check-in is allowed from 5 mins prior to shift start (16:55) through shift end (01:00)
      const isWithinShiftWindow = currentMins >= openMins || currentMins <= shiftEndMins;
      const isShiftStarted = currentMins >= shiftStartMins || currentMins <= shiftEndMins;

      if (!isWithinShiftWindow) {
        const isAfter = currentMins > shiftEndMins && currentMins < 12 * 60;
        const reason = isAfter ? "after_shift" : "before_shift";
        const message = isAfter
          ? `Your shift ended at ${shiftEndFormatted}. Check-in is not allowed outside your shift hours.`
          : `Check-in is locked until your shift opens at ${openTimeString} (${shiftStartFormatted} - ${shiftEndFormatted}).`;
        return {
          isLocked: true,
          openTimeString,
          isShiftStarted: false,
          reason,
          message,
          shiftStartFormatted,
          shiftEndFormatted,
        };
      }

      return {
        isLocked: false,
        openTimeString,
        isShiftStarted,
        shiftStartFormatted,
        shiftEndFormatted,
      };
    } else {
      // Standard daytime shift e.g. 09:00 to 17:00
      // Check-in is allowed from 5 mins prior to shift start (08:55) through shift end (17:00)
      const isShiftStarted = currentMins >= shiftStartMins;

      if (currentMins < openMins) {
        return {
          isLocked: true,
          openTimeString,
          isShiftStarted: false,
          reason: "before_shift",
          message: `Check-in is locked until your shift opens at ${openTimeString} (${shiftStartFormatted} - ${shiftEndFormatted}).`,
          shiftStartFormatted,
          shiftEndFormatted,
        };
      }

      if (currentMins > shiftEndMins) {
        return {
          isLocked: true,
          openTimeString,
          isShiftStarted: false,
          reason: "after_shift",
          message: `Your shift ended at ${shiftEndFormatted}. Check-in is not allowed outside your shift hours.`,
          shiftStartFormatted,
          shiftEndFormatted,
        };
      }

      return {
        isLocked: false,
        openTimeString,
        isShiftStarted,
        shiftStartFormatted,
        shiftEndFormatted,
      };
    }
  } catch {
    return {
      isLocked: false,
      openTimeString: "08:55 AM",
      isShiftStarted: true,
      shiftStartFormatted: "09:00",
      shiftEndFormatted: "17:00",
    };
  }
}

/**
 * Evaluates whether checkout is early relative to shift end in Asia/Kolkata timezone.
 * Handles overnight shifts (e.g. 17:00 to 01:00 where end falls on the next calendar day).
 */
export function evaluateEarlyCheckout(
  checkInAtIso: string,
  shiftStartTime: string = "09:00:00",
  shiftEndTime: string = "17:00:00",
  timezone: string = "Asia/Kolkata",
  now: Date = new Date()
): {
  isEarly: boolean;
  minutesEarly: number;
  shiftEndTimeFormatted: string;
  formattedEarly: string;
  dialogMessage: string;
} {
  try {
    const [startH = 9, startM = 0] = (shiftStartTime || "09:00:00").split(":").map(Number);
    const [endH = 17, endM = 0] = (shiftEndTime || "17:00:00").split(":").map(Number);

    const effectiveTz = timezone || "Asia/Kolkata";
    const checkInDate = new Date(checkInAtIso);
    const checkInZoned = toZonedTime(checkInDate, effectiveTz);
    const workDateStr = format(checkInZoned, "yyyy-MM-dd");

    const isNight = (endH * 60 + endM) < (startH * 60 + startM);
    let shiftEndDateStr = workDateStr;
    if (isNight) {
      const nextDay = new Date(checkInZoned.getTime() + 24 * 60 * 60 * 1000);
      shiftEndDateStr = format(nextDay, "yyyy-MM-dd");
    }

    const endHStr = String(endH).padStart(2, "0");
    const endMStr = String(endM).padStart(2, "0");
    const shiftEndTimeFormatted = `${endHStr}:${endMStr}`;

    const shiftEndIso = `${shiftEndDateStr}T${shiftEndTimeFormatted}:00`;
    const shiftEndUtc = fromZonedTime(shiftEndIso, effectiveTz);

    const diffMs = shiftEndUtc.getTime() - now.getTime();
    const isEarly = diffMs > 0;
    const minutesEarly = isEarly ? Math.ceil(diffMs / 60000) : 0;

    const hours = Math.floor(minutesEarly / 60);
    const mins = minutesEarly % 60;
    const formattedEarly = `${hours} h ${mins} m`;
    const dialogMessage = `Your shift ends at ${shiftEndTimeFormatted}. You are checking out ${formattedEarly} early. Check out anyway?`;

    return {
      isEarly,
      minutesEarly,
      shiftEndTimeFormatted,
      formattedEarly,
      dialogMessage,
    };
  } catch {
    return {
      isEarly: false,
      minutesEarly: 0,
      shiftEndTimeFormatted: "17:00",
      formattedEarly: "0 h 0 m",
      dialogMessage: "",
    };
  }
}




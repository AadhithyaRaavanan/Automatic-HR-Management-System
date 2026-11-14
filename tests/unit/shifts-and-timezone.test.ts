import { describe, it, expect } from "vitest";
import {
  evaluatePreCheckInLock,
  getCheckInOpenTime,
  isNightShift,
} from "@/lib/date/timezone";

describe("Shift Management & Night Shift Crossover Unit Tests", () => {
  describe("1. 5-Minute Pre-Check-In Lock & Open Time Formatter", () => {
    it("formats 5-minute pre-check-in opening time correctly for daytime shift", () => {
      expect(getCheckInOpenTime("09:00:00")).toBe("08:55 AM");
      expect(getCheckInOpenTime("10:30:00")).toBe("10:25 AM");
      expect(getCheckInOpenTime("14:00:00")).toBe("01:55 PM");
    });

    it("formats 5-minute pre-check-in opening time correctly for evening/night shift", () => {
      expect(getCheckInOpenTime("17:00:00")).toBe("04:55 PM");
      expect(getCheckInOpenTime("20:00:00")).toBe("07:55 PM");
      expect(getCheckInOpenTime("00:00:00")).toBe("11:55 PM");
    });

    it("locks check-in before 5 minutes prior to shift start", () => {
      // 08:30 AM (before 08:55 AM open)
      const dateBefore = new Date("2026-11-14T08:30:00Z");
      const status = evaluatePreCheckInLock("09:00:00", "17:00:00", "UTC", dateBefore);

      expect(status.isLocked).toBe(true);
      expect(status.openTimeString).toBe("08:55 AM");
      expect(status.isShiftStarted).toBe(false);
    });

    it("unlocks check-in exactly at 5 minutes prior to shift start", () => {
      // 08:55 AM (exactly at open)
      const dateAtOpen = new Date("2026-11-14T08:55:00Z");
      const status = evaluatePreCheckInLock("09:00:00", "17:00:00", "UTC", dateAtOpen);

      expect(status.isLocked).toBe(false);
      expect(status.openTimeString).toBe("08:55 AM");
      expect(status.isShiftStarted).toBe(false);
    });

    it("marks shift started at exact shift start time", () => {
      // 09:00 AM
      const dateAtStart = new Date("2026-11-14T09:00:00Z");
      const status = evaluatePreCheckInLock("09:00:00", "17:00:00", "UTC", dateAtStart);

      expect(status.isLocked).toBe(false);
      expect(status.isShiftStarted).toBe(true);
    });
  });

  describe("2. Night Shift & Midnight Crossover Support (e.g. 5:00 PM to 1:00 AM)", () => {
    it("detects shifts that cross midnight as night shifts", () => {
      expect(isNightShift("17:00:00", "01:00:00")).toBe(true);
      expect(isNightShift("20:00:00", "04:00:00")).toBe(true);
      expect(isNightShift("22:00:00", "06:00:00")).toBe(true);
    });

    it("detects daytime shifts as non-night shifts", () => {
      expect(isNightShift("09:00:00", "17:00:00")).toBe(false);
      expect(isNightShift("08:00:00", "16:30:00")).toBe(false);
    });

    it("keeps check-in active across midnight for night shifts", () => {
      // Shift is 17:00 to 01:00
      // At 23:50 (before midnight)
      const beforeMidnight = new Date("2026-11-14T23:50:00Z");
      const status1 = evaluatePreCheckInLock("17:00:00", "01:00:00", "UTC", beforeMidnight);
      expect(status1.isLocked).toBe(false);
      expect(status1.isShiftStarted).toBe(true);

      // At 00:30 (after midnight)
      const afterMidnight = new Date("2026-11-15T00:30:00Z");
      const status2 = evaluatePreCheckInLock("17:00:00", "01:00:00", "UTC", afterMidnight);
      expect(status2.isLocked).toBe(false);
      expect(status2.isShiftStarted).toBe(true);
    });
  });
});


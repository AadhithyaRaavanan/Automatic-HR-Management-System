"use client";

import * as React from "react";
import { BentoCard } from "@/components/bento/bento-card";
import { Play, Square, Clock, ShieldCheck, CheckCircle2, Lock, AlertCircle } from "lucide-react";
import { evaluatePreCheckInLock } from "@/lib/date/timezone";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/features";

interface HeroCheckInCardProps {
  isCheckedIn?: boolean;
  isOnBreak?: boolean;
  activeTime?: string;
  workDate?: string;
  targetMinutes?: number;
  shiftStartTime?: string;
  shiftEndTime?: string;
  userTimezone?: string;
  onCheckIn?: () => void;
  onCheckOut?: () => void;
  isLoading?: boolean;
  className?: string;
}

export function HeroCheckInCard({
  isCheckedIn = false,
  isOnBreak = false,
  activeTime = "00:00:00",
  workDate = "Today",
  targetMinutes = 480,
  shiftStartTime = "09:00:00",
  shiftEndTime = "18:00:00",
  userTimezone = "Asia/Kolkata",
  onCheckIn,
  onCheckOut,
  isLoading = false,
  className,
}: HeroCheckInCardProps) {
  const hasNotifiedShiftStartRef = React.useRef(false);
  const serverOffsetRef = React.useRef(0);

  // Synchronize with authoritative internet/server time
  React.useEffect(() => {
    async function syncServerClock() {
      try {
        const t0 = Date.now();
        const res = await fetch("/api/time", { cache: "no-store" });
        if (res.ok) {
          const t1 = Date.now();
          const json = await res.json();
          const latency = (t1 - t0) / 2;
          serverOffsetRef.current = json.epoch + latency - t1;
        }
      } catch {}
    }
    syncServerClock();
  }, []);

  // Evaluate pre-check-in lock and shift start status using synced time
  const [lockStatus, setLockStatus] = React.useState(() =>
    evaluatePreCheckInLock(shiftStartTime, shiftEndTime, userTimezone, new Date())
  );

  React.useEffect(() => {
    const updateLock = () => {
      const syncedNow = new Date(Date.now() + serverOffsetRef.current);
      const status = evaluatePreCheckInLock(shiftStartTime, shiftEndTime, userTimezone, syncedNow);
      setLockStatus(status);

      // Trigger Shift-Start Notification if online at shift start, shift is active/unlocked, and not checked in
      if (!isCheckedIn && !status.isLocked && status.isShiftStarted && !hasNotifiedShiftStartRef.current) {
        hasNotifiedShiftStartRef.current = true;
        toast.info("Your shift starts now! Please check in.", {
          id: "shift-start-alert",
          duration: 8000,
        });
      }
    };

    updateLock();
    const interval = setInterval(updateLock, 15000); // Check every 15s
    return () => clearInterval(interval);
  }, [shiftStartTime, shiftEndTime, userTimezone, isCheckedIn]);

  // Reset shift notification flag if user checks in or day changes
  React.useEffect(() => {
    if (isCheckedIn) {
      hasNotifiedShiftStartRef.current = true;
    }
  }, [isCheckedIn]);

  const isCheckInDisabled =
    isLoading || (!isCheckedIn && lockStatus.isLocked);

  const handleToggle = () => {
    if (isCheckedIn) {
      onCheckOut?.();
    } else {
      if (lockStatus.isLocked) {
        toast.error(
          lockStatus.message ||
          `Check-in is only allowed during your shift hours (${shiftStartTime.slice(0, 5)} - ${shiftEndTime.slice(0, 5)}).`
        );
        return;
      }
      onCheckIn?.();
    }
  };

  return (
    <BentoCard
      className={cn(
        "p-6 relative overflow-hidden transition-all duration-200 border-border-light",
        className
      )}
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium",
                isOnBreak
                  ? "bg-brand-purple/15 text-brand-purple border border-brand-purple/30"
                  : isCheckedIn
                  ? "bg-status-success-bg text-status-success-text"
                  : "bg-card-subtle text-text-secondary"
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  isOnBreak
                    ? "bg-brand-purple animate-pulse"
                    : isCheckedIn
                    ? "bg-status-success-dot"
                    : "bg-text-tertiary"
                )}
              />
              {isOnBreak ? "On break (Shift paused)" : isCheckedIn ? "Active session" : "Checked out"}
            </span>

            {/* Shift Lock Status Badge */}
            {!isCheckedIn && lockStatus.isLocked && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-status-warning/10 text-status-warning border border-status-warning/30">
                <Lock className="w-3 h-3" />
                <span>
                  {lockStatus.reason === "after_shift"
                    ? `Shift ended at ${shiftEndTime.slice(0, 5)}`
                    : `Check-in opens at ${lockStatus.openTimeString}`}
                </span>
              </span>
            )}

            <span className="text-xs text-text-tertiary font-medium">
              Target: {Math.floor(targetMinutes / 60)}h {targetMinutes % 60}m
            </span>
          </div>

          <div className="mt-3">
            <div className="text-3xl md:text-4xl font-semibold tracking-tight text-text-primary tabular-nums">
              {isCheckedIn ? activeTime : "00:00:00"}
            </div>
            <p className="text-xs text-text-secondary mt-1 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {isOnBreak
                ? "Shift timer paused during break"
                : isCheckedIn
                ? `Session running for ${workDate}`
                : lockStatus.isLocked
                  ? lockStatus.reason === "after_shift"
                    ? `Shift ended (${shiftStartTime.slice(0, 5)} - ${shiftEndTime.slice(0, 5)})`
                    : `Scheduled shift: ${shiftStartTime.slice(0, 5)} - ${shiftEndTime.slice(0, 5)}`
                  : "Ready to start your work day?"}
            </p>
          </div>
        </div>

        <div data-tour="punch-checkout" className="flex flex-col items-end gap-1.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleToggle}
            disabled={isCheckInDisabled}
            className={cn(
              "w-full sm:w-auto px-5 py-2.5 rounded-lg font-medium text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed",
              isCheckedIn
                ? "bg-status-danger-bg text-status-danger-text hover:bg-status-danger-bg/80 border border-status-danger-dot/20"
                : lockStatus.isLocked
                  ? "bg-card-subtle text-text-tertiary border border-border-light hover:bg-card-subtle"
                  : "bg-brand-navy text-white hover:bg-brand-navy-hover border border-border-light/20"
            )}
          >
            {isCheckedIn ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Check Out Now</span>
              </>
            ) : lockStatus.isLocked ? (
              <>
                <Lock className="w-3.5 h-3.5" />
                <span>
                  {lockStatus.reason === "after_shift"
                    ? "Outside shift hours"
                    : "Check-in locked"}
                </span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Check in</span>
              </>
            )}
          </button>

          {!isCheckedIn && lockStatus.isLocked && (
            <span className="text-[11px] text-text-tertiary text-right">
              {lockStatus.reason === "after_shift"
                ? `Shift: ${shiftStartTime.slice(0, 5)} - ${shiftEndTime.slice(0, 5)}`
                : `Opens 5m prior to ${shiftStartTime.slice(0, 5)}`}
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-border-light/60 flex items-center justify-between text-xs text-text-tertiary">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-text-tertiary" />
          {FEATURES.SHIFTS
            ? `Shift: ${shiftStartTime.slice(0, 5)} - ${shiftEndTime.slice(0, 5)} (${userTimezone})`
            : `Timezone: ${userTimezone}`}
        </span>
      </div>
    </BentoCard>
  );
}

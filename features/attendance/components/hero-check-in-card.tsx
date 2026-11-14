"use client";

import * as React from "react";
import { BentoCard } from "@/components/bento/bento-card";
import { Play, Square, Clock, ShieldCheck, Sparkles, Lock, AlertCircle } from "lucide-react";
import { evaluatePreCheckInLock } from "@/lib/date/timezone";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface HeroCheckInCardProps {
  isCheckedIn?: boolean;
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
  activeTime = "00:00:00",
  workDate = "Today",
  targetMinutes = 480,
  shiftStartTime = "09:00:00",
  shiftEndTime = "17:00:00",
  userTimezone = "UTC",
  onCheckIn,
  onCheckOut,
  isLoading = false,
  className,
}: HeroCheckInCardProps) {
  const hasNotifiedShiftStartRef = React.useRef(false);

  // Evaluate 5-minute pre-check-in lock and shift start status
  const [lockStatus, setLockStatus] = React.useState(() =>
    evaluatePreCheckInLock(shiftStartTime, shiftEndTime, userTimezone)
  );

  React.useEffect(() => {
    const updateLock = () => {
      const status = evaluatePreCheckInLock(shiftStartTime, shiftEndTime, userTimezone);
      setLockStatus(status);

      // Trigger Shift-Start Notification if online at shift start and not checked in
      if (!isCheckedIn && status.isShiftStarted && !hasNotifiedShiftStartRef.current) {
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
        toast.error(`Check-in is locked until 5 minutes before your shift (${lockStatus.openTimeString}).`);
        return;
      }
      onCheckIn?.();
    }
  };

  return (
    <BentoCard
      className={cn(
        "p-6 relative overflow-hidden transition-all duration-300",
        isCheckedIn
          ? "border-brand-purple/40 shadow-float"
          : "border-border-light",
        className
      )}
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold",
                isCheckedIn
                  ? "bg-status-success-bg text-status-success-text"
                  : "bg-card-subtle text-text-secondary"
              )}
            >
              <span
                className={cn(
                  "w-2 h-2 rounded-full",
                  isCheckedIn
                    ? "bg-status-success-dot animate-pulse"
                    : "bg-text-tertiary"
                )}
              />
              {isCheckedIn ? "Active Session" : "Checked Out"}
            </span>

            {/* 5-Min Pre-Check-In Badge */}
            {!isCheckedIn && lockStatus.isLocked && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-status-warning/10 text-status-warning border border-status-warning/30 animate-in fade-in">
                <Lock className="w-3 h-3" />
                <span>Check-in opens at {lockStatus.openTimeString}</span>
              </span>
            )}

            <span className="text-xs text-text-tertiary font-medium">
              Target: {Math.floor(targetMinutes / 60)}h {targetMinutes % 60}m
            </span>
          </div>

          <div className="mt-3">
            <div className="text-3xl md:text-4xl font-extrabold tracking-tight text-text-primary font-mono">
              {isCheckedIn ? activeTime : "00:00:00"}
            </div>
            <p className="text-xs text-text-secondary mt-1 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {isCheckedIn
                ? `Session running for ${workDate}`
                : lockStatus.isLocked
                ? `Scheduled shift: ${shiftStartTime.slice(0, 5)} - ${shiftEndTime.slice(0, 5)}`
                : "Ready to start your work day?"}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleToggle}
            disabled={isCheckInDisabled}
            className={cn(
              "w-full sm:w-auto px-6 py-3.5 rounded-2xl font-bold text-sm tracking-wide shadow-md transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer active:scale-95 select-none disabled:opacity-50 disabled:cursor-not-allowed",
              isCheckedIn
                ? "bg-status-danger-bg text-status-danger-text hover:bg-status-danger-bg/80 border border-status-danger-dot/20"
                : lockStatus.isLocked
                ? "bg-card-subtle text-text-tertiary border border-border-light hover:bg-card-subtle"
                : "bg-brand-navy text-white hover:bg-brand-navy-hover hover:shadow-lg border border-border-light/20"
            )}
          >
            {isCheckedIn ? (
              <>
                <Square className="w-4 h-4 fill-current" />
                <span>Check Out Now</span>
              </>
            ) : lockStatus.isLocked ? (
              <>
                <Lock className="w-4 h-4" />
                <span>Check In Locked</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Check In</span>
              </>
            )}
          </button>

          {!isCheckedIn && lockStatus.isLocked && (
            <span className="text-[10px] text-text-tertiary text-right">
              Opens 5m prior to {shiftStartTime.slice(0, 5)}
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-border-light/60 flex items-center justify-between text-xs text-text-tertiary">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-brand-purple" />
          Shift: {shiftStartTime.slice(0, 5)} - {shiftEndTime.slice(0, 5)} ({userTimezone})
        </span>
        <span className="flex items-center gap-1 font-semibold text-brand-purple">
          <Sparkles className="w-3.5 h-3.5" />
          Auto-regularization supported
        </span>
      </div>
    </BentoCard>
  );
}

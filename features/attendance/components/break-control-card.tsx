"use client";

import * as React from "react";
import { BentoCard } from "@/components/bento/bento-card";
import { Coffee, Utensils, Play, Square, Check, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface BreakControlCardProps {
  isCheckedIn: boolean;
  className?: string;
}

export function BreakControlCard({ isCheckedIn, className }: BreakControlCardProps) {
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [activeBreak, setActiveBreak] = React.useState<any>(null);
  const [shortBreakTaken, setShortBreakTaken] = React.useState(false);
  const [lunchBreakTaken, setLunchBreakTaken] = React.useState(false);
  const [canTakeShort, setCanTakeShort] = React.useState(true);
  const [canTakeLunch, setCanTakeLunch] = React.useState(true);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);

  const fetchBreaks = React.useCallback(async () => {
    try {
      const res = await fetch("/api/attendance/breaks");
      if (res.ok) {
        const data = await res.json();
        setActiveBreak(data.activeBreak || null);
        setShortBreakTaken(data.shortBreakTaken);
        setLunchBreakTaken(data.lunchBreakTaken);
        setCanTakeShort(data.canTakeShortBreak);
        setCanTakeLunch(data.canTakeLunchBreak);

        if (data.activeBreak?.startTime) {
          const startedAt = new Date(data.activeBreak.startTime).getTime();
          setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        }
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchBreaks();
  }, [fetchBreaks]);

  // Break timer ticker
  React.useEffect(() => {
    if (!activeBreak) return;
    const interval = setInterval(() => {
      const startedAt = new Date(activeBreak.startTime).getTime();
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeBreak]);

  const handleStartBreak = async (type: "short_break" | "lunch_break") => {
    if (!isCheckedIn) {
      toast.error("You must be checked in to an active shift before taking a break.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/attendance/breaks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", breakType: type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start break.");

      toast.success(data.message);
      await fetchBreaks();
    } catch (err: any) {
      toast.error(err.message || "Failed to start break.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndBreak = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/attendance/breaks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to end break.");

      toast.success(data.message);
      await fetchBreaks();
    } catch (err: any) {
      toast.error(err.message || "Failed to end break.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const maxAllowedMins = activeBreak?.type === "short_break" ? 15 : 60;
  const isOvertime = Math.floor(elapsedSeconds / 60) >= maxAllowedMins;

  return (
    <BentoCard className={cn("p-6 flex flex-col justify-between", className)}>
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-border-light">
          <div className="flex items-center gap-2">
            <Coffee className="w-4 h-4 text-brand-purple" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Work Shift Breaks
            </h3>
          </div>
          <span className="text-[11px] font-bold text-text-secondary bg-card-subtle px-2.5 py-0.5 rounded-full border border-border-light">
            Policy: 1x 15m Break + 1x 1h Lunch
          </span>
        </div>

        {activeBreak ? (
          <div className="mt-4 p-4 rounded-2xl bg-brand-purple/10 border border-brand-purple/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-brand-purple flex items-center gap-1.5 uppercase tracking-wide">
                <Clock className="w-4 h-4 animate-spin" />
                {activeBreak.type === "short_break" ? "15-Min Break Active" : "1-Hour Lunch Break Active"}
              </span>
              <span className={cn(
                "text-lg font-mono font-extrabold",
                isOvertime ? "text-status-danger" : "text-brand-purple"
              )}>
                {formatTimer(elapsedSeconds)} / {maxAllowedMins}:00
              </span>
            </div>

            {isOvertime && (
              <p className="text-[11px] font-bold text-status-danger flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                Break time limit exceeded! Please resume your shift.
              </p>
            )}

            <button
              type="button"
              disabled={submitting}
              onClick={handleEndBreak}
              className="w-full py-2 px-4 rounded-lg bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>{submitting ? "Ending break..." : "End break and resume work"}</span>
            </button>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* 15-Minute Short Break */}
            <div className="p-3.5 rounded-xl bg-card-subtle border border-border-light flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-card border border-border-light flex items-center justify-center text-text-secondary">
                    <Coffee className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-text-primary">Short break</h4>
                    <p className="text-[10px] text-text-tertiary">15 minutes allowance</p>
                  </div>
                </div>
                {shortBreakTaken && (
                  <span className="p-1 rounded-full bg-status-success/15 text-status-success">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={submitting || !canTakeShort || !isCheckedIn}
                onClick={() => handleStartBreak("short_break")}
                className="w-full py-1.5 px-3 rounded-lg bg-card border border-border-light hover:bg-brand-purple hover:text-white text-xs font-medium text-text-primary transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>{shortBreakTaken ? "Already taken" : "Take break (15m)"}</span>
              </button>
            </div>

            {/* 1-Hour Lunch Break */}
            <div className="p-3.5 rounded-xl bg-card-subtle border border-border-light flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-card border border-border-light flex items-center justify-center text-text-secondary">
                    <Utensils className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-text-primary">Lunch break</h4>
                    <p className="text-[10px] text-text-tertiary">1 hour allowance</p>
                  </div>
                </div>
                {lunchBreakTaken && (
                  <span className="p-1 rounded-full bg-status-success/15 text-status-success">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={submitting || !canTakeLunch || !isCheckedIn}
                onClick={() => handleStartBreak("lunch_break")}
                className="w-full py-1.5 px-3 rounded-lg bg-card border border-border-light hover:bg-brand-purple hover:text-white text-xs font-medium text-text-primary transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>{lunchBreakTaken ? "Already taken" : "Take lunch (1 hr)"}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-[10px] text-text-tertiary">
        Break periods are automatically logged in your daily timesheet record.
      </p>
    </BentoCard>
  );
}

"use client";

import * as React from "react";
import { Clock, Play, Square, Coffee, CheckCircle2, AlertCircle } from "lucide-react";
import { formatTimeInTimezone } from "@/lib/date/timezone";
import { cn } from "@/lib/utils";

export interface AttendanceSessionItem {
  id: string;
  check_in_at: string;
  check_out_at: string | null;
  duration_minutes?: number | null;
  source?: string;
  early_checkout?: boolean;
}

interface TodayTimelineProps {
  sessions: AttendanceSessionItem[];
  activeSession: AttendanceSessionItem | null;
  timezone?: string;
  className?: string;
}

export function TodayTimeline({
  sessions,
  activeSession,
  timezone = "Asia/Kolkata",
  className,
}: TodayTimelineProps) {
  if (!sessions || sessions.length === 0) {
    return (
      <div className="py-6 px-4 text-center rounded-2xl bg-card-subtle/50 border border-dashed border-border-light text-xs text-text-tertiary">
        No punch sessions logged today yet. Check in to record your first punch.
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border-light">
        {sessions.map((sess, idx) => {
          const isActive = sess.id === activeSession?.id && !sess.check_out_at;
          const checkInTime = formatTimeInTimezone(sess.check_in_at, timezone);
          const checkOutTime = sess.check_out_at
            ? formatTimeInTimezone(sess.check_out_at, timezone)
            : null;

          return (
            <div key={sess.id} className="relative group text-xs">
              {/* Timeline Dot */}
              <div
                className={cn(
                  "absolute -left-6 top-1 w-5 h-5 rounded-full border-2 bg-card flex items-center justify-center transition-all",
                  isActive
                    ? "border-lime text-black shadow-sm"
                    : "border-brand-purple text-brand-purple"
                )}
              >
                {isActive ? (
                  <span className="w-2 h-2 rounded-full bg-lime animate-ping" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-purple" />
                )}
              </div>

              {/* Session Details Card */}
              <div className="p-3 rounded-xl bg-card-subtle/70 border border-border-light flex items-center justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-text-primary">
                      Session #{sessions.length - idx}
                    </span>
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-extrabold bg-lime/25 text-black font-semibold">
                        Active Now
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-tertiary">Completed</span>
                    )}
                  </div>
                  <div className="text-[11px] text-text-secondary flex items-center gap-1.5 font-mono tabular-nums">
                    <span>In: {checkInTime}</span>
                    <span>→</span>
                    <span>{checkOutTime ? `Out: ${checkOutTime}` : "In Progress"}</span>
                  </div>
                </div>

                {/* Duration or Early Warning */}
                <div className="text-right shrink-0">
                  {sess.duration_minutes != null ? (
                    <span className="text-xs font-mono font-bold text-brand-purple tabular-nums">
                      {Math.floor(sess.duration_minutes / 60)}h {sess.duration_minutes % 60}m
                    </span>
                  ) : isActive ? (
                    <span className="text-[11px] font-bold text-black">Running</span>
                  ) : null}
                  {sess.early_checkout && (
                    <p className="text-[10px] text-rose-500 font-bold">Early punch</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

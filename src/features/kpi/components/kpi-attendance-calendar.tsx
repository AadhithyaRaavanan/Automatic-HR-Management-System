"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, ArrowRight, CheckCircle2 } from "lucide-react";
import type { KpiCalendarDay } from "@/features/kpi/compute";

interface KpiAttendanceCalendarProps {
  calendarDays: KpiCalendarDay[];
  periodLabel: string;
  actionableMissingDates: string[];
  pendingCorrectionDates: string[];
  isSelfView: boolean;
  employeeId: string;
  onInspectAttendanceDays: () => void;
  className?: string;
}

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function KpiAttendanceCalendar({
  calendarDays,
  periodLabel,
  actionableMissingDates,
  pendingCorrectionDates,
  isSelfView,
  employeeId,
  onInspectAttendanceDays,
  className,
}: KpiAttendanceCalendarProps) {
  const days = calendarDays || [];

  // Count summary groups from authoritative calendarDays
  const presentCount = days.filter(
    (d) => d.status === "present" || d.status === "late" || d.status === "partial_leave" || d.status === "live"
  ).length;
  const missingCount = actionableMissingDates.length;
  const pendingCount = pendingCorrectionDates.length;
  const offCount = days.filter((d) => d.status === "leave" || d.status === "holiday").length;

  // Pad leading empty grid slots for Sun=0..Sat=6 alignment based on the first calendar day
  const firstWeekday = days.length > 0 ? days[0].weekday : 0;
  const leadingBlanks = Array.from({ length: firstWeekday });

  const firstMissing = actionableMissingDates[0];
  const reviewHref = firstMissing
    ? isSelfView
      ? `/requests?date=${firstMissing}`
      : `/requests?date=${firstMissing}&employee_id=${employeeId}`
    : "/requests";

  return (
    <section
      aria-label="Attendance calendar"
      className={cn(
        "rounded-2xl bg-card border border-border-light shadow-card p-4 sm:p-5 flex flex-col justify-between gap-4",
        className
      )}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-black shrink-0" aria-hidden="true" />
            <h2 className="text-sm sm:text-base font-extrabold text-text-primary tracking-tight">
              Attendance calendar
            </h2>
          </div>
          <span className="text-xs font-semibold text-text-secondary truncate">
            {periodLabel}
          </span>
        </div>

        {/* Mon-Sun Grid */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {WEEKDAY_HEADERS.map((wd) => (
              <span
                key={wd}
                className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary py-0.5"
              >
                {wd}
              </span>
            ))}
          </div>

          {days.length > 0 ? (
            <div className="grid grid-cols-7 gap-1.5">
              {leadingBlanks.map((_, i) => (
                <div key={`blank-${i}`} aria-hidden="true" className="h-8 rounded-lg" />
              ))}

              {days.map((d) => {
                const dayNum = parseInt(d.date.slice(-2), 10);
                const cellStyle =
                  d.status === "present" || d.status === "partial_leave"
                    ? "bg-[#E9FFAC] border-[#B7FF00] text-black font-bold"
                    : d.status === "live"
                    ? "bg-[#B7FF00] border-black text-black font-black ring-2 ring-black/15"
                    : d.status === "late"
                    ? "bg-amber-50 border-amber-300 text-amber-950 font-bold"
                    : d.status === "missing"
                    ? "bg-amber-50/70 border-amber-400 text-amber-900 font-bold"
                    : d.status === "pending"
                    ? "bg-sky-50 border-sky-300 border-dashed text-sky-900 font-bold"
                    : d.status === "absent"
                    ? "bg-rose-50 border-[#FF007A]/50 text-[#FF007A] font-bold"
                    : d.status === "holiday" || d.status === "leave"
                    ? "bg-card-subtle border-border-medium text-text-secondary font-semibold"
                    : d.status === "not_employed"
                    ? "bg-transparent border-transparent text-text-tertiary/35"
                    : "bg-card-subtle/40 border-transparent text-text-tertiary";

                const tooltip = `${d.date} · ${d.label}${
                  d.workedMinutes > 0 ? ` (${(d.workedMinutes / 60).toFixed(1)}h worked)` : ""
                }`;

                if (d.status === "missing" && isSelfView) {
                  return (
                    <Link
                      key={d.date}
                      href={`/requests?date=${d.date}`}
                      title={`${tooltip} — Request attendance correction`}
                      aria-label={`${d.date}: ${d.label}. Open correction request.`}
                      className={cn(
                        "h-8 rounded-lg border text-xs flex items-center justify-center tabular-nums transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-black",
                        cellStyle
                      )}
                    >
                      {dayNum}
                    </Link>
                  );
                }

                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={onInspectAttendanceDays}
                    title={tooltip}
                    aria-label={`${d.date}: ${d.label}`}
                    className={cn(
                      "h-8 rounded-lg border text-xs flex items-center justify-center tabular-nums transition-colors cursor-pointer hover:border-black/40 focus-visible:outline-2 focus-visible:outline-black",
                      cellStyle
                    )}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-text-tertiary border border-dashed border-border-light rounded-xl">
              No calendar days available for this selection.
            </div>
          )}
        </div>
      </div>

      {/* Legend + Direct Action */}
      <div className="pt-2 border-t border-border-light/70 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-[#E9FFAC] border border-[#B7FF00]" aria-hidden="true" />
            <span>Present ({presentCount})</span>
          </span>

          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-50/70 border border-amber-400" aria-hidden="true" />
            <span>Missing ({missingCount})</span>
          </span>

          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-sky-50 border border-dashed border-sky-300" aria-hidden="true" />
              <span>Pending ({pendingCount})</span>
            </span>
          )}

          {offCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-card-subtle border border-border-medium" aria-hidden="true" />
              <span>Off/Leave ({offCount})</span>
            </span>
          )}
        </div>

        {missingCount > 0 ? (
          isSelfView ? (
            <Link
              href={reviewHref}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black shrink-0"
            >
              <span>Review missing days</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={onInspectAttendanceDays}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black shrink-0"
            >
              <span>Inspect missing days</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )
        ) : pendingCount > 0 ? (
          <Link
            href={isSelfView ? "/requests" : `/requests?employee_id=${employeeId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card-subtle hover:bg-border-light text-text-primary border border-border-light text-xs font-bold transition-colors shrink-0"
          >
            <span>{pendingCount} correction pending</span>
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-secondary">
            <CheckCircle2 className="w-3.5 h-3.5 text-black" aria-hidden="true" />
            <span>No missing days</span>
          </span>
        )}
      </div>
    </section>
  );
}

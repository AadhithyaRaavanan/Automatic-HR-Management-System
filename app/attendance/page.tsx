"use client";

import * as React from "react";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/features/attendance/components/stat-card";
import { RequestModal } from "@/features/requests/components/request-modal";
import { useSubmitRegularization } from "@/features/requests/hooks/use-regularizations";
import { createClient } from "@/lib/supabase/client";
import { formatDurationMinutes, formatTimeInTimezone, getEmployeeWorkDate } from "@/lib/date/timezone";
import { getTamilMonthInfo, resolveTamilHolidayName } from "@/lib/date/holidays-tn";
import { AttendanceDayStatus, SessionSource } from "@/types/database.types";
import {
  Clock,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Lock,
  PlusCircle,
  CheckCircle2,
  Calendar,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isDemoModeEnabled } from "@/lib/config/demo";
import {
  getStoredAttendanceSessions,
  getStoredAttendanceDays,
} from "@/lib/storage/demo-store";

interface CalendarDayRow {
  dateKey: string;
  dayNumber: number;
  status: AttendanceDayStatus | "unrecorded";
  totalMinutes: number;
  isLate: boolean;
  locked: boolean;
  holidayName?: string;
  holidayLocalName?: string | null;
  holidayRegion?: string;
  sessions: Array<{
    id: string;
    checkIn: string;
    checkOut: string | null;
    duration: number;
    source: SessionSource;
  }>;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function AttendanceCalendarContent() {
  const { userId, timezone } = useAppSession();
  const supabase = React.useMemo(() => createClient(), []);
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = React.useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = React.useState(now.getFullYear());
  const [monthDays, setMonthDays] = React.useState<CalendarDayRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedDayKey, setSelectedDayKey] = React.useState<string>(() =>
    getEmployeeWorkDate(timezone || "Asia/Kolkata")
  );
  const [requestModalOpen, setRequestModalOpen] = React.useState(false);
  const submitRegularizationMutation = useSubmitRegularization();

  const loadMonthData = React.useCallback(async () => {
    setLoading(true);
    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
    const start = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
    const end = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

    let daysMap = new Map<string, any>();
    let sessByDate = new Map<string, any[]>();
    let holidayByDate = new Map<string, any>();

    try {
      const uid =
        userId ||
        (await supabase.auth.getSession()).data.session?.user?.id ||
        (await supabase.auth.getUser()).data.user?.id;

      const [holRes, daysRes, sessRes] = await Promise.all([
        (supabase as any)
          .from("holidays")
          .select("date, name, local_name, region")
          .eq("is_active", true)
          .gte("date", start)
          .lte("date", end),
        uid && !isDemoModeEnabled()
          ? (supabase as any)
              .from("attendance_days")
              .select("work_date, status, total_minutes, is_late, locked")
              .eq("employee_id", uid)
              .gte("work_date", start)
              .lte("work_date", end)
          : Promise.resolve({ data: [] }),
        uid && !isDemoModeEnabled()
          ? (supabase as any)
              .from("attendance_sessions")
              .select("id, work_date, check_in_at, check_out_at, source")
              .eq("employee_id", uid)
              .gte("work_date", start)
              .lte("work_date", end)
              .order("check_in_at", { ascending: true })
          : Promise.resolve({ data: [] }),
      ]);

      for (const h of holRes.data || []) {
        holidayByDate.set(h.date, {
          ...h,
          local_name: resolveTamilHolidayName(h.name, h.local_name),
        });
      }
      for (const d of daysRes.data || []) {
        daysMap.set(d.work_date, d);
      }
      for (const s of sessRes.data || []) {
        const list = sessByDate.get(s.work_date) || [];
        list.push(s);
        sessByDate.set(s.work_date, list);
      }
    } catch {
      // keep clean empty day scaffold
    }

    // Merge stored demo sessions & days only if in demo mode
    if (isDemoModeEnabled()) {
      const storedSessions = getStoredAttendanceSessions();
      const storedDays = getStoredAttendanceDays();

      for (const d of storedDays) {
        if (!daysMap.has(d.work_date)) {
          daysMap.set(d.work_date, d);
        }
      }
      for (const s of storedSessions) {
        const list = sessByDate.get(s.work_date) || [];
        if (!list.some((existing) => existing.id === s.id)) {
          list.push(s);
          sessByDate.set(s.work_date, list);
        }
      }
    }

    const built: CalendarDayRow[] = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(selectedYear, selectedMonth - 1, i);
      const dow = d.getDay();
      const dateKey = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      const dbDay = daysMap.get(dateKey);
      const dbHoliday = holidayByDate.get(dateKey);
      const daySessions = (sessByDate.get(dateKey) || []).map((s: any) => {
        const dur = s.check_out_at
          ? Math.max(
              0,
              Math.round(
                (new Date(s.check_out_at).getTime() - new Date(s.check_in_at).getTime()) /
                  60000
              )
            )
          : 0;
        return {
          id: s.id,
          checkIn: s.check_in_at,
          checkOut: s.check_out_at,
          duration: dur,
          source: (s.source || "web") as SessionSource,
        };
      });

      const isSunday = dow === 0;
      let dayStatus: AttendanceDayStatus | "unrecorded" = "unrecorded";

      if (dbHoliday) {
        dayStatus = "holiday";
      } else if (isSunday) {
        dayStatus = "weekend";
      } else if (dbDay?.status && dbDay.status !== "absent") {
        dayStatus = dbDay.status as AttendanceDayStatus;
      } else if (daySessions.length > 0) {
        dayStatus = (dbDay?.status || "present") as AttendanceDayStatus;
      } else {
        // Working day with no punches recorded: render blank
        dayStatus = "unrecorded";
      }

      built.push({
        dateKey,
        dayNumber: i,
        status: dayStatus,
        totalMinutes: dbDay?.total_minutes || 0,
        isLate: Boolean(dbDay?.is_late),
        locked: Boolean(dbDay?.locked),
        holidayName: dbHoliday?.name,
        holidayLocalName: dbHoliday?.local_name,
        holidayRegion: dbHoliday?.region,
        sessions: daySessions,
      });
    }

    setMonthDays(built);
    setSelectedDayKey((prev) =>
      prev.startsWith(`${selectedYear}-${String(selectedMonth).padStart(2, "0")}`)
        ? prev
        : built[0]?.dateKey || start
    );
    setLoading(false);
  }, [supabase, userId, selectedYear, selectedMonth]);

  React.useEffect(() => {
    loadMonthData();
    const handleStorageChange = () => loadMonthData();
    window.addEventListener("remotehr_storage_change", handleStorageChange);
    return () => {
      window.removeEventListener("remotehr_storage_change", handleStorageChange);
    };
  }, [loadMonthData]);

  const selectedDay =
    monthDays.find((d) => d.dateKey === selectedDayKey) || monthDays[0];

  const totalPresent = monthDays.filter((d) => d.status === "present").length;
  const totalHolidays = monthDays.filter((d) => d.status === "holiday").length;
  const totalLates = monthDays.filter((d) => d.isLate).length;
  const totalHours = Math.round(
    monthDays.reduce((acc, curr) => acc + curr.totalMinutes, 0) / 60
  );

  const tamilMonthInfo = React.useMemo(() => {
    return getTamilMonthInfo(new Date(selectedYear, selectedMonth - 1, 15));
  }, [selectedYear, selectedMonth]);

  const firstDayOfWeek = React.useMemo(() => {
    return new Date(selectedYear, selectedMonth - 1, 1).getDay();
  }, [selectedYear, selectedMonth]);

  const statusDotClass: Record<AttendanceDayStatus | "unrecorded", string> = {
    present: "bg-status-success-dot",
    half_day: "bg-status-warning-dot",
    absent: "bg-status-danger-dot",
    holiday: "bg-brand-purple",
    weekend: "bg-text-tertiary/30",
    leave: "bg-status-info-dot",
    unrecorded: "transparent",
  };

  return (
    <div className="space-y-6">
      {/* Header & Month Navigator */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
              Attendance Calendar
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-purple-light text-brand-purple text-[11px] font-bold border border-brand-purple/20">
              {timezone || "UTC"}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Monthly punch records, public holidays, and timesheet regularization.
          </p>
        </div>

        {/* Month Switcher */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (selectedMonth === 1) {
                setSelectedMonth(12);
                setSelectedYear((y) => y - 1);
              } else {
                setSelectedMonth((m) => m - 1);
              }
            }}
            className="p-2 rounded-full bg-card border border-border-light text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors shadow-sm cursor-pointer"
            title="Previous Month"
            aria-label="Previous Month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex flex-col items-center justify-center px-4 py-2 rounded-2xl bg-card-subtle border border-border-light text-center min-w-[170px]">
            <span className="text-xs font-bold text-text-primary">
              {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              if (selectedMonth === 12) {
                setSelectedMonth(1);
                setSelectedYear((y) => y + 1);
              } else {
                setSelectedMonth((m) => m + 1);
              }
            }}
            className="p-2 rounded-full bg-card border border-border-light text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors shadow-sm cursor-pointer"
            title="Next Month"
            aria-label="Next Month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Hours"
          value={`${totalHours} hrs`}
          subtitle={`Timezone: ${timezone || "UTC"}`}
          icon={<Clock className="w-4 h-4" />}
        />
        <StatCard
          title="Days Present"
          value={`${totalPresent} Days`}
          subtitle="Full-day attendance credit"
          icon={<CheckCircle2 className="w-4 h-4 text-status-success-dot" />}
        />
        <StatCard
          title="Holidays"
          value={`${totalHolidays}`}
          subtitle="Org holidays this month"
          icon={<Calendar className="w-4 h-4 text-brand-purple" />}
        />
        <StatCard
          title="Late Arrivals"
          value={`${totalLates}`}
          subtitle="Arrivals past grace period"
          icon={<AlertCircle className="w-4 h-4 text-status-warning-dot" />}
        />
      </div>

      {/* Calendar Grid + Detailed Day Agenda */}
      <BentoGrid>
        {/* Left: Full Monthly Grid View */}
        <BentoCard
          title="Monthly Timesheet Grid"
          subtitle="Click any date to inspect shift punches and holidays"
          data-tour="attendance-timesheet"
          data-tour-team="attendance-team-table"
          className="lg:col-span-8 p-6"
        >
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-text-tertiary uppercase pb-3 border-b border-border-light/60">
            <span className="text-status-danger-text/80">Sun</span>
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
          </div>

          {loading ? (
            <div className="h-64 rounded-2xl bg-card-subtle animate-pulse mt-3" />
          ) : (
            <div className="grid grid-cols-7 gap-2 pt-3">
              {monthDays.map((day, idx) => {
                const isSelected = day.dateKey === selectedDayKey;
                const isSunday = day.status === "weekend";
                return (
                  <button
                    key={day.dateKey}
                    type="button"
                    onClick={() => setSelectedDayKey(day.dateKey)}
                    style={idx === 0 ? { gridColumnStart: firstDayOfWeek + 1 } : undefined}
                    className={cn(
                      "h-20 p-2 rounded-2xl border text-left flex flex-col justify-between transition-all cursor-pointer relative",
                      isSelected
                        ? "border-brand-purple bg-brand-purple/10 shadow-sm"
                        : "border-border-light/60 bg-card hover:bg-card-subtle/70",
                      isSunday && "opacity-85 bg-card-subtle/30"
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-mono",
                          isSelected ? "bg-brand-purple text-white" : "text-text-primary"
                        )}
                      >
                        {day.dayNumber}
                      </span>
                      {day.locked && (
                        <span title="Finalized and locked">
                          <Lock className="w-3 h-3 text-text-tertiary/60" />
                        </span>
                      )}
                    </div>

                    <div className="w-full">
                      {day.holidayName ? (
                        <>
                          <span className="text-[9px] font-bold text-brand-purple line-clamp-1 block leading-tight">
                            {day.holidayName}
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-brand-purple" />
                            <span className="text-[10px] font-medium text-brand-purple capitalize truncate">
                              Holiday
                            </span>
                          </div>
                        </>
                      ) : day.status === "weekend" ? (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-text-tertiary/30" />
                          <span className="text-[10px] font-medium text-text-tertiary capitalize truncate">
                            Weekend
                          </span>
                        </div>
                      ) : day.status === "present" || day.status === "half_day" || day.status === "leave" ? (
                        <>
                          {day.totalMinutes > 0 && (
                            <span className="text-[10px] font-mono font-semibold text-text-secondary">
                              {formatDurationMinutes(day.totalMinutes)}
                            </span>
                          )}
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full shrink-0",
                                statusDotClass[day.status]
                              )}
                            />
                            <span className="text-[10px] font-medium text-text-tertiary capitalize truncate">
                              {day.status.replace("_", " ")}
                            </span>
                          </div>
                        </>
                      ) : null /* Blank unrecorded working days */}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend Footer */}
          <div className="flex flex-wrap items-center gap-4 pt-5 mt-4 border-t border-border-light/60 text-xs text-text-secondary">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-status-success-dot" />
              Present
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-status-warning-dot" />
              Half Day
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-brand-purple" />
              Holiday
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-status-info-dot" />
              Approved Leave
            </span>
          </div>
        </BentoCard>

        {/* Right: Detailed Day Breakdown Card */}
        <BentoCard
          title={selectedDay ? `Details for ${selectedDay.dateKey}` : "Day Details"}
          action={selectedDay && selectedDay.status !== "unrecorded" ? <StatusPill status={selectedDay.status} /> : null}
          className="lg:col-span-4 p-6 flex flex-col justify-between"
        >
          {selectedDay ? (
            <div>
              {selectedDay.holidayName && (
                <div className="p-4 rounded-2xl bg-brand-purple/10 border border-brand-purple/30 mb-4">
                  <div className="flex items-center gap-2 text-brand-purple font-bold text-sm">
                    <Calendar className="w-4 h-4" />
                    <span>{selectedDay.holidayName}</span>
                  </div>
                  {selectedDay.holidayLocalName && (
                    <p className="text-xs text-text-primary font-semibold mt-1">
                      {selectedDay.holidayLocalName}
                    </p>
                  )}
                  <span className="text-[10px] text-text-tertiary mt-1 block">
                    Region: {selectedDay.holidayRegion || "ORG"}
                  </span>
                </div>
              )}

              <div className="p-4 rounded-2xl bg-card-subtle mb-4 border border-border-light flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-text-tertiary uppercase">
                    Logged Duration
                  </span>
                  <div className="text-2xl font-extrabold text-text-primary tracking-tight font-mono">
                    {formatDurationMinutes(selectedDay.totalMinutes)}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-bold text-text-tertiary uppercase">
                    Punctuality
                  </span>
                  <div
                    className={cn(
                      "text-xs font-bold mt-1",
                      selectedDay.isLate
                        ? "text-status-warning-text"
                        : "text-status-success-text"
                    )}
                  >
                    {selectedDay.isLate ? "Late Arrival" : "On Time"}
                  </div>
                </div>
              </div>

              <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-2">
                Session Intervals
              </h3>

              {selectedDay.sessions.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {selectedDay.sessions.map((sess) => (
                    <div
                      key={sess.id}
                      className="p-3 rounded-xl bg-card border border-border-light shadow-sm flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-bold text-text-primary block font-mono">
                          {formatTimeInTimezone(sess.checkIn, timezone || "UTC", "hh:mm a")} -{" "}
                          {sess.checkOut
                            ? formatTimeInTimezone(sess.checkOut, timezone || "UTC", "hh:mm a")
                            : "Open"}
                        </span>
                        <span className="text-[10px] text-text-tertiary capitalize">
                          Source: {sess.source}
                        </span>
                      </div>
                      <span className="font-bold text-brand-purple">
                        {formatDurationMinutes(sess.duration)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  className="py-6 border-dashed shadow-none bg-card-subtle/40 mb-4"
                  icon={<Clock className="w-5 h-5" />}
                  title="No sessions logged"
                  description={
                    selectedDay.holidayName
                      ? `Attendance is excused for ${selectedDay.holidayName}.`
                      : selectedDay.status === "weekend"
                      ? "Sunday is a scheduled non-working weekend day."
                      : "No shift punches recorded for this date."
                  }
                />
              )}
            </div>
          ) : null}

          <div className="pt-3 border-t border-border-light">
            <button
              type="button"
              disabled={selectedDay?.locked}
              onClick={() => setRequestModalOpen(true)}
              className="w-full py-2.5 px-4 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>{selectedDay?.locked ? "Month Locked" : "Regularize This Day"}</span>
            </button>
          </div>
        </BentoCard>
      </BentoGrid>

      {selectedDay && (
        <RequestModal
          open={requestModalOpen}
          onOpenChange={setRequestModalOpen}
          initialDate={selectedDay.dateKey}
          onSubmitRequest={async (data) => {
            await submitRegularizationMutation.mutateAsync(data);
          }}
        />
      )}
    </div>
  );
}

export default function AttendanceCalendarPage() {
  return (
    <AppShell>
      <AttendanceCalendarContent />
    </AppShell>
  );
}

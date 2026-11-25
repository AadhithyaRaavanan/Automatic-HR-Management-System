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
  birthdays?: Array<{ id: string; name: string }>;
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
  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState<string>("");
  const [accessibleEmployees, setAccessibleEmployees] = React.useState<Array<{
    id: string;
    full_name: string;
    email: string;
    role?: string;
    department?: string;
    job_title?: string;
  }>>([]);
  const [targetEmployee, setTargetEmployee] = React.useState<any>(null);
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

    let daysMap = new Map<string, any>();
    let sessByDate = new Map<string, any[]>();
    let holidayByDate = new Map<string, any>();
    let birthdayByDay = new Map<number, Array<{ id: string; name: string }>>();

    try {
      // Fetch from multi-employee calendar API with RBAC support
      const qParams = new URLSearchParams({
        month: String(selectedMonth),
        year: String(selectedYear),
      });
      if (selectedEmployeeId) {
        qParams.set("employeeId", selectedEmployeeId);
      }

      const res = await fetch(`/api/attendance/calendar?${qParams.toString()}`);
      if (res.ok) {
        const calData = await res.json();
        if (calData.targetEmployee) {
          setTargetEmployee(calData.targetEmployee);
        }
        if (Array.isArray(calData.accessibleEmployees)) {
          setAccessibleEmployees(calData.accessibleEmployees);
        }

        for (const h of calData.holidays || []) {
          holidayByDate.set(h.date, {
            ...h,
            local_name: resolveTamilHolidayName(h.name, h.local_name),
          });
        }
        for (const b of calData.birthdays || []) {
          const list = birthdayByDay.get(b.birthDay) || [];
          list.push({ id: b.employeeId, name: b.fullName });
          birthdayByDay.set(b.birthDay, list);
        }
        for (const d of calData.days || []) {
          daysMap.set(d.work_date, d);
        }
        for (const s of calData.sessions || []) {
          const list = sessByDate.get(s.work_date) || [];
          list.push(s);
          sessByDate.set(s.work_date, list);
        }
      }
    } catch {
      // fallback
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

      const isWeekend = dow === 0 || dow === 6;
      let dayStatus: AttendanceDayStatus | "unrecorded" = "unrecorded";

      if (dbHoliday) {
        dayStatus = "holiday";
      } else if (daySessions.length > 0 || (dbDay?.total_minutes && dbDay.total_minutes > 0)) {
        dayStatus = (dbDay?.status || "present") as AttendanceDayStatus;
      } else if (isWeekend) {
        dayStatus = "weekend";
      } else if (dbDay?.status && dbDay.status !== "absent") {
        dayStatus = dbDay.status as AttendanceDayStatus;
      } else {
        dayStatus = "unrecorded";
      }

      const dayBirthdays = birthdayByDay.get(i) || [];

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
        birthdays: dayBirthdays,
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
  }, [selectedYear, selectedMonth, selectedEmployeeId]);

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

  const firstDayOfWeek = React.useMemo(() => {
    return new Date(selectedYear, selectedMonth - 1, 1).getDay();
  }, [selectedYear, selectedMonth]);

  const statusDotClass: Record<AttendanceDayStatus | "unrecorded", string> = {
    present: "bg-[#B7FF00]",
    half_day: "bg-amber-400",
    absent: "bg-[#FF1493]",
    holiday: "bg-[#FF1493]",
    weekend: "bg-[#B3B3B3]",
    leave: "bg-[#808080]",
    unrecorded: "transparent",
  };

  return (
    <div className="space-y-6">
      {/* Header & Month Navigator */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-black tracking-tight">
              Attendance
            </h1>
            <span className="px-2 py-0.5 rounded-md bg-[#F5F5F5] text-[#808080] text-xs font-medium border border-[#E6E6E6]">
              {timezone || "Asia/Kolkata"}
            </span>
          </div>
          <p className="text-xs text-[#808080] mt-1">
            Monthly punch records, public holidays, and timesheet adjustments.
          </p>
        </div>

        {/* Controls: Employee selector (if allowed) + Month Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          {accessibleEmployees.length > 1 && (
            <div className="flex items-center gap-1.5">
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none focus:ring-2 focus:ring-black cursor-pointer shadow-none"
                aria-label="Select employee attendance"
              >
                <option value="">My attendance</option>
                {accessibleEmployees
                  .filter((emp) => emp.id !== userId)
                  .map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} ({emp.role ? emp.role.toUpperCase() : emp.department || "Employee"})
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-1.5">
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
              className="p-1.5 rounded-lg bg-white border border-[#E6E6E6] text-[#808080] hover:text-black hover:bg-[#F5F5F5] transition-colors cursor-pointer"
              title="Previous Month"
              aria-label="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex flex-col items-center justify-center px-4 py-1.5 rounded-lg bg-white border border-[#E6E6E6] text-center min-w-[150px]">
              <span className="text-xs font-semibold text-black">
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
              className="p-1.5 rounded-lg bg-white border border-[#E6E6E6] text-[#808080] hover:text-black hover:bg-[#F5F5F5] transition-colors cursor-pointer"
              title="Next Month"
              aria-label="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Target Employee Banner if viewing someone else */}
      {targetEmployee && selectedEmployeeId && selectedEmployeeId !== userId && (
        <div className="p-3 rounded-[14px] bg-white border border-[#E6E6E6] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#B7FF00]" />
            <span className="font-semibold text-black">Viewing: {targetEmployee.full_name}</span>
            <span className="text-[#808080]">({targetEmployee.department} • {targetEmployee.job_title})</span>
          </div>
          <button
            type="button"
            onClick={() => setSelectedEmployeeId("")}
            className="text-xs text-[#808080] hover:text-black underline cursor-pointer"
          >
            Back to my attendance
          </button>
        </div>
      )}

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total hours"
          value={`${totalHours} hrs`}
          subtitle={`Timezone: ${timezone || "UTC"}`}
          icon={<Clock className="w-4 h-4" />}
        />
        <StatCard
          title="Days present"
          value={`${totalPresent} days`}
          subtitle="Full-day attendance credit"
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <StatCard
          title="Holidays"
          value={`${totalHolidays}`}
          subtitle="Org holidays this month"
          icon={<Calendar className="w-4 h-4" />}
        />
        <StatCard
          title="Late arrivals"
          value={`${totalLates}`}
          subtitle="Arrivals past grace period"
          icon={<AlertCircle className="w-4 h-4" />}
        />
      </div>

      {/* Calendar Grid + Detailed Day Agenda */}
      <BentoGrid>
        {/* Left: Full Monthly Grid View */}
        <BentoCard
          title="Monthly timesheets"
          subtitle="Select a date to inspect shift punches and holidays"
          data-tour="attendance-timesheet"
          data-tour-team="attendance-team-table"
          className="lg:col-span-8 p-6"
        >
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-[#808080] uppercase pb-3 border-b border-[#E6E6E6]">
            <span className="text-[#FF1493]">Sun</span>
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span className="text-[#FF1493]">Sat</span>
          </div>

          {loading ? (
            <div className="h-64 rounded-xl bg-[#F5F5F5] animate-pulse mt-3" />
          ) : (
            <div className="grid grid-cols-7 gap-2 pt-3">
              {monthDays.map((day, idx) => {
                const isSelected = day.dateKey === selectedDayKey;
                const isWeekend = day.status === "weekend";
                return (
                  <button
                    key={day.dateKey}
                    type="button"
                    onClick={() => setSelectedDayKey(day.dateKey)}
                    style={idx === 0 ? { gridColumnStart: firstDayOfWeek + 1 } : undefined}
                    className={cn(
                      "h-20 p-2 rounded-xl border text-left flex flex-col justify-between transition-colors cursor-pointer relative",
                      isSelected
                        ? "border-black bg-black/5"
                        : "border-[#E6E6E6] bg-white hover:bg-[#F5F5F5]",
                      isWeekend && "opacity-85 bg-[#F5F5F5]/40"
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={cn(
                          "w-6 h-6 rounded-md flex items-center justify-center text-xs font-medium tabular-nums",
                          isSelected ? "bg-[#B7FF00] text-black font-bold" : "text-black"
                        )}
                      >
                        {day.dayNumber}
                      </span>
                      {day.locked && (
                        <span title="Finalized and locked">
                          <Lock className="w-3 h-3 text-[#808080]" />
                        </span>
                      )}
                    </div>

                    <div className="w-full">
                      {day.holidayName ? (
                        <>
                          <span className="text-[9px] font-bold text-[#FF1493] line-clamp-1 block leading-tight">
                            {day.holidayName}
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#FF1493]" />
                            <span className="text-[10px] font-medium text-[#FF1493] capitalize truncate">
                              Holiday
                            </span>
                          </div>
                        </>
                      ) : day.status === "weekend" ? (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#B3B3B3]" />
                          <span className="text-[10px] font-medium text-[#808080] capitalize truncate">
                            Weekend
                          </span>
                        </div>
                      ) : day.status === "present" || day.status === "half_day" || day.status === "leave" ? (
                        <>
                          {day.totalMinutes > 0 && (
                            <span className="text-[10px] font-mono font-semibold text-[#4D4D4D]">
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
                            <span className="text-[10px] font-medium text-[#808080] capitalize truncate">
                              {day.status.replace("_", " ")}
                            </span>
                          </div>
                        </>
                      ) : null}

                      {day.birthdays && day.birthdays.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-black font-semibold truncate bg-[#B7FF00]/25 px-1 py-0.5 rounded border border-[#B7FF00]/60">
                          <span>🎂</span>
                          <span className="truncate">{day.birthdays.map((b) => b.name.split(" ")[0]).join(", ")}</span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend Footer */}
          <div className="flex flex-wrap items-center gap-4 pt-5 mt-4 border-t border-[#E6E6E6] text-xs text-[#808080]">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#B7FF00]" />
              Present
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              Half Day
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF1493]" />
              Holiday
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#808080]" />
              Approved Leave
            </span>
            <span className="flex items-center gap-1.5">
              <span>🎂</span>
              Birthday
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
              {selectedDay.birthdays && selectedDay.birthdays.length > 0 && (
                <div className="p-3.5 rounded-xl bg-[#B7FF00]/20 border border-[#B7FF00] mb-4 space-y-1">
                  {selectedDay.birthdays.map((b, bIdx) => (
                    <div key={bIdx} className="flex items-center gap-2">
                      <span className="text-base">🎂</span>
                      <div>
                        <span className="text-xs font-bold text-black block leading-tight">
                          Today is {b.name}&apos;s Birthday!
                        </span>
                        <span className="text-[10px] text-[#4D4D4D]">
                          Team celebration & birthday wishes active
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedDay.holidayName && (
                <div className="p-4 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] mb-4">
                  <div className="flex items-center gap-2 text-black font-bold text-sm">
                    <Calendar className="w-4 h-4 text-[#FF1493]" />
                    <span>{selectedDay.holidayName}</span>
                  </div>
                  {selectedDay.holidayLocalName && (
                    <p className="text-xs text-[#4D4D4D] font-medium mt-1">
                      {selectedDay.holidayLocalName}
                    </p>
                  )}
                  <span className="text-[10px] text-[#808080] mt-1 block">
                    Region: {selectedDay.holidayRegion || "ORG"}
                  </span>
                </div>
              )}

              <div className="p-4 rounded-xl bg-[#F5F5F5] mb-4 border border-[#E6E6E6] flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-medium text-[#808080] uppercase">
                    Logged Duration
                  </span>
                  <div className="text-2xl font-bold text-black tracking-tight font-mono">
                    {formatDurationMinutes(selectedDay.totalMinutes)}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-medium text-[#808080] uppercase">
                    Punctuality
                  </span>
                  <div
                    className={cn(
                      "text-xs font-semibold mt-1",
                      selectedDay.isLate
                        ? "text-amber-600"
                        : "text-black"
                    )}
                  >
                    {selectedDay.isLate ? "Late Arrival" : "On Time"}
                  </div>
                </div>
              </div>

              <h3 className="text-xs font-semibold text-black uppercase tracking-wider mb-2">
                Session Intervals
              </h3>

              {selectedDay.sessions.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {selectedDay.sessions.map((sess) => (
                    <div
                      key={sess.id}
                      className="p-3 rounded-lg bg-white border border-[#E6E6E6] flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-black block font-mono">
                          {formatTimeInTimezone(sess.checkIn, timezone || "UTC", "hh:mm a")} -{" "}
                          {sess.checkOut
                            ? formatTimeInTimezone(sess.checkOut, timezone || "UTC", "hh:mm a")
                            : "Open"}
                        </span>
                        <span className="text-[10px] text-[#808080] capitalize">
                          Source: {sess.source}
                        </span>
                      </div>
                      <span className="font-bold text-black font-mono">
                        {formatDurationMinutes(sess.duration)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  className="py-6 border-dashed shadow-none bg-[#F5F5F5] mb-4"
                  icon={<Clock className="w-5 h-5 text-[#808080]" />}
                  title="No sessions logged"
                  description={
                    selectedDay.holidayName
                      ? `Attendance is excused for ${selectedDay.holidayName}.`
                      : selectedDay.status === "weekend"
                      ? `${new Date(selectedDay.dateKey + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" })} is a scheduled non-working weekend day.`
                      : "No shift punches recorded for this date."
                  }
                />
              )}
            </div>
          ) : null}

          <div className="pt-3 border-t border-[#E6E6E6]">
            <button
              type="button"
              disabled={selectedDay?.locked}
              onClick={() => setRequestModalOpen(true)}
              className="w-full py-2.5 px-4 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
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

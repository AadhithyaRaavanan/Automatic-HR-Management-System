"use client";

import * as React from "react";
import { BentoCard } from "@/components/bento/bento-card";
import { ChevronLeft, ChevronRight, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DayStripItem {
  dayName: string;
  dateNumber: number;
  dateKey: string;
  status?: "present" | "half_day" | "absent" | "holiday" | "weekend" | "leave";
  isSelected?: boolean;
}

export interface AgendaItem {
  id: string;
  timeSlot: string;
  title: string;
  category?: string;
}

export interface AttendanceCalendarCardProps {
  currentMonth?: string;
  days?: DayStripItem[];
  agenda?: AgendaItem[];
  shiftStartTime?: string;
  shiftEndTime?: string;
  onSelectDate?: (dateKey: string) => void;
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  className?: string;
}

// Known TN Gazetted Holidays for live display (English text only)
const KNOWN_HOLIDAYS: Record<string, { title: string; category: string }> = {
  "2026-01-01": { title: "New Year's Day", category: "TN Gazetted Holiday" },
  "2026-01-14": { title: "Pongal Festival", category: "TN Gazetted Holiday" },
  "2026-01-15": { title: "Thiruvalluvar Day", category: "TN Gazetted Holiday" },
  "2026-01-16": { title: "Uzhavar Thirunal", category: "TN Gazetted Holiday" },
  "2026-01-26": { title: "Republic Day", category: "National Holiday" },
  "2026-05-01": { title: "May Day / Labour Day", category: "National Holiday" },
  "2026-08-15": { title: "Independence Day", category: "National Holiday" },
  "2026-10-02": { title: "Gandhi Jayanti", category: "National Holiday" },
  "2026-10-19": { title: "Ayutha Pooja", category: "TN Gazetted Holiday" },
  "2026-10-20": { title: "Vijaya Dasami", category: "TN Gazetted Holiday" },
  "2026-11-08": { title: "Deepavali Festival", category: "TN Gazetted Holiday" },
  "2026-12-25": { title: "Christmas Day", category: "TN Gazetted Holiday" },
  "2027-01-01": { title: "New Year's Day", category: "TN Gazetted Holiday" },
  "2027-01-14": { title: "Bhogi Festival", category: "TN Gazetted Holiday" },
  "2027-01-15": { title: "Thai Pongal", category: "TN Gazetted Holiday" },
  "2027-01-16": { title: "Thiruvalluvar Day", category: "TN Gazetted Holiday" },
  "2027-01-17": { title: "Uzhavar Thirunal", category: "TN Gazetted Holiday" },
  "2027-01-26": { title: "Republic Day", category: "National Holiday" },
};

function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function generateLiveWeekDays(refDate: Date, weekOffset: number): DayStripItem[] {
  const target = new Date(refDate);
  target.setDate(target.getDate() + weekOffset * 7);

  // Week starts on Sunday (day 0) like the Monthly Timesheet Grid
  const dayOfWeek = target.getDay();
  const sunday = new Date(target);
  sunday.setDate(target.getDate() - dayOfWeek);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days: DayStripItem[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    const dateKey = formatIsoDate(d);
    const isWeekend = i === 0 || i === 6;
    const isHoliday = Boolean(KNOWN_HOLIDAYS[dateKey]);

    days.push({
      dayName: dayNames[i],
      dateNumber: d.getDate(),
      dateKey,
      status: isHoliday ? "holiday" : isWeekend ? "weekend" : "present",
    });
  }

  return days;
}

function formatTime12h(timeStr?: string): string {
  if (!timeStr) return "09:00 AM";
  const [hStr = "9", mStr = "0"] = timeStr.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h)) h = 9;
  if (isNaN(m)) return "09:00 AM";
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")} ${period}`;
}

function generateLiveAgenda(
  dateKey: string,
  shiftStartTime?: string,
  shiftEndTime?: string
): AgendaItem[] {
  if (KNOWN_HOLIDAYS[dateKey]) {
    const h = KNOWN_HOLIDAYS[dateKey];
    return [
      {
        id: "holiday-1",
        timeSlot: "Full Day Excused",
        title: h.title,
        category: h.category,
      },
      {
        id: "holiday-2",
        timeSlot: "Next Workday: Tomorrow",
        title: "Standard Shift Scheduled",
        category: "Chennai Office / Remote",
      },
    ];
  }

  const [y, m, d] = dateKey.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const dayOfWeek = target.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const startFormatted = formatTime12h(shiftStartTime || "09:00:00");
  const endFormatted = formatTime12h(shiftEndTime || "17:00:00");

  if (isWeekend) {
    return [
      {
        id: "weekend-1",
        timeSlot: "Rest Day",
        title: "Weekly Off (Weekend)",
        category: "Scheduled Non-Working Day",
      },
      {
        id: "weekend-2",
        timeSlot: `Next Shift: Mon ${startFormatted}`,
        title: "Standard Shift (IST)",
        category: "Chennai Office / Remote",
      },
    ];
  }

  return [
    {
      id: "workday-1",
      timeSlot: `Shift: ${startFormatted} - ${endFormatted}`,
      title: "Scheduled Workday (IST)",
      category: "Active Workplace Target",
    },
    {
      id: "workday-2",
      timeSlot: "Attendance Policy",
      title: "Daily Check-In & Break Tracking",
      category: "Remote / Office Verified",
    },
  ];
}

export function AttendanceCalendarCard({
  currentMonth,
  days: propDays,
  agenda: propAgenda,
  shiftStartTime,
  shiftEndTime,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  className,
}: AttendanceCalendarCardProps) {
  const [weekOffset, setWeekOffset] = React.useState<number>(0);
  const [teamBirthdays, setTeamBirthdays] = React.useState<Array<{ id: string; name: string; dateKey: string }>>([]);

  React.useEffect(() => {
    let active = true;
    fetch("/api/attendance/calendar")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data?.birthdays) return;
        const currentYear = new Date().getFullYear();
        const bdays = (data.birthdays || []).map((b: any) => ({
          id: b.employeeId,
          name: b.fullName,
          dateKey: `${currentYear}-${String(b.birthMonth).padStart(2, "0")}-${String(b.birthDay).padStart(2, "0")}`,
        }));
        setTeamBirthdays(bdays);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Live reference date (Asia/Kolkata or client local)
  const todayKey = React.useMemo(() => {
    return formatIsoDate(new Date());
  }, []);

  const [selectedKey, setSelectedKey] = React.useState<string>(todayKey);

  const days = React.useMemo(() => {
    if (propDays && propDays.length > 0) return propDays;
    return generateLiveWeekDays(new Date(), weekOffset);
  }, [propDays, weekOffset]);

  // Derived current month display from active strip
  const monthLabel = React.useMemo(() => {
    if (currentMonth) return currentMonth;
    // Derive from middle date of active strip
    const middleDateKey = days[3]?.dateKey || todayKey;
    const [y, m, d] = middleDateKey.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleString("en-US", { month: "long", year: "numeric" });
  }, [currentMonth, days, todayKey]);

  const agenda = React.useMemo(() => {
    const base = propAgenda && propAgenda.length > 0
      ? propAgenda
      : generateLiveAgenda(selectedKey, shiftStartTime, shiftEndTime);

    const matchingBdays = teamBirthdays.filter((b) => b.dateKey === selectedKey);
    if (matchingBdays.length > 0) {
      const bdayItems: AgendaItem[] = matchingBdays.map((b) => ({
        id: `birthday-${b.id}`,
        timeSlot: "🎂 Birthday Celebration",
        title: `Happy Birthday, ${b.name}!`,
        category: "Team Birthday & Celebration",
      }));
      return [...bdayItems, ...base];
    }

    return base;
  }, [propAgenda, selectedKey, shiftStartTime, shiftEndTime, teamBirthdays]);

  const handleSelect = (d: DayStripItem) => {
    setSelectedKey(d.dateKey);
    onSelectDate?.(d.dateKey);
  };

  const handlePrev = () => {
    if (onPrevMonth) {
      onPrevMonth();
    } else {
      setWeekOffset((prev) => prev - 1);
    }
  };

  const handleNext = () => {
    if (onNextMonth) {
      onNextMonth();
    } else {
      setWeekOffset((prev) => prev + 1);
    }
  };

  const statusDotClass = {
    present: "bg-[#A6F000]",
    half_day: "bg-amber-400",
    absent: "bg-[#F00091]",
    holiday: "bg-[#F00091]",
    weekend: "bg-[#B3B3B3]",
    leave: "bg-[#808080]",
  };

  return (
    <div
      className={cn(
        "bg-white rounded-[14px] border border-[#E6E6E6] p-5 flex flex-col justify-between shadow-none select-none transition-colors",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between w-full mb-3">
        <span className="text-sm font-bold text-black tracking-tight">
          {monthLabel}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrev}
            title="Previous week"
            className="p-1 rounded-full text-[#808080] hover:text-black hover:bg-[#F5F5F5] transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleNext}
            title="Next week"
            className="p-1 rounded-full text-[#808080] hover:text-black hover:bg-[#F5F5F5] transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 7-Day Week Strip */}
      <div className="grid grid-cols-7 gap-1 text-center py-2 border-b border-[#E6E6E6]">
        {days.map((item) => {
          const isSelected = item.dateKey === selectedKey;
          const isToday = item.dateKey === todayKey;

          return (
            <button
              key={item.dateKey}
              type="button"
              onClick={() => handleSelect(item)}
              className="flex flex-col items-center gap-1 group py-1 cursor-pointer"
            >
              <span
                className={cn(
                  "text-[11px] font-medium transition-colors",
                  isToday
                    ? "text-black font-bold"
                    : "text-[#808080] group-hover:text-black"
                )}
              >
                {item.dayName}
              </span>

              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all",
                  isSelected
                    ? "bg-[#A6F000] text-black font-bold shadow-sm"
                    : isToday
                      ? "border-2 border-black text-black font-bold"
                      : "text-black hover:bg-[#F5F5F5]"
                )}
              >
                {item.dateNumber}
              </div>

              {item.status && (
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    statusDotClass[item.status] || "bg-transparent"
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Day Agenda List */}
      <div className="mt-4 space-y-2">
        {agenda.map((slot) => (
          <div
            key={slot.id}
            className="group flex items-start justify-between gap-3 p-2.5 rounded-lg hover:bg-[#F5F5F5] transition-colors"
          >
            <div>
              <span className="text-[11px] font-medium text-[#808080] block font-sans">
                {slot.timeSlot}
              </span>
              <h5 className="text-xs font-semibold text-black mt-0.5">
                {slot.title}
              </h5>
              {slot.category && (
                <span className="text-[10px] text-[#4D4D4D] font-normal">
                  {slot.category}
                </span>
              )}
            </div>

            <button
              type="button"
              title="Session options"
              className="p-1 rounded text-[#808080] hover:text-black hover:bg-[#E6E6E6] transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

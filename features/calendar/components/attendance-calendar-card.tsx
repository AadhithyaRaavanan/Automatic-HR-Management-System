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

// Known TN Gazetted Holidays for live display
const KNOWN_HOLIDAYS: Record<string, { title: string; category: string }> = {
  "2026-01-01": { title: "New Year's Day (ஆங்கிலப் புத்தாண்டு)", category: "TN Gazetted Holiday" },
  "2026-01-14": { title: "Pongal Festival (தைப்பொங்கல்)", category: "TN Gazetted Holiday" },
  "2026-01-15": { title: "Thiruvalluvar Day (திருவள்ளுவர் தினம்)", category: "TN Gazetted Holiday" },
  "2026-01-16": { title: "Uzhavar Thirunal (உழவர் திருநாள்)", category: "TN Gazetted Holiday" },
  "2026-01-26": { title: "Republic Day (குடியரசு தினம்)", category: "National Holiday" },
  "2026-05-01": { title: "May Day / Labour Day (உழைப்பாளர் தினம்)", category: "National Holiday" },
  "2026-08-15": { title: "Independence Day (சுதந்திர தினம்)", category: "National Holiday" },
  "2026-10-02": { title: "Gandhi Jayanti (காந்தி ஜெயந்தி)", category: "National Holiday" },
  "2026-10-19": { title: "Ayutha Pooja (ஆயுத பூஜை)", category: "TN Gazetted Holiday" },
  "2026-10-20": { title: "Vijaya Dasami (விஜயதசமி)", category: "TN Gazetted Holiday" },
  "2026-11-08": { title: "Deepavali Festival (தீபாவளி பண்டிகை)", category: "TN Gazetted Holiday" },
  "2026-12-25": { title: "Christmas Day (கிறிஸ்துமஸ் பண்டிகை)", category: "TN Gazetted Holiday" },
  "2027-01-01": { title: "New Year's Day (ஆங்கிலப் புத்தாண்டு)", category: "TN Gazetted Holiday" },
  "2027-01-14": { title: "Bhogi Festival (போகிப் பண்டிகை)", category: "TN Gazetted Holiday" },
  "2027-01-15": { title: "Thai Pongal (தைப்பொங்கல்)", category: "TN Gazetted Holiday" },
  "2027-01-16": { title: "Thiruvalluvar Day (திருவள்ளுவர் தினம்)", category: "TN Gazetted Holiday" },
  "2027-01-17": { title: "Uzhavar Thirunal (உழவர் திருநாள்)", category: "TN Gazetted Holiday" },
  "2027-01-26": { title: "Republic Day (குடியரசு தினம்)", category: "National Holiday" },
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
    if (propAgenda && propAgenda.length > 0) return propAgenda;
    return generateLiveAgenda(selectedKey, shiftStartTime, shiftEndTime);
  }, [propAgenda, selectedKey, shiftStartTime, shiftEndTime]);

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
    present: "bg-status-success-dot",
    half_day: "bg-status-warning-dot",
    absent: "bg-status-danger-dot",
    holiday: "bg-brand-purple",
    weekend: "bg-text-tertiary/40",
    leave: "bg-status-info-dot",
  };

  return (
    <BentoCard
      title={
        <div className="flex items-center justify-between w-full">
          <span className="text-base font-bold text-text-primary tracking-tight">
            {monthLabel}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrev}
              title="Previous week"
              className="p-1 rounded-full text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              title="Next week"
              className="p-1 rounded-full text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      }
      className={cn("p-5 justify-between", className)}
    >
      {/* 7-Day Week Strip */}
      <div className="grid grid-cols-7 gap-1 text-center py-2 border-b border-border-light/60">
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
                  "text-[11px] font-semibold transition-colors",
                  isToday
                    ? "text-brand-purple font-bold"
                    : "text-text-tertiary group-hover:text-text-primary"
                )}
              >
                {item.dayName}
              </span>

              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                  isSelected
                    ? "bg-brand-purple text-white shadow-sm scale-105"
                    : isToday
                    ? "border-2 border-brand-purple text-brand-purple hover:bg-brand-purple/10"
                    : "text-text-primary hover:bg-card-subtle"
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
      <div className="mt-4 space-y-3">
        {agenda.map((slot) => (
          <div
            key={slot.id}
            className="group flex items-start justify-between gap-3 p-2.5 rounded-xl hover:bg-card-subtle/70 transition-colors"
          >
            <div>
              <span className="text-[11px] font-bold tracking-wider text-text-tertiary block font-mono">
                {slot.timeSlot}
              </span>
              <h5 className="text-xs font-bold text-text-primary mt-0.5">
                {slot.title}
              </h5>
              {slot.category && (
                <span className="text-[10px] text-brand-purple font-semibold">
                  {slot.category}
                </span>
              )}
            </div>

            <button
              type="button"
              title="Session options"
              className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </BentoCard>
  );
}

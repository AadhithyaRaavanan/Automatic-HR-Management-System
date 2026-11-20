"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { HeroCheckInCard } from "@/features/attendance/components/hero-check-in-card";
import { BreakControlCard } from "@/features/attendance/components/break-control-card";
import { StatCard } from "@/features/attendance/components/stat-card";
import { WeeklyHoursChart, DayBarData } from "@/features/attendance/components/weekly-hours-chart";
import { TodayTimeline } from "@/features/attendance/components/today-timeline";
import { SessionProgressRow } from "@/features/attendance/components/session-progress-row";
import { AnimatedProgressRing } from "@/features/attendance/components/animated-progress-ring";
import { HighlightCard } from "@/features/attendance/components/highlight-card";
import { DashedAddCard } from "@/features/attendance/components/dashed-add-card";
import { AttendanceCalendarCard } from "@/features/calendar/components/attendance-calendar-card";
import { RequestModal } from "@/features/requests/components/request-modal";
import { useAttendanceToday } from "@/features/attendance/hooks/use-attendance-today";
import { useCheckIn } from "@/features/attendance/hooks/use-check-in";
import { useCheckOut } from "@/features/attendance/hooks/use-check-out";
import { useAttendanceTimer } from "@/features/attendance/hooks/use-attendance-timer";
import { useNotifications } from "@/features/notifications/hooks/use-notifications";
import {
  useRegularizations,
  useSubmitRegularization,
} from "@/features/requests/hooks/use-regularizations";
import { createClient } from "@/lib/supabase/client";
import { formatDurationMinutes, formatTimeInTimezone, evaluatePreCheckInLock } from "@/lib/date/timezone";
import { getTamilMonthInfo } from "@/lib/date/holidays-tn";
import { getTaskDueState, TaskRecord } from "@/features/tasks/hooks/use-tasks";
import { EarlyCheckOutDialog } from "@/components/attendance/early-checkout-dialog";
import { LivePresenceWidget } from "@/components/attendance/live-presence-widget";
import {
  Clock,
  Calendar,
  Flame,
  CalendarDays,
  RefreshCw,
  Bell,
  FileCheck2,
  ArrowRight,
  CheckSquare,
  AlertTriangle,
  BarChart3,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface UpcomingHolidayRow {
  id: string;
  date: string;
  name: string;
  local_name: string | null;
  region: string;
}

function DashboardContent({
  onTogglePunch,
  onCheckOut,
  isCheckingOut = false,
}: {
  onTogglePunch: () => void;
  onCheckOut?: () => void;
  isCheckingOut?: boolean;
}) {
  const router = useRouter();
  const { userId, fullName, timezone, userRole } = useAppSession();
  const isPrivileged = userRole === "admin" || userRole === "hr" || userRole === "manager";
  const { data, isLoading, refetch } = useAttendanceToday();
  const checkInMutation = useCheckIn();
  const checkOutMutation = useCheckOut();
  const { notifications, unreadCount, markSingleRead, markAllRead } = useNotifications();
  const { data: regularizations = [] } = useRegularizations();
  const submitRegMutation = useSubmitRegularization();

  const [requestModalOpen, setRequestModalOpen] = React.useState(false);
  const [nextHoliday, setNextHoliday] = React.useState<UpcomingHolidayRow | null>(null);
  const [myTasks, setMyTasks] = React.useState<TaskRecord[]>([]);
  const supabase = React.useMemo(() => createClient(), []);

  React.useEffect(() => {
    let active = true;
    async function loadDashboardExtras() {
      const todayIso = new Date().toISOString().slice(0, 10);
      const { data: hols } = await (supabase as any)
        .from("holidays")
        .select("id, date, name, local_name, region")
        .eq("is_active", true)
        .gte("date", todayIso)
        .order("date", { ascending: true })
        .limit(1);
      if (active && hols && hols.length > 0) {
        setNextHoliday(hols[0] as UpcomingHolidayRow);
      }

      if (userId) {
        const { data: assignedTasks } = await supabase
          .from("tasks")
          .select(
            "id, organization_id, project_id, parent_task_id, title, description, creator_id, assignee_id, status, priority, due_date, estimated_minutes, started_at, completed_at, cancelled_at, created_at, updated_at"
          )
          .eq("assignee_id", userId)
          .in("status", ["todo", "in_progress", "blocked"])
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(4);
        if (active && assignedTasks) {
          setMyTasks(assignedTasks as TaskRecord[]);
        }
      }
    }
    loadDashboardExtras();
    return () => {
      active = false;
    };
  }, [supabase, userId]);

  const isCheckedIn = Boolean(data?.activeSession);
  const timer = useAttendanceTimer(data?.activeSession?.check_in_at);

  // Completed sessions total minutes + active ongoing session elapsed minutes
  const activeElapsedMinutes = isCheckedIn ? Math.floor(timer.elapsedSeconds / 60) : 0;
  const closedSessionsMinutes = (data?.sessions || [])
    .filter((s) => s.check_out_at)
    .reduce((acc, s) => {
      const dur = Math.max(0, Math.round((new Date(s.check_out_at!).getTime() - new Date(s.check_in_at).getTime()) / 60000));
      return acc + dur;
    }, 0);
  const todayMinutes = closedSessionsMinutes + activeElapsedMinutes || data?.daySummary?.total_minutes || 0;
  const targetMinutes = data?.targetMinutes || 480;
  const todayProgress = Math.min(Math.round((todayMinutes / targetMinutes) * 100), 100);

  const weekMinutes = (data?.weekTotalMinutes || 0) + (isCheckedIn ? activeElapsedMinutes : 0);
  const weeklyTarget = targetMinutes * 5;
  const weekProgress = Math.min(Math.round((weekMinutes / weeklyTarget) * 100), 100);

  const firstName = fullName ? fullName.split(/\s+/)[0] : "there";
  const topNotifications = notifications.slice(0, 3);
  const recentRegularizations = regularizations.slice(0, 2);

  // Authoritative shift & lock status matching the check-in card
  const shiftStartTime = data?.shiftStartTime || "09:00:00";
  const shiftEndTime = data?.shiftEndTime || "17:00:00";
  const userTimezone = data?.timezone || timezone || "Asia/Kolkata";

  const serverOffsetRef = React.useRef<number>(0);
  const [lockStatus, setLockStatus] = React.useState(() =>
    evaluatePreCheckInLock(shiftStartTime, shiftEndTime, userTimezone, new Date())
  );

  React.useEffect(() => {
    async function syncClock() {
      try {
        const t0 = Date.now();
        const res = await fetch("/api/time", { cache: "no-store" });
        if (res.ok) {
          const t1 = Date.now();
          const json = await res.json();
          const latency = (t1 - t0) / 2;
          serverOffsetRef.current = json.epoch + latency - t1;
          const syncedNow = new Date(Date.now() + serverOffsetRef.current);
          setLockStatus(evaluatePreCheckInLock(shiftStartTime, shiftEndTime, userTimezone, syncedNow));
        }
      } catch {}
    }
    syncClock();
  }, [shiftStartTime, shiftEndTime, userTimezone]);

  React.useEffect(() => {
    const timer = setInterval(() => {
      const syncedNow = new Date(Date.now() + serverOffsetRef.current);
      setLockStatus(evaluatePreCheckInLock(shiftStartTime, shiftEndTime, userTimezone, syncedNow));
    }, 10000);
    return () => clearInterval(timer);
  }, [shiftStartTime, shiftEndTime, userTimezone]);

  // Load week attendance history for the weekly bar chart (Mon - Fri)
  const [weeklyBars, setWeeklyBars] = React.useState<DayBarData[]>([]);

  React.useEffect(() => {
    let active = true;
    async function loadWeekChart() {
      if (!userId) return;
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0 is Sunday, 1 is Monday
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(today);
      monday.setDate(today.getDate() + mondayOffset);

      const daysArr: DayBarData[] = [];
      const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"];
      const datesToQuery: string[] = [];

      for (let i = 0; i < 5; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const iso = d.toISOString().slice(0, 10);
        datesToQuery.push(iso);
        daysArr.push({
          dayLabel: dayNames[i],
          dateStr: iso,
          workedMinutes: 0,
          isToday: iso === (data?.workDate || today.toISOString().slice(0, 10)),
        });
      }

      const { data: dbDays } = await (supabase as any)
        .from("attendance_days")
        .select("work_date, total_minutes")
        .eq("employee_id", userId)
        .in("work_date", datesToQuery);

      if (active && dbDays) {
        const minMap = new Map<string, number>();
        for (const row of dbDays) {
          minMap.set(row.work_date, row.total_minutes || 0);
        }
        const todayDate = data?.workDate || today.toISOString().slice(0, 10);
        if (todayMinutes > 0) {
          minMap.set(todayDate, Math.max(minMap.get(todayDate) || 0, todayMinutes));
        }

        const merged = daysArr.map((d) => ({
          ...d,
          workedMinutes: minMap.get(d.dateStr) || 0,
        }));
        setWeeklyBars(merged);
      } else if (active) {
        const todayDate = data?.workDate || today.toISOString().slice(0, 10);
        const merged = daysArr.map((d) => ({
          ...d,
          workedMinutes: d.dateStr === todayDate ? todayMinutes : 0,
        }));
        setWeeklyBars(merged);
      }
    }
    loadWeekChart();
    return () => {
      active = false;
    };
  }, [supabase, userId, data?.workDate, todayMinutes]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Info Row */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
        <div>
          <p className="text-xs sm:text-sm text-text-secondary font-medium">
            Today is{" "}
            <span className="font-bold text-text-primary">
              {data?.workDate || new Date().toISOString().slice(0, 10)}
            </span>{" "}
            ({userTimezone}). Target:{" "}
            <span className="font-bold text-black">
              {Math.floor(targetMinutes / 60)} hours
            </span>
            .
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="p-2 rounded-lg bg-card border border-border-light text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors cursor-pointer"
            title="Refresh attendance records"
            aria-label="Refresh attendance records"
          >
            <RefreshCw className="w-4 h-4 text-text-secondary" />
          </button>

          {/* Synchronized Header Action Button */}
          <button
            type="button"
            disabled={!isCheckedIn && lockStatus.isLocked}
            onClick={onTogglePunch}
            title={!isCheckedIn && lockStatus.isLocked ? lockStatus.message : undefined}
            className={cn(
              "px-4 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5",
              !isCheckedIn && lockStatus.isLocked
                ? "bg-card-subtle text-text-tertiary border border-border-light cursor-not-allowed opacity-75"
                : "bg-brand-navy hover:bg-brand-navy-hover text-white cursor-pointer"
            )}
          >
            {!isCheckedIn && lockStatus.isLocked && <Lock className="w-3.5 h-3.5" />}
            {isCheckedIn
              ? "Check out"
              : lockStatus.isLocked
                ? "Outside shift hours"
                : "Check in"}
          </button>
        </div>
      </section>

      {/* Row 1: Full-Width 3 Stat Cards (Titles in full, no truncation, big tabular-nums values, identical structure) */}
      <div className="grid grid-cols-3 gap-5">
        <StatCard
          title="Today's hours"
          value={formatDurationMinutes(todayMinutes)}
          subtitle={`Goal: ${formatDurationMinutes(targetMinutes)}`}
          progress={todayProgress}
          icon={<Clock className="w-4 h-4" />}
        />
        <StatCard
          title="Week total"
          value={formatDurationMinutes(weekMinutes)}
          subtitle={`${weekProgress}% of target completed`}
          progress={weekProgress}
          icon={<Calendar className="w-4 h-4" />}
        />
        <StatCard
          title="On-time streak"
          value={`${data?.streakDays || 0} days`}
          subtitle="Recent consistent punches"
          progress={Math.min(Math.max((data?.streakDays || 0) * 15, 10), 100)}
          icon={<Flame className="w-4 h-4 text-status-warning-dot" />}
        />
      </div>

      {/* Row 2: Two-Column Main Layout (Left: Hero Check-in + Breaks; Right: Weekly chart + Today's timeline + Shift info) */}
      <div data-tour="dashboard-hero" className="grid grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN (6 cols) */}
        <div className="col-span-6 space-y-5">
          <div data-tour="punch-card">
            <HeroCheckInCard
              isCheckedIn={isCheckedIn}
              isOnBreak={timer.isOnBreak}
              activeTime={timer.formattedTime}
              workDate={data?.workDate || "Today"}
              targetMinutes={targetMinutes}
              shiftStartTime={shiftStartTime}
              shiftEndTime={shiftEndTime}
              userTimezone={userTimezone}
              isLoading={checkInMutation.isPending || isCheckingOut || checkOutMutation.isPending || isLoading}
              onCheckIn={() => checkInMutation.mutate("Shift check-in")}
              onCheckOut={onCheckOut || (() => checkOutMutation.mutate())}
            />
          </div>
          <div data-tour="attendance-breaks">
            <BreakControlCard isCheckedIn={isCheckedIn} />
          </div>
        </div>

        {/* RIGHT COLUMN (6 cols): Fills the space with actionable data */}
        <div className="col-span-6 space-y-5">
          {/* (a) Weekly Worked Hours Bar Chart */}
          <SectionCard
            title="This Week's Worked Hours"
            subtitle="Daily performance vs 8h shift target"
            icon={<BarChart3 className="w-4 h-4 text-black" />}
          >
            <WeeklyHoursChart
              days={weeklyBars}
              targetHours={Math.round(targetMinutes / 60)}
            />
          </SectionCard>

          {/* (b) Today's Punch Timeline */}
          <SectionCard
            title="Today's Timeline"
            subtitle={`${data?.sessions?.length || 0} recorded session(s)`}
            icon={<Clock className="w-4 h-4 text-black" />}
          >
            <TodayTimeline
              sessions={data?.sessions || []}
              activeSession={data?.activeSession || null}
              timezone={userTimezone}
            />
          </SectionCard>

          {/* (c) Next Holiday & Shift Information */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-card border border-border-light space-y-1">
              <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-text-tertiary" />
                Upcoming holiday
              </span>
              {nextHoliday ? (
                <div>
                  <h4 className="text-xs font-semibold text-text-primary truncate">
                    {nextHoliday.name}
                  </h4>
                  <p className="text-xs text-text-secondary mt-0.5 tabular-nums">
                    {nextHoliday.date}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-text-tertiary">No upcoming holidays scheduled</p>
              )}
            </div>

            <div className="p-4 rounded-xl bg-card border border-border-light space-y-1">
              <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-text-tertiary" />
                Scheduled shift
              </span>
              <div>
                <h4 className="text-xs font-semibold text-text-primary tabular-nums">
                  {shiftStartTime.slice(0, 5)} – {shiftEndTime.slice(0, 5)}
                </h4>
                <p className="text-xs text-text-secondary mt-0.5">
                  Timezone: {userTimezone}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Privileged Live Presence & Workforce Logging for Admin / HR / Manager */}
      {isPrivileged && (
        <section>
          <LivePresenceWidget userTimezone={userTimezone} />
        </section>
      )}

      {/* Row 2: Live Notifications, Regularizations & Monthly Calendar */}
      <BentoGrid>
        {/* Notifications Card */}
        <BentoCard
          title="Notifications"
          action={
            unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => markAllRead().catch(() => { })}
                className="text-black hover:underline font-semibold text-xs cursor-pointer"
              >
                Mark all read
              </button>
            ) : null
          }
          className="lg:col-span-4 flex flex-col justify-between"
        >
          {topNotifications.length > 0 ? (
            <div className="space-y-2.5">
              {topNotifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={async () => {
                    if (!n.read_at) await markSingleRead(n.id).catch(() => { });
                    if (n.link) router.push(n.link);
                  }}
                  className={cn(
                    "w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer",
                    !n.read_at
                      ? "bg-[#F5F5F5] border-[#E6E6E6]"
                      : "bg-[#F5F5F5]/50 border-[#E6E6E6] opacity-80"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-black truncate">
                      {n.title}
                    </span>
                    {!n.read_at && (
                      <span className="w-2 h-2 rounded-full bg-[#FF1493] shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-[#808080] mt-1 line-clamp-2">
                    {n.body}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              className="py-6 border-dashed shadow-none bg-card-subtle/40"
              icon={<Bell className="w-5 h-5" />}
              title="No new notifications"
              description="Leave updates, approvals, and missed checkout alerts will appear here."
            />
          )}
        </BentoCard>

        {/* Regularization Requests */}
        <BentoCard
          title="Regularization Requests"
          action={
            <Link
              href="/requests"
              className="text-black hover:underline text-xs font-semibold flex items-center gap-1"
            >
              <span>Inbox</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          }
          className="lg:col-span-4 flex flex-col justify-between"
        >
          <div className="space-y-2.5 mb-4">
            {recentRegularizations.length > 0 ? (
              recentRegularizations.map((req) => (
                <div
                  key={req.id}
                  className="p-3.5 rounded-2xl bg-card border border-border-light shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] font-bold text-text-tertiary uppercase font-mono">
                      {req.work_date}
                    </span>
                    <StatusPill status={req.status} />
                  </div>
                  <p className="text-xs font-bold text-text-primary line-clamp-2">
                    {req.reason}
                  </p>
                </div>
              ))
            ) : (
              <EmptyState
                className="py-5 border-dashed shadow-none bg-card-subtle/40"
                icon={<FileCheck2 className="w-5 h-5" />}
                title="No regularization requests"
                description="Need to adjust a forgotten check-in or out? Submit a request below."
              />
            )}
          </div>

          <DashedAddCard
            label="Add new request"
            onClick={() => setRequestModalOpen(true)}
          />
        </BentoCard>

        {/* Attendance Calendar Card */}
        <div className="lg:col-span-4">
          <AttendanceCalendarCard
            currentMonth={new Date().toLocaleString("en-US", {
              month: "long",
              year: "numeric",
            })}
            shiftStartTime={shiftStartTime}
            shiftEndTime={shiftEndTime}
            onSelectDate={() => router.push("/attendance")}
          />
        </div>
      </BentoGrid>

      {/* Row 3: Deliverable Tasks & Privacy Architecture */}
      <BentoGrid>
        {/* Highlight Policy Card */}
        <HighlightCard
          title="Privacy-First Attendance"
          description="Only your check-in and check-out timestamps and declared timezone are recorded. Never GPS, screen, or keystroke monitoring."
          buttonText="View Privacy Manifesto"
          onAction={() => router.push("/settings")}
          className="lg:col-span-8"
        />

        {/* Animated Progress Ring */}
        <BentoCard
          title="Daily Shift Target"
          className="lg:col-span-4 flex flex-col justify-between text-center"
        >
          <div className="flex flex-col items-center justify-around gap-4 py-2">
            <AnimatedProgressRing
              percentage={todayProgress}
              size={100}
              strokeWidth={8}
              title="Shift Progress"
              caption={`${todayMinutes}/${targetMinutes} mins`}
              color="#B7FF00"
            />
          </div>
        </BentoCard>
      </BentoGrid>

      {/* Row 4: My Tasks Widget */}
      <BentoGrid>
        <BentoCard
          title="My Tasks"
          subtitle="Open assignments and upcoming deadlines"
          action={
            <Link
              href="/tasks"
              className="text-black hover:underline text-xs font-semibold flex items-center gap-1"
            >
              <span>Open Tasks Board</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          }
          className="lg:col-span-12"
        >
          {myTasks.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {myTasks.map((task) => {
                const dueState = getTaskDueState(task.due_date, task.status);
                return (
                  <Link
                    key={task.id}
                    href={`/tasks?task=${task.id}`}
                    className="p-3.5 rounded-xl bg-[#F5F5F5] hover:bg-white border border-[#E6E6E6] transition-all space-y-2 block"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <StatusPill status={task.status} />
                      <StatusPill status={task.priority} showIcon={false} />
                    </div>
                    <h3 className="text-xs font-semibold text-black line-clamp-1">
                      {task.title}
                    </h3>
                    <div className="flex items-center justify-between text-[11px]">
                      {dueState === "overdue" ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#FF1493]">
                          <AlertTriangle className="w-3 h-3" />
                          Overdue ({task.due_date})
                        </span>
                      ) : task.due_date ? (
                        <span className="text-[#808080] font-mono">
                          Due {task.due_date}
                        </span>
                      ) : (
                        <span className="text-[#808080]">No due date</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              className="py-6 border-dashed shadow-none bg-card-subtle/40"
              icon={<CheckSquare className="w-5 h-5" />}
              title="No open tasks assigned"
              description="Visit the Tasks board to track assignments or create a new deliverable."
              action={
                <Link
                  href="/tasks"
                  className="px-4 py-1.5 rounded-lg bg-black text-white text-xs font-semibold"
                >
                  Go to Tasks
                </Link>
              }
            />
          )}
        </BentoCard>
      </BentoGrid>

      <RequestModal
        open={requestModalOpen}
        onOpenChange={setRequestModalOpen}
        onSubmitRequest={async (formData) => {
          await submitRegMutation.mutateAsync(formData);
        }}
      />
    </div>
  );
}

export default function EmployeeDashboardPage() {
  const { data } = useAttendanceToday();
  const checkInMutation = useCheckIn();
  const isCheckedIn = Boolean(data?.activeSession);

  const [earlyCheckOutData, setEarlyCheckOutData] = React.useState<{
    open: boolean;
    shiftEndTime: string;
    formattedEarly: string;
  }>({
    open: false,
    shiftEndTime: "17:00",
    formattedEarly: "0 h 0 m",
  });

  const checkOutMutation = useCheckOut({
    onEarlyCheckOutRequired: (payload) => {
      setEarlyCheckOutData({
        open: true,
        shiftEndTime: payload.shift_end_time,
        formattedEarly: payload.formatted_early,
      });
    },
  });

  const handleTogglePunch = () => {
    if (isCheckedIn) {
      checkOutMutation.mutate();
    } else {
      checkInMutation.mutate("Regular day shift");
    }
  };

  const handleConfirmEarly = (reason?: string) => {
    checkOutMutation.mutate(
      { confirm_early: true, reason },
      {
        onSettled: () => {
          setEarlyCheckOutData((prev) => ({ ...prev, open: false }));
        },
      }
    );
  };

  return (
    <AppShell
      primaryActionLabel={isCheckedIn ? "Check Out" : "Quick Check-in"}
      onPrimaryAction={handleTogglePunch}
    >
      <DashboardContent
        onTogglePunch={handleTogglePunch}
        onCheckOut={() => checkOutMutation.mutate()}
        isCheckingOut={checkOutMutation.isPending}
      />
      <EarlyCheckOutDialog
        open={earlyCheckOutData.open}
        onOpenChange={(open) => setEarlyCheckOutData((prev) => ({ ...prev, open }))}
        shiftEndTime={earlyCheckOutData.shiftEndTime}
        formattedEarly={earlyCheckOutData.formattedEarly}
        isPending={checkOutMutation.isPending}
        onConfirm={handleConfirmEarly}
        onCancel={() => setEarlyCheckOutData((prev) => ({ ...prev, open: false }))}
      />
    </AppShell>
  );
}

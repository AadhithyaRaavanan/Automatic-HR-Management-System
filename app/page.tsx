"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { HeroCheckInCard } from "@/features/attendance/components/hero-check-in-card";
import { StatCard } from "@/features/attendance/components/stat-card";
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
import { formatDurationMinutes, formatTimeInTimezone } from "@/lib/date/timezone";
import { getTamilMonthInfo } from "@/lib/date/holidays-tn";
import { getTaskDueState, TaskRecord } from "@/features/tasks/hooks/use-tasks";
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
}: {
  onTogglePunch: () => void;
}) {
  const router = useRouter();
  const { userId, fullName, timezone } = useAppSession();
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

  const todayMinutes = data?.daySummary?.total_minutes || 0;
  const targetMinutes = data?.targetMinutes || 480;
  const todayProgress = Math.min(Math.round((todayMinutes / targetMinutes) * 100), 100);

  const weekMinutes = data?.weekTotalMinutes || todayMinutes;
  const weeklyTarget = targetMinutes * 5;
  const weekProgress = Math.min(Math.round((weekMinutes / weeklyTarget) * 100), 100);

  const firstName = fullName ? fullName.split(/\s+/)[0] : "there";
  const tamilMonth = getTamilMonthInfo();
  const topNotifications = notifications.slice(0, 3);
  const recentRegularizations = regularizations.slice(0, 2);

  return (
    <div className="space-y-6">
      {/* Header Greeting Row */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-text-primary tracking-tight">
            Hi, {firstName}!
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1 font-medium">
            Today is{" "}
            <span className="font-bold text-text-primary">
              {data?.workDate || new Date().toISOString().slice(0, 10)}
            </span>{" "}
            ({data?.timezone || timezone || "UTC"}). Target:{" "}
            <span className="font-bold text-brand-purple">
              {Math.floor(targetMinutes / 60)} hours
            </span>
            .
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="p-2 rounded-full bg-card border border-border-light text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors shadow-sm cursor-pointer"
            title="Refresh attendance records"
            aria-label="Refresh attendance records"
          >
            <RefreshCw className="w-4 h-4 text-brand-purple" />
          </button>
          <button
            type="button"
            onClick={onTogglePunch}
            className="px-4 py-2 rounded-full bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold shadow-sm cursor-pointer"
          >
            {isCheckedIn ? "Check Out Now" : "Check In Now"}
          </button>
        </div>
      </section>

      {/* Row 1: Hero Action Card & Quick Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-6">
          <HeroCheckInCard
            isCheckedIn={isCheckedIn}
            activeTime={timer.formattedTime}
            workDate={data?.workDate || "Today"}
            targetMinutes={targetMinutes}
            isLoading={checkInMutation.isPending || checkOutMutation.isPending || isLoading}
            onCheckIn={() => checkInMutation.mutate("Morning shift punch")}
            onCheckOut={() => checkOutMutation.mutate()}
          />
        </div>

        <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="Today's Hours"
            value={formatDurationMinutes(todayMinutes)}
            subtitle={`Goal: ${formatDurationMinutes(targetMinutes)}`}
            progress={todayProgress}
            icon={<Clock className="w-4 h-4" />}
          />
          <StatCard
            title="Week Total"
            value={formatDurationMinutes(weekMinutes)}
            subtitle={`${weekProgress}% completed`}
            progress={weekProgress}
            icon={<Calendar className="w-4 h-4" />}
          />
          <StatCard
            title="On-Time Streak"
            value={`${data?.streakDays || 0} Days`}
            subtitle="Recent consistent punches"
            icon={<Flame className="w-4 h-4 text-status-warning-dot" />}
          />
        </div>
      </div>

      {/* Row 2: Live Notifications, Regularizations & Monthly Calendar */}
      <BentoGrid>
        {/* Notifications Card */}
        <BentoCard
          title="Notifications"
          action={
            unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => markAllRead().catch(() => {})}
                className="text-brand-purple hover:underline font-bold text-xs cursor-pointer"
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
                    if (!n.read_at) await markSingleRead(n.id).catch(() => {});
                    if (n.link) router.push(n.link);
                  }}
                  className={cn(
                    "w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer",
                    !n.read_at
                      ? "bg-brand-purple-light/20 border-brand-purple/30"
                      : "bg-card-subtle border-border-light opacity-80"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-text-primary truncate">
                      {n.title}
                    </span>
                    {!n.read_at && (
                      <span className="w-2 h-2 rounded-full bg-brand-purple shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-text-secondary mt-1 line-clamp-2">
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
              className="text-brand-purple hover:underline text-xs font-bold flex items-center gap-1"
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
            currentMonth={`${new Date().toLocaleString("en-US", {
              month: "long",
              year: "numeric",
            })} • ${tamilMonth.tamil}`}
            onSelectDate={() => router.push("/attendance")}
          />
        </div>
      </BentoGrid>

      {/* Row 3: Today's Sessions, Tip, Progress Ring & Upcoming Holiday */}
      <BentoGrid>
        {/* Today Sessions */}
        <BentoCard
          title="Today's Sessions"
          subtitle="Clock intervals logged in your active shift"
          className="lg:col-span-5"
        >
          <div className="space-y-1">
            {(data?.sessions || []).length > 0 ? (
              data!.sessions.map((sess) => {
                const checkInTime = formatTimeInTimezone(
                  sess.check_in_at,
                  data?.timezone || "UTC"
                );
                const checkOutTime = sess.check_out_at
                  ? formatTimeInTimezone(sess.check_out_at, data?.timezone || "UTC")
                  : "In Progress";

                const diffMins = sess.check_out_at
                  ? Math.round(
                      (new Date(sess.check_out_at).getTime() -
                        new Date(sess.check_in_at).getTime()) /
                        (60 * 1000)
                    )
                  : Math.round(timer.elapsedSeconds / 60);

                const sessPct = Math.min(
                  Math.round((diffMins / (targetMinutes / 2)) * 100),
                  100
                );

                return (
                  <SessionProgressRow
                    key={sess.id}
                    title={sess.note || "Work Session"}
                    timestamp={`${checkInTime} - ${checkOutTime}`}
                    duration={formatDurationMinutes(diffMins)}
                    percentage={sessPct}
                    tags={[sess.source]}
                  />
                );
              })
            ) : (
              <EmptyState
                className="py-6 border-dashed shadow-none bg-card-subtle/40"
                icon={<Clock className="w-5 h-5" />}
                title="No sessions recorded today"
                description='Use "Check In" when you begin work.'
              />
            )}
          </div>
        </BentoCard>

        {/* Highlight Policy Card */}
        <HighlightCard
          title="Privacy-First Attendance"
          description="Only your check-in and check-out timestamps and declared timezone are recorded. Never GPS, screen, or keystroke monitoring."
          buttonText="View Privacy Manifesto"
          onAction={() => router.push("/settings")}
          className="lg:col-span-3"
        />

        {/* Animated Progress Ring */}
        <BentoCard
          title="Shift Progress"
          className="lg:col-span-2 flex flex-col justify-between text-center"
        >
          <div className="flex flex-col items-center justify-around gap-4 py-2">
            <AnimatedProgressRing
              percentage={todayProgress}
              size={90}
              strokeWidth={7}
              title="Shift Target"
              caption={`${todayMinutes}/${targetMinutes} mins`}
              color="var(--brand-purple)"
            />
          </div>
        </BentoCard>

        {/* Next Upcoming Holiday Card */}
        <BentoCard
          title="Upcoming Holiday"
          action={
            <Link href="/holidays" className="text-xs font-bold text-brand-purple hover:underline">
              Calendar →
            </Link>
          }
          className="lg:col-span-2 flex flex-col justify-between"
        >
          {nextHoliday ? (
            <div>
              <div className="flex items-center gap-1.5 text-xs text-brand-purple font-semibold mb-1">
                <CalendarDays className="w-3.5 h-3.5" />
                <span>{nextHoliday.date}</span>
              </div>
              <h3 className="text-sm font-bold text-text-primary">{nextHoliday.name}</h3>
              {nextHoliday.local_name && (
                <p className="text-xs text-brand-purple mt-0.5">{nextHoliday.local_name}</p>
              )}
              <p className="text-[11px] text-text-tertiary mt-1">
                Region: {nextHoliday.region}
              </p>
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-text-tertiary">
              No upcoming holidays scheduled yet.
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-border-light">
            <Link
              href="/holidays"
              className="w-full py-2 px-3 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-colors flex items-center justify-center gap-1"
            >
              <span>View Holiday Calendar</span>
            </Link>
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
              className="text-brand-purple hover:underline text-xs font-bold flex items-center gap-1"
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
                    className="p-3.5 rounded-2xl bg-card-subtle hover:bg-card border border-border-light hover:border-brand-purple/40 transition-all space-y-2 block"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <StatusPill status={task.status} />
                      <StatusPill status={task.priority} showIcon={false} />
                    </div>
                    <h3 className="text-xs font-bold text-text-primary line-clamp-1">
                      {task.title}
                    </h3>
                    <div className="flex items-center justify-between text-[11px]">
                      {dueState === "overdue" ? (
                        <span className="inline-flex items-center gap-1 font-extrabold text-status-danger-text">
                          <AlertTriangle className="w-3 h-3" />
                          Overdue ({task.due_date})
                        </span>
                      ) : task.due_date ? (
                        <span className="text-text-secondary font-mono">
                          Due {task.due_date}
                        </span>
                      ) : (
                        <span className="text-text-tertiary">No due date</span>
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
                  className="px-4 py-1.5 rounded-full bg-brand-purple text-white text-xs font-bold"
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
  const checkOutMutation = useCheckOut();
  const isCheckedIn = Boolean(data?.activeSession);

  const handleTogglePunch = () => {
    if (isCheckedIn) {
      checkOutMutation.mutate();
    } else {
      checkInMutation.mutate("Regular day shift");
    }
  };

  return (
    <AppShell
      primaryActionLabel={isCheckedIn ? "Check Out" : "Quick Check-in"}
      onPrimaryAction={handleTogglePunch}
    >
      <DashboardContent onTogglePunch={handleTogglePunch} />
    </AppShell>
  );
}

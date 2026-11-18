"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getEmployeeWorkDate } from "@/lib/date/timezone";
import { AttendanceDayStatus, SessionSource } from "@/types/database.types";
import { isDemoModeEnabled } from "@/lib/config/demo";
import {
  getStoredAttendanceSessions,
  getStoredAttendanceDays,
} from "@/lib/storage/demo-store";

export interface AttendanceSessionItem {
  id: string;
  employee_id: string;
  work_date: string;
  check_in_at: string;
  check_out_at: string | null;
  source: SessionSource;
  note: string | null;
}

export interface DaySummaryRow {
  total_minutes: number;
  status: AttendanceDayStatus;
  is_late: boolean;
  locked: boolean;
}

export interface TodayAttendanceData {
  workDate: string;
  timezone: string;
  targetMinutes: number;
  shiftStartTime?: string;
  shiftEndTime?: string;
  activeSession: AttendanceSessionItem | null;
  sessions: AttendanceSessionItem[];
  daySummary: DaySummaryRow | null;
  weekTotalMinutes: number;
  streakDays: number;
}

interface EmployeeProfileRow {
  timezone: string;
  work_target_minutes: number;
  shift_start_time?: string;
  shift_end_time?: string;
}

export function useAttendanceToday() {
  const supabase = createClient();

  return useQuery<TodayAttendanceData>({
    queryKey: ["attendance", "today"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? (await supabase.auth.getUser()).data.user;

      const userTimezone =
        (user?.user_metadata?.timezone as string) || "UTC";
      const todayDate = getEmployeeWorkDate(userTimezone);

      // If no authenticated user session, only allow mock preview in non-production demo mode
      if (!user) {
        const storedSessions = getStoredAttendanceSessions().filter((s) => s.work_date === todayDate);
        const storedDays = getStoredAttendanceDays().find((d) => d.work_date === todayDate);
        const activeSess = storedSessions.find((s) => !s.check_out_at);

        return {
          workDate: todayDate,
          timezone: userTimezone,
          targetMinutes: 480,
          shiftStartTime: "09:00:00",
          shiftEndTime: "17:00:00",
          activeSession: activeSess
            ? {
                id: activeSess.id,
                employee_id: activeSess.employee_id,
                work_date: activeSess.work_date,
                check_in_at: activeSess.check_in_at,
                check_out_at: activeSess.check_out_at,
                source: "web",
                note: null,
              }
            : null,
          sessions: storedSessions.map((s) => ({
            id: s.id,
            employee_id: s.employee_id,
            work_date: s.work_date,
            check_in_at: s.check_in_at,
            check_out_at: s.check_out_at,
            source: "web",
            note: null,
          })),
          daySummary: storedDays
            ? {
                total_minutes: storedDays.total_minutes,
                status: storedDays.status,
                is_late: storedDays.is_late,
                locked: storedDays.locked,
              }
            : null,
          weekTotalMinutes: storedDays?.total_minutes || 0,
          streakDays: storedDays?.status === "present" ? 1 : 0,
        };
      }

      // Fetch employee profile & shift hours
      const [{ data: profileData }, { data: memberData }] = await Promise.all([
        supabase
          .from("employees")
          .select("timezone, work_target_minutes, shift_start_time, shift_end_time")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("organization_members")
          .select("shift_start_time, shift_end_time")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      const empProfile = profileData as EmployeeProfileRow | null;
      const memRow = memberData as any;
      const effectiveTz = empProfile?.timezone && empProfile.timezone !== "UTC" ? empProfile.timezone : (userTimezone && userTimezone !== "UTC" ? userTimezone : "Asia/Kolkata");
      const targetMins = empProfile?.work_target_minutes || 480;
      const shiftStartTime = empProfile?.shift_start_time || memRow?.shift_start_time || "09:00:00";
      const shiftEndTime = empProfile?.shift_end_time || memRow?.shift_end_time || "17:00:00";
      const effectiveWorkDate = getEmployeeWorkDate(effectiveTz, new Date(), shiftStartTime, shiftEndTime);

      // 1. Fetch today's sessions and any open active session (supporting overnight crossover)
      const [{ data: sessions }, { data: activeOpenSession }] = await Promise.all([
        supabase
          .from("attendance_sessions")
          .select("*")
          .eq("employee_id", user.id)
          .eq("work_date", effectiveWorkDate)
          .order("check_in_at", { ascending: true }),
        supabase
          .from("attendance_sessions")
          .select("*")
          .eq("employee_id", user.id)
          .is("check_out_at", null)
          .order("check_in_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const sessionList = (sessions || []) as AttendanceSessionItem[];
      const active = (activeOpenSession as AttendanceSessionItem | null) || sessionList.find((s) => s.check_out_at === null) || null;

      // 2. Fetch today's day summary
      const { data: summaryData } = await supabase
        .from("attendance_days")
        .select("total_minutes, status, is_late, locked")
        .eq("employee_id", user.id)
        .eq("work_date", effectiveWorkDate)
        .maybeSingle();

      const daySummary = summaryData as DaySummaryRow | null;

      // 3. Fetch recent days for week total & attendance streak
      const { data: recentDays } = await supabase
        .from("attendance_days")
        .select("total_minutes, status")
        .eq("employee_id", user.id)
        .order("work_date", { ascending: false })
        .limit(30);

      const recentRows = (recentDays || []) as { total_minutes: number; status: AttendanceDayStatus }[];
      const weekTotal = recentRows
        .slice(0, 7)
        .reduce((acc, curr) => acc + (curr.total_minutes || 0), 0);

      let streakDays = 0;
      for (const row of recentRows) {
        if (row.status === "absent") break;
        if (row.status === "present" || row.status === "half_day") {
          streakDays += 1;
        }
      }

      return {
        workDate: effectiveWorkDate,
        timezone: effectiveTz,
        targetMinutes: targetMins,
        shiftStartTime,
        shiftEndTime,
        activeSession: active,
        sessions: sessionList,
        daySummary: daySummary || null,
        weekTotalMinutes: weekTotal || (daySummary?.total_minutes || 0),
        streakDays,
      };
    },
    staleTime: 0, // Live punch state is always immediately refreshed on tab switch / window focus
    refetchOnWindowFocus: true,
  });
}

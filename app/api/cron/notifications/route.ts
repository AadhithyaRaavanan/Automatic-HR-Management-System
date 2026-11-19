import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/notify";
import { getManagersOf, getHrUsers } from "@/lib/notifications/recipients";
import { dispatchBirthdayNotifications } from "@/lib/notifications/birthdays";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // 1. Authorize via CRON_SECRET if configured
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");
    const secretHeader = request.headers.get("x-cron-secret");

    if (cronSecret) {
      const isAuthorized =
        authHeader === `Bearer ${cronSecret}` || secretHeader === cronSecret;
      if (!isAuthorized) {
        return NextResponse.json({ error: "Unauthorized cron execution" }, { status: 401 });
      }
    }

    const now = new Date();
    // Resolve date in Asia/Kolkata
    const kolkataDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now); // "YYYY-MM-DD"

    const kolkataHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        hour12: false,
      }).format(now),
      10
    );

    const kolkataMins = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        minute: "numeric",
      }).format(now),
      10
    );
    const currentTotalMins = kolkataHour * 60 + kolkataMins;

    const stats = {
      taskDueSoon: 0,
      taskOverdue: 0,
      pendingLeave48h: 0,
      pendingReg48h: 0,
      shiftMissedCheckIn: 0,
      shiftLateCheckOut: 0,
      autoClosedSessions: 0,
      onboardingIncomplete: 0,
      birthdaysCelebrated: 0,
    };

    // ------------------------------------------------------------------------
    // Rule 1: Tasks Due within 24h & Overdue
    // ------------------------------------------------------------------------
    try {
      const { data: tasks } = await (supabaseAdmin.from("tasks") as any)
        .select("id, title, assignee_id, creator_id, due_date, status")
        .in("status", ["todo", "in_progress"])
        .not("due_date", "is", null);

      if (tasks) {
        for (const t of tasks) {
          if (!t.assignee_id) continue;
          const dueDateStr = t.due_date.slice(0, 10);

          if (dueDateStr === kolkataDate) {
            // Due within 24h
            await notify({
              userIds: [t.assignee_id],
              type: "reminder_task_due",
              typeGroup: "reminders",
              title: "Task Due Today",
              body: `Your assigned task "${t.title}" is due today (${dueDateStr}).`,
              link: "/tasks",
              entityType: "tasks",
              entityId: t.id,
              dedupeKey: `task-due-24h:${t.id}:${kolkataDate}`,
            });
            stats.taskDueSoon++;
          } else if (dueDateStr < kolkataDate) {
            // Overdue -> Assignee
            await notify({
              userIds: [t.assignee_id],
              type: "reminder_task_overdue",
              typeGroup: "reminders",
              title: "Task Overdue",
              body: `Your assigned task "${t.title}" was due on ${dueDateStr} and is currently overdue.`,
              link: "/tasks",
              entityType: "tasks",
              entityId: t.id,
              dedupeKey: `task-overdue-emp:${t.id}:${kolkataDate}`,
            });

            // Overdue -> Manager (once per task)
            const managers = await getManagersOf(t.assignee_id);
            if (managers.length > 0) {
              await notify({
                userIds: managers,
                type: "reminder_task_overdue_manager",
                typeGroup: "reminders",
                title: "Team Task Overdue Notice",
                body: `Task "${t.title}" assigned to your team member was due on ${dueDateStr} and is overdue.`,
                link: "/tasks",
                entityType: "tasks",
                entityId: t.id,
                dedupeKey: `task-overdue-mgr:${t.id}`,
              });
            }
            stats.taskOverdue++;
          }
        }
      }
    } catch (err) {
      console.error("[Cron: Task Reminders Error]:", err);
    }

    // ------------------------------------------------------------------------
    // Rule 2: Leave or Correction Pending > 48h
    // ------------------------------------------------------------------------
    try {
      const twoDaysAgoIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

      // Pending Leave Requests
      const { data: pendingLeaves } = await (supabaseAdmin.from("leave_requests") as any)
        .select("id, employee_id, start_date, end_date, created_at")
        .eq("status", "pending")
        .lt("created_at", twoDaysAgoIso);

      if (pendingLeaves) {
        for (const lr of pendingLeaves) {
          const managers = await getManagersOf(lr.employee_id);
          const hrUsers = await getHrUsers();
          const reviewers = Array.from(new Set([...managers, ...hrUsers]));

          if (reviewers.length > 0) {
            await notify({
              userIds: reviewers,
              type: "reminder_leave_pending_48h",
              typeGroup: "reminders",
              title: "Leave Request Awaiting Review (>48h)",
              body: `A leave request submitted on ${lr.created_at.slice(0, 10)} has been pending review for over 48 hours.`,
              link: "/leave",
              entityType: "leave_requests",
              entityId: lr.id,
              dedupeKey: `leave-pending-48h:${lr.id}:${kolkataDate}`,
            });
            stats.pendingLeave48h++;
          }
        }
      }

      // Pending Regularization Requests
      const { data: pendingRegs } = await (supabaseAdmin.from("regularization_requests") as any)
        .select("id, employee_id, work_date, created_at")
        .eq("status", "pending")
        .lt("created_at", twoDaysAgoIso);

      if (pendingRegs) {
        for (const rr of pendingRegs) {
          const managers = await getManagersOf(rr.employee_id);
          const hrUsers = await getHrUsers();
          const reviewers = Array.from(new Set([...managers, ...hrUsers]));

          if (reviewers.length > 0) {
            await notify({
              userIds: reviewers,
              type: "reminder_reg_pending_48h",
              typeGroup: "reminders",
              title: "Attendance Regularization Awaiting Review (>48h)",
              body: `An attendance correction for ${rr.work_date} has been pending approval for more than 48 hours.`,
              link: "/requests",
              entityType: "regularization_requests",
              entityId: rr.id,
              dedupeKey: `reg-pending-48h:${rr.id}:${kolkataDate}`,
            });
            stats.pendingReg48h++;
          }
        }
      }
    } catch (err) {
      console.error("[Cron: Pending Requests Error]:", err);
    }

    // ------------------------------------------------------------------------
    // Rule 3: Shift Start Passed with No Check-In
    // ------------------------------------------------------------------------
    try {
      const { data: activeEmployees } = await (supabaseAdmin.from("employees") as any)
        .select("id, shift_start_time, shift_end_time, status")
        .eq("status", "active")
        .not("shift_start_time", "is", null);

      if (activeEmployees) {
        for (const emp of activeEmployees) {
          const [sh = 9, sm = 0] = (emp.shift_start_time || "09:00:00").split(":").map(Number);
          const shiftStartMins = sh * 60 + sm;

          // Check if shift start + 30 mins has passed in Kolkata time
          if (currentTotalMins > shiftStartMins + 30) {
            // Check if checked in today
            const { data: attDay } = await (supabaseAdmin.from("attendance_days") as any)
              .select("id, status")
              .eq("employee_id", emp.id)
              .eq("work_date", kolkataDate)
              .maybeSingle();

            if (!attDay || attDay.status === "absent") {
              await notify({
                userIds: [emp.id],
                type: "reminder_shift_missed_checkin",
                typeGroup: "reminders",
                title: "Shift Check-in Reminder",
                body: `Your shift started at ${emp.shift_start_time.slice(0, 5)}. You have not logged your check-in for today yet.`,
                link: "/",
                entityType: "attendance_days",
                dedupeKey: `shift-missed-checkin:${emp.id}:${kolkataDate}`,
              });
              stats.shiftMissedCheckIn++;
            }
          }
        }
      }
    } catch (err) {
      console.error("[Cron: Shift Missed Checkin Error]:", err);
    }

    // ------------------------------------------------------------------------
    // Rule 4: Still Checked In After Shift End + 30 Min
    // ------------------------------------------------------------------------
    try {
      const { data: openSessions } = await (supabaseAdmin.from("attendance_sessions") as any)
        .select("id, employee_id, work_date, employees:employee_id(shift_end_time)")
        .eq("work_date", kolkataDate)
        .is("punch_out", null);

      if (openSessions) {
        for (const sess of openSessions) {
          const shiftEndTime = sess.employees?.shift_end_time || "17:00:00";
          const [eh = 17, em = 0] = shiftEndTime.split(":").map(Number);
          const shiftEndMins = eh * 60 + em;

          if (currentTotalMins > shiftEndMins + 30) {
            await notify({
              userIds: [sess.employee_id],
              type: "reminder_shift_late_checkout",
              typeGroup: "reminders",
              title: "Shift Check-out Reminder",
              body: `Your shift concluded at ${shiftEndTime.slice(0, 5)}. You are currently still clocked in. Please remember to check out.`,
              link: "/",
              entityType: "attendance_sessions",
              entityId: sess.id,
              dedupeKey: `shift-late-checkout:${sess.id}:${kolkataDate}`,
            });
            stats.shiftLateCheckOut++;
          }
        }
      }
    } catch (err) {
      console.error("[Cron: Late Checkout Error]:", err);
    }

    // ------------------------------------------------------------------------
    // Rule 5: Auto-Closed Session Needs Confirmation
    // ------------------------------------------------------------------------
    try {
      const { data: autoClosedSessions } = await (supabaseAdmin.from("attendance_sessions") as any)
        .select("id, employee_id, work_date, auto_closed, regularization_requested")
        .eq("auto_closed", true)
        .or("regularization_requested.eq.false,regularization_requested.is.null")
        .limit(30);

      if (autoClosedSessions) {
        for (const sess of autoClosedSessions) {
          await notify({
            userIds: [sess.employee_id],
            type: "reminder_autoclosed_session",
            typeGroup: "reminders",
            title: "Attendance Session Auto-Closed",
            body: `Your attendance session on ${sess.work_date} was automatically closed. Please review and regularize your timings.`,
            link: "/requests",
            entityType: "attendance_sessions",
            entityId: sess.id,
            dedupeKey: `session-autoclosed:${sess.id}`,
          });
          stats.autoClosedSessions++;
        }
      }
    } catch (err) {
      console.error("[Cron: Auto-Closed Sessions Error]:", err);
    }

    // ------------------------------------------------------------------------
    // Rule 6: Candidate Onboarding Incomplete for 3 Days
    // ------------------------------------------------------------------------
    try {
      const threeDaysAgoIso = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
      const { data: incompleteProfiles } = await (supabaseAdmin as any)
        .from("onboarding_profiles")
        .select("user_id, created_at, onboarding_status")
        .in("onboarding_status", ["DRAFT", "INVITED", "NOT_STARTED"])
        .lt("created_at", threeDaysAgoIso);

      if (incompleteProfiles) {
        for (const prof of incompleteProfiles) {
          await notify({
            userIds: [prof.user_id],
            type: "reminder_onboarding_incomplete",
            typeGroup: "reminders",
            title: "Complete Your Onboarding",
            body: "Your Pulse employee onboarding registration is still pending. Please submit your profile details and upload the required documents.",
            link: "/onboarding",
            entityType: "onboarding_profiles",
            entityId: prof.user_id,
            dedupeKey: `onboarding-incomplete-3d:${prof.user_id}:${kolkataDate}`,
          });
          stats.onboardingIncomplete++;
        }
      }
    } catch (err) {
      console.error("[Cron: Incomplete Onboarding Error]:", err);
    }

    // ------------------------------------------------------------------------
    // Rule 7: Daily Birthday Celebration & Announcements
    // ------------------------------------------------------------------------
    try {
      const bdayResult = await dispatchBirthdayNotifications(kolkataDate);
      stats.birthdaysCelebrated = bdayResult.birthdaysCount;
    } catch (err) {
      console.error("[Cron: Birthday Dispatch Error]:", err);
    }

    return NextResponse.json({
      success: true,
      executionDate: kolkataDate,
      stats,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error during scheduled cron" },
      { status: 500 }
    );
  }
}

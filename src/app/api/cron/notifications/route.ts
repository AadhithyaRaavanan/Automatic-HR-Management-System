import { NextRequest, NextResponse } from "next/server";
import { getAdminClient, supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/features/notifications/notify";
import { getManagersOf, getHrUsers } from "@/features/notifications/recipients";
import { dispatchBirthdayNotifications } from "@/features/notifications/birthdays";
import { enforceBreakTimeouts } from "@/features/attendance/break-timeout";
import { processSessionTimeouts } from "@/features/attendance/session-timeout";
import { calculateWorkingDaysAhead, countWorkingDaysBetween } from "@/lib/date/working-days";
import { requireCronAuthorization } from "@/features/auth/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = requireCronAuthorization(request);
  if (authError) {
    return authError;
  }

  try {

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
      breakTimeoutAutoLogouts: 0,
      onboardingIncomplete: 0,
      birthdaysCelebrated: 0,
      recurringTasksCreated: 0,
      staleTasksNotified: 0,
    };

    // ------------------------------------------------------------------------
    // Rule 1: Tasks Due within 24h & Overdue
    // ------------------------------------------------------------------------
    try {
      const { data: tasks } = await (supabaseAdmin.from("tasks") as any)
        .select("id, organization_id, title, assignee_id, creator_id, due_date, status")
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
              organizationId: t.organization_id,
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
              organizationId: t.organization_id,
              type: "reminder_task_overdue",
              typeGroup: "reminders",
              title: "Task Overdue",
              body: `Your assigned task "${t.title}" was due on ${dueDateStr} and is currently overdue.`,
              link: "/tasks",
              entityType: "tasks",
              entityId: t.id,
              dedupeKey: `task-overdue-emp:${t.id}:${kolkataDate}`,
            });

            // Overdue -> Manager (scoped strictly to task's organization)
            const managers = await getManagersOf(t.assignee_id, t.organization_id);
            if (managers.length > 0) {
              await notify({
                userIds: managers,
                organizationId: t.organization_id,
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
        .select("id, organization_id, employee_id, start_date, end_date, created_at")
        .eq("status", "pending")
        .lt("created_at", twoDaysAgoIso);

      if (pendingLeaves) {
        for (const lr of pendingLeaves) {
          const managers = await getManagersOf(lr.employee_id, lr.organization_id);
          const hrUsers = await getHrUsers(lr.organization_id);
          const reviewers = Array.from(new Set([...managers, ...hrUsers]));

          if (reviewers.length > 0) {
            await notify({
              userIds: reviewers,
              organizationId: lr.organization_id,
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
        .select("id, organization_id, employee_id, work_date, created_at")
        .eq("status", "pending")
        .lt("created_at", twoDaysAgoIso);

      if (pendingRegs) {
        for (const rr of pendingRegs) {
          const managers = await getManagersOf(rr.employee_id, rr.organization_id);
          const hrUsers = await getHrUsers(rr.organization_id);
          const reviewers = Array.from(new Set([...managers, ...hrUsers]));

          if (reviewers.length > 0) {
            await notify({
              userIds: reviewers,
              organizationId: rr.organization_id,
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
            // Check if checked in today:
            // 1. Check if an active or completed session exists for today
            const { data: todaySession } = await (supabaseAdmin.from("attendance_sessions") as any)
              .select("id")
              .eq("employee_id", emp.id)
              .eq("work_date", kolkataDate)
              .limit(1)
              .maybeSingle();

            if (todaySession) {
              // Employee already has a session logged for today, do not remind
              continue;
            }

            // 2. Fallback check on attendance_days
            const { data: attDay } = await (supabaseAdmin.from("attendance_days") as any)
              .select("id, status, is_present")
              .eq("employee_id", emp.id)
              .eq("work_date", kolkataDate)
              .maybeSingle();

            if (!attDay || attDay.status === "absent" || attDay.is_present === false) {
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
    // Rule 7: Daily Birthday Celebration & Announcements per Active Organization
    // ------------------------------------------------------------------------
    try {
      const { data: activeOrgs } = await (supabaseAdmin.from("organizations") as any)
        .select("id")
        .in("status", ["active", "trial"]);

      for (const org of activeOrgs || []) {
        const bdayResult = await dispatchBirthdayNotifications(kolkataDate, org.id);
        stats.birthdaysCelebrated += bdayResult.birthdaysCount;
      }
    } catch (err) {
      console.error("[Cron: Birthday Dispatch Error]:", err);
    }

    // ------------------------------------------------------------------------
    // Rule 8: Recurring Tasks Dispatch (Asia/Kolkata Aware & Idempotent)
    // ------------------------------------------------------------------------
    try {
      // 1. First attempt database RPC if available
      const { data: rpcRes, error: rpcErr } = await (supabaseAdmin.rpc as any)(
        "dispatch_recurring_tasks",
        { p_today: kolkataDate }
      );

      if (!rpcErr && rpcRes) {
        stats.recurringTasksCreated += rpcRes.created_tasks || 0;
      } else {
        // Fallback application-level recurrence dispatcher
        const { data: recurrences } = await (supabaseAdmin as any)
          .from("task_recurrences")
          .select("*, task_types(due_rule_working_days)")
          .eq("is_active", true)
          .lte("next_run_date", kolkataDate);

        if (recurrences && recurrences.length > 0) {
          // Fetch holidays for working-day calculations
          const { data: holidays } = await (supabaseAdmin as any)
            .from("holidays")
            .select("date")
            .eq("is_active", true);
          const holidaysList = holidays || [];

          for (const rec of recurrences) {
            if (rec.end_date && rec.next_run_date > rec.end_date) {
              await (supabaseAdmin as any)
                .from("task_recurrences")
                .update({ is_active: false })
                .eq("id", rec.id);
              continue;
            }

            // Check if assignee is inactive
            if (rec.assignee_id) {
              const { data: emp } = await (supabaseAdmin as any)
                .from("employees")
                .select("status")
                .eq("id", rec.assignee_id)
                .single();

              if (!emp || emp.status !== "active") {
                await (supabaseAdmin as any)
                  .from("task_recurrences")
                  .update({ is_active: false, updated_at: new Date().toISOString() })
                  .eq("id", rec.id);

                await notify({
                  userIds: [rec.created_by],
                  type: "task_recurrence_paused",
                  typeGroup: "reminders",
                  title: "Recurring Task Paused",
                  body: `Recurring task "${rec.title}" was paused because the assignee is no longer active.`,
                  link: "/tasks",
                  entityType: "tasks",
                  dedupeKey: `recurrence-paused:${rec.id}`,
                });
                continue;
              }
            }

            // Idempotency check: don't create two tasks for same recurrence today
            const { data: existingToday } = await (supabaseAdmin as any)
              .from("tasks")
              .select("id")
              .eq("recurrence_id", rec.id)
              .gte("created_at", `${kolkataDate}T00:00:00+05:30`)
              .lte("created_at", `${kolkataDate}T23:59:59+05:30`)
              .limit(1);

            if (existingToday && existingToday.length > 0) {
              continue;
            }

            // Calculate suggested due date if due_rule_working_days is set
            let calculatedDueDate: string | null = null;
            const dueDays = rec.task_types?.due_rule_working_days;
            if (typeof dueDays === "number" && dueDays > 0) {
              const dueInfo = calculateWorkingDaysAhead(dueDays, holidaysList, kolkataDate);
              calculatedDueDate = dueInfo.dateStr;
            }

            // Create next task
            const { data: createdTask, error: createErr } = await (supabaseAdmin as any)
              .from("tasks")
              .insert({
                organization_id: rec.organization_id,
                title: rec.title,
                description: rec.description || null,
                creator_id: rec.created_by,
                assignee_id: rec.assignee_id || null,
                status: "todo",
                priority: rec.priority || "medium",
                due_date: calculatedDueDate,
                estimated_minutes: rec.estimate_minutes || null,
                task_type_id: rec.task_type_id || null,
                recurrence_id: rec.id,
                auto_due_suggested: Boolean(calculatedDueDate),
              })
              .select("id")
              .single();

            if (!createErr && createdTask) {
              stats.recurringTasksCreated++;

              // Notify assignee if not creator
              if (rec.assignee_id && rec.assignee_id !== rec.created_by) {
                await notify({
                  userIds: [rec.assignee_id],
                  type: "task_assigned",
                  typeGroup: "tasks",
                  title: "New Recurring Task Assigned",
                  body: `You have been assigned "${rec.title}"${calculatedDueDate ? ` (Due ${calculatedDueDate})` : ""}.`,
                  link: `/tasks?task=${createdTask.id}`,
                  entityType: "tasks",
                  entityId: createdTask.id,
                  dedupeKey: `recurring-task-assign:${createdTask.id}`,
                });
              }

              // Compute next run date
              let nextRunStr = kolkataDate;
              if (rec.frequency === "daily") {
                nextRunStr = calculateWorkingDaysAhead(1, holidaysList, kolkataDate).dateStr;
              } else if (rec.frequency === "weekly") {
                const [y, m, d] = kolkataDate.split("-").map(Number);
                const nextDate = new Date(Date.UTC(y, m - 1, d + (rec.interval_n || 1) * 7));
                nextRunStr = nextDate.toISOString().slice(0, 10);
              } else if (rec.frequency === "monthly") {
                const [y, m, d] = kolkataDate.split("-").map(Number);
                const targetDay = rec.day_of_month || d;
                const nextMonth = new Date(Date.UTC(y, m - 1 + (rec.interval_n || 1), 1));
                const daysInMonth = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate();
                nextMonth.setUTCDate(Math.min(targetDay, daysInMonth));
                nextRunStr = nextMonth.toISOString().slice(0, 10);
              } else if (rec.frequency === "every_n_working_days") {
                nextRunStr = calculateWorkingDaysAhead(rec.interval_n || 1, holidaysList, kolkataDate).dateStr;
              }

              const isStillActive = !rec.end_date || nextRunStr <= rec.end_date;

              await (supabaseAdmin as any)
                .from("task_recurrences")
                .update({
                  last_created_task_id: createdTask.id,
                  next_run_date: nextRunStr,
                  is_active: isStillActive,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", rec.id);
            }
          }
        }
      }
    } catch (err) {
      console.error("[Cron: Recurring Tasks Error]:", err);
    }

    // ------------------------------------------------------------------------
    // Rule 9: Stale In-Progress Task Gentle Prompt (5 Working Days No Activity)
    // ------------------------------------------------------------------------
    try {
      const { data: inProgressTasks } = await (supabaseAdmin.from("tasks") as any)
        .select("id, title, assignee_id, started_at, updated_at")
        .eq("status", "in_progress")
        .not("assignee_id", "is", null);

      if (inProgressTasks && inProgressTasks.length > 0) {
        const { data: holidays } = await (supabaseAdmin.from("holidays") as any)
          .select("date")
          .eq("is_active", true);
        const holidaysList = holidays || [];

        for (const t of inProgressTasks) {
          // Fetch latest activity timestamp (task_events, task_comments, task_time_logs)
          const [eventsRes, commentsRes, logsRes] = await Promise.all([
            (supabaseAdmin.from("task_events") as any)
              .select("created_at")
              .eq("task_id", t.id)
              .order("created_at", { ascending: false })
              .limit(1),
            (supabaseAdmin.from("task_comments") as any)
              .select("created_at")
              .eq("task_id", t.id)
              .order("created_at", { ascending: false })
              .limit(1),
            (supabaseAdmin.from("task_time_logs") as any)
              .select("created_at, work_date")
              .eq("task_id", t.id)
              .order("created_at", { ascending: false })
              .limit(1),
          ]);

          const dates: string[] = [t.started_at, t.updated_at].filter(Boolean);
          if (eventsRes?.data?.[0]?.created_at) dates.push(eventsRes.data[0].created_at);
          if (commentsRes?.data?.[0]?.created_at) dates.push(commentsRes.data[0].created_at);
          if (logsRes?.data?.[0]?.created_at) dates.push(logsRes.data[0].created_at);
          if (logsRes?.data?.[0]?.work_date) dates.push(logsRes.data[0].work_date);

          const latestActivityIso = dates.sort().reverse()[0] || t.updated_at || kolkataDate;
          const latestActivityDateStr = latestActivityIso.slice(0, 10);

          const workingDaysInactive = countWorkingDaysBetween(
            latestActivityDateStr,
            kolkataDate,
            holidaysList
          );

          // If no activity for 5 or more working days, send ONE gentle prompt to assignee
          if (workingDaysInactive >= 5 && t.assignee_id) {
            // Dedupe interval: every 5 calendar days window
            const fiveDayBucket = Math.floor(Date.now() / (5 * 86400 * 1000));
            await notify({
              userIds: [t.assignee_id],
              type: "reminder_stale_task",
              typeGroup: "reminders",
              title: "Task Still In Progress",
              body: `Still working on "${t.title}"? Update its status or leave a comment.`,
              link: `/tasks?task=${t.id}`,
              entityType: "tasks",
              entityId: t.id,
              dedupeKey: `stale-task:${t.id}:${fiveDayBucket}`,
            });
            stats.staleTasksNotified++;
          }
        }
      }
    } catch (err) {
      console.error("[Cron: Stale In-Progress Tasks Error]:", err);
    }

    // ------------------------------------------------------------------------
    // Rule 9: Auto Check-Out & Notify Employees on Inactivity (20m) or Break Timeout
    // ------------------------------------------------------------------------
    try {
      const [sessionTimeoutResult, breakTimeoutResult] = await Promise.all([
        processSessionTimeouts({
          adminClient: getAdminClient(),
          now,
        }),
        enforceBreakTimeouts({
          adminClient: getAdminClient(),
          now,
        }),
      ]);
      stats.breakTimeoutAutoLogouts =
        sessionTimeoutResult.timedOutCount + breakTimeoutResult.timedOutCount;
    } catch (err) {
      console.error("[Cron: Attendance Timeout Enforcement Error]:", err);
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

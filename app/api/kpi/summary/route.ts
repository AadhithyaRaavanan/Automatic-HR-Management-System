import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    let response = NextResponse.next();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next();
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve caller employee record & system role
    const { data: callerEmp, error: callerErr } = await (supabaseAdmin.from("employees") as any)
      .select("id, full_name, email, department_id, organization_id, user_role, role")
      .eq("id", user.id)
      .maybeSingle();

    const rawRole = (callerEmp?.user_role || callerEmp?.role || user.user_metadata?.user_role || "employee").toLowerCase();
    const isHrOrAdmin = rawRole === "admin" || rawRole === "hr";
    const isManager = rawRole === "manager";

    const { searchParams } = new URL(request.url);
    const targetEmployeeId = searchParams.get("employeeId") || user.id;
    const listEmployeesParam = searchParams.get("listEmployees") === "true";

    // 1. Scoped employee listing for selectors
    if (listEmployeesParam) {
      if (isHrOrAdmin) {
        // Admin & HR see all active employees
        const { data: allActive } = await (supabaseAdmin.from("employees") as any)
          .select("id, full_name, email, department_id, job_title_id, status")
          .eq("status", "active")
          .order("full_name");
        return NextResponse.json({ employees: allActive || [], scope: "all" });
      } else if (isManager) {
        // Manager sees only direct department / direct reports + self
        const deptId = callerEmp?.department_id;
        let query = (supabaseAdmin.from("employees") as any)
          .select("id, full_name, email, department_id, job_title_id, status")
          .eq("status", "active");

        if (deptId) {
          query = query.or(`department_id.eq.${deptId},id.eq.${user.id}`);
        } else {
          query = query.eq("id", user.id);
        }
        const { data: teamActive } = await query.order("full_name");
        return NextResponse.json({ employees: teamActive || [], scope: "department" });
      } else {
        // Employee sees only self
        return NextResponse.json({
          employees: callerEmp ? [callerEmp] : [],
          scope: "self",
        });
      }
    }

    // 2. Strict Role Scoping Check on targetEmployeeId
    if (!isHrOrAdmin) {
      if (isManager) {
        // Manager can only view employees in their own department or self
        if (targetEmployeeId !== user.id) {
          const { data: targetEmp } = await (supabaseAdmin.from("employees") as any)
            .select("department_id")
            .eq("id", targetEmployeeId)
            .maybeSingle();

          if (!targetEmp || targetEmp.department_id !== callerEmp?.department_id) {
            return NextResponse.json(
              { error: "Forbidden: Managers may only access KPI metrics for their department members." },
              { status: 403 }
            );
          }
        }
      } else {
        // Employee can ONLY see self
        if (targetEmployeeId !== user.id) {
          return NextResponse.json(
            { error: "Forbidden: Employees may only access their personal KPI metrics." },
            { status: 403 }
          );
        }
      }
    }

    // 3. Compute live authoritative KPI metrics for targetEmployeeId
    const now = new Date();
    const firstDayIso = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const todayIso = now.toISOString().slice(0, 10);

    const [attendanceRes, tasksRes, leavesRes] = await Promise.all([
      (supabaseAdmin.from("attendance_days") as any)
        .select("status, is_punctual, is_late, total_worked_minutes, work_date")
        .eq("employee_id", targetEmployeeId)
        .gte("work_date", firstDayIso)
        .lte("work_date", todayIso),
      (supabaseAdmin.from("tasks") as any)
        .select("status, due_date, completed_at, is_completed")
        .eq("assignee_id", targetEmployeeId),
      (supabaseAdmin.from("leave_requests") as any)
        .select("status, total_days, start_date, end_date")
        .eq("employee_id", targetEmployeeId)
        .eq("status", "approved")
        .gte("start_date", firstDayIso),
    ]);

    const days = attendanceRes.data || [];
    const tasks = tasksRes.data || [];
    const leaves = leavesRes.data || [];

    const totalAttended = days.length;
    const punctualDays = days.filter((d: any) => d.is_punctual || (!d.is_late && d.status === "present")).length;
    const onTimeAttRate = totalAttended > 0 ? Math.round((punctualDays / totalAttended) * 100) : 0;

    const completedTasks = tasks.filter((t: any) => t.status === "completed" || t.is_completed).length;
    const totalAssigned = tasks.length;
    const taskCompletionRate = totalAssigned > 0 ? Math.round((completedTasks / totalAssigned) * 100) : 0;

    const totalLeaveDays = leaves.reduce((sum: number, l: any) => sum + Number(l.total_days || 0), 0);

    const hasActivity = totalAttended > 0 || completedTasks > 0;
    let score = 0;
    if (hasActivity) {
      // 50% attendance punctuality + 50% task completion
      score = Math.round(
        (totalAttended > 0 ? onTimeAttRate * 0.5 : 0) +
        (totalAssigned > 0 ? taskCompletionRate * 0.5 : totalAttended > 0 ? onTimeAttRate * 0.5 : 0)
      );
    }

    return NextResponse.json({
      employeeId: targetEmployeeId,
      overallScore: score,
      hasActivity,
      attendanceOnTimeRate: onTimeAttRate,
      tasksCompleted: completedTasks,
      totalAssignedTasks: totalAssigned,
      totalLeaveDays,
      attendedDays: totalAttended,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to calculate scoped KPI summary." },
      { status: 500 }
    );
  }
}

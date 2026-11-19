import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { getStoredAttendanceSessions, getStoredUsers } from "@/lib/storage/demo-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr", "manager"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const todayIso = new Date().toISOString().slice(0, 10);

    // Fetch active employees in the organization
    let empQuery = (supabaseAdmin as any)
      .from("employees")
      .select("id, full_name, email, avatar_url, timezone, work_mode, department_id, departments:department_id(name), job_titles:job_title_id(title_name)")
      .eq("organization_id", context.organizationId)
      .eq("status", "active")
      .order("full_name");

    // If manager, restrict to direct reports
    if (context.role === "manager") {
      empQuery = empQuery.eq("manager_id", context.userId);
    }

    const { data: employees, error: empErr } = await empQuery;

    // Fetch today sessions
    const { data: sessions, error: sessErr } = await (supabaseAdmin as any)
      .from("attendance_sessions")
      .select("id, employee_id, check_in_at, check_out_at, work_date")
      .eq("work_date", todayIso)
      .order("check_in_at", { ascending: true });

    let empList = employees || [];
    let sessList = sessions || [];

    if (isDemoModeEnabled() && (!empList.length || empErr)) {
      const demoUsers = getStoredUsers();
      empList = demoUsers.map((u: any) => ({
        id: u.id,
        full_name: u.name,
        email: u.email,
        avatar_url: u.avatarUrl || null,
        timezone: u.timezone || "UTC",
        work_mode: u.workMode || "remote",
        departments: u.department ? { name: u.department } : null,
        job_titles: u.jobTitle ? { title_name: u.jobTitle } : null,
      }));

      const demoSessions = getStoredAttendanceSessions();
      sessList = demoSessions.filter((s: any) => s.work_date === todayIso);
    }

    // Map each employee to their live attendance status
    const logs = empList.map((emp: any) => {
      const empSessions = sessList.filter((s: any) => s.employee_id === emp.id);
      const activeSession = empSessions.find((s: any) => !s.check_out_at);
      const firstSession = empSessions[0];
      const lastSession = empSessions[empSessions.length - 1];

      let status: "active" | "checked_out" | "not_logged_in" = "not_logged_in";
      let loggedMinutes = 0;

      for (const s of empSessions) {
        const inTime = new Date(s.check_in_at).getTime();
        const outTime = s.check_out_at ? new Date(s.check_out_at).getTime() : Date.now();
        loggedMinutes += Math.max(0, Math.round((outTime - inTime) / 60000));
      }

      if (activeSession) {
        status = "active";
      } else if (empSessions.length > 0) {
        status = "checked_out";
      }

      return {
        id: emp.id,
        name: emp.full_name,
        email: emp.email,
        avatarUrl: emp.avatar_url,
        department: emp.departments?.name || "Company",
        jobTitle: emp.job_titles?.title_name || "Employee",
        status,
        checkInAt: firstSession ? firstSession.check_in_at : null,
        checkOutAt: lastSession && !activeSession ? lastSession.check_out_at : null,
        totalMinutes: loggedMinutes,
      };
    });

    const activeCount = logs.filter((l: any) => l.status === "active").length;
    const checkedOutCount = logs.filter((l: any) => l.status === "checked_out").length;
    const notLoggedInCount = logs.filter((l: any) => l.status === "not_logged_in").length;

    return NextResponse.json({
      success: true,
      workDate: todayIso,
      counts: {
        total: logs.length,
        active: activeCount,
        checkedOut: checkedOutCount,
        notLoggedIn: notLoggedInCount,
      },
      logs,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load live presence logs" }, { status: 500 });
  }
}

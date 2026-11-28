import { NextRequest, NextResponse } from "next/server";
import { resolveTenantCaller } from "@/features/auth/tenant-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { getVerifiedEmployeeBirthdays } from "@/features/notifications/birthdays";
import {
  getStoredAttendanceSessions,
  getStoredAttendanceDays,
  getStoredUsers,
} from "@/lib/storage/demo-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveTenantCaller(request, { requireAal2ForPrivileged: false });
    if ("response" in authResult) {
      return authResult.response;
    }

    const { user, context } = authResult;
    const callerRole = context.role;
    const orgId = context.organizationId;

    // 3. Parse query parameters
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1), 10);
    const year = parseInt(searchParams.get("year") || String(now.getFullYear()), 10);
    const requestedEmpId = searchParams.get("employeeId") || user.id;

    // Verify target employee belongs to caller's organization
    const { data: targetEmp } = await (supabaseAdmin as any)
      .from("employees")
      .select("id, organization_id, department_id, manager_id")
      .eq("id", requestedEmpId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!targetEmp) {
      return NextResponse.json({ error: "Employee not found in your organization." }, { status: 404 });
    }

    // 4. Resolve manager's department or reports within organization
    let managerDeptId: string | null = null;
    let managerReportIds: string[] = [];

    if (callerRole === "manager") {
      const { data: callerEmp } = await (supabaseAdmin as any)
        .from("employees")
        .select("id, department_id")
        .eq("id", user.id)
        .eq("organization_id", orgId)
        .maybeSingle();

      managerDeptId = callerEmp?.department_id || null;

      const { data: directReports } = await (supabaseAdmin as any)
        .from("employees")
        .select("id")
        .eq("organization_id", orgId)
        .eq("manager_id", user.id);

      managerReportIds = (directReports || []).map((r: any) => r.id);
    }

    // 5. Access control for requested employee's attendance
    const isSelf = requestedEmpId === user.id;
    const isPrivileged = callerRole === "admin" || callerRole === "hr";
    const isManagerAuthorized =
      callerRole === "manager" &&
      (isSelf ||
        managerReportIds.includes(requestedEmpId) ||
        (managerDeptId && targetEmp.department_id === managerDeptId));

    if (!isSelf && !isPrivileged && !isManagerAuthorized) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to view this employee's attendance." },
        { status: 403 }
      );
    }

    const targetEmpId = requestedEmpId;

    // 6. Build date range for the month
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

    // 7. Fetch holidays, days, sessions, target employee info, and accessible list in parallel
    const [holRes, daysRes, sessRes, targetEmpRes] = await Promise.all([
      (supabaseAdmin as any)
        .from("holidays")
        .select("date, name, local_name, region")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .gte("date", startDate)
        .lte("date", endDate),
      (supabaseAdmin as any)
        .from("attendance_days")
        .select("work_date, status, total_minutes, is_late, locked")
        .eq("organization_id", orgId)
        .eq("employee_id", targetEmpId)
        .gte("work_date", startDate)
        .lte("work_date", endDate),
      (supabaseAdmin as any)
        .from("attendance_sessions")
        .select("id, work_date, check_in_at, check_out_at, source")
        .eq("employee_id", targetEmpId)
        .gte("work_date", startDate)
        .lte("work_date", endDate)
        .order("check_in_at", { ascending: true }),
      (supabaseAdmin as any)
        .from("employees")
        .select(`
          id,
          full_name,
          email,
          avatar_url,
          timezone,
          work_mode,
          department_id,
          job_title_id,
          departments:department_id(name),
          job_titles:job_title_id(title_name)
        `)
        .eq("id", targetEmpId)
        .maybeSingle(),
    ]);

    // 8. Fetch list of accessible employees for the selector dropdown
    let accessibleEmployees: Array<{
      id: string;
      full_name: string;
      email: string;
      role: string;
      department: string;
      job_title: string;
    }> = [];

    if (callerRole === "admin" || callerRole === "hr") {
      // Admin and HR can see everyone in their active organization only
      const { data: allEmps } = await (supabaseAdmin as any)
        .from("employees")
        .select(`
          id,
          full_name,
          email,
          status,
          departments:department_id(name),
          job_titles:job_title_id(title_name)
        `)
        .eq("organization_id", orgId)
        .eq("status", "active")
        .order("full_name", { ascending: true });

      const { data: allRoles } = await (supabaseAdmin as any)
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", orgId);

      const roleLookup = new Map<string, string>();
      for (const r of allRoles || []) {
        if (r.user_id && r.role) roleLookup.set(r.user_id, String(r.role).toLowerCase());
      }

      accessibleEmployees = (allEmps || []).map((e: any) => ({
        id: e.id,
        full_name: e.full_name || e.email,
        email: e.email,
        role: roleLookup.get(e.id) || "employee",
        department: e.departments?.name || "General",
        job_title: e.job_titles?.title_name || "Employee",
      }));
    } else if (callerRole === "manager") {
      // Manager can see their team members (reports / department) + themselves within org
      let managerQuery = (supabaseAdmin as any)
        .from("employees")
        .select(`
          id,
          full_name,
          email,
          status,
          departments:department_id(name),
          job_titles:job_title_id(title_name)
        `)
        .eq("organization_id", orgId)
        .eq("status", "active");

      if (managerDeptId) {
        managerQuery = managerQuery.or(`manager_id.eq.${user.id},department_id.eq.${managerDeptId},id.eq.${user.id}`);
      } else {
        managerQuery = managerQuery.or(`manager_id.eq.${user.id},id.eq.${user.id}`);
      }

      const { data: teamEmps } = await managerQuery.order("full_name", { ascending: true });

      accessibleEmployees = (teamEmps || []).map((e: any) => ({
        id: e.id,
        full_name: e.full_name || e.email,
        email: e.email,
        role: e.id === user.id ? "manager" : "employee",
        department: e.departments?.name || "Department",
        job_title: e.job_titles?.title_name || "Specialist",
      }));
    }

    // 9. Demo mode fallback or merge
    let days = daysRes.data || [];
    let sessions = sessRes.data || [];
    let holidays = holRes.data || [];

    if (isDemoModeEnabled()) {
      if (days.length === 0) days = getStoredAttendanceDays() as any[];
      if (sessions.length === 0) sessions = getStoredAttendanceSessions() as any[];
      if (accessibleEmployees.length === 0) {
        const storedUsers = getStoredUsers();
        accessibleEmployees = storedUsers.map((u) => ({
          id: u.id,
          full_name: (u as any).fullName || u.name,
          email: u.email,
          role: u.role,
          department: u.department || "Engineering",
          job_title: u.jobTitle || "Specialist",
        }));
      }
    }

    const targetEmpData = targetEmpRes.data || {
      id: targetEmpId,
      full_name: user.user_metadata?.full_name || user.email || "Employee",
      email: user.email || "",
      department: "General",
      job_title: "Employee",
      timezone: "Asia/Kolkata",
    };

    // 10. Fetch birthdays of verified employees for this month
    const allBirthdays = await getVerifiedEmployeeBirthdays();
    const birthdays = allBirthdays.filter((b) => b.birthMonth === month);

    return NextResponse.json({
      targetEmployee: {
        id: targetEmpData.id,
        full_name: targetEmpData.full_name,
        email: targetEmpData.email,
        department: targetEmpData.departments?.name || targetEmpData.department || "General",
        job_title: targetEmpData.job_titles?.title_name || targetEmpData.job_title || "Employee",
        timezone: targetEmpData.timezone || "Asia/Kolkata",
      },
      days,
      sessions,
      holidays,
      birthdays,
      accessibleEmployees,
      callerRole,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to fetch attendance calendar" },
      { status: 500 }
    );
  }
}

// ============================================================================
// /api/kpi/team: Scoped Team Performance Matrix for Managers, HR, and Admin
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext } from "@/features/kpi/auth-helper";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeKpi } from "@/features/kpi/compute";
import { getKolkataPresetDates } from "@/features/kpi/date-helper";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 1. Only Managers, HR, and Admins can access the Team Overview
  if (caller.role === "employee") {
    return NextResponse.json(
      { error: "Forbidden: Team performance view is restricted to managers, HR, and administrators." },
      { status: 403 }
    );
  }

  const defaultDates = getKolkataPresetDates("month");
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || defaultDates.from;
  const to = searchParams.get("to") || defaultDates.to;
  const departmentFilter = searchParams.get("department");
  const employeeTypeFilter = searchParams.get("employee_type");

  try {
    if (!caller.organizationId) {
      return NextResponse.json({ error: "Organization context is missing" }, { status: 403 });
    }

    // 2. Fetch org-scoped employees (with fallback if employment_category column is not migrated yet)
    const buildTeamQuery = (withEmpCat: boolean) => {
      const cols = withEmpCat
        ? "id, full_name, email, department_id, employment_category, departments:department_id(id, name)"
        : "id, full_name, email, department_id, departments:department_id(id, name)";

      let q = (supabaseAdmin as any)
        .from("employees")
        .select(cols)
        .eq("status", "active")
        .eq("organization_id", caller.organizationId)
        .order("full_name", { ascending: true });

      if (withEmpCat && employeeTypeFilter && employeeTypeFilter !== "all") {
        q = q.eq("employment_category", employeeTypeFilter);
      }

      // Role-based scoping: Manager only sees direct reports or same department
      if (caller.role === "manager") {
        if (caller.departmentId) {
          q = q.or(`manager_id.eq.${caller.userId},department_id.eq.${caller.departmentId}`);
        } else {
          q = q.eq("manager_id", caller.userId);
        }
      }

      return q;
    };

    let deptResolvedId: string | null = null;
    if (departmentFilter && departmentFilter !== "all") {
      const isUuid = /^[0-9a-fA-F-]{36}$/.test(departmentFilter);
      if (isUuid) {
        deptResolvedId = departmentFilter;
      } else {
        const { data: dRow } = await (supabaseAdmin as any)
          .from("departments")
          .select("id")
          .eq("organization_id", caller.organizationId)
          .ilike("name", departmentFilter)
          .maybeSingle();
        if (!dRow?.id) {
          return NextResponse.json({ period: { from, to }, team: [] });
        }
        deptResolvedId = dRow.id;
      }
    }

    let q1 = buildTeamQuery(true);
    if (deptResolvedId) q1 = q1.eq("department_id", deptResolvedId);
    let { data: employees, error: empErr } = await q1;

    if (empErr && /column .* does not exist|schema cache/i.test(String(empErr.message || ""))) {
      let q2 = buildTeamQuery(false);
      if (deptResolvedId) q2 = q2.eq("department_id", deptResolvedId);
      const fallback = await q2;
      employees = fallback.data;
      empErr = fallback.error;
    }
    if (empErr) {
      return NextResponse.json({ error: empErr.message }, { status: 500 });
    }

    const empList = employees || [];
    if (empList.length === 0) {
      return NextResponse.json({ team: [] });
    }

    // 3. Fetch period-overlapping reviews & goals for all target employees
    const empIds = empList.map((e: any) => e.id);
    const [reviewsRes, goalsRes] = await Promise.all([
      (supabaseAdmin as any)
        .from("kpi_reviews")
        .select("employee_id, created_at, period_start, period_end, ratings, note")
        .in("employee_id", empIds)
        .lte("period_start", to)
        .gte("period_end", from)
        .order("created_at", { ascending: false }),
      (supabaseAdmin as any)
        .from("kpi_goals")
        .select("employee_id, status")
        .in("employee_id", empIds)
        .lte("period_start", to)
        .gte("period_end", from),
    ]);

    const latestReviewMap = new Map<string, any>();
    for (const r of reviewsRes?.data || []) {
      if (!latestReviewMap.has(r.employee_id)) {
        latestReviewMap.set(r.employee_id, r);
      }
    }

    const goalsMap = new Map<string, { total: number; done: number; onTrack: number; atRisk: number; notStarted: number }>();
    for (const g of goalsRes?.data || []) {
      const cur = goalsMap.get(g.employee_id) || { total: 0, done: 0, onTrack: 0, atRisk: 0, notStarted: 0 };
      cur.total++;
      if (g.status === "done") cur.done++;
      else if (g.status === "on_track") cur.onTrack++;
      else if (g.status === "at_risk") cur.atRisk++;
      else cur.notStarted++;
      goalsMap.set(g.employee_id, cur);
    }

    // 4. Concurrency-limited execution for computeKpi (chunk size 10)
    const chunkSize = 10;
    const computedResults: any[] = [];

    for (let i = 0; i < empList.length; i += chunkSize) {
      const chunk = empList.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(
        chunk.map(async (emp: any) => {
          try {
            const kpi = await computeKpi(
              emp.id,
              from,
              to,
              emp.employment_category || "full_time",
              caller.organizationId
            );

            const att1 = kpi.metrics.on_time_check_in_rate.value;
            const att2 = kpi.metrics.days_worked_vs_expected.value;
            const attendanceScore =
              att1 != null && att2 != null
                ? Math.round((att1 + att2) / 2)
                : att1 ?? att2 ?? null;

            const hoursScore = kpi.metrics.worked_hours_vs_target.value;

            const t1 = kpi.metrics.tasks_completed_vs_assigned.value;
            const t2 = kpi.metrics.task_on_time_rate.value;
            const tasksScore =
              t1 != null && t2 != null
                ? Math.round((t1 + t2) / 2)
                : t1 ?? t2 ?? null;

            const hasBehind = Object.values(kpi.metrics).some((m) => m.status === "behind" || m.status === "at_risk");
            const hasNoData = kpi.overallScore == null;
            const needsAttention = hasNoData || hasBehind;

            const rev = latestReviewMap.get(emp.id);
            const goals = goalsMap.get(emp.id) || { total: 0, done: 0, onTrack: 0, atRisk: 0, notStarted: 0 };

            return {
              id: emp.id,
              fullName: emp.full_name || "Unnamed",
              email: emp.email,
              department: emp.departments?.name || "General",
              departmentId: emp.department_id,
              employmentCategory: emp.employment_category || "full_time",
              overallScore: kpi.overallScore,
              overallTarget: kpi.overallTarget,
              dataStatus: kpi.dataStatus,
              attendanceScore,
              hoursScore,
              tasksScore,
              needsAttention,
              latestReviewDate: rev?.created_at ? rev.created_at.slice(0, 10) : null,
              latestReviewRatings: rev?.ratings || null,
              latestReviewNote: rev?.note || null,
              goals,
            };
          } catch {
            return {
              id: emp.id,
              fullName: emp.full_name || "Unnamed",
              email: emp.email,
              department: emp.departments?.name || "General",
              departmentId: emp.department_id,
              employmentCategory: emp.employment_category || "full_time",
              overallScore: null,
              attendanceScore: null,
              hoursScore: null,
              tasksScore: null,
              needsAttention: true,
              latestReviewDate: null,
              latestReviewRatings: null,
              latestReviewNote: null,
              goals: { total: 0, done: 0, onTrack: 0, atRisk: 0, notStarted: 0 },
            };
          }
        })
      );
      computedResults.push(...chunkResults);
    }

    return NextResponse.json({
      period: { from, to },
      team: computedResults,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load team performance" }, { status: 500 });
  }
}

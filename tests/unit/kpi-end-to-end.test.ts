import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// In-memory mock Supabase datastore & query builder
// ---------------------------------------------------------------------------
interface MockDbState {
  authUsers: Record<string, { id: string; email: string; role?: string }>;
  currentCookieUserId: string | null;
  employees: any[];
  organization_members: any[];
  kpi_config_versions: any[];
  attendance_days: any[];
  attendance_sessions: any[];
  regularization_requests: any[];
  leave_requests: any[];
  holidays: any[];
  company_days_off: any[];
  tasks: any[];
  task_events: any[];
  kpi_adjustments: any[];
  kpi_reviews: any[];
  kpi_goals: any[];
  kpi_self_reviews: any[];
  departments: any[];
  errors: Record<string, any>;
}

const state: MockDbState = {
  authUsers: {},
  currentCookieUserId: null,
  employees: [],
  organization_members: [],
  kpi_config_versions: [],
  attendance_days: [],
  attendance_sessions: [],
  regularization_requests: [],
  leave_requests: [],
  holidays: [],
  company_days_off: [],
  tasks: [],
  task_events: [],
  kpi_adjustments: [],
  kpi_reviews: [],
  kpi_goals: [],
  kpi_self_reviews: [],
  departments: [],
  errors: {},
};

function makeQuery(table: string) {
  let rows = [...((state as any)[table] || [])];
  const ops: Array<(r: any[]) => any[]> = [];
  let isSingle = false;
  let isHeadCount = false;
  let pendingInsert: any = null;
  let pendingUpdate: any = null;

  const exec = () => {
    if (state.errors[table]) {
      return { data: null, error: state.errors[table], count: null };
    }

    if (pendingInsert !== null) {
      const toInsert = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
      const inserted = toInsert.map((item, i) => ({
        id: item.id || `${table}-${Date.now()}-${i}`,
        created_at: item.created_at || new Date().toISOString(),
        ...item,
      }));
      (state as any)[table].push(...inserted);
      return {
        data: isSingle ? inserted[0] : inserted,
        error: null,
        count: inserted.length,
      };
    }

    if (pendingUpdate !== null) {
      let filtered = rows;
      for (const fn of ops) filtered = fn(filtered);
      for (const r of filtered) {
        Object.assign(r, pendingUpdate);
      }
      return {
        data: isSingle ? filtered[0] || null : filtered,
        error: null,
        count: filtered.length,
      };
    }

    let result = rows;
    for (const fn of ops) {
      result = fn(result);
    }

    // Attach department join if requested on employees
    if (table === "employees") {
      result = result.map((emp) => ({
        ...emp,
        departments: state.departments.find((d) => d.id === emp.department_id) || null,
      }));
    }

    if (isHeadCount) {
      return { data: null, error: null, count: result.length };
    }

    if (isSingle) {
      return { data: result[0] || null, error: null };
    }
    return { data: result, error: null };
  };

  const builder: any = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.head) isHeadCount = true;
      return builder;
    },
    insert(payload: any) {
      pendingInsert = payload;
      return builder;
    },
    upsert(payload: any) {
      pendingInsert = payload;
      return builder;
    },
    update(payload: any) {
      pendingUpdate = payload;
      return builder;
    },
    eq(col: string, val: any) {
      ops.push((r) => r.filter((row) => row[col] === val));
      return builder;
    },
    ilike(col: string, val: string) {
      const needle = String(val || "").toLowerCase();
      ops.push((r) => r.filter((row) => String(row[col] || "").toLowerCase() === needle));
      return builder;
    },
    in(col: string, vals: any[]) {
      const set = new Set(vals || []);
      ops.push((r) => r.filter((row) => set.has(row[col])));
      return builder;
    },
    gte(col: string, val: any) {
      ops.push((r) => r.filter((row) => row[col] != null && String(row[col]) >= String(val)));
      return builder;
    },
    lte(col: string, val: any) {
      ops.push((r) => r.filter((row) => row[col] != null && String(row[col]) <= String(val)));
      return builder;
    },
    or(expr: string) {
      const clauses = expr.split(",").map((c) => c.trim());
      ops.push((r) =>
        r.filter((row) =>
          clauses.some((cl) => {
            const m = cl.match(/^([^.]+)\.eq\.(.+)$/);
            if (!m) return false;
            return String(row[m[1]]) === String(m[2]);
          })
        )
      );
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      const asc = opts?.ascending !== false;
      ops.push((r) =>
        [...r].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        })
      );
      return builder;
    },
    limit(n: number) {
      ops.push((r) => r.slice(0, n));
      return builder;
    },
    maybeSingle() {
      isSingle = true;
      return Promise.resolve(exec());
    },
    single() {
      isSingle = true;
      return Promise.resolve(exec());
    },
    then(resolve: any, reject: any) {
      return Promise.resolve(exec()).then(resolve, reject);
    },
  };

  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    auth: {
      getUser: async (token: string) => ({
        data: {
          user: state.authUsers[token]
            ? {
                id: state.authUsers[token].id,
                email: state.authUsers[token].email,
                app_metadata: { onboarding_approved: true },
              }
            : null,
        },
        error: null,
      }),
    },
    from: (table: string) => makeQuery(table),
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: state.currentCookieUserId
            ? {
                id: state.currentCookieUserId,
                email: "cookie@test.local",
                app_metadata: { onboarding_approved: true },
              }
            : null,
        },
      }),
    },
  }),
}));

vi.mock("@/features/notifications/notify", () => ({
  notify: vi.fn(async () => ({})),
}));

vi.mock("@/features/notifications/recipients", () => ({
  getManagersOf: vi.fn(async () => []),
  getHrUsers: vi.fn(async () => []),
}));

import { computeKpi, evaluateMetricStatus, reconstructPeriodTasks } from "@/features/kpi/compute";
import { getKolkataToday } from "@/features/kpi/date-helper";
import { getEmployeeWorkDate } from "@/lib/date/timezone";
import { GET as getOverview } from "@/app/api/kpi/route";
import { GET as getDetail } from "@/app/api/kpi/detail/route";
import { GET as getTeam } from "@/app/api/kpi/team/route";
import { GET as getExport } from "@/app/api/kpi/export/route";
import { GET as getSettings, POST as postSettings } from "@/app/api/kpi/settings/route";
import { GET as getReviews } from "@/app/api/kpi/reviews/route";
import { GET as getGoals } from "@/app/api/kpi/goals/route";
import { POST as postAdjustment } from "@/app/api/kpi/adjustments/route";

function reqWithToken(url: string, token: string, init?: RequestInit) {
  return new NextRequest(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

function resetFixtures() {
  state.errors = {};
  state.authUsers = {
    "tok-admin-a": { id: "admin-a", email: "admin-a@orgA.test" },
    "tok-mgr-a": { id: "mgr-a", email: "mgr-a@orgA.test" },
    "tok-emp-a1": { id: "emp-a1", email: "emp-a1@orgA.test" },
    "tok-emp-a2": { id: "emp-a2", email: "emp-a2@orgA.test" },
    "tok-admin-b": { id: "admin-b", email: "admin-b@orgB.test" },
    "tok-emp-b1": { id: "emp-b1", email: "emp-b1@orgB.test" },
    "tok-no-org": { id: "emp-noorg", email: "noorg@test" },
  };
  state.currentCookieUserId = null;
  state.departments = [
    { id: "dept-eng-a", organization_id: "org-a", name: "Engineering" },
    { id: "dept-sales-a", organization_id: "org-a", name: "Sales" },
    { id: "dept-eng-b", organization_id: "org-b", name: "Engineering" },
  ];
  state.organization_members = [
    { user_id: "admin-a", organization_id: "org-a", role: "admin", status: "active" },
    { user_id: "mgr-a", organization_id: "org-a", role: "manager", status: "active" },
    { user_id: "emp-a1", organization_id: "org-a", role: "employee", status: "active" },
    { user_id: "emp-a2", organization_id: "org-a", role: "employee", status: "active" },
    { user_id: "admin-b", organization_id: "org-b", role: "admin", status: "active" },
    { user_id: "emp-b1", organization_id: "org-b", role: "employee", status: "active" },
  ];
  state.employees = [
    {
      id: "admin-a",
      organization_id: "org-a",
      department_id: "dept-eng-a",
      manager_id: null,
      full_name: "Admin A",
      email: "admin-a@orgA.test",
      status: "active",
      employment_category: "full_time",
      work_target_minutes: 480,
      timezone: "Asia/Kolkata",
    },
    {
      id: "mgr-a",
      organization_id: "org-a",
      department_id: "dept-eng-a",
      manager_id: "admin-a",
      full_name: "Manager A",
      email: "mgr-a@orgA.test",
      status: "active",
      employment_category: "full_time",
      work_target_minutes: 480,
      timezone: "Asia/Kolkata",
    },
    {
      id: "emp-a1",
      organization_id: "org-a",
      department_id: "dept-eng-a",
      manager_id: "mgr-a",
      full_name: "Aanya Kapoor",
      email: "emp-a1@orgA.test",
      status: "active",
      employment_category: "intern",
      work_target_minutes: 480,
      timezone: "Asia/Kolkata",
    },
    {
      id: "emp-a2",
      organization_id: "org-a",
      department_id: "dept-sales-a",
      manager_id: "admin-a",
      full_name: "Sales Rep A",
      email: "emp-a2@orgA.test",
      status: "active",
      employment_category: "full_time",
      work_target_minutes: 480,
      timezone: "Asia/Kolkata",
    },
    {
      id: "admin-b",
      organization_id: "org-b",
      department_id: "dept-eng-b",
      manager_id: null,
      full_name: "Admin B",
      email: "admin-b@orgB.test",
      status: "active",
      employment_category: "full_time",
      work_target_minutes: 480,
      timezone: "Asia/Kolkata",
    },
    {
      id: "emp-b1",
      organization_id: "org-b",
      department_id: "dept-eng-b",
      manager_id: "admin-b",
      full_name: "OrgB Employee",
      email: "emp-b1@orgB.test",
      status: "active",
      employment_category: "full_time",
      work_target_minutes: 480,
      timezone: "Asia/Kolkata",
    },
  ];
  state.kpi_config_versions = [
    {
      id: "cfg-a",
      organization_id: "org-a",
      effective_from: "2026-01-01",
      reason: "Org A custom 85% target",
      config: {
        overallTarget: 85,
        weights: {
          on_time_check_in_rate: 0.25,
          days_worked_vs_expected: 0.25,
          worked_hours_vs_target: 0.2,
          tasks_completed_vs_assigned: 0.2,
          task_on_time_rate: 0.1,
        },
        employeeTypes: {
          intern: {
            hoursPerDay: 8,
            onTimeTargetRate: 90,
            daysWorkedTargetRate: 100,
            hoursTargetRate: 100,
            taskCompletionTargetRate: 85,
            taskOnTimeTargetRate: 85,
          },
        },
      },
    },
    {
      id: "cfg-b",
      organization_id: "org-b",
      effective_from: "2026-01-01",
      reason: "Org B strict 95% target",
      config: {
        overallTarget: 95,
        weights: {
          on_time_check_in_rate: 0.3,
          days_worked_vs_expected: 0.2,
          worked_hours_vs_target: 0.2,
          tasks_completed_vs_assigned: 0.15,
          task_on_time_rate: 0.15,
        },
      },
    },
  ];
  state.attendance_days = [];
  state.attendance_sessions = [];
  state.regularization_requests = [];
  state.leave_requests = [];
  state.holidays = [];
  state.company_days_off = [];
  state.tasks = [];
  state.task_events = [];
  state.kpi_adjustments = [];
  state.kpi_reviews = [];
  state.kpi_goals = [];
  state.kpi_self_reviews = [];
}

describe("KPI End-to-End Correctness, Security & Parity", () => {
  beforeEach(() => {
    resetFixtures();
  });

  it("1. Enforces strict cross-organization & role isolation across all KPI endpoints", async () => {
    // Missing org context fails closed with 403
    const noOrgRes = await getOverview(
      reqWithToken("http://localhost/api/kpi?from=2026-11-02&to=2026-11-06", "tok-no-org")
    );
    expect(noOrgRes.status).toBe(403);

    // Org-A Admin MUST NOT read Org-B employee Overview, Detail, Reviews, Goals, Export, or Adjust
    const crossOverview = await getOverview(
      reqWithToken("http://localhost/api/kpi?employee_id=emp-b1&from=2026-11-02&to=2026-11-06", "tok-admin-a")
    );
    expect(crossOverview.status).toBe(403);

    const crossDetail = await getDetail(
      reqWithToken(
        "http://localhost/api/kpi/detail?employee_id=emp-b1&metric=days_worked_vs_expected&from=2026-11-02&to=2026-11-06",
        "tok-admin-a"
      )
    );
    expect(crossDetail.status).toBe(403);

    const crossExport = await getExport(
      reqWithToken("http://localhost/api/kpi/export?employee_id=emp-b1&from=2026-11-02&to=2026-11-06", "tok-admin-a")
    );
    expect(crossExport.status).toBe(403);

    const crossReviews = await getReviews(
      reqWithToken("http://localhost/api/kpi/reviews?employee_id=emp-b1", "tok-admin-a")
    );
    expect(crossReviews.status).toBe(403);

    const crossGoals = await getGoals(
      reqWithToken("http://localhost/api/kpi/goals?employee_id=emp-b1", "tok-admin-a")
    );
    expect(crossGoals.status).toBe(403);

    const crossAdj = await postAdjustment(
      reqWithToken("http://localhost/api/kpi/adjustments", "tok-admin-a", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: "emp-b1",
          metric: "task_overdue_count",
          override_value: 0,
          reason: "Cross org attempt",
        }),
      })
    );
    expect(crossAdj.status).toBe(403);

    // Org-A Manager cannot inspect Sales employee outside manager's department/reports
    const outOfDept = await getOverview(
      reqWithToken("http://localhost/api/kpi?employee_id=emp-a2&from=2026-11-02&to=2026-11-06", "tok-mgr-a")
    );
    expect(outOfDept.status).toBe(403);

    // Org-A & Org-B settings remain isolated to each caller's organization
    const settingsA = await (
      await getSettings(reqWithToken("http://localhost/api/kpi/settings", "tok-admin-a"))
    ).json();
    const settingsB = await (
      await getSettings(reqWithToken("http://localhost/api/kpi/settings", "tok-admin-b"))
    ).json();
    expect(settingsA.activeConfig.overallTarget).toBe(85);
    expect(settingsA.versions.map((v: any) => v.id)).toEqual(["cfg-a"]);
    expect(settingsB.activeConfig.overallTarget).toBe(95);
    expect(settingsB.versions.map((v: any) => v.id)).toEqual(["cfg-b"]);

    // Team department name filter is org-scoped and returns empty on non-matching dept
    const teamUnknownDept = await (
      await getTeam(reqWithToken("http://localhost/api/kpi/team?from=2026-11-02&to=2026-11-06&department=Finance", "tok-admin-a"))
    ).json();
    expect(teamUnknownDept.team).toEqual([]);
  });

  it("2. Credits half-day approved leave fractionally (4h worked + 4h leave = 8h effective) and deduplicates overlapping holiday + leave credits", async () => {
    // 2026-11-02 (Mon): Half-day leave + 4h worked (240 mins) -> 4h worked + 4h leave = 8h (100%)
    // 2026-11-03 (Tue): Holiday AND approved full leave overlapping -> counted ONCE (8h holiday, 0h extra leave)
    state.attendance_days.push({
      employee_id: "emp-a1",
      work_date: "2026-11-02",
      status: "half_day",
      is_late: false,
      total_minutes: 240,
    });
    state.leave_requests.push(
      {
        employee_id: "emp-a1",
        start_date: "2026-11-02",
        end_date: "2026-11-02",
        day_part: "first_half",
        status: "approved",
      },
      {
        employee_id: "emp-a1",
        start_date: "2026-11-03",
        end_date: "2026-11-03",
        day_part: "full",
        status: "approved",
      }
    );
    state.holidays.push({
      organization_id: "org-a",
      date: "2026-11-03",
      name: "Founder's Day",
      is_active: true,
    });

    // Org-A Sales dept company day off on 2026-11-02 MUST NOT affect emp-a1 (Engineering)
    state.company_days_off.push({
      organization_id: "org-a",
      department_id: "dept-sales-a",
      date: "2026-11-02",
      title: "Sales Offsite",
    });

    const res = await computeKpi("emp-a1", "2026-11-02", "2026-11-03");
    expect(res.hoursBreakdown.workedMinutes).toBe(240);
    expect(res.hoursBreakdown.leaveCreditMinutes).toBe(240);
    expect(res.hoursBreakdown.holidayCreditMinutes).toBe(480);
    expect(res.hoursBreakdown.effectiveMinutes).toBe(960);
    expect(res.hoursBreakdown.targetMinutes).toBe(960);
    expect(res.metrics.worked_hours_vs_target.value).toBe(100);
    expect(res.metrics.days_worked_vs_expected.value).toBe(100);
  });

  it("3. Does not let an open live session establish punctuality and separates actionable missing vs pending correction dates", async () => {
    const todayKolkata = getKolkataToday();
    const checkInToday = new Date().toISOString();
    state.attendance_sessions.push({
      id: "sess-live-1",
      employee_id: "emp-a1",
      work_date: todayKolkata,
      check_in_at: checkInToday,
      check_out_at: null,
      source: "web",
      early_checkout: false,
    });

    // Scheduled window in Nov 2026 before today (assuming test runs on 2026-11-27 or any day; use relative weekdays)
    state.regularization_requests.push({
      id: "reg-pending-1",
      employee_id: "emp-a1",
      work_date: "2026-11-25",
      status: "pending",
      reason: "Forgot punch",
    });

    // Live session alone today must NOT establish a 100% punctuality rate
    const liveOnlyRes = await computeKpi("emp-a1", todayKolkata, todayKolkata);
    expect(liveOnlyRes.hoursBreakdown.hasLiveSession).toBe(true);
    expect(liveOnlyRes.metrics.on_time_check_in_rate.value).toBeNull();

    const res = await computeKpi("emp-a1", "2026-11-25", "2026-11-27");
    expect(res.pendingCorrectionDates).toContain("2026-11-25");
    expect(res.actionableMissingDates).toContain("2026-11-26");
    expect(res.actionableMissingDates).not.toContain("2026-11-25");

    const detail = res.metricDetails.days_worked_vs_expected;
    const pendingRow = detail.rows.find((r) => r.date === "2026-11-25");
    const missingRow = detail.rows.find((r) => r.date === "2026-11-26");
    expect(pendingRow?.statusText).toBe("Correction Pending");
    expect(missingRow?.statusText).toBe("Missing Check-In");
    expect(missingRow?.actionUrl).toBe("/requests?date=2026-11-26&employee_id=emp-a1");
  });

  it("4. Reconstructs historical tasks with employee-local dates, Dec closure exclusion, reopenings, cancellations, no-due-date exclusion & zero-target adjustments", async () => {
    // Task 1: Created Nov 5, due Nov 20, closed Dec 2 -> MUST NOT count completed in Nov!
    // Task 2: Created Nov 5, no due date, closed Nov 12 -> Counts completed, excluded from on-time rate
    // Task 3: Created Nov 10, due Nov 18, completed Nov 16 THEN reopened on Nov 25 -> NOT completed in Nov
    // Task 4: Cancelled task -> Excluded
    // Task 5: Carryover task created Oct 20, due Oct 30, still open -> Overdue carryover counted
    state.tasks = [
      {
        id: "t-dec-close",
        title: "Closed in Dec",
        assignee_id: "emp-a1",
        status: "done",
        due_date: "2026-11-20",
        created_at: "2026-11-05T05:00:00Z",
        completed_at: "2026-12-02T05:00:00Z",
      },
      {
        id: "t-nodue",
        title: "No due date",
        assignee_id: "emp-a1",
        status: "done",
        due_date: null,
        created_at: "2026-11-05T05:00:00Z",
        completed_at: "2026-11-12T05:00:00Z",
      },
      {
        id: "t-reopened",
        title: "Reopened task",
        assignee_id: "emp-a1",
        status: "in_progress",
        due_date: "2026-11-18",
        created_at: "2026-11-10T05:00:00Z",
        completed_at: null,
      },
      {
        id: "t-cancelled",
        title: "Cancelled",
        assignee_id: "emp-a1",
        status: "cancelled",
        due_date: "2026-11-15",
        created_at: "2026-11-02T05:00:00Z",
        completed_at: null,
      },
      {
        id: "t-carryover",
        title: "Oct carryover",
        assignee_id: "emp-a1",
        status: "in_progress",
        due_date: "2026-10-30",
        created_at: "2026-10-20T05:00:00Z",
        completed_at: null,
      },
    ];
    state.task_events = [
      {
        task_id: "t-reopened",
        event_type: "completed",
        to_status: "done",
        created_at: "2026-11-16T05:00:00Z",
      },
      {
        task_id: "t-reopened",
        event_type: "status_changed",
        from_status: "done",
        to_status: "in_progress",
        created_at: "2026-11-25T05:00:00Z",
      },
    ];

    const { periodTasks, taskPopulationNote } = reconstructPeriodTasks(
      state.tasks,
      state.task_events,
      "emp-a1",
      "2026-11-01",
      "2026-11-30",
      "2026-11-27",
      "Asia/Kolkata"
    );

    expect(periodTasks.map((t) => t.id)).toEqual([
      "t-dec-close",
      "t-nodue",
      "t-reopened",
      "t-carryover",
    ]);
    expect(periodTasks.find((t) => t.id === "t-dec-close")?.statusAsOfEnd).toBe("in_progress");
    expect(periodTasks.find((t) => t.id === "t-reopened")?.statusAsOfEnd).toBe("in_progress");
    expect(taskPopulationNote).toContain("without due date");
    expect(taskPopulationNote).toContain("overdue carryover");

    // Apply authorized adjustment overriding overdue tasks to 0 -> MUST evaluate against target 0 as "on_track"
    expect(evaluateMetricStatus("task_overdue_count", 0, 0)).toBe("on_track");

    state.kpi_adjustments.push({
      employee_id: "emp-a1",
      metric: "task_overdue_count",
      period_start: "2026-11-01",
      period_end: "2026-11-30",
      override_value: 0,
      reason: "Manager excused October carryover",
      created_at: "2026-11-27T10:00:00Z",
    });

    const computed = await computeKpi("emp-a1", "2026-11-01", "2026-11-30");
    expect(computed.metrics.tasks_completed_vs_assigned.value).toBe(25); // 1 done (t-nodue) of 4 active tasks
    expect(computed.metrics.task_on_time_rate.value).toBeNull(); // t-nodue has no due date
    expect(computed.metrics.task_overdue_count.adjusted).toBe(true);
    expect(computed.metrics.task_overdue_count.originalValue).toBe(3);
    expect(computed.metrics.task_overdue_count.value).toBe(0);
    expect(computed.metrics.task_overdue_count.status).toBe("on_track");
  });

  it("5. Keeps Overview, Detail Drawer, Team Matrix, and CSV Export in exact parity across employee, manager, and admin callers", async () => {
    state.attendance_days.push(
      { employee_id: "emp-a1", work_date: "2026-11-02", status: "present", is_late: false, total_minutes: 480 },
      { employee_id: "emp-a1", work_date: "2026-11-03", status: "half_day", is_late: false, total_minutes: 240 }
    );
    state.leave_requests.push({
      employee_id: "emp-a1",
      start_date: "2026-11-03",
      end_date: "2026-11-03",
      day_part: "first_half",
      status: "approved",
    });
    state.tasks.push({
      id: "t-on-time",
      title: "Ship API audit",
      assignee_id: "emp-a1",
      status: "done",
      due_date: "2026-11-05",
      created_at: "2026-11-01T05:00:00Z",
      completed_at: "2026-11-04T05:00:00Z",
    });

    const periodQs = "employee_id=emp-a1&from=2026-11-02&to=2026-11-03";
    const [empOverviewRes, mgrOverviewRes, admOverviewRes, detailHoursRes, teamRes, exportRes] =
      await Promise.all([
        getOverview(reqWithToken(`http://localhost/api/kpi?${periodQs}`, "tok-emp-a1")),
        getOverview(reqWithToken(`http://localhost/api/kpi?${periodQs}`, "tok-mgr-a")),
        getOverview(reqWithToken(`http://localhost/api/kpi?${periodQs}`, "tok-admin-a")),
        getDetail(
          reqWithToken(
            `http://localhost/api/kpi/detail?${periodQs}&metric=worked_hours_vs_target`,
            "tok-mgr-a"
          )
        ),
        getTeam(
          reqWithToken("http://localhost/api/kpi/team?from=2026-11-02&to=2026-11-03", "tok-mgr-a")
        ),
        getExport(reqWithToken(`http://localhost/api/kpi/export?${periodQs}`, "tok-admin-a")),
      ]);

    const empOverview = await empOverviewRes.json();
    const mgrOverview = await mgrOverviewRes.json();
    const admOverview = await admOverviewRes.json();
    const detailHours = await detailHoursRes.json();
    const teamJson = await teamRes.json();
    const exportCsv = await exportRes.text();

    // Employee, Manager, and Admin get identical results & Org-A policy overallTarget (85%)
    expect(empOverview.current.overallTarget).toBe(85);
    expect(mgrOverview.current.overallScore).toBe(empOverview.current.overallScore);
    expect(admOverview.current.overallScore).toBe(empOverview.current.overallScore);
    expect(empOverview.current.employeeType).toBe("intern");

    // Team row matches exact employee score & real employmentCategory
    const teamRow = teamJson.team.find((m: any) => m.id === "emp-a1");
    expect(teamRow).toBeDefined();
    expect(teamRow.employmentCategory).toBe("intern");
    expect(teamRow.overallScore).toBe(empOverview.current.overallScore);
    expect(teamRow.overallTarget).toBe(85);

    // Detail drawer and CSV export match exact hoursBreakdown and metrics
    expect(detailHours.hoursBreakdown.effectiveMinutes).toBe(
      empOverview.current.hoursBreakdown.effectiveMinutes
    );
    expect(detailHours.metricItem.value).toBe(
      empOverview.current.metrics.worked_hours_vs_target.value
    );
    expect(exportCsv).toContain(`"Overall Score","${empOverview.current.overallScore}%"`);
    expect(exportCsv).toContain(`"Target Score","85%"`);
    expect(exportCsv).toContain("Leave Credit 4.0h");
  });

  it("6. Exposes unavailable state instead of fake zero scores when a source query fails", async () => {
    state.errors.attendance_days = { message: "connection timeout" };

    const res = await computeKpi("emp-a1", "2026-11-02", "2026-11-06");
    expect(res.dataStatus).toBe("unavailable");
    expect(res.sourceErrors).toContain("attendance_days");
    expect(res.overallScore).toBeNull();
  });

  it("7. Intersects KPI schedule with joined_on, ignores pre-hire absent rows, handles new hires & UTC/night shifts", async () => {
    // Reviewer joined on Nov 28, 2026 (Saturday) during 2026-11-01..2026-11-28 period
    const targetEmp = state.employees.find((e) => e.id === "emp-a1")!;
    targetEmp.joined_on = "2026-11-28";
    targetEmp.timezone = "UTC";
    // Persist bogus pre-hire absent row on Nov 27 (should be ignored!)
    state.attendance_days.push({
      employee_id: "emp-a1",
      work_date: "2026-11-27",
      status: "absent",
      is_late: false,
      total_minutes: 0,
    });

    const newHireRes = await computeKpi("emp-a1", "2026-11-01", "2026-11-28");
    expect(newHireRes.joinedOn).toBe("2026-11-28");
    expect(newHireRes.eligibleDaysElapsed).toBe(0);
    expect(newHireRes.hasElapsedEligibleDays).toBe(false);
    expect(newHireRes.actionableMissingDates).toEqual([]);
    expect(newHireRes.overallScore).toBeNull();
    expect(newHireRes.calendarDays.filter((d) => d.status === "missing")).toHaveLength(0);
    expect(newHireRes.calendarDays.find((d) => d.date === "2026-11-27")?.status).toBe("not_employed");

    // Cross-midnight shift preservation for explicit UTC timezone
    const crossMidnight = getEmployeeWorkDate("UTC", new Date("2026-11-28T02:00:00Z"), "22:00:00", "06:00:00");
    expect(crossMidnight).toBe("2026-11-27");
  });
});

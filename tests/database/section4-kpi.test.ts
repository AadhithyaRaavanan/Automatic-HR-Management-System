/**
 * Section 4: KPI System (Attendance, Leave & Tasks) DB & Security Suite
 *
 * Covers:
 * 1. Pure SQL formula function `calculate_kpi_score` unit tests:
 *    - NULL / no-data edge case, target = 0 (higher_is_better & lower_is_better),
 *      bounding [0, 100], exact percentages, invalid direction.
 * 2. Real metric computation (`compute_kpi_scores`) from attendance_days,
 *    leave_requests, and tasks across all 8 fixed source metrics; role/department
 *    scoping; open-period recalculation.
 * 3. Closed-period immutability (`trg_enforce_kpi_closed_immutability`) &
 *    separation of duties (`submit_kpi_review` denies self and non-reports),
 *    notifications (`kpi_review`), and UPPER_SNAKE audits.
 * 4. Complete RLS & RPC authorization matrix across Employee, Manager, HR, Admin,
 *    AAL1 vs AAL2, and cross-tenant Organization 2.
 * 5. No-data metrics return NULL across all 8 metrics and are excluded from weighted totals.
 * 6. Employee effective timezone (`Asia/Kolkata` midnight edge case) & period-scoped open overdue single-count.
 * 7. Straddling leave working-day calculation (`calculate_working_days`) & Sick/Statutory exclusion toggle.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import { computeWeightedKpiScore } from "@/lib/kpi/helpers";

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const stagingPath = path.resolve(process.cwd(), ".env.staging");
  if (fs.existsSync(stagingPath)) {
    for (const line of fs.readFileSync(stagingPath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        return trimmed.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  throw new Error("DATABASE_URL must be set for database tests.");
}

function enforceLocalhost(url: string): string {
  const host = (url.match(/@([^:/]+)/) || [])[1] || "";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`CRITICAL SECURITY FAILURE: Database tests must run only against localhost (attempted ${host}).`);
  }
  return url;
}

const DB_URL = enforceLocalhost(getDatabaseUrl());

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const ORG_2_ID = "00000000-0000-0000-0000-000000000940";

const ORG_1 = {
  admin: "00000000-0000-0000-0000-000000000001",
  hr: "00000000-0000-0000-0000-000000000002",
  manager: "00000000-0000-0000-0000-000000000003",
  reportEmp: "00000000-0000-0000-0000-000000000004",
  otherManager: "00000000-0000-0000-0000-000000000941",
  nonReportEmp: "00000000-0000-0000-0000-000000000942",
};

const ORG_2 = {
  admin: "00000000-0000-0000-0000-000000000943",
  deptId: "00000000-0000-0000-0000-000000000944",
};

describe("Section 4: KPI System", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL, ssl: false, connectionTimeoutMillis: 5000 });
    await client.connect();

    await client.query(`
      UPDATE public.employees
      SET manager_id = '${ORG_1.manager}'
      WHERE id = '${ORG_1.reportEmp}' AND organization_id = '${ORG_1_ID}';
    `);

    const org1Extras = [
      { id: ORG_1.otherManager, email: "sec4-othermgr@org1.test", role: "manager", mgr: null as string | null },
      { id: ORG_1.nonReportEmp, email: "sec4-nonreport@org1.test", role: "employee", mgr: ORG_1.otherManager },
    ];
    for (const u of org1Extras) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        VALUES ('${u.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${u.email}', 'fake', now(), '{"provider":"email"}', '{}', now(), now())
        ON CONFLICT (id) DO NOTHING;
      `);
      await client.query(`
        INSERT INTO public.organization_members (organization_id, user_id, role, status)
        VALUES ('${ORG_1_ID}', '${u.id}', '${u.role}', 'active')
        ON CONFLICT (user_id) DO UPDATE SET organization_id = '${ORG_1_ID}', role = '${u.role}', status = 'active';
      `);
      await client.query(`
        INSERT INTO public.employees (id, organization_id, email, full_name, manager_id, status, work_mode, timezone)
        VALUES ('${u.id}', '${ORG_1_ID}', '${u.email}', 'Sec4 ${u.role}', ${u.mgr ? `'${u.mgr}'` : "NULL"}, 'active', 'hybrid', 'UTC')
        ON CONFLICT (id) DO UPDATE SET organization_id = '${ORG_1_ID}', manager_id = ${u.mgr ? `'${u.mgr}'` : "NULL"}, status = 'active';
      `);
    }

    await client.query(`
      INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone, leave_year_start_month)
      VALUES ('${ORG_2_ID}', 'Section 4 Tenant 2', 'sec4-t2', 'hybrid', 'active', 'UTC', 1)
      ON CONFLICT (id) DO UPDATE SET status = 'active';
    `);
    await client.query(`
      INSERT INTO public.departments (id, organization_id, name, code)
      VALUES ('${ORG_2.deptId}', '${ORG_2_ID}', 'Tenant 2 Engineering', 'T2ENG')
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES ('${ORG_2.admin}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec4-admin@t2.test', 'fake', now(), '{"provider":"email"}', '{}', now(), now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES ('${ORG_2_ID}', '${ORG_2.admin}', 'admin', 'active')
      ON CONFLICT (user_id) DO UPDATE SET organization_id = '${ORG_2_ID}', role = 'admin', status = 'active';
    `);
    await client.query(`
      INSERT INTO public.employees (id, organization_id, email, full_name, status, work_mode, timezone)
      VALUES ('${ORG_2.admin}', '${ORG_2_ID}', 'sec4-admin@t2.test', 'Sec4 T2 Admin', 'active', 'hybrid', 'UTC')
      ON CONFLICT (id) DO UPDATE SET organization_id = '${ORG_2_ID}', status = 'active';
    `);
  });

  afterAll(async () => {
    if (client) {
      await client.query("RESET ROLE;").catch(() => {});
      await client.query(`DELETE FROM public.notifications WHERE metadata->>'period_id' IS NOT NULL AND organization_id IN ('${ORG_1_ID}', '${ORG_2_ID}');`).catch(() => {});
      await client.query(`DELETE FROM public.audit_logs WHERE table_name IN ('kpi_definitions', 'kpi_periods', 'kpi_scores', 'kpi_reviews') AND organization_id IN ('${ORG_1_ID}', '${ORG_2_ID}');`).catch(() => {});
      await client.query(`DELETE FROM public.kpi_reviews WHERE organization_id IN ('${ORG_1_ID}', '${ORG_2_ID}');`).catch(() => {});
      await client.query(`DELETE FROM public.kpi_scores WHERE organization_id IN ('${ORG_1_ID}', '${ORG_2_ID}');`).catch(() => {});
      await client.query(`DELETE FROM public.kpi_periods WHERE organization_id IN ('${ORG_1_ID}', '${ORG_2_ID}');`).catch(() => {});
      await client.query(`DELETE FROM public.kpi_definitions WHERE organization_id IN ('${ORG_1_ID}', '${ORG_2_ID}');`).catch(() => {});

      for (const uid of [ORG_1.nonReportEmp, ORG_1.otherManager, ORG_2.admin]) {
        await client.query(`DELETE FROM public.notifications WHERE user_id = '${uid}';`).catch(() => {});
        await client.query(`DELETE FROM public.organization_members WHERE user_id = '${uid}';`).catch(() => {});
        await client.query(`DELETE FROM public.employees WHERE id = '${uid}';`).catch(() => {});
        await client.query(`DELETE FROM auth.users WHERE id = '${uid}';`).catch(() => {});
      }
      await client.query(`DELETE FROM public.departments WHERE id = '${ORG_2.deptId}';`).catch(() => {});
      await client.query(`DELETE FROM public.organizations WHERE id = '${ORG_2_ID}';`).catch(() => {});
      await client.end();
    }
  });

  async function asRole<T>(
    uid: string,
    orgId: string,
    role: string,
    aal: "aal1" | "aal2",
    fn: () => Promise<T>,
    opts?: { commit?: boolean }
  ): Promise<T> {
    const claims = JSON.stringify({
      sub: uid,
      aud: "authenticated",
      role: "authenticated",
      aal,
      user_role: role,
      organization_id: orgId,
    });
    await client.query("BEGIN;");
    try {
      await client.query("SET LOCAL ROLE authenticated;");
      await client.query(`SELECT set_config('request.jwt.claims', $1, true);`, [claims]);
      const result = await fn();
      await client.query(opts?.commit ? "COMMIT;" : "ROLLBACK;");
      return result;
    } catch (err) {
      await client.query("ROLLBACK;").catch(() => {});
      throw err;
    } finally {
      await client.query("RESET ROLE;").catch(() => {});
    }
  }

  it("1. Pure SQL calculate_kpi_score handles NULL/no data, zero targets, bounds, and directions", async () => {
    const calc = async (actual: number | null, target: number, dir: string): Promise<number | null> => {
      const r = await client.query<{ score: string | null }>(
        `SELECT public.calculate_kpi_score($1, $2, $3)::text AS score;`,
        [actual, target, dir]
      );
      return r.rows[0].score === null ? null : Number(r.rows[0].score);
    };

    // NULL actual (no data) stays NULL ("not scored"), never 0 or 100
    expect(await calc(null, 95, "higher_is_better")).toBeNull();
    expect(await calc(null, 2, "lower_is_better")).toBeNull();
    expect(await calc(null, 0, "lower_is_better")).toBeNull();

    // Zero target edge cases
    expect(await calc(0, 0, "higher_is_better")).toBe(0);
    expect(await calc(5, 0, "higher_is_better")).toBe(100);
    expect(await calc(0, 0, "lower_is_better")).toBe(100);
    expect(await calc(1, 0, "lower_is_better")).toBe(50);
    expect(await calc(3, 0, "lower_is_better")).toBe(25);

    // higher_is_better intermediate and capped at [0, 100]
    expect(await calc(50, 100, "higher_is_better")).toBe(50);
    expect(await calc(140, 100, "higher_is_better")).toBe(100);
    expect(await calc(-10, 100, "higher_is_better")).toBe(0);

    // lower_is_better at/below target, above target, and floored at 0
    expect(await calc(1, 2, "lower_is_better")).toBe(100);
    expect(await calc(2, 2, "lower_is_better")).toBe(100);
    expect(await calc(3, 2, "lower_is_better")).toBe(50);
    expect(await calc(5, 2, "lower_is_better")).toBe(0);

    // Invalid direction raises SQLSTATE 22023
    await expect(calc(10, 10, "invalid_dir")).rejects.toThrow(/Invalid KPI direction/i);
  });

  it("2. Computes live KPI snapshots from attendance, leave, and tasks + supports open recalculation", async () => {
    const startDate = "2025-05-01";
    const endDate = "2025-05-31";
    const seededDefIds: string[] = [];
    const seededTaskIds: string[] = [];
    const seededAttDates: string[] = ["2025-05-04", "2025-05-05", "2025-05-06"];
    let seededLeaveId: string | null = null;
    let periodId: string | null = null;

    try {
      // Seed real attendance_days for reportEmp in 2025-05 window (1 on-time 480m, 1 late 240m, 1 absent 0m)
      await client.query(
        `INSERT INTO public.attendance_days (organization_id, employee_id, work_date, total_minutes, status, is_late)
         VALUES
           ($1, $2, '2025-05-04', 480, 'present', false),
           ($1, $2, '2025-05-05', 240, 'half_day', true),
           ($1, $2, '2025-05-06', 0, 'absent', false)
         ON CONFLICT (employee_id, work_date) DO UPDATE
           SET total_minutes = EXCLUDED.total_minutes, status = EXCLUDED.status, is_late = EXCLUDED.is_late;`,
        [ORG_1_ID, ORG_1.reportEmp]
      );

      // Seed 1 approved CASUAL leave_request for reportEmp (Mon May 12 - Tue May 13 2025 = 2 working days)
      const ltRes = await client.query<{ id: string }>(
        `SELECT id FROM public.leave_types WHERE organization_id = $1 AND code = 'CASUAL' LIMIT 1;`,
        [ORG_1_ID]
      );
      if (ltRes.rows[0]?.id) {
        const lrRes = await client.query<{ id: string }>(
          `INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, day_part, total_days, reason, status)
           VALUES ($1, $2, $3, '2025-05-12', '2025-05-13', 'full', 2.0, 'Sec4 Leave Metric', 'approved')
           RETURNING id;`,
          [ORG_1_ID, ORG_1.reportEmp, ltRes.rows[0].id]
        );
        seededLeaveId = lrRes.rows[0].id;
      }

      // Seed 3 tasks assigned to reportEmp:
      // 1) Done on time (2-day cycle time)
      // 2) Done late (4-day cycle time)
      // 3) Overdue open task whose due_date falls inside this period (< local_today)
      const t1 = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date, started_at, completed_at)
         VALUES ($1, 'Sec4 OnTime Task', $2, $3, 'done', 'medium', '2025-05-10', '2025-05-07T12:00:00Z', '2025-05-09T12:00:00Z')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.manager, ORG_1.reportEmp]
      );
      const t2 = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date, started_at, completed_at)
         VALUES ($1, 'Sec4 Late Task', $2, $3, 'done', 'high', '2025-05-15', '2025-05-14T12:00:00Z', '2025-05-18T12:00:00Z')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.manager, ORG_1.reportEmp]
      );
      const t3 = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date)
         VALUES ($1, 'Sec4 Overdue Task', $2, $3, 'in_progress', 'urgent', '2025-05-02')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.manager, ORG_1.reportEmp]
      );
      seededTaskIds.push(t1.rows[0].id, t2.rows[0].id, t3.rows[0].id);

      // Admin AAL2 defines all 8 fixed source KPIs + 1 role-filtered KPI for 'hr' only
      await asRole(
        ORG_1.admin,
        ORG_1_ID,
        "admin",
        "aal2",
        async () => {
          const defs: Array<[string, string, number, string, number, string | null]> = [
            ["Sec4 Att OnTime", "attendance_on_time_rate", 100, "higher_is_better", 1, null],
            ["Sec4 Hours Target", "hours_vs_target", 100, "higher_is_better", 1, null],
            ["Sec4 Absences", "absence_days", 2, "lower_is_better", 1, null],
            ["Sec4 Leave Taken", "leave_days_taken", 4, "lower_is_better", 1, null],
            ["Sec4 Tasks Done", "tasks_completed", 4, "higher_is_better", 2, null],
            ["Sec4 Tasks OnTime", "tasks_on_time_rate", 100, "higher_is_better", 1, null],
            ["Sec4 Tasks Overdue", "tasks_overdue", 0, "lower_is_better", 1, null],
            ["Sec4 Cycle Time", "avg_task_cycle_days", 3, "lower_is_better", 1, null],
            ["Sec4 HR Only", "tasks_completed", 1, "higher_is_better", 1, "hr"],
          ];
          for (const [name, metric, target, dir, weight, roleFilter] of defs) {
            const res = await client.query(
              `SELECT public.upsert_kpi_definition($1, $2, $3, $4, $5, NULL, $6, NULL, TRUE, NULL) AS res;`,
              [name, metric, target, dir, weight, roleFilter]
            );
            seededDefIds.push(res.rows[0].res.definition.id);
          }

          const pRes = await client.query(
            `SELECT public.create_kpi_period('Sec4 May 2025', 'monthly', $1, $2) AS res;`,
            [startDate, endDate]
          );
          periodId = pRes.rows[0].res.period.id;

          const cRes = await client.query(`SELECT public.compute_kpi_scores($1) AS res;`, [periodId]);
          expect(cRes.rows[0].res.scores_written).toBeGreaterThanOrEqual(8);
        },
        { commit: true }
      );

      // Verify exact snapshot values written for reportEmp & exclusion of 'hr'-only KPI
      const repScores = await client.query<{
        source_metric: string;
        actual_value: string;
        score: string;
      }>(
        `SELECT d.source_metric, s.actual_value::text, s.score::text
         FROM public.kpi_scores s
         JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
         WHERE s.period_id = $1 AND s.employee_id = $2;`,
        [periodId, ORG_1.reportEmp]
      );
      const byMetric = new Map(repScores.rows.map((r) => [r.source_metric, r]));

      // HR-only KPI must NOT be scored for employee role (only 8 KPI rows for reportEmp)
      expect(repScores.rows.length).toBe(8);
      // 1 of 2 attended days on time = 50%
      expect(Number(byMetric.get("attendance_on_time_rate")?.actual_value)).toBe(50);
      expect(Number(byMetric.get("attendance_on_time_rate")?.score)).toBe(50);
      // 720m worked out of 3*480=1440m = 50%
      expect(Number(byMetric.get("hours_vs_target")?.actual_value)).toBe(50);
      // 1 absent day against target 2 (lower_is_better) -> 100
      expect(Number(byMetric.get("absence_days")?.actual_value)).toBe(1);
      expect(Number(byMetric.get("absence_days")?.score)).toBe(100);
      // 2 approved leave days (if leave type seeded)
      if (seededLeaveId) {
        expect(Number(byMetric.get("leave_days_taken")?.actual_value)).toBe(2);
      }
      // 2 tasks completed vs target 4 -> 50%
      expect(Number(byMetric.get("tasks_completed")?.actual_value)).toBe(2);
      expect(Number(byMetric.get("tasks_completed")?.score)).toBe(50);
      // 1 of 2 tasks done on time = 50%
      expect(Number(byMetric.get("tasks_on_time_rate")?.actual_value)).toBe(50);
      // Overdue tasks: 1 open past due + 1 late done = 2 -> target 0 -> 100/(1+2) = 33.33
      expect(Number(byMetric.get("tasks_overdue")?.actual_value)).toBe(2);
      expect(Number(byMetric.get("tasks_overdue")?.score)).toBe(33.33);
      // Cycle days avg of (2 days + 4 days) = 3.00 -> target 3 -> 100
      expect(Number(byMetric.get("avg_task_cycle_days")?.actual_value)).toBe(3);
      expect(Number(byMetric.get("avg_task_cycle_days")?.score)).toBe(100);

      // Recalculate while period is open after finishing t3 on time in 2025-05-20
      await client.query(
        `UPDATE public.tasks SET status = 'done', due_date = '2025-05-25', completed_at = '2025-05-20T12:00:00Z' WHERE id = $1;`,
        [t3.rows[0].id]
      );
      await asRole(
        ORG_1.hr,
        ORG_1_ID,
        "hr",
        "aal2",
        async () => {
          await client.query(`SELECT public.compute_kpi_scores($1);`, [periodId]);
        },
        { commit: true }
      );

      const recomputed = await client.query<{ actual_value: string; score: string }>(
        `SELECT s.actual_value::text, s.score::text
         FROM public.kpi_scores s
         JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
         WHERE s.period_id = $1 AND s.employee_id = $2 AND d.source_metric = 'tasks_completed';`,
        [periodId, ORG_1.reportEmp]
      );
      expect(Number(recomputed.rows[0].actual_value)).toBe(3);
      expect(Number(recomputed.rows[0].score)).toBe(75);
    } finally {
      if (periodId) {
        await client.query(`DELETE FROM public.audit_logs WHERE record_id = $1 OR new_data->>'period_id' = $1::text;`, [periodId]).catch(() => {});
        await client.query(`DELETE FROM public.kpi_scores WHERE period_id = $1;`, [periodId]).catch(() => {});
        await client.query(`DELETE FROM public.kpi_periods WHERE id = $1;`, [periodId]).catch(() => {});
      }
      if (seededDefIds.length > 0) {
        await client.query(`DELETE FROM public.kpi_definitions WHERE id = ANY($1::uuid[]);`, [seededDefIds]).catch(() => {});
      }
      if (seededTaskIds.length > 0) {
        await client.query(`DELETE FROM public.tasks WHERE id = ANY($1::uuid[]);`, [seededTaskIds]).catch(() => {});
      }
      if (seededLeaveId) {
        await client.query(`DELETE FROM public.leave_requests WHERE id = $1;`, [seededLeaveId]).catch(() => {});
      }
      await client.query(
        `DELETE FROM public.attendance_days WHERE employee_id = $1 AND work_date = ANY($2::date[]);`,
        [ORG_1.reportEmp, seededAttDates]
      ).catch(() => {});
    }
  });

  it("3. Enforces closed-period immutability, separation of duties on reviews, notifications & audits", async () => {
    let defId = "";
    let periodId = "";

    await asRole(
      ORG_1.admin,
      ORG_1_ID,
      "admin",
      "aal2",
      async () => {
        const dRes = await client.query(
          `SELECT public.upsert_kpi_definition('Sec4 Immutability KPI', 'tasks_completed', 3, 'higher_is_better', 1.5) AS res;`
        );
        defId = dRes.rows[0].res.definition.id;
        const pRes = await client.query(
          `SELECT public.create_kpi_period('Sec4 Q3 2099', 'quarterly', '2099-07-01', '2099-09-30') AS res;`
        );
        periodId = pRes.rows[0].res.period.id;
        await client.query(`SELECT public.compute_kpi_scores($1);`, [periodId]);
      },
      { commit: true }
    );

    try {
      // Self-review denied for manager & admin; non-report denied for manager
      await expect(
        asRole(ORG_1.manager, ORG_1_ID, "manager", "aal1", async () => {
          await client.query(`SELECT public.submit_kpi_review($1, $2, 5.0, 'Self high');`, [periodId, ORG_1.manager]);
        })
      ).rejects.toThrow(/Separation of duties prevents reviewing your own/i);

      await expect(
        asRole(ORG_1.admin, ORG_1_ID, "admin", "aal2", async () => {
          await client.query(`SELECT public.submit_kpi_review($1, $2, 5.0, 'Self admin');`, [periodId, ORG_1.admin]);
        })
      ).rejects.toThrow(/Separation of duties prevents reviewing your own/i);

      await expect(
        asRole(ORG_1.manager, ORG_1_ID, "manager", "aal1", async () => {
          await client.query(`SELECT public.submit_kpi_review($1, $2, 4.0, 'Cross team');`, [periodId, ORG_1.nonReportEmp]);
        })
      ).rejects.toThrow(/direct reports/i);

      // DB check constraint blocks self-review even at table level
      await expect(
        client.query(
          `INSERT INTO public.kpi_reviews (organization_id, period_id, employee_id, reviewer_id, rating, comment)
           VALUES ($1, $2, $3, $3, 4.0, 'Direct self');`,
          [ORG_1_ID, periodId, ORG_1.manager]
        )
      ).rejects.toThrow(/chk_kpi_reviews_no_self_review/i);

      // Manager validly reviews direct report -> notification + audit written
      await asRole(
        ORG_1.manager,
        ORG_1_ID,
        "manager",
        "aal1",
        async () => {
          await client.query(`SELECT public.submit_kpi_review($1, $2, 4.5, 'Strong period delivery');`, [
            periodId,
            ORG_1.reportEmp,
          ]);
        },
        { commit: true }
      );

      const notif = await client.query(
        `SELECT type, link, metadata FROM public.notifications
         WHERE user_id = $1 AND type = 'kpi_review' AND metadata->>'period_id' = $2::text;`,
        [ORG_1.reportEmp, periodId]
      );
      expect(notif.rows.length).toBe(1);
      expect(notif.rows[0].link).toBe(`/kpi?period=${periodId}`);

      // Close period -> freezes everything
      await asRole(
        ORG_1.hr,
        ORG_1_ID,
        "hr",
        "aal2",
        async () => {
          await client.query(`SELECT public.close_kpi_period($1);`, [periodId]);
        },
        { commit: true }
      );

      // All mutation RPCs on closed period / closed-period definitions must fail cleanly
      await expect(
        asRole(ORG_1.admin, ORG_1_ID, "admin", "aal2", async () => {
          await client.query(`SELECT public.compute_kpi_scores($1);`, [periodId]);
        })
      ).rejects.toThrow(/Closed KPI periods are immutable/i);

      await expect(
        asRole(ORG_1.manager, ORG_1_ID, "manager", "aal1", async () => {
          await client.query(`SELECT public.submit_kpi_review($1, $2, 3.0, 'Late edit');`, [periodId, ORG_1.reportEmp]);
        })
      ).rejects.toThrow(/Closed KPI periods are immutable/i);

      await expect(
        asRole(ORG_1.admin, ORG_1_ID, "admin", "aal2", async () => {
          await client.query(`SELECT public.close_kpi_period($1);`, [periodId]);
        })
      ).rejects.toThrow(/already closed/i);

      await expect(
        asRole(ORG_1.admin, ORG_1_ID, "admin", "aal2", async () => {
          await client.query(`SELECT public.delete_kpi_definition($1);`, [defId]);
        })
      ).rejects.toThrow(/referenced by a closed period/i);

      // Trigger immutability even against superuser direct DML on closed records
      await expect(
        client.query(`UPDATE public.kpi_periods SET status = 'open' WHERE id = $1;`, [periodId])
      ).rejects.toThrow(/Closed KPI periods are immutable/i);

      await expect(
        client.query(`UPDATE public.kpi_scores SET score = 99 WHERE period_id = $1;`, [periodId])
      ).rejects.toThrow(/closed period are immutable/i);

      await expect(
        client.query(`DELETE FROM public.kpi_reviews WHERE period_id = $1;`, [periodId])
      ).rejects.toThrow(/closed period are immutable/i);

      const audits = await client.query<{ action: string }>(
        `SELECT action FROM public.audit_logs
         WHERE record_id IN ($1, $2) OR new_data->>'period_id' = $2::text;`,
        [defId, periodId]
      );
      const actions = audits.rows.map((r) => r.action);
      expect(actions).toContain("KPI_DEFINITION_CREATED");
      expect(actions).toContain("KPI_PERIOD_CREATED");
      expect(actions).toContain("KPI_SCORES_COMPUTED");
      expect(actions).toContain("KPI_PERIOD_CLOSED");
    } finally {
      // Test cleanup disables the closed-period trigger briefly inside a controlled local-test cleanup query
      await client.query(`ALTER TABLE public.kpi_reviews DISABLE TRIGGER trg_kpi_reviews_immutable;`).catch(() => {});
      await client.query(`ALTER TABLE public.kpi_scores DISABLE TRIGGER trg_kpi_scores_immutable;`).catch(() => {});
      await client.query(`ALTER TABLE public.kpi_periods DISABLE TRIGGER trg_kpi_periods_immutable;`).catch(() => {});
      await client.query(`DELETE FROM public.notifications WHERE metadata->>'period_id' = $1::text;`, [periodId]).catch(() => {});
      await client.query(`DELETE FROM public.audit_logs WHERE record_id IN ($1, $2) OR new_data->>'period_id' = $2::text;`, [defId, periodId]).catch(() => {});
      await client.query(`DELETE FROM public.kpi_reviews WHERE period_id = $1;`, [periodId]).catch(() => {});
      await client.query(`DELETE FROM public.kpi_scores WHERE period_id = $1;`, [periodId]).catch(() => {});
      await client.query(`DELETE FROM public.kpi_periods WHERE id = $1;`, [periodId]).catch(() => {});
      await client.query(`DELETE FROM public.kpi_definitions WHERE id = $1;`, [defId]).catch(() => {});
      await client.query(`ALTER TABLE public.kpi_periods ENABLE TRIGGER trg_kpi_periods_immutable;`).catch(() => {});
      await client.query(`ALTER TABLE public.kpi_scores ENABLE TRIGGER trg_kpi_scores_immutable;`).catch(() => {});
      await client.query(`ALTER TABLE public.kpi_reviews ENABLE TRIGGER trg_kpi_reviews_immutable;`).catch(() => {});
    }
  });

  it("4. Enforces RLS visibility matrix, RPC denial matrix, AAL2 checks, and cross-tenant isolation", async () => {
    let defId = "";
    let periodId = "";

    await asRole(
      ORG_1.admin,
      ORG_1_ID,
      "admin",
      "aal2",
      async () => {
        const dRes = await client.query(
          `SELECT public.upsert_kpi_definition('Sec4 RLS KPI', 'attendance_on_time_rate', 90, 'higher_is_better', 1.0) AS res;`
        );
        defId = dRes.rows[0].res.definition.id;
        const pRes = await client.query(
          `SELECT public.create_kpi_period('Sec4 RLS Period', 'monthly', '2099-10-01', '2099-10-31') AS res;`
        );
        periodId = pRes.rows[0].res.period.id;
        await client.query(`SELECT public.compute_kpi_scores($1);`, [periodId]);
      },
      { commit: true }
    );

    await asRole(
      ORG_1.admin,
      ORG_1_ID,
      "admin",
      "aal2",
      async () => {
        await client.query(`SELECT public.submit_kpi_review($1, $2, 4.0, 'Report review');`, [periodId, ORG_1.reportEmp]);
        await client.query(`SELECT public.submit_kpi_review($1, $2, 3.5, 'NonReport review');`, [periodId, ORG_1.nonReportEmp]);
      },
      { commit: true }
    );

    try {
      // Employee sees ONLY own scores and own reviews (NOT nonReportEmp's)
      await asRole(ORG_1.reportEmp, ORG_1_ID, "employee", "aal1", async () => {
        const s = await client.query(`SELECT employee_id FROM public.kpi_scores WHERE period_id = $1;`, [periodId]);
        expect(s.rows.map((r) => r.employee_id)).toEqual([ORG_1.reportEmp]);

        const rv = await client.query(`SELECT employee_id FROM public.kpi_reviews WHERE period_id = $1;`, [periodId]);
        expect(rv.rows.map((r) => r.employee_id)).toEqual([ORG_1.reportEmp]);
      });

      // Manager sees own + direct report scores/reviews, NEVER nonReportEmp's
      await asRole(ORG_1.manager, ORG_1_ID, "manager", "aal1", async () => {
        const s = await client.query(`SELECT employee_id FROM public.kpi_scores WHERE period_id = $1;`, [periodId]);
        const ids = s.rows.map((r) => r.employee_id);
        expect(ids).toContain(ORG_1.reportEmp);
        expect(ids).toContain(ORG_1.manager);
        expect(ids).not.toContain(ORG_1.nonReportEmp);

        const rv = await client.query(`SELECT employee_id FROM public.kpi_reviews WHERE period_id = $1;`, [periodId]);
        expect(rv.rows.map((r) => r.employee_id)).toEqual([ORG_1.reportEmp]);
      });

      // HR & Admin at AAL1 blocked by RESTRICTIVE AAL2 policies across all 4 tables
      for (const [role, uid] of [
        ["hr", ORG_1.hr],
        ["admin", ORG_1.admin],
      ] as const) {
        await asRole(uid, ORG_1_ID, role, "aal1", async () => {
          for (const tbl of ["kpi_definitions", "kpi_periods", "kpi_scores", "kpi_reviews"]) {
            const res = await client.query(`SELECT count(*)::int AS c FROM public.${tbl};`);
            expect(res.rows[0].c).toBe(0);
          }
        });
      }

      // HR & Admin at AAL2 see BOTH reportEmp and nonReportEmp
      await asRole(ORG_1.hr, ORG_1_ID, "hr", "aal2", async () => {
        const s = await client.query(`SELECT employee_id FROM public.kpi_scores WHERE period_id = $1;`, [periodId]);
        const ids = s.rows.map((r) => r.employee_id);
        expect(ids).toContain(ORG_1.reportEmp);
        expect(ids).toContain(ORG_1.nonReportEmp);
      });

      // Cross-tenant Org 2 admin AAL2 sees ZERO Org 1 rows across all 4 KPI tables
      await asRole(ORG_2.admin, ORG_2_ID, "admin", "aal2", async () => {
        for (const tbl of ["kpi_definitions", "kpi_periods", "kpi_scores", "kpi_reviews"]) {
          const res = await client.query(
            `SELECT count(*)::int AS c FROM public.${tbl} WHERE organization_id = $1;`,
            [ORG_1_ID]
          );
          expect(res.rows[0].c).toBe(0);
        }
      });

      // Direct client DML denied on all 4 KPI tables
      for (const sql of [
        `INSERT INTO public.kpi_definitions (organization_id, name, source_metric, target_value, direction, created_by) VALUES ('${ORG_1_ID}', 'Hack', 'tasks_completed', 1, 'higher_is_better', '${ORG_1.admin}');`,
        `INSERT INTO public.kpi_periods (organization_id, name, period_type, start_date, end_date, created_by) VALUES ('${ORG_1_ID}', 'HackP', 'monthly', '2099-01-01', '2099-01-31', '${ORG_1.admin}');`,
        `INSERT INTO public.kpi_scores (organization_id, period_id, employee_id, kpi_definition_id, actual_value, target_value, score) VALUES ('${ORG_1_ID}', '${periodId}', '${ORG_1.admin}', '${defId}', 10, 10, 100);`,
        `INSERT INTO public.kpi_reviews (organization_id, period_id, employee_id, reviewer_id, rating, comment) VALUES ('${ORG_1_ID}', '${periodId}', '${ORG_1.reportEmp}', '${ORG_1.admin}', 5, 'Direct');`,
      ]) {
        await expect(
          asRole(ORG_1.admin, ORG_1_ID, "admin", "aal2", async () => {
            await client.query(sql);
          })
        ).rejects.toThrow(/permission denied/i);
      }

      // RPC denial matrix: Employee & Manager denied governance RPCs
      for (const [role, uid] of [
        ["employee", ORG_1.reportEmp],
        ["manager", ORG_1.manager],
      ] as const) {
        for (const sql of [
          `SELECT public.upsert_kpi_definition('Denied KPI', 'tasks_completed', 1, 'higher_is_better');`,
          `SELECT public.delete_kpi_definition('${defId}');`,
          `SELECT public.create_kpi_period('Denied Period', 'monthly', '2099-11-01', '2099-11-30');`,
          `SELECT public.compute_kpi_scores('${periodId}');`,
          `SELECT public.close_kpi_period('${periodId}');`,
        ]) {
          await expect(
            asRole(uid, ORG_1_ID, role, "aal1", async () => {
              await client.query(sql);
            })
          ).rejects.toThrow(/Only HR or administrators/i);
        }
      }

      // HR & Admin at AAL1 denied all privileged KPI RPCs
      for (const [role, uid] of [
        ["hr", ORG_1.hr],
        ["admin", ORG_1.admin],
      ] as const) {
        for (const sql of [
          `SELECT public.upsert_kpi_definition('AAL1 KPI', 'tasks_completed', 1, 'higher_is_better');`,
          `SELECT public.compute_kpi_scores('${periodId}');`,
          `SELECT public.close_kpi_period('${periodId}');`,
          `SELECT public.submit_kpi_review('${periodId}', '${ORG_1.reportEmp}', 4, 'AAL1');`,
        ]) {
          await expect(
            asRole(uid, ORG_1_ID, role, "aal1", async () => {
              await client.query(sql);
            })
          ).rejects.toThrow(/MFA AAL2 verification required/i);
        }
      }

      // Cross-tenant RPC denials: Org 2 admin AAL2 denied acting on Org 1 records or attaching Org 2 dept
      await expect(
        asRole(ORG_2.admin, ORG_2_ID, "admin", "aal2", async () => {
          await client.query(`SELECT public.compute_kpi_scores($1);`, [periodId]);
        })
      ).rejects.toThrow(/not found in caller organization/i);

      await expect(
        asRole(ORG_2.admin, ORG_2_ID, "admin", "aal2", async () => {
          await client.query(`SELECT public.close_kpi_period($1);`, [periodId]);
        })
      ).rejects.toThrow(/not found in caller organization/i);

      await expect(
        asRole(ORG_2.admin, ORG_2_ID, "admin", "aal2", async () => {
          await client.query(`SELECT public.submit_kpi_review($1, $2, 4, 'X-tenant');`, [periodId, ORG_1.reportEmp]);
        })
      ).rejects.toThrow(/not found in caller organization/i);

      await expect(
        asRole(ORG_1.admin, ORG_1_ID, "admin", "aal2", async () => {
          await client.query(
            `SELECT public.upsert_kpi_definition('Cross Dept', 'tasks_completed', 1, 'higher_is_better', 1, NULL, NULL, $1);`,
            [ORG_2.deptId]
          );
        })
      ).rejects.toThrow(/Department not found in caller organization/i);
    } finally {
      await client.query(`DELETE FROM public.notifications WHERE metadata->>'period_id' = $1::text;`, [periodId]).catch(() => {});
      await client.query(`DELETE FROM public.audit_logs WHERE record_id IN ($1, $2) OR new_data->>'period_id' = $2::text;`, [defId, periodId]).catch(() => {});
      await client.query(`DELETE FROM public.kpi_reviews WHERE period_id = $1;`, [periodId]).catch(() => {});
      await client.query(`DELETE FROM public.kpi_scores WHERE period_id = $1;`, [periodId]).catch(() => {});
      await client.query(`DELETE FROM public.kpi_periods WHERE id = $1;`, [periodId]).catch(() => {});
      await client.query(`DELETE FROM public.kpi_definitions WHERE id = $1;`, [defId]).catch(() => {});
    }
  });

  it("5. Computes zero-data employees, zero targets, and due-date boundaries accurately inside compute_kpi_scores", async () => {
    const seededDefIds: string[] = [];
    const seededTaskIds: string[] = [];
    let periodId: string | null = null;

    try {
      // Task assigned to nonReportEmp with due_date strictly AFTER the period end (must NOT count as overdue)
      const futureTask = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date)
         VALUES ($1, 'Sec4 Future Non-Overdue', $2, $3, 'in_progress', 'low', '2100-06-01')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.otherManager, ORG_1.nonReportEmp]
      );
      seededTaskIds.push(futureTask.rows[0].id);

      // 1 completed task in-period for otherManager (used with target_value = 0, higher_is_better -> score 100)
      const mgrTask = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date, started_at, completed_at)
         VALUES ($1, 'Sec4 ZeroTarget Beat', $2, $2, 'done', 'medium', '2099-12-15', '2099-12-10T00:00:00Z', '2099-12-12T00:00:00Z')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.otherManager]
      );
      seededTaskIds.push(mgrTask.rows[0].id);

      await asRole(
        ORG_1.admin,
        ORG_1_ID,
        "admin",
        "aal2",
        async () => {
          const defs: Array<[string, string, number, string]> = [
            ["Sec4 Edge Att OnTime", "attendance_on_time_rate", 95, "higher_is_better"],
            ["Sec4 Edge Hours Target", "hours_vs_target", 100, "higher_is_better"],
            ["Sec4 Edge Absences", "absence_days", 2, "lower_is_better"],
            ["Sec4 Edge Leave Taken", "leave_days_taken", 3, "lower_is_better"],
            ["Sec4 Edge Zero Target TasksDone", "tasks_completed", 0, "higher_is_better"],
            ["Sec4 Edge OnTimeTasks", "tasks_on_time_rate", 90, "higher_is_better"],
            ["Sec4 Edge Zero Target Overdue", "tasks_overdue", 0, "lower_is_better"],
            ["Sec4 Edge CycleDays", "avg_task_cycle_days", 3, "lower_is_better"],
          ];
          for (const [name, metric, target, dir] of defs) {
            const dRes = await client.query(
              `SELECT public.upsert_kpi_definition($1, $2, $3, $4, 1.0, NULL, NULL, NULL, TRUE, NULL) AS res;`,
              [name, metric, target, dir]
            );
            seededDefIds.push(dRes.rows[0].res.definition.id);
          }

          const pRes = await client.query(
            `SELECT public.create_kpi_period('Sec4 Dec 2099 Edge', 'monthly', '2099-12-01', '2099-12-31') AS res;`
          );
          periodId = pRes.rows[0].res.period.id;
          const cRes = await client.query(`SELECT public.compute_kpi_scores($1) AS res;`, [periodId]);
          expect(cRes.rows[0].res.weighted_scores[ORG_1.nonReportEmp]).toBeNull();
        },
        { commit: true }
      );

      // Zero-data employee (nonReportEmp) scores safely without NULL/division-by-zero failures
      const nrRes = await client.query<{ source_metric: string; actual_value: string | null; score: string | null }>(
        `SELECT d.source_metric, s.actual_value::text, s.score::text
         FROM public.kpi_scores s
         JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
         WHERE s.period_id = $1 AND s.employee_id = $2;`,
        [periodId, ORG_1.nonReportEmp]
      );
      const nrMap = new Map(
        nrRes.rows.map((r) => [
          r.source_metric,
          {
            actual: r.actual_value === null ? null : Number(r.actual_value),
            score: r.score === null ? null : Number(r.score),
          },
        ])
      );
      // Item 4(a) & Follow-up 3: A metric with no underlying data produces NULL across all 8 metrics and is excluded from the total
      expect(nrMap.get("attendance_on_time_rate")).toEqual({ actual: null, score: null });
      expect(nrMap.get("hours_vs_target")).toEqual({ actual: null, score: null });
      expect(nrMap.get("absence_days")).toEqual({ actual: null, score: null });
      expect(nrMap.get("leave_days_taken")).toEqual({ actual: null, score: null });
      expect(nrMap.get("tasks_completed")).toEqual({ actual: null, score: null });
      expect(nrMap.get("tasks_on_time_rate")).toEqual({ actual: null, score: null });
      expect(nrMap.get("tasks_overdue")).toEqual({ actual: null, score: null });
      expect(nrMap.get("avg_task_cycle_days")).toEqual({ actual: null, score: null });

      // Total weighted score for an employee with only unscored metrics evaluates to null ("No data")
      const nrScoreInputs = Array.from(nrMap.values()).map((v) => ({ score: v.score, weight: 1 }));
      expect(computeWeightedKpiScore(nrScoreInputs)).toBeNull();

      // Mixed: 7 unscored metrics + 1 scored metric (e.g. 85%) produces 85% (unscored metrics are excluded from denominator)
      expect(computeWeightedKpiScore([...nrScoreInputs, { score: 85, weight: 2 }])).toBe(85);

      // Zero-target > 0 actual under higher_is_better scores 100 inside compute_kpi_scores
      const omRes = await client.query<{ actual_value: string; score: string }>(
        `SELECT s.actual_value::text, s.score::text
         FROM public.kpi_scores s
         JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
         WHERE s.period_id = $1 AND s.employee_id = $2 AND d.source_metric = 'tasks_completed' AND d.id = ANY($3::uuid[]);`,
        [periodId, ORG_1.otherManager, seededDefIds]
      );
      expect(Number(omRes.rows[0].actual_value)).toBe(1);
      expect(Number(omRes.rows[0].score)).toBe(100);
    } finally {
      if (periodId) {
        await client.query(`DELETE FROM public.audit_logs WHERE record_id = $1 OR new_data->>'period_id' = $1::text;`, [periodId]).catch(() => {});
        await client.query(`DELETE FROM public.kpi_scores WHERE period_id = $1;`, [periodId]).catch(() => {});
        await client.query(`DELETE FROM public.kpi_periods WHERE id = $1;`, [periodId]).catch(() => {});
      }
      if (seededDefIds.length > 0) {
        await client.query(`DELETE FROM public.kpi_definitions WHERE id = ANY($1::uuid[]);`, [seededDefIds]).catch(() => {});
      }
      if (seededTaskIds.length > 0) {
        await client.query(`DELETE FROM public.tasks WHERE id = ANY($1::uuid[]);`, [seededTaskIds]).catch(() => {});
      }
    }
  });
  it("6. IST employee timezone edge case: task completed after midnight IST is excluded from prior-month KPI period", async () => {
    // Employee in Asia/Kolkata (UTC+5:30). A task completed at 2025-05-31T19:00:00Z =
    // 2025-06-01T00:30:00+05:30 IST — this is in June for the employee, so it must NOT
    // count as a May completion in compute_kpi_scores.
    const IST_EMP_ID = "00000000-0000-0000-0000-000000000960";
    const seededDefIds: string[] = [];
    const seededTaskIds: string[] = [];
    let periodId: string | null = null;

    await client.query(`
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES ('${IST_EMP_ID}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec4-ist-emp@org1.test', 'fake', now(), '{"provider":"email"}', '{}', now(), now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES ('${ORG_1_ID}', '${IST_EMP_ID}', 'employee', 'active')
      ON CONFLICT (user_id) DO UPDATE SET organization_id = '${ORG_1_ID}', role = 'employee', status = 'active';
    `);
    await client.query(`
      INSERT INTO public.employees (id, organization_id, email, full_name, manager_id, status, work_mode, timezone)
      VALUES ('${IST_EMP_ID}', '${ORG_1_ID}', 'sec4-ist-emp@org1.test', 'Sec4 IST Employee', '${ORG_1.manager}', 'active', 'hybrid', 'Asia/Kolkata')
      ON CONFLICT (id) DO UPDATE SET timezone = 'Asia/Kolkata', status = 'active';
    `);

    try {
      // Task completed at 2025-05-31T19:00:00Z = 2025-06-01 00:30 IST → NOT in May period
      const tMidnight = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date, started_at, completed_at)
         VALUES ($1, 'Sec4 IST Midnight Task', $2, $3, 'done', 'high', '2025-05-31', '2025-05-28T10:00:00Z', '2025-05-31T19:00:00Z')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.manager, IST_EMP_ID]
      );
      seededTaskIds.push(tMidnight.rows[0].id);

      // Open overdue task due on 2025-04-15 is BEFORE period start (2025-05-01) → not period-scoped overdue
      const tOverdueApr = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date)
         VALUES ($1, 'Sec4 IST Apr Overdue', $2, $3, 'in_progress', 'medium', '2025-04-15')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.manager, IST_EMP_ID]
      );
      seededTaskIds.push(tOverdueApr.rows[0].id);

      await asRole(
        ORG_1.admin,
        ORG_1_ID,
        "admin",
        "aal2",
        async () => {
          const dRes = await client.query(
            `SELECT public.upsert_kpi_definition('Sec4 IST Tasks Done', 'tasks_completed', 1, 'higher_is_better', 1.0, NULL, NULL, NULL, TRUE, NULL) AS res;`
          );
          seededDefIds.push(dRes.rows[0].res.definition.id);
          const dRes2 = await client.query(
            `SELECT public.upsert_kpi_definition('Sec4 IST Overdue', 'tasks_overdue', 0, 'lower_is_better', 1.0, NULL, NULL, NULL, TRUE, NULL) AS res;`
          );
          seededDefIds.push(dRes2.rows[0].res.definition.id);

          const pRes = await client.query(
            `SELECT public.create_kpi_period('Sec4 IST May 2025', 'monthly', '2025-05-01', '2025-05-31') AS res;`
          );
          periodId = pRes.rows[0].res.period.id;
          await client.query(`SELECT public.compute_kpi_scores($1);`, [periodId]);
        },
        { commit: true }
      );

      const istScores = await client.query<{ source_metric: string; actual_value: string }>(
        `SELECT d.source_metric, s.actual_value::text
         FROM public.kpi_scores s
         JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
         WHERE s.period_id = $1 AND s.employee_id = $2;`,
        [periodId, IST_EMP_ID]
      );
      const istMap = new Map(istScores.rows.map((r) => [r.source_metric, Number(r.actual_value)]));

      // Completion at 19:00 UTC = 00:30 IST next day → NOT counted in May period
      expect(istMap.get("tasks_completed")).toBe(0);
      // Overdue task due on 2025-04-15 is before period start → not period-scoped overdue
      expect(istMap.get("tasks_overdue")).toBe(0);

      // ----------------------------------------------------------------------
      // Item 1 Follow-up: compute on-time as (completed_at AT TIME ZONE tz)::date <= due_date
      // Add test: due 2026-11-10, completed 23:30 IST on 2026-11-10, session timezone UTC -> on time;
      // completed 00:30 IST on 2026-11-11 -> late.
      // ----------------------------------------------------------------------
      await client.query("SET TIME ZONE 'UTC';");

      // 1. Direct SQL evaluation asserting date column is NOT subjected to AT TIME ZONE
      const sqlCheck = await client.query<{ on_time_task: boolean; late_task: boolean }>(`
        SELECT
          ((TIMESTAMPTZ '2026-11-10 18:00:00+00' AT TIME ZONE 'Asia/Kolkata')::date <= DATE '2026-11-10') AS on_time_task,
          ((TIMESTAMPTZ '2026-11-10 19:00:00+00' AT TIME ZONE 'Asia/Kolkata')::date <= DATE '2026-11-10') AS late_task;
      `);
      expect(sqlCheck.rows[0].on_time_task).toBe(true);  // 23:30 IST on 2026-11-10 -> On time
      expect(sqlCheck.rows[0].late_task).toBe(false);    // 00:30 IST on 2026-11-11 -> Late

      // 2. Full compute_kpi_scores verification for the November 2026 period under UTC session
      const tOnTimeNov = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date, started_at, completed_at)
         VALUES ($1, 'Sec4 IST On-Time Nov', $2, $3, 'done', 'high', '2026-11-10', '2026-11-08T00:00:00Z', '2026-11-10T18:00:00Z')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.manager, IST_EMP_ID]
      );
      seededTaskIds.push(tOnTimeNov.rows[0].id);

      let novPeriodId: string | null = null;
      try {
        await asRole(
          ORG_1.admin,
          ORG_1_ID,
          "admin",
          "aal2",
          async () => {
            const dResOnTime = await client.query(
              `SELECT public.upsert_kpi_definition('Sec4 IST Nov On-Time', 'tasks_on_time_rate', 100, 'higher_is_better', 1.0, NULL, NULL, NULL, TRUE, NULL) AS res;`
            );
            seededDefIds.push(dResOnTime.rows[0].res.definition.id);

            const pResNov = await client.query(
              `SELECT public.create_kpi_period('Sec4 IST Nov 2026', 'monthly', '2026-11-01', '2026-11-30') AS res;`
            );
            novPeriodId = pResNov.rows[0].res.period.id;
            await client.query(`SELECT public.compute_kpi_scores($1);`, [novPeriodId]);
          },
          { commit: true }
        );

        // Task 1 completed at 23:30 IST on 2026-11-10 (18:00 UTC) with due_date 2026-11-10 -> On time (100%)
        const novRes1 = await client.query<{ actual_value: string; score: string }>(
          `SELECT s.actual_value::text, s.score::text
           FROM public.kpi_scores s
           JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
           WHERE s.period_id = $1 AND s.employee_id = $2 AND d.source_metric = 'tasks_on_time_rate';`,
          [novPeriodId, IST_EMP_ID]
        );
        expect(Number(novRes1.rows[0]?.actual_value)).toBe(100);
        expect(Number(novRes1.rows[0]?.score)).toBe(100);

        // Add Task 2 completed at 00:30 IST on 2026-11-11 (19:00 UTC Nov 10) with due_date 2026-11-10 -> Late
        const tLateNov = await client.query<{ id: string }>(
          `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date, started_at, completed_at)
           VALUES ($1, 'Sec4 IST Late Nov', $2, $3, 'done', 'high', '2026-11-10', '2026-11-08T00:00:00Z', '2026-11-10T19:00:00Z')
           RETURNING id;`,
          [ORG_1_ID, ORG_1.manager, IST_EMP_ID]
        );
        seededTaskIds.push(tLateNov.rows[0].id);

        await asRole(
          ORG_1.admin,
          ORG_1_ID,
          "admin",
          "aal2",
          async () => {
            await client.query(`SELECT public.compute_kpi_scores($1);`, [novPeriodId]);
          },
          { commit: true }
        );

        // 1 on-time out of 2 tasks completed in November period -> 50% on-time rate
        const novRes2 = await client.query<{ actual_value: string; score: string }>(
          `SELECT s.actual_value::text, s.score::text
           FROM public.kpi_scores s
           JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
           WHERE s.period_id = $1 AND s.employee_id = $2 AND d.source_metric = 'tasks_on_time_rate';`,
          [novPeriodId, IST_EMP_ID]
        );
        expect(Number(novRes2.rows[0]?.actual_value)).toBe(50);
        expect(Number(novRes2.rows[0]?.score)).toBe(50);
      } finally {
        if (novPeriodId) {
          await client.query(`DELETE FROM public.audit_logs WHERE record_id = $1 OR new_data->>'period_id' = $1::text;`, [novPeriodId]).catch(() => {});
          await client.query(`DELETE FROM public.kpi_scores WHERE period_id = $1;`, [novPeriodId]).catch(() => {});
          await client.query(`DELETE FROM public.kpi_periods WHERE id = $1;`, [novPeriodId]).catch(() => {});
        }
      }
    } finally {
      if (periodId) {
        await client.query(`DELETE FROM public.audit_logs WHERE record_id = $1 OR new_data->>'period_id' = $1::text;`, [periodId]).catch(() => {});
        await client.query(`DELETE FROM public.kpi_scores WHERE period_id = $1;`, [periodId]).catch(() => {});
        await client.query(`DELETE FROM public.kpi_periods WHERE id = $1;`, [periodId]).catch(() => {});
      }
      if (seededDefIds.length > 0) {
        await client.query(`DELETE FROM public.kpi_definitions WHERE id = ANY($1::uuid[]);`, [seededDefIds]).catch(() => {});
      }
      if (seededTaskIds.length > 0) {
        await client.query(`DELETE FROM public.tasks WHERE id = ANY($1::uuid[]);`, [seededTaskIds]).catch(() => {});
      }
      await client.query(`DELETE FROM public.notifications WHERE user_id = '${IST_EMP_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.organization_members WHERE user_id = '${IST_EMP_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.employees WHERE id = '${IST_EMP_ID}';`).catch(() => {});
      await client.query(`DELETE FROM auth.users WHERE id = '${IST_EMP_ID}';`).catch(() => {});
    }
  });

  it("7. Straddling leave uses calculate_working_days for period overlap; Sick/Statutory excluded via counts_toward_kpi toggle; hr_update_leave_type_kpi_setting writes audit", async () => {
    const STRADDLE_EMP_ID = "00000000-0000-0000-0000-000000000961";
    const seededDefIds: string[] = [];
    let seededLeaveId: string | null = null;
    let seededSickLeaveId: string | null = null;
    let periodId: string | null = null;
    let origSickKpiSetting: boolean | null = null;
    let sickLtId: string | null = null;
    let casualLtId: string | null = null;

    await client.query(`
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES ('${STRADDLE_EMP_ID}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec4-straddle@org1.test', 'fake', now(), '{"provider":"email"}', '{}', now(), now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES ('${ORG_1_ID}', '${STRADDLE_EMP_ID}', 'employee', 'active')
      ON CONFLICT (user_id) DO UPDATE SET organization_id = '${ORG_1_ID}', role = 'employee', status = 'active';
    `);
    await client.query(`
      INSERT INTO public.employees (id, organization_id, email, full_name, manager_id, status, work_mode, timezone)
      VALUES ('${STRADDLE_EMP_ID}', '${ORG_1_ID}', 'sec4-straddle@org1.test', 'Sec4 Straddle Employee', '${ORG_1.manager}', 'active', 'hybrid', 'UTC')
      ON CONFLICT (id) DO UPDATE SET status = 'active';
    `);

    try {
      const casualRes = await client.query<{ id: string }>(
        `SELECT id FROM public.leave_types WHERE organization_id = $1 AND code = 'CASUAL' LIMIT 1;`,
        [ORG_1_ID]
      );
      casualLtId = casualRes.rows[0]?.id ?? null;

      const sickRes = await client.query<{ id: string; counts_toward_kpi: boolean }>(
        `SELECT id, counts_toward_kpi FROM public.leave_types WHERE organization_id = $1 AND code = 'SICK' LIMIT 1;`,
        [ORG_1_ID]
      );
      sickLtId = sickRes.rows[0]?.id ?? null;
      origSickKpiSetting = sickRes.rows[0]?.counts_toward_kpi ?? null;

      // 1. Straddling multi-day CASUAL leave: Apr 29–May 2 (day_part = 'full').
      // Invariant: half-day type is applied ONLY to single-day requests (enforced by chk_leave_request_half_day_single_date);
      // straddling multi-day requests count working days within the period (May 1 Thu + May 2 Fri = 2.0).
      let seededSingleHalfDayId: string | null = null;
      if (casualLtId) {
        const lrRes = await client.query<{ id: string }>(
          `INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, day_part, total_days, reason, status)
           VALUES ($1, $2, $3, '2025-04-29', '2025-05-02', 'full', 4.0, 'Sec4 Straddle Leave', 'approved')
           RETURNING id;`,
          [ORG_1_ID, STRADDLE_EMP_ID, casualLtId]
        );
        seededLeaveId = lrRes.rows[0].id;

        // 2. Single-day CASUAL leave: May 15 with day_part = 'second_half' -> yields 0.5 working days
        const halfRes = await client.query<{ id: string }>(
          `INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, day_part, total_days, reason, status)
           VALUES ($1, $2, $3, '2025-05-15', '2025-05-15', 'second_half', 0.5, 'Sec4 Single Half-Day Leave', 'approved')
           RETURNING id;`,
          [ORG_1_ID, STRADDLE_EMP_ID, casualLtId]
        );
        seededSingleHalfDayId = halfRes.rows[0].id;
      }

      // 3. SICK leave within period (counts_toward_kpi = FALSE by default, 2.0 days)
      if (sickLtId) {
        const slRes = await client.query<{ id: string }>(
          `INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, day_part, total_days, reason, status)
           VALUES ($1, $2, $3, '2025-05-05', '2025-05-06', 'full', 2.0, 'Sec4 Sick Leave', 'approved')
           RETURNING id;`,
          [ORG_1_ID, STRADDLE_EMP_ID, sickLtId]
        );
        seededSickLeaveId = slRes.rows[0].id;
      }

      await asRole(
        ORG_1.admin,
        ORG_1_ID,
        "admin",
        "aal2",
        async () => {
          const dRes = await client.query(
            `SELECT public.upsert_kpi_definition('Sec4 Straddle Leave Taken', 'leave_days_taken', 5, 'lower_is_better', 1.0, NULL, NULL, NULL, TRUE, NULL) AS res;`
          );
          seededDefIds.push(dRes.rows[0].res.definition.id);
          const pRes = await client.query(
            `SELECT public.create_kpi_period('Sec4 Straddle May 2025', 'monthly', '2025-05-01', '2025-05-31') AS res;`
          );
          periodId = pRes.rows[0].res.period.id;
          await client.query(`SELECT public.compute_kpi_scores($1);`, [periodId]);
        },
        { commit: true }
      );

      // Default setting: Sick and Statutory leave are excluded from KPI by default (counts_toward_kpi = FALSE).
      // Straddle CASUAL leave (Apr 29-May 2) overlaps May 1-2 = 2.0 working days.
      // Single-day CASUAL leave (May 15) with second_half = 0.5 working days.
      // Sick leave (May 5-6) is excluded by default -> expected leave_days_taken = 2.5.
      const defaultRes = await client.query<{ actual_value: string }>(
        `SELECT s.actual_value::text
         FROM public.kpi_scores s
         JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
         WHERE s.period_id = $1 AND s.employee_id = $2 AND d.source_metric = 'leave_days_taken';`,
        [periodId, STRADDLE_EMP_ID]
      );
      expect(Number(defaultRes.rows[0]?.actual_value)).toBe(2.5);

      // Now HR enables Sick leave for KPI (counts_toward_kpi = TRUE) using hr_update_leave_type_kpi_setting
      if (sickLtId) {
        await asRole(
          ORG_1.hr,
          ORG_1_ID,
          "hr",
          "aal2",
          async () => {
            await client.query(`SELECT public.hr_update_leave_type_kpi_setting($1, TRUE);`, [sickLtId]);
          },
          { commit: true }
        );

        // Audit row written with counts_toward_kpi = true
        const enableAudit = await client.query<{ action: string; new_data: Record<string, unknown> }>(
          `SELECT action, new_data FROM public.audit_logs
           WHERE record_id = $1 AND action = 'LEAVE_TYPE_KPI_SETTING_UPDATED'
           ORDER BY created_at DESC LIMIT 1;`,
          [sickLtId]
        );
        expect(enableAudit.rows.length).toBe(1);
        expect(enableAudit.rows[0].new_data).toMatchObject({ counts_toward_kpi: true });

        // Recompute: now straddle CASUAL (2.0) + single-day half-day (0.5) + SICK (2.0) count = 4.5
        await asRole(
          ORG_1.hr,
          ORG_1_ID,
          "hr",
          "aal2",
          async () => {
            await client.query(`SELECT public.compute_kpi_scores($1);`, [periodId]);
          },
          { commit: true }
        );

        const enabledRes = await client.query<{ actual_value: string }>(
          `SELECT s.actual_value::text
           FROM public.kpi_scores s
           JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
           WHERE s.period_id = $1 AND s.employee_id = $2 AND d.source_metric = 'leave_days_taken';`,
          [periodId, STRADDLE_EMP_ID]
        );
        expect(Number(enabledRes.rows[0]?.actual_value)).toBe(4.5);

        // Now HR disables Sick leave again (counts_toward_kpi = FALSE)
        await asRole(
          ORG_1.hr,
          ORG_1_ID,
          "hr",
          "aal2",
          async () => {
            await client.query(`SELECT public.hr_update_leave_type_kpi_setting($1, FALSE);`, [sickLtId]);
          },
          { commit: true }
        );

        // Audit row written with counts_toward_kpi = false
        const disableAudit = await client.query<{ action: string; new_data: Record<string, unknown> }>(
          `SELECT action, new_data FROM public.audit_logs
           WHERE record_id = $1 AND action = 'LEAVE_TYPE_KPI_SETTING_UPDATED'
           ORDER BY created_at DESC LIMIT 1;`,
          [sickLtId]
        );
        expect(disableAudit.rows.length).toBe(1);
        expect(disableAudit.rows[0].new_data).toMatchObject({ counts_toward_kpi: false });

        // Recompute: only 2.5 casual days remain (2.0 straddle + 0.5 single-day half-day)
        await asRole(
          ORG_1.hr,
          ORG_1_ID,
          "hr",
          "aal2",
          async () => {
            await client.query(`SELECT public.compute_kpi_scores($1);`, [periodId]);
          },
          { commit: true }
        );

        const disabledRes = await client.query<{ actual_value: string }>(
          `SELECT s.actual_value::text
           FROM public.kpi_scores s
           JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
           WHERE s.period_id = $1 AND s.employee_id = $2 AND d.source_metric = 'leave_days_taken';`,
          [periodId, STRADDLE_EMP_ID]
        );
        expect(Number(disabledRes.rows[0]?.actual_value)).toBe(2.5);
      }

      // Cross-tenant denial: Org 2 admin at aal2 cannot call hr_update_leave_type_kpi_setting with an Org 1 UUID
      if (casualLtId) {
        await expect(
          asRole(ORG_2.admin, ORG_2_ID, "admin", "aal2", async () => {
            await client.query(`SELECT public.hr_update_leave_type_kpi_setting($1, FALSE);`, [casualLtId]);
          })
        ).rejects.toThrow(/42501|not found|permission denied/i);
      }
    } finally {
      if (sickLtId && origSickKpiSetting !== null) {
        await asRole(
          ORG_1.hr,
          ORG_1_ID,
          "hr",
          "aal2",
          async () => {
            await client.query(`SELECT public.hr_update_leave_type_kpi_setting($1, $2);`, [sickLtId, origSickKpiSetting]);
          },
          { commit: true }
        ).catch(() => {});
      }
      if (periodId) {
        await client.query(`DELETE FROM public.audit_logs WHERE record_id = $1 OR new_data->>'period_id' = $1::text;`, [periodId]).catch(() => {});
        await client.query(`DELETE FROM public.kpi_scores WHERE period_id = $1;`, [periodId]).catch(() => {});
        await client.query(`DELETE FROM public.kpi_periods WHERE id = $1;`, [periodId]).catch(() => {});
      }
      if (seededDefIds.length > 0) {
        await client.query(`DELETE FROM public.kpi_definitions WHERE id = ANY($1::uuid[]);`, [seededDefIds]).catch(() => {});
      }
      if (seededSickLeaveId) await client.query(`DELETE FROM public.leave_requests WHERE id = $1;`, [seededSickLeaveId]).catch(() => {});
      if (seededLeaveId) await client.query(`DELETE FROM public.leave_requests WHERE id = $1;`, [seededLeaveId]).catch(() => {});
      await client.query(`DELETE FROM public.leave_requests WHERE employee_id = '${STRADDLE_EMP_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.notifications WHERE user_id = '${STRADDLE_EMP_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.organization_members WHERE user_id = '${STRADDLE_EMP_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.employees WHERE id = '${STRADDLE_EMP_ID}';`).catch(() => {});
      await client.query(`DELETE FROM auth.users WHERE id = '${STRADDLE_EMP_ID}';`).catch(() => {});
      if (sickLtId) {
        await client.query(
          `DELETE FROM public.audit_logs WHERE record_id = $1 AND action = 'LEAVE_TYPE_KPI_SETTING_UPDATED';`,
          [sickLtId]
        ).catch(() => {});
      }
    }
  });

  it("8. Database authoritative weighted KPI total guarded by NULLIF handles all-zero weights and matches TypeScript helper", async () => {
    let periodId: string | null = null;
    const seededDefIds: string[] = [];
    const seededTaskIds: string[] = [];

    try {
      // Create period
      await asRole(ORG_1.admin, ORG_1_ID, "admin", "aal2", async () => {
        const pRes = await client.query<{ res: { period: { id: string } } }>(
          `SELECT public.create_kpi_period('Sec4 Zero Weight Period', 'monthly', '2026-06-01', '2026-06-30') AS res;`
        );
        periodId = pRes.rows[0].res.period.id;

        // Upsert 2 KPI definitions with weight = 0.0 (informational KPIs)
        const d1 = await client.query<{ res: { definition: { id: string } } }>(
          `SELECT public.upsert_kpi_definition('Sec4 Zero Weight Tasks', 'tasks_completed', 2, 'higher_is_better', 0.0, NULL, NULL, NULL, TRUE, NULL) AS res;`
        );
        seededDefIds.push(d1.rows[0].res.definition.id);

        const d2 = await client.query<{ res: { definition: { id: string } } }>(
          `SELECT public.upsert_kpi_definition('Sec4 Zero Weight Cycle', 'avg_task_cycle_days', 5, 'lower_is_better', 0.0, NULL, NULL, NULL, TRUE, NULL) AS res;`
        );
        seededDefIds.push(d2.rows[0].res.definition.id);
      }, { commit: true });

      // Seed 2 completed tasks in June 2026 for employee
      const t1 = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, status, priority, creator_id, assignee_id, due_date, created_at, started_at, completed_at)
         VALUES ($1, 'Zero Weight Task 1', 'done', 'medium', $2, $3, '2026-06-15', '2026-06-01 10:00:00+00', '2026-06-01 10:00:00+00', '2026-06-02 10:00:00+00')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.manager, ORG_1.reportEmp]
      );
      seededTaskIds.push(t1.rows[0].id);

      const t2 = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, status, priority, creator_id, assignee_id, due_date, created_at, started_at, completed_at)
         VALUES ($1, 'Zero Weight Task 2', 'done', 'medium', $2, $3, '2026-06-20', '2026-06-01 10:00:00+00', '2026-06-01 10:00:00+00', '2026-06-03 10:00:00+00')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.manager, ORG_1.reportEmp]
      );
      seededTaskIds.push(t2.rows[0].id);

      // Compute KPI scores via RPC
      let computeRes: any;
      await asRole(ORG_1.admin, ORG_1_ID, "admin", "aal2", async () => {
        const cRes = await client.query(
          `SELECT public.compute_kpi_scores($1) AS res;`,
          [periodId]
        );
        computeRes = cRes.rows[0].res;
      }, { commit: true });

      // 1. In compute_kpi_scores return payload, employee weighted score is null (not 0, not NaN, no division by zero)
      expect(computeRes.weighted_scores[ORG_1.reportEmp]).toBeNull();

      // 2. Direct SQL query: evaluating SUM(score * weight) / NULLIF(SUM(CASE WHEN score IS NOT NULL THEN weight ELSE 0 END), 0)
      const sqlWeightedRes = await client.query<{ sql_weighted: string | null }>(
        `SELECT ROUND(
            SUM(s.score * d.weight) / NULLIF(SUM(CASE WHEN s.score IS NOT NULL THEN d.weight ELSE 0 END), 0),
            2
         )::text AS sql_weighted
         FROM public.kpi_scores s
         JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
         WHERE s.period_id = $1 AND s.employee_id = $2 AND d.id = ANY($3::uuid[]);`,
        [periodId, ORG_1.reportEmp, seededDefIds]
      );
      expect(sqlWeightedRes.rows[0].sql_weighted).toBeNull();

      // 3. Query the individual scores from DB to verify both were scored with non-null scores (e.g. 100)
      const scoreRows = await client.query<{ score: string; weight: string }>(
        `SELECT s.score::text, d.weight::text
         FROM public.kpi_scores s
         JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
         WHERE s.period_id = $1 AND s.employee_id = $2 AND d.id = ANY($3::uuid[]);`,
        [periodId, ORG_1.reportEmp, seededDefIds]
      );
      expect(scoreRows.rows.length).toBe(2);
      expect(scoreRows.rows.every((r) => Number(r.weight) === 0)).toBe(true);
      expect(scoreRows.rows.every((r) => Number(r.score) > 0)).toBe(true);

      // 4. Test that TypeScript computeWeightedKpiScore matches the authoritative SQL output exactly
      const tsInputs = scoreRows.rows.map((r) => ({
        score: Number(r.score),
        weight: Number(r.weight),
      }));
      const tsResult = computeWeightedKpiScore(tsInputs);
      expect(tsResult).toBeNull();
      expect(tsResult).toBe(sqlWeightedRes.rows[0].sql_weighted);
    } finally {
      if (periodId) {
        await client.query(`DELETE FROM public.audit_logs WHERE record_id = $1 OR new_data->>'period_id' = $1::text;`, [periodId]).catch(() => {});
        await client.query(`DELETE FROM public.kpi_scores WHERE period_id = $1;`, [periodId]).catch(() => {});
        await client.query(`DELETE FROM public.kpi_periods WHERE id = $1;`, [periodId]).catch(() => {});
      }
      if (seededDefIds.length > 0) {
        await client.query(`DELETE FROM public.kpi_definitions WHERE id = ANY($1::uuid[]);`, [seededDefIds]).catch(() => {});
      }
      if (seededTaskIds.length > 0) {
        await client.query(`DELETE FROM public.tasks WHERE id = ANY($1::uuid[]);`, [seededTaskIds]).catch(() => {});
      }
    }
  });
});
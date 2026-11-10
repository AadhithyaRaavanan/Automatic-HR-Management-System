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
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

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
    const calc = async (actual: number | null, target: number, dir: string) => {
      const r = await client.query<{ score: string }>(
        `SELECT public.calculate_kpi_score($1, $2, $3)::text AS score;`,
        [actual, target, dir]
      );
      return Number(r.rows[0].score);
    };

    // NULL actual (no data) resolves cleanly to 0.00
    expect(await calc(null, 95, "higher_is_better")).toBe(0);
    expect(await calc(null, 2, "lower_is_better")).toBe(0);
    expect(await calc(null, 0, "lower_is_better")).toBe(0);

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
    const startDate = "2099-05-01";
    const endDate = "2099-05-31";
    const seededDefIds: string[] = [];
    const seededTaskIds: string[] = [];
    const seededAttDates: string[] = ["2099-05-04", "2099-05-05", "2099-05-06"];
    let seededLeaveId: string | null = null;
    let periodId: string | null = null;

    try {
      // Seed real attendance_days for reportEmp in 2099-05 window (1 on-time 480m, 1 late 240m, 1 absent 0m)
      await client.query(
        `INSERT INTO public.attendance_days (organization_id, employee_id, work_date, total_minutes, status, is_late)
         VALUES
           ($1, $2, '2099-05-04', 480, 'present', false),
           ($1, $2, '2099-05-05', 240, 'half_day', true),
           ($1, $2, '2099-05-06', 0, 'absent', false)
         ON CONFLICT (employee_id, work_date) DO UPDATE
           SET total_minutes = EXCLUDED.total_minutes, status = EXCLUDED.status, is_late = EXCLUDED.is_late;`,
        [ORG_1_ID, ORG_1.reportEmp]
      );

      // Seed 1 approved leave_request for reportEmp (2 days) using any existing Org 1 leave type
      const ltRes = await client.query<{ id: string }>(
        `SELECT id FROM public.leave_types WHERE organization_id = $1 LIMIT 1;`,
        [ORG_1_ID]
      );
      if (ltRes.rows[0]?.id) {
        const lrRes = await client.query<{ id: string }>(
          `INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, day_part, total_days, reason, status)
           VALUES ($1, $2, $3, '2099-05-12', '2099-05-13', 'full', 2.0, 'Sec4 Leave Metric', 'approved')
           RETURNING id;`,
          [ORG_1_ID, ORG_1.reportEmp, ltRes.rows[0].id]
        );
        seededLeaveId = lrRes.rows[0].id;
      }

      // Seed 3 tasks assigned to reportEmp:
      // 1) Done on time (2-day cycle time)
      // 2) Done late (4-day cycle time)
      // 3) Overdue open task with past due_date <= end_date
      const t1 = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date, started_at, completed_at)
         VALUES ($1, 'Sec4 OnTime Task', $2, $3, 'done', 'medium', '2099-05-10', '2099-05-07T00:00:00Z', '2099-05-09T00:00:00Z')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.manager, ORG_1.reportEmp]
      );
      const t2 = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date, started_at, completed_at)
         VALUES ($1, 'Sec4 Late Task', $2, $3, 'done', 'high', '2099-05-15', '2099-05-14T00:00:00Z', '2099-05-18T00:00:00Z')
         RETURNING id;`,
        [ORG_1_ID, ORG_1.manager, ORG_1.reportEmp]
      );
      const t3 = await client.query<{ id: string }>(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date)
         VALUES ($1, 'Sec4 Overdue Task', $2, $3, 'in_progress', 'urgent', '2020-01-01')
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
            `SELECT public.create_kpi_period('Sec4 May 2099', 'monthly', $1, $2) AS res;`,
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

      // Recalculate while period is open after finishing t3 on time? Update t3 completed_at in 2099-05-20
      await client.query(
        `UPDATE public.tasks SET status = 'done', due_date = '2099-05-25', completed_at = '2099-05-20T00:00:00Z' WHERE id = $1;`,
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
          await client.query(`SELECT public.compute_kpi_scores($1);`, [periodId]);
        },
        { commit: true }
      );

      // Zero-data employee (nonReportEmp) scores safely without NULL/division-by-zero failures
      const nrRes = await client.query<{ source_metric: string; actual_value: string; score: string }>(
        `SELECT d.source_metric, s.actual_value::text, s.score::text
         FROM public.kpi_scores s
         JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
         WHERE s.period_id = $1 AND s.employee_id = $2;`,
        [periodId, ORG_1.nonReportEmp]
      );
      const nrMap = new Map(nrRes.rows.map((r) => [r.source_metric, { actual: Number(r.actual_value), score: Number(r.score) }]));
      expect(nrMap.get("attendance_on_time_rate")).toEqual({ actual: 0, score: 0 });
      expect(nrMap.get("hours_vs_target")).toEqual({ actual: 0, score: 0 });
      expect(nrMap.get("absence_days")).toEqual({ actual: 0, score: 100 });
      expect(nrMap.get("leave_days_taken")).toEqual({ actual: 0, score: 100 });
      expect(nrMap.get("tasks_completed")).toEqual({ actual: 0, score: 0 }); // 0 vs target 0 higher_is_better -> 0
      expect(nrMap.get("tasks_on_time_rate")).toEqual({ actual: 0, score: 0 });
      expect(nrMap.get("tasks_overdue")).toEqual({ actual: 0, score: 100 }); // future due_date excluded; 0 vs target 0 lower_is_better -> 100
      expect(nrMap.get("avg_task_cycle_days")).toEqual({ actual: 0, score: 100 });

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
});


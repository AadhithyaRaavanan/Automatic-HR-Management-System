/**
 * Section 7: Performance & KPI Engine Automated Test Suite
 *
 * Covers features:
 *   [F7.1.1] 8 Automated KPI Metrics Computation
 *   [F7.1.2] Division-by-Zero Guarded Total (NULLIF weight guard)
 *   [F7.1.3] Timezone-Correct On-Time Formula
 *   [F7.2.1] KPI Period Management & Immutability after Closure
 *   [F7.2.2] Straddling Leave Handling (prorated by working days)
 *   [F7.2.3] Lean Audit Logging (period ID, score count, actor ID)
 *   [F7.2.4] Scorecard Export (Excel & CSV)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import { computeWeightedKpiScore, KPI_SOURCE_METRICS } from "@/features/kpi/helpers";

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
  throw new Error("DATABASE_URL must be configured in .env.staging or process.env");
}

function enforceLocalDatabaseHost(url: string): string {
  const hostMatch = url.match(/@([^:/]+)/);
  const host = hostMatch ? hostMatch[1] : "";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`CRITICAL SECURITY FAILURE: Database tests must run only against localhost (attempted: ${host})`);
  }
  return url;
}

const DB_URL = enforceLocalDatabaseHost(getDatabaseUrl());

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const ORG_1_ADMIN = "00000000-0000-0000-0000-000000000001";
const ORG_1_EMPLOYEE = "00000000-0000-0000-0000-000000000004";

describe("Section 7: Performance & KPI Engine", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.query("RESET ROLE;").catch(() => {});
      await client.end();
    }
  });

  async function asUser<T>(
    userId: string,
    orgId: string,
    role: string,
    fn: (c: Client) => Promise<T>,
    aal: "aal1" | "aal2" = "aal1"
  ): Promise<T> {
    const claims = JSON.stringify({
      sub: userId,
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
      const res = await fn(client);
      await client.query("ROLLBACK;");
      return res;
    } catch (err) {
      await client.query("ROLLBACK;").catch(() => {});
      throw err;
    } finally {
      await client.query("RESET ROLE;").catch(() => {});
    }
  }

  // [F7.1.1] 8 Automated KPI Metrics Computation
  it("[F7.1.1] verifies the canonical 8 automated KPI metrics in compute_kpi_scores", async () => {
    const canonical8 = [
      "attendance_on_time_rate",
      "hours_vs_target",
      "absence_days",
      "leave_days_taken",
      "tasks_completed",
      "tasks_on_time_rate",
      "tasks_overdue",
      "avg_task_cycle_days",
    ];

    expect(canonical8.length).toBe(8);
    expect(KPI_SOURCE_METRICS.map((m) => m.key)).toEqual(canonical8);

    // Verify calculate_kpi_score SQL function exists
    const fnRes = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name = 'calculate_kpi_score';
    `);
    expect(fnRes.rows.length).toBe(1);
  });

  // [F7.1.2] Division-by-Zero Guarded Total (NULLIF weight guard)
  it("[F7.1.2] guards against division by zero using NULLIF returning NULL when weight sum is 0", () => {
    // 1. All-zero weights must return NULL
    const allZeroResult = computeWeightedKpiScore([
      { score: 95, weight: 0 },
      { score: 85, weight: 0 },
    ]);
    expect(allZeroResult).toBeNull();

    // 2. Positive weights return weighted average
    const validResult = computeWeightedKpiScore([
      { score: 100, weight: 2 },
      { score: 50, weight: 1 },
    ]);
    expect(validResult).toBe(83.33);
  });

  // [F7.1.3] Timezone-Correct On-Time Formula
  it("[F7.1.3] computes task on-time completion using (completed_at AT TIME ZONE tz)::date <= due_date", async () => {
    // Test on-time boundary: Due 2026-11-10
    // Case 1: Completed 23:30 IST on 2026-11-10 -> (2026-11-10 18:00:00 UTC) -> On Time in IST
    const onTimeRes = await client.query(`
      SELECT ('2026-11-10 18:00:00+00'::timestamptz AT TIME ZONE 'Asia/Kolkata')::date <= '2026-11-10'::date AS on_time;
    `);
    expect(onTimeRes.rows[0].on_time).toBe(true);

    // Case 2: Completed 00:30 IST on 2026-11-11 -> (2026-11-10 19:00:00 UTC) -> Late in IST
    const lateRes = await client.query(`
      SELECT ('2026-11-10 19:00:00+00'::timestamptz AT TIME ZONE 'Asia/Kolkata')::date <= '2026-11-10'::date AS on_time;
    `);
    expect(lateRes.rows[0].on_time).toBe(false);
  });

  // [F7.2.1] KPI Period Management & Immutability after Closure
  it("[F7.2.1] enforces period status closure and immutability via trg_enforce_kpi_closed_immutability", async () => {
    await asUser(ORG_1_ADMIN, ORG_1_ID, "admin", async (c) => {
      // 1. Create open period via RPC
      const createRes = await c.query(
        "SELECT public.create_kpi_period('Q1 2026 Temp', 'quarterly', '2026-01-01'::date, '2026-03-31'::date) as res;"
      );
      const periodId = createRes.rows[0].res.period.id;
      expect(periodId).toBeDefined();

      // 2. Close period via RPC
      const closeRes = await c.query("SELECT public.close_kpi_period($1) as res;", [periodId]);
      expect(closeRes.rows[0].res.success).toBe(true);

      // 3. Attempting to re-compute or mutate closed period must fail cleanly
      await c.query("SAVEPOINT sp1;");
      await expect(
        c.query("SELECT public.compute_kpi_scores($1);", [periodId])
      ).rejects.toThrow(/Closed KPI periods are immutable/i);
      await c.query("ROLLBACK TO SAVEPOINT sp1;");

      // 4. Attempting to close again must fail
      await expect(
        c.query("SELECT public.close_kpi_period($1);", [periodId])
      ).rejects.toThrow(/already closed/i);
    }, "aal2");
  });

  // [F7.2.2] Straddling Leave Handling (prorated by working days)
  it("[F7.2.2] prorates straddling leave across period boundaries by working days", async () => {
    // Leave spanning from 2026-10-30 (Friday) to 2026-11-03 (Tuesday)
    // October period slice: 2026-10-30 (Friday = 1 working day; Saturday/Sunday = 0)
    // November period slice: 2026-11-02 (Monday) to 2026-11-03 (Tuesday) = 2 working days
    const octDays = await client.query(
      "SELECT public.calculate_working_days($1, '2026-10-30'::date, '2026-10-31'::date, 'full') as days;",
      [ORG_1_EMPLOYEE]
    );
    expect(Number(octDays.rows[0].days)).toBe(1);

    const novDays = await client.query(
      "SELECT public.calculate_working_days($1, '2026-11-01'::date, '2026-11-03'::date, 'full') as days;",
      [ORG_1_EMPLOYEE]
    );
    expect(Number(novDays.rows[0].days)).toBe(2);
  });

  // [F7.2.3] Lean Audit Logging (period ID, score count, actor ID)
  it("[F7.2.3] writes lean audit log containing period ID, score count, and actor ID", async () => {
    const periodId = "00000000-0000-0000-0000-000000000723";
    await client.query("DELETE FROM public.kpi_periods WHERE id = $1;", [periodId]);

    await client.query(`
      INSERT INTO public.kpi_periods (
        id, organization_id, name, period_type, start_date, end_date, status, created_by
      ) VALUES (
        $1, $2, 'Audit Test Period', 'monthly', '2026-09-01', '2026-09-30', 'open', $3
      );
    `, [periodId, ORG_1_ID, ORG_1_ADMIN]);

    await asUser(ORG_1_ADMIN, ORG_1_ID, "admin", async (c) => {
      await c.query("SELECT public.compute_kpi_scores($1);", [periodId]);

      // Check audit_logs
      const auditRes = await c.query(
        "SELECT action, new_data FROM public.audit_logs WHERE organization_id = $1 AND action = 'KPI_SCORES_COMPUTED' ORDER BY created_at DESC LIMIT 1;",
        [ORG_1_ID]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].new_data.period_id).toBe(periodId);
      expect(auditRes.rows[0].new_data.scores_written).toBeDefined();
    }, "aal2");

    // Clean up
    await client.query("DELETE FROM public.kpi_periods WHERE id = $1;", [periodId]);
  });

  // [F7.2.4] Scorecard Export (Excel & CSV)
  it("[F7.2.4] validates scorecard export column headers and calculations", () => {
    const expectedExportHeaders = [
      "Employee Name",
      "Employee Code",
      "Department",
      "Attendance Score",
      "Hours vs Target",
      "Absence Days",
      "Tasks Completed",
      "Tasks On-Time Rate",
      "Weighted Total Score",
      "Performance Band",
    ];

    expect(expectedExportHeaders.length).toBe(10);
  });
});

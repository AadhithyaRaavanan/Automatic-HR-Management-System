import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const localEnv = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(localEnv)) {
    for (const line of fs.readFileSync(localEnv, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        return trimmed.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
}

const DB_URL = getDatabaseUrl();

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const ORG_1 = {
  admin: "00000000-0000-0000-0000-000000000001",
  reportEmp: "00000000-0000-0000-0000-000000000004",
};

describe("Database: Shift Management, Late Flagging & Night Shift Auto-Checkout", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    // Ensure test employee is set to UTC timezone for deterministic time tests
    await client.query(`
      UPDATE public.employees
      SET timezone = 'UTC'
      WHERE id = '${ORG_1.reportEmp}';
    `);
  });

  afterAll(async () => {
    if (client) {
      await client.query("RESET ROLE;").catch(() => {});
      await client.end();
    }
  });

  it("1. Shift columns exist and accurately detect night shift crossovers", async () => {
    await client.query(`
      UPDATE public.organization_members
      SET shift_start_time = '17:00:00', shift_end_time = '01:00:00'
      WHERE user_id = '${ORG_1.reportEmp}' AND organization_id = '${ORG_1_ID}';

      UPDATE public.employees
      SET shift_start_time = '17:00:00', shift_end_time = '01:00:00'
      WHERE id = '${ORG_1.reportEmp}' AND organization_id = '${ORG_1_ID}';
    `);

    const res = await client.query(`
      SELECT 
        shift_start_time, 
        shift_end_time,
        (shift_end_time < shift_start_time) AS crosses_midnight
      FROM public.organization_members
      WHERE user_id = '${ORG_1.reportEmp}' AND organization_id = '${ORG_1_ID}';
    `);

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].shift_start_time).toBe("17:00:00");
    expect(res.rows[0].shift_end_time).toBe("01:00:00");
    expect(res.rows[0].crosses_midnight).toBe(true);
  });

  it("2. recalculate_day dynamically flags is_late = TRUE when punch is past grace period (15m)", async () => {
    const testDate = "2026-11-20";

    await client.query(`
      UPDATE public.organization_members
      SET shift_start_time = '09:00:00', shift_end_time = '17:00:00'
      WHERE user_id = '${ORG_1.reportEmp}' AND organization_id = '${ORG_1_ID}';

      UPDATE public.employees
      SET shift_start_time = '09:00:00', shift_end_time = '17:00:00', timezone = 'UTC'
      WHERE id = '${ORG_1.reportEmp}' AND organization_id = '${ORG_1_ID}';

      DELETE FROM public.attendance_sessions WHERE employee_id = '${ORG_1.reportEmp}';
      DELETE FROM public.attendance_days WHERE employee_id = '${ORG_1.reportEmp}' AND work_date = '${testDate}';
    `);

    // Insert session checked in at 09:30:00 UTC (10 mins past 20m grace)
    await client.query(`
      INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, check_out_at, source
      ) VALUES (
        '${ORG_1_ID}', '${ORG_1.reportEmp}', '${testDate}',
        '${testDate} 09:30:00+00', '${testDate} 17:00:00+00', 'web'
      );
    `);

    await client.query(`SELECT public.recalculate_day('${ORG_1.reportEmp}', '${testDate}');`);

    const dayRes = await client.query(`
      SELECT is_late, status, total_minutes
      FROM public.attendance_days
      WHERE employee_id = '${ORG_1.reportEmp}' AND work_date = '${testDate}';
    `);

    expect(dayRes.rows.length).toBe(1);
    expect(dayRes.rows[0].is_late).toBe(true);
  });

  it("3. recalculate_day sets is_late = FALSE when punch is within grace period (15m)", async () => {
    const testDate = "2026-11-21";

    await client.query(`
      UPDATE public.organization_members
      SET shift_start_time = '09:00:00', shift_end_time = '17:00:00'
      WHERE user_id = '${ORG_1.reportEmp}' AND organization_id = '${ORG_1_ID}';

      UPDATE public.employees
      SET shift_start_time = '09:00:00', shift_end_time = '17:00:00', timezone = 'UTC'
      WHERE id = '${ORG_1.reportEmp}' AND organization_id = '${ORG_1_ID}';

      DELETE FROM public.attendance_sessions WHERE employee_id = '${ORG_1.reportEmp}';
      DELETE FROM public.attendance_days WHERE employee_id = '${ORG_1.reportEmp}' AND work_date = '${testDate}';
    `);

    // Insert session checked in at 09:10:00 UTC (within 15m grace)
    await client.query(`
      INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, check_out_at, source
      ) VALUES (
        '${ORG_1_ID}', '${ORG_1.reportEmp}', '${testDate}',
        '${testDate} 09:10:00+00', '${testDate} 17:00:00+00', 'web'
      );
    `);

    await client.query(`SELECT public.recalculate_day('${ORG_1.reportEmp}', '${testDate}');`);

    const dayRes = await client.query(`
      SELECT is_late
      FROM public.attendance_days
      WHERE employee_id = '${ORG_1.reportEmp}' AND work_date = '${testDate}';
    `);

    expect(dayRes.rows.length).toBe(1);
    expect(dayRes.rows[0].is_late).toBe(false);
  });

  it("4. cron_auto_checkout skips active sessions for employees assigned to night shifts", async () => {
    const testDate = "2026-11-22";

    // Configure employee for Night Shift: 17:00 to 01:00 UTC
    await client.query(`
      UPDATE public.organization_members
      SET shift_start_time = '17:00:00', shift_end_time = '01:00:00'
      WHERE user_id = '${ORG_1.reportEmp}' AND organization_id = '${ORG_1_ID}';

      UPDATE public.employees
      SET shift_start_time = '17:00:00', shift_end_time = '01:00:00', timezone = 'UTC'
      WHERE id = '${ORG_1.reportEmp}' AND organization_id = '${ORG_1_ID}';

      DELETE FROM public.attendance_sessions WHERE employee_id = '${ORG_1.reportEmp}';
    `);

    // Create active open session starting at 17:30 UTC
    const sessionRes = await client.query(`
      INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, check_out_at, source
      ) VALUES (
        '${ORG_1_ID}', '${ORG_1.reportEmp}', '${testDate}',
        '${testDate} 17:30:00+00', NULL, 'web'
      ) RETURNING id;
    `);
    const sessionId = sessionRes.rows[0].id;

    // Run auto-checkout at 23:59:00 UTC on the same day
    await client.query(`
      SELECT public.cron_auto_checkout('${testDate} 23:59:00+00'::timestamptz);
    `);

    // Session MUST still be open (check_out_at IS NULL) because it is a night shift
    const check1 = await client.query(`
      SELECT check_out_at FROM public.attendance_sessions WHERE id = '${sessionId}';
    `);
    expect(check1.rows[0].check_out_at).toBeNull();

    // Clear cron_run_state so subsequent test run can process
    await client.query("DELETE FROM public.cron_run_state WHERE job_name = 'auto_checkout';");

    // Now run auto-checkout past the next-day night cutoff (e.g. 01:20:00 UTC on 2026-11-23)
    await client.query(`
      SELECT public.cron_auto_checkout('2026-11-23 01:20:00+00'::timestamptz);
    `);

    // Session SHOULD now be auto-closed
    const check2 = await client.query(`
      SELECT check_out_at, source FROM public.attendance_sessions WHERE id = '${sessionId}';
    `);
    expect(check2.rows[0].check_out_at).not.toBeNull();
    expect(check2.rows[0].source).toBe("auto");
  });
});

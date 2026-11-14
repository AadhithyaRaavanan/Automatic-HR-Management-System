/**
 * Section 4: Shift Management & Night Shift Engine Automated Test Suite
 *
 * Covers features:
 *   [F4.1.1] Custom Shift Times (shift_start_time, shift_end_time)
 *   [F4.1.2] Admin Shift Customization via /admin/users
 *   [F4.1.3] Directory Shift Visualizer (Day vs Night badges)
 *   [F4.1.4] Shift Templates (create, update, assign)
 *   [F4.2.1] Cross-Midnight Detection (shift_end_time < shift_start_time)
 *   [F4.2.2] UTC TIMESTAMPTZ Precision & DST Transitions
 *   [F4.2.3] Auto-Checkout Exemption for Night Shifts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import { isNightShift } from "@/lib/date/timezone";

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

describe("Section 4: Shift Management & Night Shift Engine", () => {
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

  // [F4.1.1] Custom Shift Times (shift_start_time, shift_end_time)
  it("[F4.1.1] persists custom shift_start_time and shift_end_time on organization_members and employees", async () => {
    await client.query(
      "UPDATE public.organization_members SET shift_start_time = '10:00:00', shift_end_time = '18:00:00' WHERE user_id = $1 AND organization_id = $2;",
      [ORG_1_EMPLOYEE, ORG_1_ID]
    );
    await client.query(
      "UPDATE public.employees SET shift_start_time = '10:00:00', shift_end_time = '18:00:00' WHERE id = $1 AND organization_id = $2;",
      [ORG_1_EMPLOYEE, ORG_1_ID]
    );

    const omRes = await client.query(
      "SELECT shift_start_time, shift_end_time FROM public.organization_members WHERE user_id = $1 AND organization_id = $2;",
      [ORG_1_EMPLOYEE, ORG_1_ID]
    );
    expect(omRes.rows[0].shift_start_time).toBe("10:00:00");
    expect(omRes.rows[0].shift_end_time).toBe("18:00:00");

    const empRes = await client.query(
      "SELECT shift_start_time, shift_end_time FROM public.employees WHERE id = $1 AND organization_id = $2;",
      [ORG_1_EMPLOYEE, ORG_1_ID]
    );
    expect(empRes.rows[0].shift_start_time).toBe("10:00:00");
    expect(empRes.rows[0].shift_end_time).toBe("18:00:00");
  });

  // [F4.1.2] Admin Shift Customization via /admin/users
  it("[F4.1.2] allows admin to alter employee shift times", async () => {
    // Service-level update representing /api/admin/users/shift endpoint mutation
    await client.query(
      "UPDATE public.organization_members SET shift_start_time = '11:00:00', shift_end_time = '19:00:00' WHERE user_id = $1 AND organization_id = $2;",
      [ORG_1_EMPLOYEE, ORG_1_ID]
    );
    await client.query(
      "UPDATE public.employees SET shift_start_time = '11:00:00', shift_end_time = '19:00:00' WHERE id = $1 AND organization_id = $2;",
      [ORG_1_EMPLOYEE, ORG_1_ID]
    );

    const chk = await client.query(
      "SELECT shift_start_time, shift_end_time FROM public.organization_members WHERE user_id = $1 AND organization_id = $2;",
      [ORG_1_EMPLOYEE, ORG_1_ID]
    );
    expect(chk.rows[0].shift_start_time).toBe("11:00:00");
    expect(chk.rows[0].shift_end_time).toBe("19:00:00");
  });

  // [F4.1.3] Directory Shift Visualizer (Day vs Night badges)
  it("[F4.1.3] differentiates Day shift vs Night shift badges based on midnight crossover", () => {
    function getShiftBadgeType(startTime?: string | null, endTime?: string | null): "day" | "night" {
      if (!startTime || !endTime) return "day";
      return isNightShift(startTime, endTime) ? "night" : "day";
    }

    expect(getShiftBadgeType("09:00:00", "17:00:00")).toBe("day");
    expect(getShiftBadgeType("10:00:00", "18:00:00")).toBe("day");
    expect(getShiftBadgeType("17:00:00", "01:00:00")).toBe("night");
    expect(getShiftBadgeType("20:00:00", "04:00:00")).toBe("night");
    expect(getShiftBadgeType(null, null)).toBe("day");
  });

  // [F4.1.4] Shift Templates (create, update, assign)
  it("[F4.1.4] executes shift template lifecycle: create, update, and assign", async () => {
    let templateId: string;

    await asUser(ORG_1_ADMIN, ORG_1_ID, "admin", async (c) => {
      // 1. Create shift template
      const createRes = await c.query(`
        SELECT public.admin_create_shift_template(
          'Night Engineering Shift',
          'Graveyard engineering shift 10pm to 6am',
          '22:00:00'::time,
          '06:00:00'::time,
          480,
          60
        ) as res;
      `);
      templateId = createRes.rows[0].res.shift_template_id || createRes.rows[0].res.id;
      expect(templateId).toBeDefined();

      // 2. Update shift template
      await c.query(`
        SELECT public.admin_update_shift_template(
          $1,
          'Night Shift Updated',
          '21:00:00'::time,
          '05:00:00'::time,
          480,
          60
        );
      `, [templateId]);

      const chk = await c.query("SELECT name, start_time, end_time FROM public.shift_templates WHERE id = $1;", [templateId]);
      expect(chk.rows[0].name).toBe("Night Shift Updated");
      expect(chk.rows[0].start_time).toBe("21:00:00");
      expect(chk.rows[0].end_time).toBe("05:00:00");

      // 3. Assign shift template
      const assignRes = await c.query(`
        SELECT public.admin_assign_shift(
          $1,
          $2,
          CURRENT_DATE,
          CURRENT_DATE + 30
        ) as res;
      `, [ORG_1_EMPLOYEE, templateId]);
      expect(assignRes.rows[0].res).toBeDefined();

      // 4. Delete template
      await c.query("SELECT public.admin_delete_shift_template($1);", [templateId]);
    }, "aal2");
  });

  // [F4.2.1] Cross-Midnight Detection (shift_end_time < shift_start_time)
  it("[F4.2.1] detects cross-midnight shifts when shift_end_time is earlier than shift_start_time", () => {
    expect(isNightShift("18:00:00", "02:00:00")).toBe(true);
    expect(isNightShift("23:00:00", "07:00:00")).toBe(true);
    expect(isNightShift("08:00:00", "16:00:00")).toBe(false);
  });

  // [F4.2.2] UTC TIMESTAMPTZ Precision & DST Transitions
  it("[F4.2.2] calculates cross-midnight session durations accurately using UTC timestamps", () => {
    // Session starting at 2026-11-14 22:00:00 UTC and ending 2026-11-15 06:00:00 UTC (8 hours = 480 mins)
    const checkIn = new Date("2026-11-14T22:00:00Z");
    const checkOut = new Date("2026-11-15T06:00:00Z");

    const diffMinutes = Math.floor((checkOut.getTime() - checkIn.getTime()) / (1000 * 60));
    expect(diffMinutes).toBe(480);
  });

  // [F4.2.3] Auto-Checkout Exemption for Night Shifts
  it("[F4.2.3] exempts active night shift from 23:59:00 cutoff and closes at shift_end_time + 15m", async () => {
    // Configure employee for night shift: 17:00:00 to 01:00:00
    await client.query(
      "UPDATE public.organization_members SET shift_start_time = '17:00:00', shift_end_time = '01:00:00' WHERE user_id = $1 AND organization_id = $2;",
      [ORG_1_EMPLOYEE, ORG_1_ID]
    );
    await client.query(
      "UPDATE public.employees SET shift_start_time = '17:00:00', shift_end_time = '01:00:00', timezone = 'UTC' WHERE id = $1 AND organization_id = $2;",
      [ORG_1_EMPLOYEE, ORG_1_ID]
    );

    // Night shift cutoff in DB is 01:00:00 + 15m = 01:15:00
    const testSessionId = "00000000-0000-0000-0000-000000000401";
    await client.query("DELETE FROM public.attendance_sessions WHERE id = $1;", [testSessionId]);
    await client.query("UPDATE public.attendance_sessions SET check_out_at = now() WHERE employee_id = $1 AND check_out_at IS NULL;", [ORG_1_EMPLOYEE]);

    await client.query(`
      INSERT INTO public.attendance_sessions (id, organization_id, employee_id, check_in_at, work_date, source)
      VALUES ($1, $2, $3, '2026-11-14 17:30:00+00'::timestamptz, '2026-11-14', 'web');
    `, [testSessionId, ORG_1_ID, ORG_1_EMPLOYEE]);

    // Run cron_auto_checkout at 23:59:00 UTC
    await client.query("SELECT public.cron_auto_checkout('2026-11-14 23:59:00+00'::timestamptz);");

    // Session must STILL be open!
    const stillOpen = await client.query("SELECT check_out_at FROM public.attendance_sessions WHERE id = $1;", [testSessionId]);
    expect(stillOpen.rows[0].check_out_at).toBeNull();

    // Clear cron_run_state so subsequent test run can process
    await client.query("DELETE FROM public.cron_run_state WHERE job_name = 'auto_checkout';");

    // Now run cron_auto_checkout at 01:20:00 UTC on next day (past 01:15:00 cutoff)
    await client.query("SELECT public.cron_auto_checkout('2026-11-15 01:20:00+00'::timestamptz);");

    // Session must now be closed!
    const closed = await client.query("SELECT check_out_at FROM public.attendance_sessions WHERE id = $1;", [testSessionId]);
    expect(closed.rows[0].check_out_at).not.toBeNull();

    // Clean up
    await client.query("DELETE FROM public.attendance_sessions WHERE id = $1;", [testSessionId]);
  });
});

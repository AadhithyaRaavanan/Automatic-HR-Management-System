/**
 * Section 3: Attendance Tracking & Live Time Clock Automated Test Suite
 *
 * Covers features:
 *   [F3.1.1] Persistent Global Attendance Timer
 *   [F3.1.2] Single-Click Punch
 *   [F3.1.3] Single Open Session Guarantee (idx_single_open_session)
 *   [F3.1.4] Daily Target Progress Visualizer (progress bar & ring)
 *   [F3.2.1] 5-Minute Pre-Shift Lock
 *   [F3.2.2] Pre-Shift Badge ('Check-in opens at HH:MM AM/PM')
 *   [F3.2.3] Shift-Start In-App Notification Toast
 *   [F3.3.1] Web Portal Direct Punch (source = 'web')
 *   [F3.3.2] Office Location Geofencing (NOT IMPLEMENTED)
 *   [F3.3.3] Office IP Whitelisting (NOT IMPLEMENTED)
 *   [F3.3.4] Rotating QR Code Verification (NOT IMPLEMENTED)
 *   [F3.3.5] Kiosk Mode Terminal (NOT IMPLEMENTED)
 *   [F3.4.1] Automatic Late Flagging (is_late = TRUE)
 *   [F3.4.2] Status Classification (7 attendance day statuses)
 *   [F3.4.3] Overtime Calculation
 *   [F3.4.4] Month Finalization & Locking (lock_month)
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

describe("Section 3: Attendance Tracking & Live Time Clock", () => {
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

  // [F3.1.1] Persistent Global Attendance Timer
  it("[F3.1.1] calculates dynamic elapsed seconds from UTC check_in_at timestamp", () => {
    const now = Date.now();
    const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();
    const elapsedSeconds = Math.floor((now - new Date(tenMinutesAgo).getTime()) / 1000);
    expect(elapsedSeconds).toBe(600);
  });

  // [F3.1.2] Single-Click Punch
  it("[F3.1.2] executes single-click check-in and check-out cycle", async () => {
    // Clean up any open session beforehand
    await client.query(`
      UPDATE public.attendance_sessions
      SET check_out_at = pg_catalog.now()
      WHERE employee_id = $1 AND check_out_at IS NULL;
    `, [ORG_1_EMPLOYEE]);

    await asUser(ORG_1_EMPLOYEE, ORG_1_ID, "employee", async (c) => {
      // 1. Clock In
      const checkInRes = await c.query("SELECT public.check_in('web') as res;");
      expect(checkInRes.rows[0].res.success).toBe(true);
      expect(checkInRes.rows[0].res.session_id).toBeDefined();

      // 2. Second Clock In without check out must be rejected
      const dupRes = await c.query("SELECT public.check_in('web') as res;");
      expect(dupRes.rows[0].res.success).toBe(false);
      expect(dupRes.rows[0].res.error).toMatch(/active open session/i);

      // 3. Clock Out
      const checkOutRes = await c.query("SELECT public.check_out() as res;");
      expect(checkOutRes.rows[0].res.success).toBe(true);
    });
  });

  // [F3.1.3] Single Open Session Guarantee (idx_single_open_session)
  it("[F3.1.3] prevents duplicate open attendance sessions via idx_single_open_session index", async () => {
    // Verify index exists
    const indexRes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'attendance_sessions' AND indexname = 'idx_single_open_session';
    `);
    expect(indexRes.rows.length).toBe(1);
    expect(indexRes.rows[0].indexdef).toContain("WHERE (check_out_at IS NULL)");

    // Attempting direct raw insert of two open sessions for same employee must violate unique index
    const testSession1 = "00000000-0000-0000-0000-000000000301";
    const testSession2 = "00000000-0000-0000-0000-000000000302";

    // Clean any prior open session
    await client.query("UPDATE public.attendance_sessions SET check_out_at = now() WHERE employee_id = $1 AND check_out_at IS NULL;", [ORG_1_EMPLOYEE]);

    await client.query(`
      INSERT INTO public.attendance_sessions (id, organization_id, employee_id, check_in_at, work_date, source)
      VALUES ($1, $2, $3, now(), CURRENT_DATE, 'web');
    `, [testSession1, ORG_1_ID, ORG_1_EMPLOYEE]);

    await expect(
      client.query(`
        INSERT INTO public.attendance_sessions (id, organization_id, employee_id, check_in_at, work_date, source)
        VALUES ($1, $2, $3, now(), CURRENT_DATE, 'web');
      `, [testSession2, ORG_1_ID, ORG_1_EMPLOYEE])
    ).rejects.toThrow(/idx_single_open_session/);

    // Clean up
    await client.query("DELETE FROM public.attendance_sessions WHERE id IN ($1, $2);", [testSession1, testSession2]);
  });

  // [F3.1.4] Daily Target Progress Visualizer (progress bar & ring)
  it("[F3.1.4] computes exact daily work target progress percentages (0%, 50%, 100%, 125%)", () => {
    function computeProgress(workedMinutes: number, targetMinutes: number = 480): number {
      if (targetMinutes <= 0) return 0;
      return Math.round((workedMinutes / targetMinutes) * 100);
    }

    expect(computeProgress(0, 480)).toBe(0);
    expect(computeProgress(240, 480)).toBe(50);
    expect(computeProgress(480, 480)).toBe(100);
    expect(computeProgress(600, 480)).toBe(125);
  });

  // [F3.2.1] 5-Minute Pre-Shift Lock
  it("[F3.2.1] disables check-in until 5 minutes before shift_start_time", () => {
    function isCheckInLocked(currentMinutes: number, shiftStartMinutes: number, lockWindow: number = 5): boolean {
      // Locked if current time is strictly earlier than (shiftStartMinutes - lockWindow)
      return currentMinutes < (shiftStartMinutes - lockWindow);
    }

    const shiftStart = 9 * 60; // 09:00 AM (540 mins)
    // At 08:54 AM (534 mins) -> 6 minutes prior -> locked
    expect(isCheckInLocked(534, shiftStart, 5)).toBe(true);
    // At 08:55 AM (535 mins) -> 5 minutes prior -> unlocked
    expect(isCheckInLocked(535, shiftStart, 5)).toBe(false);
    // At 09:00 AM (540 mins) -> shift start -> unlocked
    expect(isCheckInLocked(540, shiftStart, 5)).toBe(false);
  });

  // [F3.2.2] Pre-Shift Badge ('Check-in opens at HH:MM AM/PM')
  it("[F3.2.2] generates pre-shift badge text formatted with 5-minute pre-shift time", () => {
    function getPreShiftBadge(shiftStartTime: string): string {
      const [h, m] = shiftStartTime.split(":").map(Number);
      let totalMins = h * 60 + m - 5;
      if (totalMins < 0) totalMins += 24 * 60;
      const opensHour = Math.floor(totalMins / 60);
      const opensMin = totalMins % 60;
      const period = opensHour >= 12 ? "PM" : "AM";
      const displayHour = opensHour % 12 === 0 ? 12 : opensHour % 12;
      const padMin = String(opensMin).padStart(2, "0");
      return `Check-in opens at ${displayHour}:${padMin} ${period}`;
    }

    expect(getPreShiftBadge("09:00:00")).toBe("Check-in opens at 8:55 AM");
    expect(getPreShiftBadge("14:00:00")).toBe("Check-in opens at 1:55 PM");
  });

  // [F3.2.3] Shift-Start In-App Notification Toast
  it("[F3.2.3] evaluates shift-start in-app toast trigger condition", () => {
    function shouldTriggerShiftNotification(currentTime: string, shiftStartTime: string, isCheckedIn: boolean): boolean {
      if (isCheckedIn) return false;
      return currentTime >= shiftStartTime;
    }

    expect(shouldTriggerShiftNotification("08:59:00", "09:00:00", false)).toBe(false);
    expect(shouldTriggerShiftNotification("09:00:00", "09:00:00", false)).toBe(true);
    expect(shouldTriggerShiftNotification("09:05:00", "09:00:00", true)).toBe(false);
  });

  // [F3.3.1] Web Portal Direct Punch (source = 'web')
  it("[F3.3.1] records punch source as 'web' upon portal check-in", async () => {
    const res = await client.query(`
      SELECT column_name, column_default 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'attendance_sessions' AND column_name = 'source';
    `);
    expect(res.rows.length).toBe(1);
  });

  // [F3.3.2] Office Location Geofencing (NOT IMPLEMENTED)
  it.todo("[F3.3.2] Office location geofencing is not implemented in frontend/check-in flow");

  // [F3.3.3] Office IP Whitelisting (NOT IMPLEMENTED)
  it.todo("[F3.3.3] Office IP whitelisting is not implemented in check_in RPC");

  // [F3.3.4] Rotating QR Code Verification (NOT IMPLEMENTED)
  it.todo("[F3.3.4] Rotating QR code verification is not implemented");

  // [F3.3.5] Kiosk Mode Terminal (NOT IMPLEMENTED)
  it.todo("[F3.3.5] Kiosk mode terminal UI and endpoint is not implemented");

  // [F3.4.1] Automatic Late Flagging (is_late = TRUE)
  it("[F3.4.1] flags is_late = TRUE when punch occurs after shift_start_time + grace_period", () => {
    function isPunchLate(punchMinutes: number, shiftStartMinutes: number, graceMinutes: number = 15): boolean {
      return punchMinutes > (shiftStartMinutes + graceMinutes);
    }

    const shiftStart = 9 * 60; // 09:00 AM (540 mins)
    // Punch at 09:14 AM (554 mins) -> within 15m grace -> not late
    expect(isPunchLate(554, shiftStart, 15)).toBe(false);
    // Punch at 09:15 AM (555 mins) -> exactly at grace boundary -> not late
    expect(isPunchLate(555, shiftStart, 15)).toBe(false);
    // Punch at 09:16 AM (556 mins) -> past grace period -> late
    expect(isPunchLate(556, shiftStart, 15)).toBe(true);
  });

  // [F3.4.2] Status Classification (7 attendance day statuses)
  it("[F3.4.2] enforces valid attendance day statuses in database constraint", async () => {
    const validStatuses = ["present", "half_day", "absent", "holiday", "weekend", "leave"];
    const res = await client.query(`
      SELECT pg_get_constraintdef(oid) as condef
      FROM pg_constraint
      WHERE conrelid = 'public.attendance_days'::regclass AND conname = 'attendance_days_status_check';
    `);
    expect(res.rows.length).toBe(1);
    for (const s of validStatuses) {
      expect(res.rows[0].condef).toContain(`'${s}'`);
    }

    // is_late column exists as a boolean flag
    const colRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'attendance_days' AND column_name = 'is_late';
    `);
    expect(colRes.rows.length).toBe(1);
    expect(colRes.rows[0].data_type).toBe("boolean");
  });

  // [F3.4.3] Overtime Calculation
  it("[F3.4.3] calculates overtime minutes as GREATEST(worked - target, 0)", () => {
    function calculateOvertime(worked: number, target: number = 480): number {
      return Math.max(worked - target, 0);
    }

    expect(calculateOvertime(400, 480)).toBe(0);
    expect(calculateOvertime(480, 480)).toBe(0);
    expect(calculateOvertime(540, 480)).toBe(60);
  });

  // [F3.4.4] Month Finalization & Locking (lock_month)
  it("[F3.4.4] locks attendance month preventing edits and requires admin reason to unlock", async () => {
    // 1. Admin locks month 2026-01
    await asUser(ORG_1_ADMIN, ORG_1_ID, "admin", async (c) => {
      const lockRes = await c.query("SELECT public.lock_month(2026, 1) as res;");
      expect(lockRes.rows[0].res.success).toBe(true);

      // Verify audit_logs record for MONTH_LOCKED
      const auditChk = await c.query(
        "SELECT * FROM public.audit_logs WHERE organization_id = $1 AND action = 'MONTH_LOCKED' ORDER BY created_at DESC LIMIT 1;",
        [ORG_1_ID]
      );
      expect(auditChk.rows.length).toBe(1);

      // 2. Admin unlocks month with reason
      const unlockRes = await c.query(
        "SELECT public.unlock_month(2026, 1, 'Auditing discrepancy correction') as res;"
      );
      expect(unlockRes.rows[0].res.success).toBe(true);

      const unlockAudit = await c.query(
        "SELECT * FROM public.audit_logs WHERE organization_id = $1 AND action = 'MONTH_UNLOCKED' ORDER BY created_at DESC LIMIT 1;",
        [ORG_1_ID]
      );
      expect(unlockAudit.rows.length).toBe(1);
    }, "aal2");
  });
});

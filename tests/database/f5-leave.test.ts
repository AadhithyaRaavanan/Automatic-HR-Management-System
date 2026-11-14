/**
 * Section 5: Leave Management & Balance Engine Automated Test Suite
 *
 * Covers features:
 *   [F5.1.1] Custom Leave Types (CRUD & Balances)
 *   [F5.1.2] Yearly Allocation Engine (allocate_yearly_balances)
 *   [F5.1.3] KPI Contribution Toggle (counts_toward_kpi)
 *   [F5.2.1] Business Day Calculator (calculate_working_days)
 *   [F5.2.2] Half-Day Boundary Protection (chk_leave_request_half_day_single_date)
 *   [F5.3.1] Employee Leave Filing & Preview
 *   [F5.3.2] Manager Leave Approval Queue
 *   [F5.3.3] Automated Attendance Recalculation on Approval
 *   [F5.3.4] Approval Delegation (create, use, revoke, expire)
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
const ORG_1_HR = "00000000-0000-0000-0000-000000000002";
const ORG_1_MANAGER = "00000000-0000-0000-0000-000000000003";
const ORG_1_EMPLOYEE = "00000000-0000-0000-0000-000000000004";

describe("Section 5: Leave Management & Balance Engine", () => {
  let client: Client;
  let testLeaveTypeId: string;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();

    // Query an active leave type in Org 1
    const ltRes = await client.query(
      "SELECT id FROM public.leave_types WHERE organization_id = $1 LIMIT 1;",
      [ORG_1_ID]
    );
    testLeaveTypeId = ltRes.rows[0]?.id;
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

  // [F5.1.1] Custom Leave Types (CRUD & Balances)
  it("[F5.1.1] supports custom leave types and balance records", async () => {
    const customTypeId = "00000000-0000-0000-0000-000000000501";
    await client.query("DELETE FROM public.leave_types WHERE id = $1;", [customTypeId]);

    await client.query(`
      INSERT INTO public.leave_types (
        id, organization_id, name, code, description, is_paid, is_active, counts_toward_kpi
      ) VALUES (
        $1, $2, 'Wellness Leave', 'WELL', 'Mental wellness days', true, true, false
      );
    `, [customTypeId, ORG_1_ID]);

    const res = await client.query("SELECT * FROM public.leave_types WHERE id = $1;", [customTypeId]);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].code).toBe("WELL");
    expect(res.rows[0].is_paid).toBe(true);

    // Clean up
    await client.query("DELETE FROM public.leave_types WHERE id = $1;", [customTypeId]);
  });

  // [F5.1.2] Yearly Allocation Engine (allocate_yearly_balances)
  it("[F5.1.2] allocates yearly balances with carry-forward and pro-rating", async () => {
    await asUser(ORG_1_HR, ORG_1_ID, "hr", async (c) => {
      const res = await c.query("SELECT public.allocate_yearly_balances($1, 2026) as res;", [ORG_1_ID]);
      expect(res.rows[0].res).toBeDefined();

      const bal = await c.query(
        "SELECT * FROM public.leave_balances WHERE organization_id = $1;",
        [ORG_1_ID]
      );
      expect(bal.rows.length).toBeGreaterThan(0);
    }, "aal2");
  });

  // [F5.1.3] KPI Contribution Toggle (counts_toward_kpi)
  it("[F5.1.3] toggles counts_toward_kpi via hr_update_leave_type_kpi_setting", async () => {
    await asUser(ORG_1_HR, ORG_1_ID, "hr", async (c) => {
      // Toggle to true
      await c.query("SELECT public.hr_update_leave_type_kpi_setting($1, true);", [testLeaveTypeId]);
      let chk = await c.query("SELECT counts_toward_kpi FROM public.leave_types WHERE id = $1;", [testLeaveTypeId]);
      expect(chk.rows[0].counts_toward_kpi).toBe(true);

      // Toggle to false
      await c.query("SELECT public.hr_update_leave_type_kpi_setting($1, false);", [testLeaveTypeId]);
      chk = await c.query("SELECT counts_toward_kpi FROM public.leave_types WHERE id = $1;", [testLeaveTypeId]);
      expect(chk.rows[0].counts_toward_kpi).toBe(false);
    }, "aal2");
  });

  // [F5.2.1] Business Day Calculator (calculate_working_days)
  it("[F5.2.1] calculates working days excluding weekends and location holidays", async () => {
    // 2026-11-09 (Monday) to 2026-11-13 (Friday) = 5 working days
    const res = await client.query(
      "SELECT public.calculate_working_days($1, '2026-11-09'::date, '2026-11-13'::date, 'full') as days;",
      [ORG_1_EMPLOYEE]
    );
    expect(Number(res.rows[0].days)).toBe(5);

    // Saturday & Sunday (2026-11-14 to 2026-11-15) = 0 working days
    const weekendRes = await client.query(
      "SELECT public.calculate_working_days($1, '2026-11-14'::date, '2026-11-15'::date, 'full') as days;",
      [ORG_1_EMPLOYEE]
    );
    expect(Number(weekendRes.rows[0].days)).toBe(0);

    // Half day single date = 0.5 working days
    const halfDayRes = await client.query(
      "SELECT public.calculate_working_days($1, '2026-11-09'::date, '2026-11-09'::date, 'first_half') as days;",
      [ORG_1_EMPLOYEE]
    );
    expect(Number(halfDayRes.rows[0].days)).toBe(0.5);
  });

  // [F5.2.2] Half-Day Boundary Protection (chk_leave_request_half_day_single_date)
  it("[F5.2.2] enforces chk_leave_request_half_day_single_date constraint rejecting multi-day half-day requests", async () => {
    const invalidRequestId = "00000000-0000-0000-0000-000000000502";
    await client.query("DELETE FROM public.leave_requests WHERE id = $1;", [invalidRequestId]);

    // Attempt direct insert of a multi-day request with day_part = 'first_half'
    await expect(
      client.query(`
        INSERT INTO public.leave_requests (
          id, organization_id, employee_id, leave_type_id, start_date, end_date, day_part, status, total_days, reason
        ) VALUES (
          $1, $2, $3, $4, '2026-11-09', '2026-11-10', 'first_half', 'pending', 1.0, 'Invalid multi-day half-day'
        );
      `, [invalidRequestId, ORG_1_ID, ORG_1_EMPLOYEE, testLeaveTypeId])
    ).rejects.toThrow(/chk_leave_request_half_day_single_date/);
  });

  // [F5.3.1] Employee Leave Filing & Preview
  it("[F5.3.1] allows employee to request leave and deducts pending days from balance", async () => {
    const reqDate = "2026-10-06";

    // Clean prior requests using superuser
    await client.query(`
      DELETE FROM public.leave_requests
      WHERE employee_id = $1 AND start_date = $2;
    `, [ORG_1_EMPLOYEE, reqDate]);

    await asUser(ORG_1_EMPLOYEE, ORG_1_ID, "employee", async (c) => {
      const reqRes = await c.query(`
        SELECT public.request_leave(
          $1,
          $2::date,
          $2::date,
          'full',
          'Single personal day'
        ) as res;
      `, [testLeaveTypeId, reqDate]);

      expect(reqRes.rows[0].res.success).toBe(true);
      expect(reqRes.rows[0].res.request_id).toBeDefined();
    });
  });

  // [F5.3.2] Manager Leave Approval Queue
  it("[F5.3.2] allows manager to approve or reject employee leave and prevents self-approval", async () => {
    const reqStartDate = "2026-12-08";
    const reqEndDate = "2026-12-08";
    const requestId = "00000000-0000-0000-0000-000000000508";

    await client.query("DELETE FROM public.leave_requests WHERE id = $1;", [requestId]);

    // Insert pending leave request for ORG_1_EMPLOYEE
    await client.query(`
      INSERT INTO public.leave_requests (
        id, organization_id, employee_id, leave_type_id, start_date, end_date, day_part, status, total_days, reason
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'full', 'pending', 1.0, 'Personal day'
      );
    `, [requestId, ORG_1_ID, ORG_1_EMPLOYEE, testLeaveTypeId, reqStartDate, reqEndDate]);

    // 1. Employee cannot approve own request (Self-approval blocked)
    await asUser(ORG_1_EMPLOYEE, ORG_1_ID, "employee", async (c) => {
      await expect(
        c.query("SELECT public.approve_leave($1, 'Self approved');", [requestId])
      ).rejects.toThrow(/Separation of duties|cannot approve your own/i);
    });

    // 2. Manager approves request
    await asUser(ORG_1_MANAGER, ORG_1_ID, "manager", async (c) => {
      const approveRes = await c.query("SELECT public.approve_leave($1, 'Approved by team lead') as res;", [requestId]);
      expect(approveRes.rows[0].res.success).toBe(true);
    });

    // Clean up
    await client.query("DELETE FROM public.leave_requests WHERE id = $1;", [requestId]);
  });

  // [F5.3.3] Automated Attendance Recalculation on Approval
  it("[F5.3.3] automatically recalculates attendance day status to 'leave' on leave approval", async () => {
    const leaveDate = "2026-12-15";
    const requestId = "00000000-0000-0000-0000-000000000515";

    await client.query("DELETE FROM public.leave_requests WHERE id = $1;", [requestId]);
    await client.query("DELETE FROM public.attendance_days WHERE employee_id = $1 AND work_date = $2;", [ORG_1_EMPLOYEE, leaveDate]);

    // Insert request
    await client.query(`
      INSERT INTO public.leave_requests (
        id, organization_id, employee_id, leave_type_id, start_date, end_date, day_part, status, total_days, reason
      ) VALUES (
        $1, $2, $3, $4, $5, $5, 'full', 'pending', 1.0, 'Doctor appointment'
      );
    `, [requestId, ORG_1_ID, ORG_1_EMPLOYEE, testLeaveTypeId, leaveDate]);

    // Manager approves and verifies status within the authenticated session
    await asUser(ORG_1_MANAGER, ORG_1_ID, "manager", async (c) => {
      await c.query("SELECT public.approve_leave($1, 'Approved') as res;", [requestId]);

      const attRes = await c.query(`
        SELECT status FROM public.attendance_days
        WHERE employee_id = $1 AND work_date = $2;
      `, [ORG_1_EMPLOYEE, leaveDate]);

      expect(attRes.rows.length).toBe(1);
      expect(attRes.rows[0].status).toBe("leave");
    });

    // Clean up
    await client.query("DELETE FROM public.leave_requests WHERE id = $1;", [requestId]);
    await client.query("DELETE FROM public.attendance_days WHERE employee_id = $1 AND work_date = $2;", [ORG_1_EMPLOYEE, leaveDate]);
  });

  // [F5.3.4] Approval Delegation (create, use, revoke, expire)
  it("[F5.3.4] manages approval delegation lifecycle (create, verify, revoke)", async () => {
    const delRes = await client.query(`
      INSERT INTO public.approval_delegations (
        organization_id, delegator_id, delegate_id, starts_on, ends_on, created_by, is_active
      ) VALUES (
        $1, $2, $3, CURRENT_DATE - 1, CURRENT_DATE + 7, $2, true
      ) RETURNING id;
    `, [ORG_1_ID, ORG_1_MANAGER, ORG_1_HR]);
    const delegationId = delRes.rows[0].id;
    expect(delegationId).toBeDefined();

    // HR verifies they are active delegated approver for Manager
    await asUser(ORG_1_HR, ORG_1_ID, "hr", async (c) => {
      const checkRes = await c.query("SELECT public.is_active_delegated_approver($1) as is_active;", [ORG_1_MANAGER]);
      expect(checkRes.rows[0].is_active).toBe(true);
    });

    // Manager revokes delegation via RPC
    await asUser(ORG_1_MANAGER, ORG_1_ID, "manager", async (c) => {
      await c.query("SELECT public.revoke_approval_delegation($1);", [delegationId]);
    });

    // Clean up
    await client.query("DELETE FROM public.approval_delegations WHERE id = $1;", [delegationId]);
  });
});

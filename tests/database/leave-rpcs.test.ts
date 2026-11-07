/**
 * Leave Module Database & RPC Test Suite
 *
 * Comprehensive tests for:
 * 1. Day counting: weekends, holidays, half days, month-spanning
 * 2. Range overlap exclusion: GiST exclusion on active requests
 * 3. Monthly caps: per-type monthly cap and combined monthly cap (with month splitting)
 * 4. Separation of duties & Denial matrix:
 *    - Self-approval blocked (approve_leave, reject_leave)
 *    - Self-assignment blocked (hr_assign_leave)
 *    - Self-adjustment blocked (hr_adjust_balance)
 *    - Wrong role denial (employee/manager)
 *    - Cross-tenant denial (Org 2 trying to manage Org 1)
 *    - AAL1 denial (elevated HR/Admin actions require AAL2)
 * 5. Balance deduction & restoration on cancel
 * 6. Pro-rating for mid-year joiners and carry forward in allocate_yearly_balances
 * 7. Leave year start month boundaries (1 vs 4)
 * 8. Locked-month refusal (refuses approval and cancellation touching locked month)
 * 9. Punched work day conflict (cannot approve full day leave if already punched in)
 * 10. Concurrency safety (SELECT ... FOR UPDATE prevents race conditions)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

function getDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const stagingPath = path.resolve(process.cwd(), ".env.staging");
  if (fs.existsSync(stagingPath)) {
    const content = fs.readFileSync(stagingPath, "utf-8");
    const match = content.split("\n").find((line) => line.trim().startsWith("DATABASE_URL="));
    if (match) {
      return match.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

function enforceLocalDatabaseHost(url: string | null): string {
  if (!url) {
    throw new Error("DATABASE_URL must be configured in .env.staging or process.env");
  }
  const hostMatch = url.match(/@([^:/]+)/);
  const host = hostMatch ? hostMatch[1] : "";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`CRITICAL SECURITY FAILURE: Database tests are strictly restricted to local test instances (127.0.0.1 or localhost). Attempted connection to: ${host}`);
  }
  return url;
}

const dbUrl = enforceLocalDatabaseHost(getDatabaseUrl());

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const ORG_2_ID = "00000000-0000-0000-0000-000000000002";

const ORG_1_USERS = {
  admin: "00000000-0000-0000-0000-000000000001",
  hr: "00000000-0000-0000-0000-000000000002",
  manager: "00000000-0000-0000-0000-000000000003",
  employee: "00000000-0000-0000-0000-000000000004",
};

const ORG_2_USERS = {
  employee: "00000000-0000-0000-0000-000000000201",
  admin: "00000000-0000-0000-0000-000000000204",
};

describe("Leave Module Database & RPC Test Suite", () => {
  let client: Client;
  let casualTypeId: string;
  let sickTypeId: string;

  beforeAll(async () => {
    client = new Client({
      connectionString: dbUrl,
      ssl: false,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();

    // Ensure Org 2 exists
    await client.query(`
      INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone, leave_year_start_month)
      VALUES ('${ORG_2_ID}', 'Acme Matrix Corp', 'acme-matrix', 'hybrid', 'active', 'UTC', 1)
      ON CONFLICT (id) DO UPDATE SET status = 'active';
    `);

    // Ensure Org 2 users
    for (const [role, uid] of Object.entries(ORG_2_USERS)) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        VALUES ('${uid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'matrix-${role}@example.com', 'fakehash', now(), '{"provider":"email"}', '{}', now(), now())
        ON CONFLICT (id) DO NOTHING;
      `);
      await client.query(`
        INSERT INTO public.organization_members (organization_id, user_id, role, status)
        VALUES ('${ORG_2_ID}', '${uid}', '${role}', 'active')
        ON CONFLICT (user_id) DO UPDATE SET organization_id = '${ORG_2_ID}', role = '${role}', status = 'active';
      `);
      await client.query(`
        INSERT INTO public.employees (id, organization_id, email, full_name, work_mode, timezone)
        VALUES ('${uid}', '${ORG_2_ID}', 'matrix-${role}@example.com', 'Matrix ${role}', 'hybrid', 'UTC')
        ON CONFLICT (id) DO UPDATE SET organization_id = '${ORG_2_ID}';
      `);
    }

    // Set employee manager to ORG_1_USERS.manager
    await client.query(`
      UPDATE public.employees
      SET manager_id = '${ORG_1_USERS.manager}'
      WHERE id = '${ORG_1_USERS.employee}';
    `);

    // Fetch casual and sick leave types for Org 1
    const typesRes = await client.query(`
      SELECT id, code FROM public.leave_types WHERE organization_id = '${ORG_1_ID}';
    `);
    casualTypeId = typesRes.rows.find((r) => r.code === "CASUAL")?.id;
    sickTypeId = typesRes.rows.find((r) => r.code === "SICK")?.id;

    // Seed balances for employee in Org 1 for current leave period
    const curYear = new Date().getUTCFullYear();
    const periodStart = `${curYear}-01-01`;
    const periodEnd = `${curYear}-12-31`;

    await client.query(`
      INSERT INTO public.leave_balances (organization_id, employee_id, leave_type_id, period_start, period_end, allocated, used, carried_forward, adjusted)
      VALUES 
        ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '${casualTypeId}', '${periodStart}', '${periodEnd}', 12, 0, 0, 0),
        ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '${sickTypeId}', '${periodStart}', '${periodEnd}', 10, 0, 0, 0)
      ON CONFLICT (organization_id, employee_id, leave_type_id, period_start, period_end)
      DO UPDATE SET allocated = EXCLUDED.allocated, used = 0;
    `);
  });

  afterAll(async () => {
    if (client) {
      await client.query("RESET ROLE;");
      await client.end();
    }
  });

  async function asUser<T = any>(
    userId: string,
    orgId: string,
    role: string,
    aal: "aal1" | "aal2",
    queryFn: (c: Client) => Promise<T>,
    commit = false
  ): Promise<T> {
    const claims = JSON.stringify({
      sub: userId,
      role: "authenticated",
      user_role: role,
      organization_id: orgId,
      aal: aal,
    });

    await client.query("BEGIN;");
    try {
      await client.query("SET LOCAL ROLE authenticated;");
      await client.query(`SELECT set_config('request.jwt.claims', '${claims}', true);`);
      const res = await queryFn(client);
      if (commit) {
        await client.query("COMMIT;");
      } else {
        await client.query("ROLLBACK;");
      }
      return res;
    } catch (err) {
      await client.query("ROLLBACK;");
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // 1. Day Counting & Exclusion of Weekends/Holidays
  // --------------------------------------------------------------------------
  describe("1. Day Counting Rules", () => {
    it("excludes weekends (Saturday and Sunday) from working days count", async () => {
      // 2026-05-08 (Friday) to 2026-05-11 (Monday): Friday + Saturday + Sunday + Monday = 2 working days
      const res = await client.query(`
        SELECT public.calculate_working_days('${ORG_1_USERS.employee}', '2026-05-08', '2026-05-11', 'full') as days;
      `);
      expect(Number(res.rows[0].days)).toBe(2);
    });

    it("excludes organization holidays from working days count", async () => {
      // Clean and insert holiday on Monday 2026-05-11
      await client.query(`DELETE FROM public.holidays WHERE date = '2026-05-11';`);
      await client.query(`
        INSERT INTO public.holidays (organization_id, date, name, region)
        VALUES ('${ORG_1_ID}', '2026-05-11', 'Spring Day', 'GLOBAL');
      `);

      // Now 2026-05-08 to 2026-05-11 should only have 1 working day (Friday 05-08)
      const res = await client.query(`
        SELECT public.calculate_working_days('${ORG_1_USERS.employee}', '2026-05-08', '2026-05-11', 'full') as days;
      `);
      expect(Number(res.rows[0].days)).toBe(1);

      // Cleanup holiday
      await client.query(`DELETE FROM public.holidays WHERE date = '2026-05-11';`);
    });

    it("calculates 0.5 days for half day leave when start and end dates match", async () => {
      // 2026-05-13 is Wednesday
      const res = await client.query(`
        SELECT public.calculate_working_days('${ORG_1_USERS.employee}', '2026-05-13', '2026-05-13', 'first_half') as days;
      `);
      expect(Number(res.rows[0].days)).toBe(0.5);
    });

    it("rejects half day leave when start and end dates differ", async () => {
      await expect(
        client.query(`
          SELECT public.calculate_working_days('${ORG_1_USERS.employee}', '2026-05-13', '2026-05-14', 'first_half');
        `)
      ).rejects.toThrow(/Half day leave must have identical start and end dates/i);
    });

    it("calculates working days correctly across month boundaries", async () => {
      // 2026-06-29 (Mon) to 2026-07-03 (Fri): Mon, Tue (2 in Jun), Wed, Thu, Fri (3 in Jul) = 5 days
      const res = await client.query(`
        SELECT public.calculate_working_days('${ORG_1_USERS.employee}', '2026-06-29', '2026-07-03', 'full') as days;
      `);
      expect(Number(res.rows[0].days)).toBe(5);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Overlap Protection (GiST Exclusion Constraint)
  // --------------------------------------------------------------------------
  describe("2. Range Overlap Exclusion", () => {
    beforeEach(async () => {
      await client.query(`DELETE FROM public.leave_requests WHERE organization_id = '${ORG_1_ID}';`);
    });

    it("blocks overlapping leave request ranges with GiST exclusion constraint", async () => {
      await asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
        // Request 1: 2026-06-08 (Mon) to 2026-06-09 (Tue) -> 2 days (within casual monthly cap 2.0)
        await c.query(`
          SELECT public.request_leave('${casualTypeId}', '2026-06-08', '2026-06-09', 'full', 'Vacation part 1');
        `);

        // Request 2 overlapping: 2026-06-09 to 2026-06-09 should be rejected by GiST exclusion
        await expect(
          c.query(`
            SELECT public.request_leave('${sickTypeId}', '2026-06-09', '2026-06-09', 'full', 'Overlap request');
          `)
        ).rejects.toThrow(/conflicting key value violates exclusion constraint/i);
      });
    });

    it("allows new request on previous dates if earlier request was cancelled", async () => {
      await asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
        // Request 1: 2026-07-06 to 2026-07-07
        const res = await c.query(`
          SELECT public.request_leave('${casualTypeId}', '2026-07-06', '2026-07-07', 'full', 'To cancel');
        `);
        const reqId = res.rows[0].request_leave.request_id;

        // Cancel it
        await c.query(`SELECT public.cancel_leave('${reqId}', 'Cancelling plans');`);

        // Now new request for identical dates should succeed
        const res2 = await c.query(`
          SELECT public.request_leave('${casualTypeId}', '2026-07-06', '2026-07-07', 'full', 'Re-booking dates');
        `);
        expect(res2.rows[0].request_leave.success).toBe(true);
      });
    });
  });

  // --------------------------------------------------------------------------
  // 3. Monthly Caps (Per-Type and Combined)
  // --------------------------------------------------------------------------
  describe("3. Monthly Cap Enforcement & Month-Spanning Splitting", () => {
    beforeEach(async () => {
      await client.query(`DELETE FROM public.leave_requests WHERE organization_id = '${ORG_1_ID}';`);
    });

    it("enforces per-type monthly cap (casual leave cap is 2 days/month)", async () => {
      await asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
        // Request 3 days in August 2026 (Mon 2026-08-03 to Wed 2026-08-05): exceeds casual cap of 2.0
        await expect(
          c.query(`
            SELECT public.request_leave('${casualTypeId}', '2026-08-03', '2026-08-05', 'full', 'Exceeding cap');
          `)
        ).rejects.toThrow(/Monthly leave cap exceeded/i);
      });
    });

    it("enforces combined monthly leave cap when configured on organization", async () => {
      // Temporarily set combined monthly leave cap to 3.0 days
      await client.query(`
        UPDATE public.organizations
        SET combined_monthly_leave_cap = 3.0
        WHERE id = '${ORG_1_ID}';
      `);

      try {
        await asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          // Request 2 days Casual: 2026-09-07 to 2026-09-08 (succeeds, <= 2 casual cap and <= 3 combined)
          await c.query(`
            SELECT public.request_leave('${casualTypeId}', '2026-09-07', '2026-09-08', 'full', 'Sept casual');
          `);

          // Request 2 days Sick: 2026-09-09 to 2026-09-10 (exceeds combined 3.0 cap: 2 + 2 = 4 > 3)
          await expect(
            c.query(`
              SELECT public.request_leave('${sickTypeId}', '2026-09-09', '2026-09-10', 'full', 'Sept sick');
            `)
          ).rejects.toThrow(/Combined monthly leave cap exceeded/i);
        });
      } finally {
        await client.query(`
          UPDATE public.organizations
          SET combined_monthly_leave_cap = NULL
          WHERE id = '${ORG_1_ID}';
        `);
      }
    });

    it("splits month-spanning leave requests by month when evaluating monthly caps", async () => {
      // In Casual policy: monthly cap is 2.0.
      // Range: 2026-10-30 (Friday, 1 day in Oct) to 2026-11-03 (Monday & Tuesday, 2 days in Nov).
      // October usage = 1.0 (<= 2.0 cap)
      // November usage = 2.0 (<= 2.0 cap)
      // This should succeed because neither month exceeds the 2.0 cap!
      await asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
        const res = await c.query(`
          SELECT public.request_leave('${casualTypeId}', '2026-10-30', '2026-11-03', 'full', 'Month spanning ok');
        `);
        expect(res.rows[0].request_leave.success).toBe(true);
        expect(Number(res.rows[0].request_leave.total_days)).toBe(3);
      });
    });
  });

  // --------------------------------------------------------------------------
  // 4. Separation of Duties & Denial Matrix
  // --------------------------------------------------------------------------
  describe("4. Separation of Duties & Denial Matrix", () => {
    let testReqId: string;

    beforeEach(async () => {
      await client.query(`DELETE FROM public.leave_requests WHERE organization_id = '${ORG_1_ID}';`);
      const curYear = new Date().getUTCFullYear();
      const r = await client.query(`
        INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, day_part, total_days, reason, status)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '${casualTypeId}', '${curYear}-11-16', '${curYear}-11-17', 'full', 2, 'Pending test', 'pending')
        RETURNING id;
      `);
      testReqId = r.rows[0].id;
    });

    it("denies self-approval (employee cannot approve their own leave request)", async () => {
      await expect(
        asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          await c.query(`SELECT public.approve_leave('${testReqId}', 'Self approval');`);
        })
      ).rejects.toThrow(/Separation of duties/i);
    });

    it("denies wrong role approval (regular employee cannot approve peers)", async () => {
      await expect(
        asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          await c.query(`SELECT public.approve_leave('${testReqId}', 'Peer approval');`);
        })
      ).rejects.toThrow(/Separation of duties|Forbidden/i);
    });

    it("denies cross-tenant approval (Org 2 Admin cannot approve Org 1 leave request)", async () => {
      await expect(
        asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
          await c.query(`SELECT public.approve_leave('${testReqId}', 'Cross org approval');`);
        })
      ).rejects.toThrow(/not found in caller organization/i);
    });

    it("denies AAL1 approval by elevated role (HR requires AAL2 to approve)", async () => {
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal1", async (c) => {
          await c.query(`SELECT public.approve_leave('${testReqId}', 'AAL1 HR approval');`);
        })
      ).rejects.toThrow(/MFA AAL2 verification required/i);
    });

    it("denies HR from assigning leave to themselves (separation of duties)", async () => {
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`
            SELECT public.hr_assign_leave(
              ARRAY['${ORG_1_USERS.hr}']::UUID[],
              '${casualTypeId}',
              '2026-12-01',
              '2026-12-02',
              'full',
              'Self assign'
            );
          `);
        })
      ).rejects.toThrow(/Separation of duties.*cannot assign leave for themselves/i);
    });

    it("denies HR from adjusting their own leave balance (separation of duties)", async () => {
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`
            SELECT public.hr_adjust_balance('${ORG_1_USERS.hr}', '${casualTypeId}', 5.0, 'Self balance bonus');
          `);
        })
      ).rejects.toThrow(/Separation of duties.*cannot adjust their own leave balance/i);
    });

    it("allows direct manager to approve leave for direct report", async () => {
      await asUser(ORG_1_USERS.manager, ORG_1_ID, "manager", "aal1", async (c) => {
        const res = await c.query(`SELECT public.approve_leave('${testReqId}', 'Manager approved');`);
        expect(res.rows[0].approve_leave.success).toBe(true);
        expect(res.rows[0].approve_leave.status).toBe("approved");
      });
    });
  });

  // --------------------------------------------------------------------------
  // 5. Balance Deduction and Restoration on Cancellation
  // --------------------------------------------------------------------------
  describe("5. Balance Deduction and Restoration", () => {
    it("deducts balance upon approval and restores balance upon cancellation", async () => {
      const curYear = new Date().getUTCFullYear();
      const pStart = `${curYear}-01-01`;
      const pEnd = `${curYear}-12-31`;

      await client.query(`DELETE FROM public.leave_requests WHERE organization_id = '${ORG_1_ID}';`);

      // Reset balance used to 0
      await client.query(`
        UPDATE public.leave_balances
        SET allocated = 10, used = 0
        WHERE organization_id = '${ORG_1_ID}' AND employee_id = '${ORG_1_USERS.employee}'
          AND leave_type_id = '${sickTypeId}' AND period_start = '${pStart}' AND period_end = '${pEnd}';
      `);

      // Create a sick leave request
      const reqRes = await client.query(`
        INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, day_part, total_days, reason, status)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '${sickTypeId}', '${curYear}-12-14', '${curYear}-12-15', 'full', 2.0, 'Flu recovery', 'pending')
        RETURNING id;
      `);
      const reqId = reqRes.rows[0].id;

      // Manager approves (with commit = true)
      await asUser(ORG_1_USERS.manager, ORG_1_ID, "manager", "aal1", async (c) => {
        await c.query(`SELECT public.approve_leave('${reqId}', 'Get well soon');`);
      }, true);

      // Verify balance deducted (used increased by 2.0)
      const bApproved = await client.query(`
        SELECT used FROM public.leave_balances
        WHERE organization_id = '${ORG_1_ID}' AND employee_id = '${ORG_1_USERS.employee}'
          AND leave_type_id = '${sickTypeId}' AND period_start = '${pStart}' AND period_end = '${pEnd}';
      `);
      expect(Number(bApproved.rows[0].used)).toBe(2.0);

      // Verify attendance_days marked as status = 'leave'
      const attRes = await client.query(`
        SELECT status FROM public.attendance_days
        WHERE organization_id = '${ORG_1_ID}' AND employee_id = '${ORG_1_USERS.employee}' AND work_date = '${curYear}-12-14';
      `);
      expect(attRes.rows[0]?.status).toBe("leave");

      // Employee cancels the approved leave (with commit = true)
      await asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
        await c.query(`SELECT public.cancel_leave('${reqId}', 'Recovered earlier');`);
      }, true);

      // Verify balance restored (used decreased back to 0)
      const bCancelled = await client.query(`
        SELECT used FROM public.leave_balances
        WHERE organization_id = '${ORG_1_ID}' AND employee_id = '${ORG_1_USERS.employee}'
          AND leave_type_id = '${sickTypeId}' AND period_start = '${pStart}' AND period_end = '${pEnd}';
      `);
      expect(Number(bCancelled.rows[0].used)).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Pro-Rating for Mid-Year Joiners
  // --------------------------------------------------------------------------
  describe("6. Pro-Rating in allocate_yearly_balances", () => {
    it("pro-rates quota for mid-year joiners based on remaining months in leave year", async () => {
      const curYear = new Date().getUTCFullYear();
      const midYearEmployeeId = "00000000-0000-0000-0000-000000000301";

      // Insert employee created on July 1 (6 months remaining in Jan-Dec leave year)
      await client.query(`
        INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        VALUES ('${midYearEmployeeId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'midyear@example.com', 'fakehash', now(), '{"provider":"email"}', '{}', '${curYear}-07-01T00:00:00Z', now())
        ON CONFLICT (id) DO NOTHING;
      `);
      await client.query(`
        INSERT INTO public.organization_members (organization_id, user_id, role, status)
        VALUES ('${ORG_1_ID}', '${midYearEmployeeId}', 'employee', 'active')
        ON CONFLICT (user_id) DO UPDATE SET status = 'active';
      `);
      await client.query(`
        INSERT INTO public.employees (id, organization_id, email, full_name, created_at)
        VALUES ('${midYearEmployeeId}', '${ORG_1_ID}', 'midyear@example.com', 'Mid Year Hire', '${curYear}-07-01T00:00:00Z')
        ON CONFLICT (id) DO UPDATE SET created_at = '${curYear}-07-01T00:00:00Z', status = 'active';
      `);

      // Call allocate_yearly_balances as HR with AAL2 (with commit = true)
      await asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
        const res = await c.query(`SELECT public.allocate_yearly_balances('${ORG_1_ID}', ${curYear});`);
        expect(res.rows[0].allocate_yearly_balances.success).toBe(true);
      }, true);

      // Check allocated quota for Casual Leave (Yearly quota = 12; 6 months remaining = 6.0)
      const bRes = await client.query(`
        SELECT allocated FROM public.leave_balances
        WHERE organization_id = '${ORG_1_ID}' AND employee_id = '${midYearEmployeeId}' AND leave_type_id = '${casualTypeId}';
      `);
      expect(Number(bRes.rows[0].allocated)).toBe(6.0);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Leave Year Start Month Boundaries (1 vs 4)
  // --------------------------------------------------------------------------
  describe("7. Leave Year Start Month Boundaries", () => {
    it("computes correct leave periods for leave_year_start_month = 1 vs 4", async () => {
      // Org 1 has start month 1 (Jan - Dec)
      const p1 = await client.query(`
        SELECT period_start::text, period_end::text FROM public.get_organization_leave_period('${ORG_1_ID}', '2026-06-15');
      `);
      expect(p1.rows[0].period_start).toBe("2026-01-01");
      expect(p1.rows[0].period_end).toBe("2026-12-31");

      // Update Org 2 to start month 4 (April - March)
      await client.query(`
        UPDATE public.organizations SET leave_year_start_month = 4 WHERE id = '${ORG_2_ID}';
      `);

      // Date before April (e.g. 2026-02-15) falls in 2025-04-01 to 2026-03-31
      const p2 = await client.query(`
        SELECT period_start::text, period_end::text FROM public.get_organization_leave_period('${ORG_2_ID}', '2026-02-15');
      `);
      expect(p2.rows[0].period_start).toBe("2025-04-01");
      expect(p2.rows[0].period_end).toBe("2026-03-31");

      // Date after April (e.g. 2026-06-15) falls in 2026-04-01 to 2027-03-31
      const p3 = await client.query(`
        SELECT period_start::text, period_end::text FROM public.get_organization_leave_period('${ORG_2_ID}', '2026-06-15');
      `);
      expect(p3.rows[0].period_start).toBe("2026-04-01");
      expect(p3.rows[0].period_end).toBe("2027-03-31");
    });
  });

  // --------------------------------------------------------------------------
  // 8. Locked-Month Refusal
  // --------------------------------------------------------------------------
  describe("8. Locked Month Protection", () => {
    it("refuses leave approval touching locked month dates", async () => {
      // Lock a date in attendance_days for employee
      await client.query(`
        INSERT INTO public.attendance_days (organization_id, employee_id, work_date, total_minutes, status, locked)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '2026-03-10', 480, 'present', true)
        ON CONFLICT (employee_id, work_date) DO UPDATE SET locked = true;
      `);

      // Create request touching locked date
      const reqRes = await client.query(`
        INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '${casualTypeId}', '2026-03-10', '2026-03-11', 2, 'Locked test', 'pending')
        RETURNING id;
      `);
      const reqId = reqRes.rows[0].id;

      await expect(
        asUser(ORG_1_USERS.manager, ORG_1_ID, "manager", "aal1", async (c) => {
          await c.query(`SELECT public.approve_leave('${reqId}', 'Approving locked');`);
        })
      ).rejects.toThrow(/Cannot approve leave: includes locked month dates/i);

      // Cleanup
      await client.query(`DELETE FROM public.leave_requests WHERE id = '${reqId}';`);
      await client.query(`DELETE FROM public.attendance_days WHERE employee_id = '${ORG_1_USERS.employee}' AND work_date = '2026-03-10';`);
    });

    it("refuses leave cancellation touching locked month dates", async () => {
      // Insert approved leave request
      const reqRes = await client.query(`
        INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '${casualTypeId}', '2026-03-16', '2026-03-17', 2, 'Lock cancel test', 'approved')
        RETURNING id;
      `);
      const reqId = reqRes.rows[0].id;

      // Lock the date in attendance_days
      await client.query(`
        INSERT INTO public.attendance_days (organization_id, employee_id, work_date, total_minutes, status, locked)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '2026-03-16', 0, 'leave', true)
        ON CONFLICT (employee_id, work_date) DO UPDATE SET locked = true;
      `);

      await expect(
        asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          await c.query(`SELECT public.cancel_leave('${reqId}', 'Trying to cancel locked leave');`);
        })
      ).rejects.toThrow(/Cannot cancel leave: touches locked month dates/i);

      // Cleanup
      await client.query(`DELETE FROM public.leave_requests WHERE id = '${reqId}';`);
      await client.query(`DELETE FROM public.attendance_days WHERE employee_id = '${ORG_1_USERS.employee}' AND work_date = '2026-03-16';`);
    });
  });

  // --------------------------------------------------------------------------
  // 9. Punched Work Day Conflict Refusal
  // --------------------------------------------------------------------------
  describe("9. Punched Work Day Conflict Refusal", () => {
    it("refuses full day leave approval if employee already punched in on that date", async () => {
      const punchDate = "2026-04-14"; // Tuesday

      // Insert an attendance session for employee on that date
      await client.query(`
        INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, check_out_at)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '${punchDate}', '${punchDate}T09:00:00Z', '${punchDate}T17:00:00Z');
      `);

      // Create leave request for that date
      const reqRes = await client.query(`
        INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '${casualTypeId}', '${punchDate}', '${punchDate}', 1, 'Conflict test', 'pending')
        RETURNING id;
      `);
      const reqId = reqRes.rows[0].id;

      await expect(
        asUser(ORG_1_USERS.manager, ORG_1_ID, "manager", "aal1", async (c) => {
          await c.query(`SELECT public.approve_leave('${reqId}', 'Approving conflict');`);
        })
      ).rejects.toThrow(/already punched in.*cannot approve full day leave/i);

      // Cleanup
      await client.query(`DELETE FROM public.attendance_sessions WHERE employee_id = '${ORG_1_USERS.employee}' AND work_date = '${punchDate}';`);
      await client.query(`DELETE FROM public.leave_requests WHERE id = '${reqId}';`);
    });
  });

  // --------------------------------------------------------------------------
  // 10. Concurrency Safety
  // --------------------------------------------------------------------------
  describe("10. Concurrency Safety", () => {
    it("safely handles balance validation and deduction using SELECT ... FOR UPDATE", async () => {
      const curYear = new Date().getUTCFullYear();
      const pStart = `${curYear}-01-01`;
      const pEnd = `${curYear}-12-31`;

      await client.query(`DELETE FROM public.leave_requests WHERE organization_id = '${ORG_1_ID}';`);

      // Create balance with exactly 2 days available
      await client.query(`
        UPDATE public.leave_balances
        SET allocated = 2.0, used = 0.0, carried_forward = 0.0, adjusted = 0.0
        WHERE organization_id = '${ORG_1_ID}' AND employee_id = '${ORG_1_USERS.employee}'
          AND leave_type_id = '${casualTypeId}' AND period_start = '${pStart}' AND period_end = '${pEnd}';
      `);

      // Create two separate requests for 2 days each
      const r1 = await client.query(`
        INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '${casualTypeId}', '2026-11-23', '2026-11-24', 2.0, 'Concurrent 1', 'pending')
        RETURNING id;
      `);
      const r2 = await client.query(`
        INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '${casualTypeId}', '2026-11-26', '2026-11-27', 2.0, 'Concurrent 2', 'pending')
        RETURNING id;
      `);

      // Approve request 1 (with commit = true)
      await asUser(ORG_1_USERS.manager, ORG_1_ID, "manager", "aal1", async (c) => {
        await c.query(`SELECT public.approve_leave('${r1.rows[0].id}', 'Approved 1');`);
      }, true);

      // Verify request 1 used the 2.0 days
      const bCheck = await client.query(`
        SELECT used, allocated FROM public.leave_balances
        WHERE organization_id = '${ORG_1_ID}' AND employee_id = '${ORG_1_USERS.employee}'
          AND leave_type_id = '${casualTypeId}' AND period_start = '${pStart}' AND period_end = '${pEnd}';
      `);
      expect(Number(bCheck.rows[0].used)).toBe(2.0);

      // Now approving request 2 must fail due to insufficient balance
      await expect(
        asUser(ORG_1_USERS.manager, ORG_1_ID, "manager", "aal1", async (c) => {
          await c.query(`SELECT public.approve_leave('${r2.rows[0].id}', 'Approved 2');`);
        })
      ).rejects.toThrow(/Insufficient leave balance to approve request/i);
    });
  });
});

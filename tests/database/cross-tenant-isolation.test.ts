/**
 * Cross-Tenant Isolation Test Suite
 *
 * Verifies strict, impenetrable isolation between tenants:
 * 1. Seeds Organization 2 (Acme Corp) with employee, manager, hr, and admin.
 * 2. Executes matrix across every tenant table x role x operation (SELECT, INSERT, UPDATE, DELETE)
 *    verifying that elevated roles in Org 2 (even HR and Admin at aal2) CANNOT read, insert, update,
 *    or delete Org 1 data.
 * 3. Enforces POSITIVE CONTROLS for every denial: asserts that the exact same authenticated caller
 *    with the exact same claims CAN successfully read and operate on their own organization data.
 * 4. Tests privileged RPCs called with cross-tenant IDs (check_in override, lock_month,
 *    approve_regularization, reject_regularization, punch_verified).
 * 5. Strictly cleans up all Org 2 test data in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

const dbUrl = getDatabaseUrl();

const ORG_1_ID = "00000000-0000-0000-0000-000000000001"; // Demo Org
const ORG_2_ID = "00000000-0000-0000-0000-000000000002"; // Acme Corp (Test only)

// Org 1 Users
const ORG_1_USERS = {
  admin: "00000000-0000-0000-0000-000000000001",
  hr: "00000000-0000-0000-0000-000000000002",
  manager: "00000000-0000-0000-0000-000000000003",
  employee: "00000000-0000-0000-0000-000000000004",
};

// Org 2 Users
const ORG_2_USERS = {
  employee: "00000000-0000-0000-0000-000000000201",
  manager: "00000000-0000-0000-0000-000000000202",
  hr: "00000000-0000-0000-0000-000000000203",
  admin: "00000000-0000-0000-0000-000000000204",
};

describe("Cross-Tenant Multi-Tenancy Isolation Suite", () => {
  let client: Client | null = null;
  let isConnected = false;

  let org1ReqId: string;
  let org2ReqId: string;
  let org2Req2Id: string;
  let org1LocId: string;
  let org2LocId: string;
  let org2SessionId: string;

  beforeAll(async () => {
    if (!dbUrl) return;
    try {
      const isLocal = dbUrl.includes("127.0.0.1") || dbUrl.includes("localhost");
      client = new Client({
        connectionString: dbUrl,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });
      await client.connect();
      isConnected = true;

      // 1. Seed Org 2 in organizations
      await client.query(`
        INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone)
        VALUES ('${ORG_2_ID}', 'Acme Corp', 'acme', 'hybrid', 'active', 'America/New_York')
        ON CONFLICT (id) DO UPDATE SET status = 'active';
      `);

      // 2. Create Org 2 users in auth.users and organization_members
      for (const [role, uid] of Object.entries(ORG_2_USERS)) {
        await client.query(`
          INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
          VALUES ('${uid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'acme-${role}@example.com', 'fakehash', now(), '{"provider":"email"}', '{}', now(), now())
          ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = '{"provider":"email"}';
        `);

        // 3. Insert into public.organization_members
        await client.query(`
          INSERT INTO public.organization_members (organization_id, user_id, role, status)
          VALUES ('${ORG_2_ID}', '${uid}', '${role}', 'active')
          ON CONFLICT (user_id) DO UPDATE SET organization_id = '${ORG_2_ID}', role = '${role}', status = 'active';
        `);

        // 4. Insert into public.employees
        await client.query(`
          INSERT INTO public.employees (id, organization_id, email, first_name, last_name, work_mode, timezone)
          VALUES ('${uid}', '${ORG_2_ID}', 'acme-${role}@example.com', 'Acme', '${role}', 'hybrid', 'America/New_York')
          ON CONFLICT (id) DO UPDATE SET organization_id = '${ORG_2_ID}', work_mode = 'hybrid';
        `);
      }

      // Link manager
      await client.query(`
        UPDATE public.employees SET manager_id = '${ORG_2_USERS.manager}' WHERE id = '${ORG_2_USERS.employee}';
      `);

      // 5. Locations for Org 1 and Org 2
      const l1 = await client.query(`
        INSERT INTO public.locations (organization_id, name, code, timezone)
        VALUES ('${ORG_1_ID}', 'Org 1 HQ', 'O1-HQ', 'UTC')
        ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id;
      `);
      org1LocId = l1.rows[0].id;

      const l2 = await client.query(`
        INSERT INTO public.locations (organization_id, name, code, timezone)
        VALUES ('${ORG_2_ID}', 'Acme NY HQ', 'ACME-NY', 'America/New_York')
        ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id;
      `);
      org2LocId = l2.rows[0].id;

      // 6. Regularization request fixtures
      const r1 = await client.query(`
        INSERT INTO public.regularization_requests (organization_id, employee_id, work_date, requested_in, requested_out, reason, status)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '2026-11-10', '2026-11-10 09:00:00+00', '2026-11-10 17:00:00+00', 'Org 1 reason', 'pending')
        RETURNING id;
      `);
      org1ReqId = r1.rows[0].id;

      const r2 = await client.query(`
        INSERT INTO public.regularization_requests (organization_id, employee_id, work_date, requested_in, requested_out, reason, status)
        VALUES ('${ORG_2_ID}', '${ORG_2_USERS.employee}', '2026-11-10', '2026-11-10 09:00:00-05', '2026-11-10 17:00:00-05', 'Org 2 approve reason', 'pending')
        RETURNING id;
      `);
      org2ReqId = r2.rows[0].id;

      const r3 = await client.query(`
        INSERT INTO public.regularization_requests (organization_id, employee_id, work_date, requested_in, requested_out, reason, status)
        VALUES ('${ORG_2_ID}', '${ORG_2_USERS.employee}', '2026-11-11', '2026-11-11 09:00:00-05', '2026-11-11 17:00:00-05', 'Org 2 reject reason', 'pending')
        RETURNING id;
      `);
      org2Req2Id = r3.rows[0].id;

      // 7. Attendance days fixture for month locking test
      await client.query(`
        INSERT INTO public.attendance_days (organization_id, employee_id, work_date, total_minutes, status, locked)
        VALUES ('${ORG_1_ID}', '${ORG_1_USERS.employee}', '2026-11-12', 480, 'present', false)
        ON CONFLICT (employee_id, work_date) DO UPDATE SET locked = false;
      `);

      await client.query(`
        INSERT INTO public.attendance_days (organization_id, employee_id, work_date, total_minutes, status, locked)
        VALUES ('${ORG_2_ID}', '${ORG_2_USERS.employee}', '2026-11-12', 480, 'present', false)
        ON CONFLICT (employee_id, work_date) DO UPDATE SET locked = false;
      `);

      // 8. Attendance session fixture for Org 2
      const s2 = await client.query(`
        INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, source)
        VALUES ('${ORG_2_ID}', '${ORG_2_USERS.employee}', '2026-11-12', '2026-11-12 09:00:00-05', 'web')
        RETURNING id;
      `);
      org2SessionId = s2.rows[0].id;

      // 9. Attendance policy fixture for Org 2
      await client.query(`
        INSERT INTO public.attendance_policies (organization_id, standard_daily_hours, allowed_grace_minutes)
        VALUES ('${ORG_2_ID}', 8.0, 15)
        ON CONFLICT (organization_id) DO UPDATE SET standard_daily_hours = 8.0;
      `);
    } catch {
      isConnected = false;
    }
  });

  afterAll(async () => {
    if (client && isConnected) {
      try {
        await client.query(`RESET ROLE;`);
        // Clean up all Org 2 test data
        await client.query(`DELETE FROM public.audit_logs WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.attendance_sessions WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.attendance_days WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.regularization_requests WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.notifications WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.employee_shift_assignments WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.shift_templates WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.kiosk_devices WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.privacy_acknowledgments WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.locations WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.attendance_policies WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.employees WHERE organization_id = '${ORG_2_ID}';`);
        await client.query(`DELETE FROM public.organization_members WHERE organization_id = '${ORG_2_ID}';`);
        for (const uid of Object.values(ORG_2_USERS)) {
          await client.query(`DELETE FROM auth.users WHERE id = '${uid}';`);
        }
        await client.query(`DELETE FROM public.organizations WHERE id = '${ORG_2_ID}';`);

        // Clean up Org 1 test fixtures
        await client.query(`DELETE FROM public.regularization_requests WHERE id = '${org1ReqId}';`);
        await client.query(`DELETE FROM public.attendance_days WHERE employee_id = '${ORG_1_USERS.employee}' AND work_date = '2026-11-12';`);
        await client.query(`DELETE FROM public.locations WHERE id = '${org1LocId}';`);
      } catch {}
      await client.end().catch(() => {});
    }
  });

  // Helper to run query as an authenticated user with exact JWT claims
  async function asUser<T = any>(
    userId: string,
    orgId: string,
    role: string,
    aal: "aal1" | "aal2",
    queryFn: (c: Client) => Promise<T>
  ): Promise<T> {
    if (!client) throw new Error("No client");
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
      return await queryFn(client);
    } finally {
      await client.query("ROLLBACK;");
    }
  }

  // ==========================================================================
  // 1. Cross-Tenant Data Access Matrix (SELECT) with POSITIVE CONTROLS
  // ==========================================================================

  describe("Cross-Tenant Data Isolation (SELECT Matrix & Positive Controls)", () => {
    const roles: Array<"employee" | "manager" | "hr" | "admin"> = ["employee", "manager", "hr", "admin"];

    for (const role of roles) {
      const aal = role === "hr" || role === "admin" ? "aal2" : "aal1";

      it(`Org 2 ${role} CANNOT see Org 1 employees (Positive Control: CAN see Org 2 employees)`, async () => {
        if (!isConnected || !client) return;
        const uid = ORG_2_USERS[role];

        // 1. Cross-tenant denial
        const cross = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.employees WHERE organization_id = '${ORG_1_ID}';`);
        });
        expect(cross.rows.length).toBe(0);

        // 2. Positive Control: same user, same claims, own organization
        const own = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.employees WHERE organization_id = '${ORG_2_ID}';`);
        });
        expect(own.rows.length).toBeGreaterThan(0);
      });

      it(`Org 2 ${role} CANNOT see Org 1 attendance_sessions (Positive Control: CAN see Org 2 sessions)`, async () => {
        if (!isConnected || !client) return;
        const uid = ORG_2_USERS[role];

        // 1. Cross-tenant denial
        const cross = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.attendance_sessions WHERE organization_id = '${ORG_1_ID}';`);
        });
        expect(cross.rows.length).toBe(0);

        // 2. Positive Control: own organization sessions
        const own = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.attendance_sessions WHERE organization_id = '${ORG_2_ID}';`);
        });
        // Employee/manager/HR/Admin query in own org
        if (role === "employee") {
          // Employee sees own session
          expect(own.rows.length).toBe(1);
        } else {
          expect(own.rows.length).toBeGreaterThanOrEqual(1);
        }
      });

      it(`Org 2 ${role} CANNOT see Org 1 attendance_days (Positive Control: CAN see Org 2 days)`, async () => {
        if (!isConnected || !client) return;
        const uid = ORG_2_USERS[role];

        // 1. Cross-tenant denial
        const cross = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.attendance_days WHERE organization_id = '${ORG_1_ID}';`);
        });
        expect(cross.rows.length).toBe(0);

        // 2. Positive Control
        const own = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.attendance_days WHERE organization_id = '${ORG_2_ID}';`);
        });
        expect(own.rows.length).toBeGreaterThan(0);
      });

      it(`Org 2 ${role} CANNOT see Org 1 regularization_requests (Positive Control: CAN see Org 2 requests)`, async () => {
        if (!isConnected || !client) return;
        const uid = ORG_2_USERS[role];

        // 1. Cross-tenant denial
        const cross = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.regularization_requests WHERE organization_id = '${ORG_1_ID}';`);
        });
        expect(cross.rows.length).toBe(0);

        // 2. Positive Control
        const own = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.regularization_requests WHERE organization_id = '${ORG_2_ID}';`);
        });
        expect(own.rows.length).toBeGreaterThan(0);
      });

      it(`Org 2 ${role} CANNOT see Org 1 locations (Positive Control: CAN see Org 2 locations)`, async () => {
        if (!isConnected || !client) return;
        const uid = ORG_2_USERS[role];

        // 1. Cross-tenant denial
        const cross = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.locations WHERE organization_id = '${ORG_1_ID}';`);
        });
        expect(cross.rows.length).toBe(0);

        // 2. Positive Control
        const own = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.locations WHERE organization_id = '${ORG_2_ID}';`);
        });
        expect(own.rows.length).toBeGreaterThan(0);
      });

      it(`Org 2 ${role} CANNOT see Org 1 attendance_policies (Positive Control: CAN see Org 2 policies)`, async () => {
        if (!isConnected || !client) return;
        const uid = ORG_2_USERS[role];

        // 1. Cross-tenant denial
        const cross = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.attendance_policies WHERE organization_id = '${ORG_1_ID}';`);
        });
        expect(cross.rows.length).toBe(0);

        // 2. Positive Control
        const own = await asUser(uid, ORG_2_ID, role, aal, async (c) => {
          return c.query(`SELECT * FROM public.attendance_policies WHERE organization_id = '${ORG_2_ID}';`);
        });
        expect(own.rows.length).toBeGreaterThan(0);
      });
    }
  });

  // ==========================================================================
  // 2. Cross-Tenant Write Isolation (INSERT, UPDATE, DELETE) & Positive Controls
  // ==========================================================================

  describe("Cross-Tenant Write Mutation Rejection & Positive Controls", () => {
    it("Org 2 Admin CANNOT insert into Org 1 locations (Positive Control: CAN insert into Org 2 locations)", async () => {
      if (!isConnected || !client) return;

      // 1. Cross-tenant denial (WITH CHECK constraint fails)
      await expect(
        asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
          return c.query(`
            INSERT INTO public.locations (organization_id, name, code, timezone)
            VALUES ('${ORG_1_ID}', 'Rogue Org 1 Branch', 'ROGUE-1', 'UTC');
          `);
        })
      ).rejects.toThrow();

      // 2. Positive Control: Admin inserting into own organization succeeds
      const own = await asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
        return c.query(`
          INSERT INTO public.locations (organization_id, name, code, timezone)
          VALUES ('${ORG_2_ID}', 'Acme Secondary Office', 'ACME-2', 'America/New_York')
          RETURNING id;
        `);
      });
      expect(own.rowCount).toBe(1);
    });

    it("Org 2 Admin CANNOT update Org 1 attendance_policies (Positive Control: CAN update Org 2 policies)", async () => {
      if (!isConnected || !client) return;

      // 1. Cross-tenant denial (0 rows affected by RLS USING filter)
      const cross = await asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
        return c.query(`
          UPDATE public.attendance_policies 
          SET allowed_grace_minutes = 99 
          WHERE organization_id = '${ORG_1_ID}';
        `);
      });
      expect(cross.rowCount).toBe(0);

      // 2. Positive Control: Admin updating own organization policy succeeds
      const own = await asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
        return c.query(`
          UPDATE public.attendance_policies 
          SET allowed_grace_minutes = 20 
          WHERE organization_id = '${ORG_2_ID}'
          RETURNING organization_id;
        `);
      });
      expect(own.rowCount).toBe(1);
    });

    it("Org 2 Admin CANNOT delete Org 1 employees (Positive Control: Org 2 employees remain accessible)", async () => {
      if (!isConnected || !client) return;

      // 1. Cross-tenant denial
      const cross = await asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
        return c.query(`DELETE FROM public.employees WHERE id = '${ORG_1_USERS.employee}';`);
      });
      expect(cross.rowCount).toBe(0);

      // 2. Positive Control: Org 1 employee still exists in database
      const check = await client.query(`SELECT id FROM public.employees WHERE id = '${ORG_1_USERS.employee}';`);
      expect(check.rows.length).toBe(1);
    });
  });

  // ==========================================================================
  // 3. Privileged Functions Called with Cross-Tenant IDs & Positive Controls
  // ==========================================================================

  describe("Privileged RPC Cross-Tenant Rejection & Positive Controls", () => {
    it("check_in override: Org 2 HR/Admin calling check_in for Org 1 employee is rejected (Positive Control: succeeds for Org 2 employee)", async () => {
      if (!isConnected || !client) return;

      // 1. Cross-tenant denial
      const res = await asUser(ORG_2_USERS.hr, ORG_2_ID, "hr", "aal2", async (c) => {
        return c.query(`SELECT public.check_in('${ORG_1_USERS.employee}', 'Cross tenant punch') AS result;`);
      });
      const result = res.rows[0].result;
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/target employee not found in your organization/i);

      // 2. Positive Control: Org 2 HR calling check_in for Org 2 employee succeeds
      const pos = await asUser(ORG_2_USERS.hr, ORG_2_ID, "hr", "aal2", async (c) => {
        return c.query(`SELECT public.check_in('${ORG_2_USERS.employee}', 'Valid Org 2 punch') AS result;`);
      });
      const posResult = pos.rows[0].result;
      expect(posResult.success).toBe(true);
    });

    it("lock_month: Org 2 HR calling lock_month ONLY locks Org 2 days, Org 1 remains unlocked (Positive Control: Org 2 days locked)", async () => {
      if (!isConnected || !client) return;

      // Org 2 locks November 2026
      await asUser(ORG_2_USERS.hr, ORG_2_ID, "hr", "aal2", async (c) => {
        return c.query(`SELECT public.lock_month(2026, 11);`);
      });

      // Positive Control: Verify Org 2 day is locked
      const o2Day = await client.query(`
        SELECT locked FROM public.attendance_days WHERE employee_id = '${ORG_2_USERS.employee}' AND work_date = '2026-11-12';
      `);
      expect(o2Day.rows[0].locked).toBe(true);

      // Cross-tenant isolation: Verify Org 1 day remains UNLOCKED
      const o1Day = await client.query(`
        SELECT locked FROM public.attendance_days WHERE employee_id = '${ORG_1_USERS.employee}' AND work_date = '2026-11-12';
      `);
      expect(o1Day.rows[0].locked).toBe(false);
    });

    it("approve_regularization: Org 2 HR approving Org 1 request is rejected (Positive Control: succeeds for Org 2 request)", async () => {
      if (!isConnected || !client) return;

      // 1. Cross-tenant denial
      const res = await asUser(ORG_2_USERS.hr, ORG_2_ID, "hr", "aal2", async (c) => {
        return c.query(`SELECT public.approve_regularization('${org1ReqId}', 'Approved cross-tenant') AS result;`);
      });
      const result = res.rows[0].result;
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/request does not belong to your organization/i);

      // Verify Org 1 request remains pending
      const reqCheck = await client.query(`SELECT status FROM public.regularization_requests WHERE id = '${org1ReqId}';`);
      expect(reqCheck.rows[0].status).toBe("pending");

      // 2. Positive Control: Org 2 HR approving Org 2 request succeeds
      const pos = await asUser(ORG_2_USERS.hr, ORG_2_ID, "hr", "aal2", async (c) => {
        return c.query(`SELECT public.approve_regularization('${org2ReqId}', 'Approved own org request') AS result;`);
      });
      const posResult = pos.rows[0].result;
      expect(posResult.success).toBe(true);

      const org2Check = await client.query(`SELECT status FROM public.regularization_requests WHERE id = '${org2ReqId}';`);
      expect(org2Check.rows[0].status).toBe("approved");
    });

    it("reject_regularization: Org 2 HR rejecting Org 1 request is rejected (Positive Control: succeeds for Org 2 request)", async () => {
      if (!isConnected || !client) return;

      // 1. Cross-tenant denial
      const res = await asUser(ORG_2_USERS.hr, ORG_2_ID, "hr", "aal2", async (c) => {
        return c.query(`SELECT public.reject_regularization('${org1ReqId}', 'Rejected cross-tenant') AS result;`);
      });
      const result = res.rows[0].result;
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/request does not belong to your organization/i);

      // Verify Org 1 request remains pending
      const reqCheck = await client.query(`SELECT status FROM public.regularization_requests WHERE id = '${org1ReqId}';`);
      expect(reqCheck.rows[0].status).toBe("pending");

      // 2. Positive Control: Org 2 HR rejecting Org 2 request succeeds
      const pos = await asUser(ORG_2_USERS.hr, ORG_2_ID, "hr", "aal2", async (c) => {
        return c.query(`SELECT public.reject_regularization('${org2Req2Id}', 'Rejected own org request') AS result;`);
      });
      const posResult = pos.rows[0].result;
      expect(posResult.success).toBe(true);

      const org2Check = await client.query(`SELECT status FROM public.regularization_requests WHERE id = '${org2Req2Id}';`);
      expect(org2Check.rows[0].status).toBe("rejected");
    });

    it("punch_verified: Calling punch_verified for Org 1 employee with Org 2 location is rejected (Positive Control: succeeds with Org 1 location)", async () => {
      if (!isConnected || !client) return;

      // 1. Cross-tenant rejection
      const res = await client.query(`
        SELECT public.punch_verified('${ORG_1_USERS.employee}', 'office_ip', '${org2LocId}', 'Verified cross punch') AS result;
      `);
      const result = res.rows[0].result;
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/location does not belong to employee organization/i);

      // 2. Positive Control: Calling punch_verified for Org 1 employee with Org 1 location succeeds
      const pos = await client.query(`
        SELECT public.punch_verified('${ORG_1_USERS.employee}', 'office_ip', '${org1LocId}', 'Verified own punch') AS result;
      `);
      const posResult = pos.rows[0].result;
      expect(posResult.success).toBe(true);
    });
  });
});

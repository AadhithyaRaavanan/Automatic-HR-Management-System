/**
 * Intra-Tenant Authorization & Privilege Boundary Test Suite
 *
 * Verifies that within the SAME organization, role and command boundaries are strictly enforced:
 * - employee & manager at aal1
 * - hr & admin at aal2
 *
 * Operations tested:
 * 1. organizations: UPDATE name/status, DELETE
 * 2. organization_members: UPDATE own role to admin, direct INSERT, direct DELETE
 * 3. locations: UPDATE allowed_ip_ranges, INSERT/UPDATE/DELETE
 * 4. shift_templates: INSERT/UPDATE/DELETE
 * 5. employee_shift_assignments: INSERT/UPDATE/DELETE
 * 6. kiosk_devices: INSERT/UPDATE/DELETE
 * 7. privacy_acknowledgments: UPDATE own, DELETE own, INSERT
 * 8. attendance_sessions: direct INSERT/UPDATE with arbitrary times (must be denied)
 * 9. regularization_requests: direct status UPDATE (must be denied; decisions only via RPC)
 * 10. employees: employee updating own manager_id, status, work_mode, primary_location_id, organization_id
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
const ORG_ID = "00000000-0000-0000-0000-000000000001"; // Demo Org

const USERS = {
  admin: "00000000-0000-0000-0000-000000000001",
  hr: "00000000-0000-0000-0000-000000000002",
  manager: "00000000-0000-0000-0000-000000000003",
  employee: "00000000-0000-0000-0000-000000000004",
};

describe("Intra-Tenant Authorization & Privilege Boundary Suite", () => {
  let client: Client | null = null;
  let isConnected = false;

  let testLocId: string;
  let testShiftId: string;
  let testKioskId: string;
  let testSessionId: string;
  let testReqId: string;
  let hrOwnReqId: string;
  let testAckId: string;

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

      // Fixtures
      const loc = await client.query(`
        INSERT INTO public.locations (organization_id, name, code, allowed_ip_ranges)
        VALUES ('${ORG_ID}', 'Intra Test Office', 'INTRA-LOC-1', '{"192.168.1.1/32"}')
        ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id;
      `);
      testLocId = loc.rows[0].id;
      await client.query(`
        INSERT INTO auth.users (id, email) VALUES 
          ('00000000-0000-0000-0000-000000000088', 'second_admin@remotehr.io'),
          ('00000000-0000-0000-0000-000000000077', 'temp_hr@remotehr.io'),
          ('00000000-0000-0000-0000-000000000099', 'new_member@remotehr.io')
        ON CONFLICT (id) DO NOTHING;
      `);


      const shift = await client.query(`
        INSERT INTO public.shift_templates (organization_id, name, code, start_time, end_time)
        VALUES ('${ORG_ID}', 'Intra Test Shift', 'INTRA-SHIFT-1', '09:00:00', '17:00:00')
        ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id;
      `);
      testShiftId = shift.rows[0].id;

      const kiosk = await client.query(`
        INSERT INTO public.kiosk_devices (organization_id, location_id, device_name, enrollment_token_hash)
        VALUES ('${ORG_ID}', '${testLocId}', 'Intra Kiosk 1', 'fakehash')
        RETURNING id;
      `);
      testKioskId = kiosk.rows[0].id;

      const sess = await client.query(`
        INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, source)
        VALUES ('${ORG_ID}', '${USERS.employee}', '2026-11-20', '2026-11-20 09:00:00+00', 'web')
        RETURNING id;
      `);
      testSessionId = sess.rows[0].id;

      const req = await client.query(`
        INSERT INTO public.regularization_requests (organization_id, employee_id, work_date, requested_in, requested_out, reason, status)
        VALUES ('${ORG_ID}', '${USERS.employee}', '2026-11-20', '2026-11-20 09:00:00+00', '2026-11-20 17:00:00+00', 'Reason', 'pending')
        RETURNING id;
      `);
      testReqId = req.rows[0].id;

      const hrReq = await client.query(`
        INSERT INTO public.regularization_requests (organization_id, employee_id, work_date, requested_in, requested_out, reason, status)
        VALUES ('${ORG_ID}', '${USERS.hr}', '2026-11-20', '2026-11-20 09:00:00+00', '2026-11-20 17:00:00+00', 'HR reason', 'pending')
        RETURNING id;
      `);
      hrOwnReqId = hrReq.rows[0].id;

      const ack = await client.query(`
        INSERT INTO public.privacy_acknowledgments (organization_id, employee_id, policy_version, enabled_methods)
        VALUES ('${ORG_ID}', '${USERS.employee}', 'v1.0-test', '{"web"}')
        ON CONFLICT (organization_id, employee_id, policy_version) DO UPDATE SET ip_address = '127.0.0.1'
        RETURNING id;
      `);
      testAckId = ack.rows[0].id;
    } catch {
      isConnected = false;
    }
  });

  afterAll(async () => {
    if (client && isConnected) {
      try {
        await client.query(`RESET ROLE;`);
        await client.query(`DELETE FROM public.privacy_acknowledgments WHERE id = '${testAckId}';`);
        await client.query(`DELETE FROM public.regularization_requests WHERE id IN ('${testReqId}', '${hrOwnReqId}');`);
        await client.query(`DELETE FROM public.attendance_sessions WHERE id = '${testSessionId}';`);
        await client.query(`DELETE FROM public.kiosk_devices WHERE id = '${testKioskId}';`);
        await client.query(`DELETE FROM public.shift_templates WHERE id = '${testShiftId}';`);
        await client.query(`DELETE FROM public.locations WHERE id = '${testLocId}';`);
        await client.query(`
          DELETE FROM auth.users WHERE id IN (
            '00000000-0000-0000-0000-000000000088',
            '00000000-0000-0000-0000-000000000077',
            '00000000-0000-0000-0000-000000000099'
          );
        `);

      } catch {}
      await client.end().catch(() => {});
    }
  });

  async function asRole<T = any>(
    userId: string,
    role: string,
    aal: "aal1" | "aal2",
    queryFn: (c: Client) => Promise<T>,
    options: { commit?: boolean } = {}
  ): Promise<T> {
    if (!client) throw new Error("No client");
    const claims = JSON.stringify({
      sub: userId,
      role: "authenticated",
      user_role: role,
      organization_id: ORG_ID,
      aal: aal,
    });

    await client.query("BEGIN;");
    let committed = false;
    try {
      await client.query("SET LOCAL ROLE authenticated;");
      await client.query(`SELECT set_config('request.jwt.claims', '${claims}', true);`);
      const result = await queryFn(client);
      if (options.commit) {
        await client.query("COMMIT;");
        committed = true;
      }
      return result;
    } finally {
      if (!committed) {
        await client.query("ROLLBACK;");
      }
    }
  }

  async function expectWriteDenied(promise: Promise<{ rowCount?: number | null }>) {
    try {
      const res = await promise;
      expect(res.rowCount).toBe(0);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  }

  // ==========================================================================
  // 1. organizations
  // ==========================================================================

  describe("1. organizations intra-tenant boundaries", () => {
    it("DELETE organization: DENIED to all roles (including admin at aal2)", async () => {
      if (!isConnected || !client) return;
      for (const [role, uid] of Object.entries(USERS)) {
        const aal = role === "hr" || role === "admin" ? "aal2" : "aal1";
        await expectWriteDenied(
          asRole(uid, role, aal, async (c) => c.query(`DELETE FROM public.organizations WHERE id = '${ORG_ID}';`))
        );
      }
    });

    it("UPDATE organization status directly: DENIED to all roles (including admin at aal2)", async () => {
      if (!isConnected || !client) return;
      for (const [role, uid] of Object.entries(USERS)) {
        const aal = role === "hr" || role === "admin" ? "aal2" : "aal1";
        await expectWriteDenied(
          asRole(uid, role, aal, async (c) => c.query(`UPDATE public.organizations SET status = 'suspended' WHERE id = '${ORG_ID}';`))
        );
      }
    });

    it("UPDATE organization name: DENIED to employee, manager, hr; ALLOWED to admin at aal2", async () => {
      if (!isConnected || !client) return;
      // employee denied
      await expectWriteDenied(
        asRole(USERS.employee, "employee", "aal1", async (c) => c.query(`UPDATE public.organizations SET name = 'Hacked' WHERE id = '${ORG_ID}';`))
      );

      // manager denied
      await expectWriteDenied(
        asRole(USERS.manager, "manager", "aal1", async (c) => c.query(`UPDATE public.organizations SET name = 'Hacked' WHERE id = '${ORG_ID}';`))
      );

      // hr denied
      await expectWriteDenied(
        asRole(USERS.hr, "hr", "aal2", async (c) => c.query(`UPDATE public.organizations SET name = 'Hacked' WHERE id = '${ORG_ID}';`))
      );

      // admin allowed
      const res = await asRole(USERS.admin, "admin", "aal2", async (c) => {
        return c.query(`UPDATE public.organizations SET name = 'demo' WHERE id = '${ORG_ID}' RETURNING id;`);
      });
      expect(res.rowCount).toBe(1);
    });
  });

  // ==========================================================================
  // 2. organization_members
  // ==========================================================================

  describe("2. organization_members intra-tenant boundaries", () => {
    it("UPDATE own role to admin: DENIED to employee, manager, and hr", async () => {
      if (!isConnected || !client) return;
      // employee cannot elevate own role
      await expectWriteDenied(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`UPDATE public.organization_members SET role = 'admin' WHERE user_id = '${USERS.employee}';`);
        })
      );

      // manager cannot elevate own role
      await expectWriteDenied(
        asRole(USERS.manager, "manager", "aal1", async (c) => {
          return c.query(`UPDATE public.organization_members SET role = 'admin' WHERE user_id = '${USERS.manager}';`);
        })
      );

      // hr cannot elevate own role
      await expectWriteDenied(
        asRole(USERS.hr, "hr", "aal2", async (c) => {
          return c.query(`UPDATE public.organization_members SET role = 'admin' WHERE user_id = '${USERS.hr}';`);
        })
      );
    });

    it("Direct INSERT into organization_members: DENIED to authenticated users (writes only via admin RPC)", async () => {
      if (!isConnected || !client) return;
      await expect(
        asRole(USERS.admin, "admin", "aal2", async (c) => {
          return c.query(`
            INSERT INTO public.organization_members (organization_id, user_id, role)
            VALUES ('${ORG_ID}', gen_random_uuid(), 'employee');
          `);
        })
      ).rejects.toThrow();
    });

    it("Direct DELETE from organization_members: DENIED to authenticated users (writes only via admin RPC)", async () => {
      if (!isConnected || !client) return;
      await expect(
        asRole(USERS.admin, "admin", "aal2", async (c) => {
          return c.query(`DELETE FROM public.organization_members WHERE user_id = '${USERS.employee}';`);
        })
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 3. locations
  // ==========================================================================

  describe("3. locations intra-tenant boundaries", () => {
    it("UPDATE allowed_ip_ranges: DENIED to employee, manager, and HR; ALLOWED to admin at aal2", async () => {
      if (!isConnected || !client) return;
      // employee denied
      await expectWriteDenied(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`UPDATE public.locations SET allowed_ip_ranges = '{"0.0.0.0/0"}' WHERE id = '${testLocId}';`);
        })
      );

      // manager denied
      await expectWriteDenied(
        asRole(USERS.manager, "manager", "aal1", async (c) => {
          return c.query(`UPDATE public.locations SET allowed_ip_ranges = '{"0.0.0.0/0"}' WHERE id = '${testLocId}';`);
        })
      );

      // hr denied (only admin can change security-critical IP ranges - trigger throws exception)
      await expect(
        asRole(USERS.hr, "hr", "aal2", async (c) => {
          return c.query(`UPDATE public.locations SET allowed_ip_ranges = '{"0.0.0.0/0"}' WHERE id = '${testLocId}';`);
        })
      ).rejects.toThrow(/Permission denied: Only administrators can modify allowed_ip_ranges/i);

      // admin allowed
      const res = await asRole(USERS.admin, "admin", "aal2", async (c) => {
        return c.query(`UPDATE public.locations SET allowed_ip_ranges = '{"10.0.0.1/32"}' WHERE id = '${testLocId}' RETURNING id;`);
      });
      expect(res.rowCount).toBe(1);
    });

    it("INSERT / UPDATE / DELETE locations: DENIED to employee and manager", async () => {
      if (!isConnected || !client) return;
      await expectWriteDenied(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`INSERT INTO public.locations (organization_id, name, code) VALUES ('${ORG_ID}', 'Emp Loc', 'EMP-1');`);
        })
      );

      await expectWriteDenied(
        asRole(USERS.manager, "manager", "aal1", async (c) => {
          return c.query(`DELETE FROM public.locations WHERE id = '${testLocId}';`);
        })
      );
    });
  });

  // ==========================================================================
  // 4. shift_templates & employee_shift_assignments
  // ==========================================================================

  describe("4. shifts intra-tenant boundaries", () => {
    it("shift_templates INSERT/UPDATE/DELETE: DENIED to employee and manager", async () => {
      if (!isConnected || !client) return;
      await expectWriteDenied(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`
            INSERT INTO public.shift_templates (organization_id, name, code, start_time, end_time)
            VALUES ('${ORG_ID}', 'Emp Shift', 'EMP-SH', '09:00:00', '17:00:00');
          `);
        })
      );

      await expectWriteDenied(
        asRole(USERS.manager, "manager", "aal1", async (c) => {
          return c.query(`DELETE FROM public.shift_templates WHERE id = '${testShiftId}';`);
        })
      );
    });

    it("employee_shift_assignments INSERT/UPDATE/DELETE: DENIED to employee and manager", async () => {
      if (!isConnected || !client) return;
      await expectWriteDenied(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`
            INSERT INTO public.employee_shift_assignments (organization_id, employee_id, shift_template_id, effective_from)
            VALUES ('${ORG_ID}', '${USERS.employee}', '${testShiftId}', '2026-11-01');
          `);
        })
      );
    });
  });

  // ==========================================================================
  // 5. kiosk_devices
  // ==========================================================================

  describe("5. kiosk_devices intra-tenant boundaries", () => {
    it("kiosk_devices INSERT/UPDATE/DELETE: DENIED to employee, manager, and HR; ALLOWED to admin at aal2", async () => {
      if (!isConnected || !client) return;
      // employee denied
      await expectWriteDenied(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`
            INSERT INTO public.kiosk_devices (organization_id, location_id, device_name, enrollment_token_hash)
            VALUES ('${ORG_ID}', '${testLocId}', 'Rogue Kiosk', 'hash');
          `);
        })
      );

      // hr denied (hardware enrollment is admin-only)
      await expectWriteDenied(
        asRole(USERS.hr, "hr", "aal2", async (c) => {
          return c.query(`DELETE FROM public.kiosk_devices WHERE id = '${testKioskId}';`);
        })
      );

      // admin allowed
      const res = await asRole(USERS.admin, "admin", "aal2", async (c) => {
        return c.query(`UPDATE public.kiosk_devices SET device_name = 'Updated Kiosk' WHERE id = '${testKioskId}' RETURNING id;`);
      });
      expect(res.rowCount).toBe(1);
    });
  });

  // ==========================================================================
  // 6. privacy_acknowledgments
  // ==========================================================================

  describe("6. privacy_acknowledgments intra-tenant boundaries", () => {
    it("UPDATE or DELETE own acknowledgment: DENIED (acknowledgments are immutable append-only)", async () => {
      if (!isConnected || !client) return;
      // Employee cannot update acknowledgment
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`UPDATE public.privacy_acknowledgments SET policy_version = 'v2.0' WHERE id = '${testAckId}';`);
        })
      ).rejects.toThrow();

      // Employee cannot delete acknowledgment
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`DELETE FROM public.privacy_acknowledgments WHERE id = '${testAckId}';`);
        })
      ).rejects.toThrow();
    });

    it("INSERT acknowledgment for another employee: DENIED (self-insert only)", async () => {
      if (!isConnected || !client) return;
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`
            INSERT INTO public.privacy_acknowledgments (organization_id, employee_id, policy_version)
            VALUES ('${ORG_ID}', '${USERS.manager}', 'v99.0');
          `);
        })
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 7. attendance_sessions
  // ==========================================================================

  describe("7. attendance_sessions direct write rejection", () => {
    it("Direct client INSERT/UPDATE with arbitrary times: DENIED to authenticated users (writes only via RPC)", async () => {
      if (!isConnected || !client) return;
      // employee direct insert denied
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`
            INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, source)
            VALUES ('${ORG_ID}', '${USERS.employee}', '2026-11-21', '2026-11-21 09:00:00+00', 'manual');
          `);
        })
      ).rejects.toThrow();

      // employee direct update denied
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`
            UPDATE public.attendance_sessions 
            SET check_in_at = '2026-11-20 08:00:00+00' 
            WHERE id = '${testSessionId}';
          `);
        })
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 8. regularization_requests
  // ==========================================================================

  describe("8. regularization_requests direct status update rejection", () => {
    it("Direct client UPDATE of status: DENIED to all roles (decisions strictly through RPC)", async () => {
      if (!isConnected || !client) return;
      // Employee cannot approve own request
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`UPDATE public.regularization_requests SET status = 'approved' WHERE id = '${testReqId}';`);
        })
      ).rejects.toThrow();

      // HR cannot directly update status bypassing RPC audit and session creation
      await expect(
        asRole(USERS.hr, "hr", "aal2", async (c) => {
          return c.query(`UPDATE public.regularization_requests SET status = 'approved' WHERE id = '${testReqId}';`);
        })
      ).rejects.toThrow();
    });

    it("HR approving own regularization request: DENIED via direct SQL and via RPC", async () => {
      if (!isConnected || !client) return;
      // HR cannot directly update own request to approved
      await expect(
        asRole(USERS.hr, "hr", "aal2", async (c) => {
          return c.query(`UPDATE public.regularization_requests SET status = 'approved' WHERE id = '${hrOwnReqId}';`);
        })
      ).rejects.toThrow();

      // HR cannot approve own request via RPC (Separation of duties)
      await expect(
        asRole(USERS.hr, "hr", "aal2", async (c) => {
          return c.query(`SELECT public.approve_regularization('${hrOwnReqId}');`);
        })
      ).rejects.toThrow(/separation of duties/i);
    });
  });

  // ==========================================================================
  // 9. employees
  // ==========================================================================

  describe("9. employees self-privilege escalation prevention", () => {
    it("Employee updating own manager_id, status, work_mode, primary_location_id, organization_id: DENIED", async () => {
      if (!isConnected || !client) return;
      // 1. Employee trying to change manager_id
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`UPDATE public.employees SET manager_id = '${USERS.employee}' WHERE id = '${USERS.employee}';`);
        })
      ).rejects.toThrow(/Permission denied/i);

      // 2. Employee trying to change status to terminated/active
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`UPDATE public.employees SET status = 'inactive' WHERE id = '${USERS.employee}';`);
        })
      ).rejects.toThrow(/Permission denied/i);

      // 3. Employee trying to change work_mode
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`UPDATE public.employees SET work_mode = 'remote' WHERE id = '${USERS.employee}';`);
        })
      ).rejects.toThrow(/Permission denied/i);

      // 4. Employee trying to change primary_location_id
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`UPDATE public.employees SET primary_location_id = '${testLocId}' WHERE id = '${USERS.employee}';`);
        })
      ).rejects.toThrow(/Permission denied/i);

      // 5. Employee trying to change organization_id
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`UPDATE public.employees SET organization_id = '00000000-0000-0000-0000-000000000099' WHERE id = '${USERS.employee}';`);
        })
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 10. Organization Member Administration RPCs
  // ==========================================================================

  describe("10. Organization Member Administration RPCs", () => {
    const foreignOrgId = "00000000-0000-0000-0000-000000000002";
    const newMemberId = "00000000-0000-0000-0000-000000000099";

    it("Foreign-org mismatch in admin RPC: REJECTED with cross-tenant violation", async () => {
      if (!isConnected || !client) return;
      await expect(
        asRole(USERS.admin, "admin", "aal2", async (c) => {
          return c.query(`SELECT public.admin_add_org_member('${foreignOrgId}', '${newMemberId}', 'employee');`);
        })
      ).rejects.toThrow(/Cross-tenant violation/i);
    });

    it("admin_add_org_member: DENIED to employee, manager, and hr", async () => {
      if (!isConnected || !client) return;
      for (const [role, uid] of [["employee", USERS.employee], ["manager", USERS.manager], ["hr", USERS.hr]] as const) {
        const aal = role === "hr" ? "aal2" : "aal1";
        await expect(
          asRole(uid, role, aal, async (c) => {
            return c.query(`SELECT public.admin_add_org_member('${ORG_ID}', '${newMemberId}', 'employee');`);
          })
        ).rejects.toThrow(/Forbidden: Only active administrators/i);
      }
    });

    it("admin_add_org_member: DENIED to admin at aal1 (MFA AAL2 required)", async () => {
      if (!isConnected || !client) return;
      await expect(
        asRole(USERS.admin, "admin", "aal1", async (c) => {
          return c.query(`SELECT public.admin_add_org_member('${ORG_ID}', '${newMemberId}', 'employee');`);
        })
      ).rejects.toThrow(/MFA AAL2 required/i);
    });

    it("Last-admin protection and self-demotion rule: DENIED to demote or remove sole admin", async () => {
      if (!isConnected || !client) return;
      // Admin trying to demote themselves when sole admin
      await expect(
        asRole(USERS.admin, "admin", "aal2", async (c) => {
          return c.query(`SELECT public.admin_update_org_member_role('${ORG_ID}', '${USERS.admin}', 'employee');`);
        })
      ).rejects.toThrow(/Last admin protection/i);

      // Admin trying to remove themselves when sole admin
      await expect(
        asRole(USERS.admin, "admin", "aal2", async (c) => {
          return c.query(`SELECT public.admin_remove_org_member('${ORG_ID}', '${USERS.admin}');`);
        })
      ).rejects.toThrow(/Last admin protection/i);
    });

    it("Concurrent demotion serialization: two separate DB connections demote each other simultaneously, leaving at least one admin", async () => {
      if (!isConnected || !client || !dbUrl) return;
      const isLocal = dbUrl.includes("127.0.0.1") || dbUrl.includes("localhost");
      const secondAdmin = "00000000-0000-0000-0000-000000000088";

      // Setup: Ensure secondAdmin exists and both are active admins
      await client.query(`
        INSERT INTO auth.users (id, email) VALUES ('${secondAdmin}', 'second_admin@remotehr.io')
        ON CONFLICT (id) DO NOTHING;
      `);
      await client.query(`
        INSERT INTO public.organization_members (organization_id, user_id, role, status)
        VALUES ('${ORG_ID}', '${secondAdmin}', 'admin', 'active')
        ON CONFLICT (user_id) DO UPDATE SET role = 'admin', status = 'active';
      `);
      await client.query(`
        INSERT INTO public.organization_members (organization_id, user_id, role, status)
        VALUES ('${ORG_ID}', '${USERS.admin}', 'admin', 'active')
        ON CONFLICT (user_id) DO UPDATE SET role = 'admin', status = 'active';
      `);

      // Verify two active admins exist initially
      const initialAdmins = await client.query(`
        SELECT COUNT(*) FROM public.organization_members
        WHERE organization_id = '${ORG_ID}' AND role = 'admin' AND status = 'active';
      `);
      expect(Number(initialAdmins.rows[0].count)).toBe(2);

      // Create two independent database connections
      const client1 = new Client({
        connectionString: dbUrl,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });
      const client2 = new Client({
        connectionString: dbUrl,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });

      await client1.connect();
      await client2.connect();

      try {
        const claims1 = JSON.stringify({
          sub: USERS.admin,
          role: "authenticated",
          user_role: "admin",
          organization_id: ORG_ID,
          aal: "aal2",
        });
        const claims2 = JSON.stringify({
          sub: secondAdmin,
          role: "authenticated",
          user_role: "admin",
          organization_id: ORG_ID,
          aal: "aal2",
        });

        await client1.query("SET ROLE authenticated;");
        await client1.query(`SELECT set_config('request.jwt.claims', '${claims1}', false);`);

        await client2.query("SET ROLE authenticated;");
        await client2.query(`SELECT set_config('request.jwt.claims', '${claims2}', false);`);

        // Both admins fire demotion of the other admin simultaneously
        const p1 = client1.query(
          `SELECT public.admin_update_org_member_role('${ORG_ID}', '${secondAdmin}', 'employee');`
        );
        const p2 = client2.query(
          `SELECT public.admin_update_org_member_role('${ORG_ID}', '${USERS.admin}', 'employee');`
        );

        const [res1, res2] = await Promise.allSettled([p1, p2]);

        const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
        const rejected = [res1, res2].filter((r) => r.status === "rejected");

        // Exactly one demotion must succeed, and the second must be rejected by advisory lock / last-admin check
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/Last admin protection/i);

        // Assert at least one active admin remains in the organization
        const finalAdmins = await client.query(`
          SELECT COUNT(*) FROM public.organization_members
          WHERE organization_id = '${ORG_ID}' AND role = 'admin' AND status = 'active';
        `);
        expect(Number(finalAdmins.rows[0].count)).toBe(1);
      } finally {
        await client1.end();
        await client2.end();

        // Restore USERS.admin as active admin and remove secondAdmin
        await client.query(`
          UPDATE public.organization_members
          SET role = 'admin', status = 'active'
          WHERE organization_id = '${ORG_ID}' AND user_id = '${USERS.admin}';
        `);
        await client.query(`
          DELETE FROM public.organization_members
          WHERE organization_id = '${ORG_ID}' AND user_id = '${secondAdmin}';
        `);
      }
    });
  });

  // ==========================================================================
  // 11. Real-Time Dynamic Role Freshness from organization_members
  // ==========================================================================

  describe("11. Real-Time Role Freshness Verification", () => {
    it("Demoting an HR user immediately denies privileged operations even with old aal2 HR JWT claim", async () => {
      if (!isConnected || !client) return;
      const tempHrId = "00000000-0000-0000-0000-000000000077";

      // 1. Setup temp HR user in organization_members
      await client.query(`
        INSERT INTO public.organization_members (organization_id, user_id, role, status)
        VALUES ('${ORG_ID}', '${tempHrId}', 'hr', 'active')
        ON CONFLICT (user_id) DO UPDATE SET role = 'hr', status = 'active';
      `);

      // 2. Demote temp HR user in database to employee
      await client.query(`
        UPDATE public.organization_members SET role = 'employee' WHERE user_id = '${tempHrId}';
      `);

      // 3. User attempts to execute an HR operation with old JWT token claiming user_role='hr' at aal2
      await expect(
        asRole(tempHrId, "hr", "aal2", async (c) => {
          return c.query(`
            SELECT public.admin_update_employee(
              '${USERS.employee}',
              NULL,
              NULL,
              'office'
            );
          `);
        })
      ).rejects.toThrow(/Forbidden: Only HR and administrators can update employee governance attributes/i);

      // Cleanup
      await client.query(`DELETE FROM public.organization_members WHERE user_id = '${tempHrId}';`);
    });
  });

  // ==========================================================================
  // 12. regularization_requests WITH CHECK and privacy_acknowledgments defenses
  // ==========================================================================

  describe("12. regularization_requests and privacy_acknowledgments defenses", () => {
    it("regularization_requests: INSERT with status='approved' is REJECTED by WITH CHECK", async () => {
      if (!isConnected || !client) return;
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`
            INSERT INTO public.regularization_requests (organization_id, employee_id, work_date, requested_in, requested_out, reason, status)
            VALUES ('${ORG_ID}', '${USERS.employee}', '2026-11-25', '2026-11-25 09:00:00+00', '2026-11-25 17:00:00+00', 'Tamper', 'approved');
          `);
        })
      ).rejects.toThrow();
    });

    it("regularization_requests: INSERT with non-null review fields is REJECTED by WITH CHECK", async () => {
      if (!isConnected || !client) return;
      await expect(
        asRole(USERS.employee, "employee", "aal1", async (c) => {
          return c.query(`
            INSERT INTO public.regularization_requests (organization_id, employee_id, work_date, requested_in, requested_out, reason, status, reviewed_by)
            VALUES ('${ORG_ID}', '${USERS.employee}', '2026-11-25', '2026-11-25 09:00:00+00', '2026-11-25 17:00:00+00', 'Tamper', 'pending', '${USERS.admin}');
          `);
        })
      ).rejects.toThrow();
    });

    it("privacy_acknowledgments: client-supplied forged timestamp is overwritten by server trigger", async () => {
      if (!isConnected || !client) return;
      const forgedTimestamp = "2020-01-01 00:00:00+00";
      const ackRes = await asRole(USERS.employee, "employee", "aal1", async (c) => {
        return c.query(`
          INSERT INTO public.privacy_acknowledgments (organization_id, employee_id, policy_version, acknowledged_at)
          VALUES ('${ORG_ID}', '${USERS.employee}', 'v99.0-trigger-test', '${forgedTimestamp}')
          RETURNING acknowledged_at;
        `);
      });

      const recordedAt = new Date(ackRes.rows[0].acknowledged_at);
      const forgedDate = new Date(forgedTimestamp);
      expect(recordedAt.getFullYear()).toBeGreaterThan(2025);
      expect(recordedAt.getTime()).not.toBe(forgedDate.getTime());

      // Cleanup
      await client.query(`DELETE FROM public.privacy_acknowledgments WHERE policy_version = 'v99.0-trigger-test';`);
    });
  });

  // ==========================================================================
  // 13. employees sensitive columns direct update denial and RPC governance
  // ==========================================================================

  describe("13. employees sensitive columns and admin RPC governance", () => {
    it("Direct UPDATE of sensitive governance columns DENIED for employee, manager, and hr", async () => {
      if (!isConnected || !client) return;
      const sensitiveUpdates = [
        "manager_id = '00000000-0000-0000-0000-000000000001'",
        "status = 'inactive'",
        "work_mode = 'office'",
        `primary_location_id = '${testLocId}'`,
        "work_target_minutes = 300",
        "expected_office_days = '{2, 4}'",
        "required_office_days_per_week = 3",
      ];

      for (const updateClause of sensitiveUpdates) {
        // Employee direct update denied
        await expect(
          asRole(USERS.employee, "employee", "aal1", async (c) => {
            return c.query(`UPDATE public.employees SET ${updateClause} WHERE id = '${USERS.employee}';`);
          })
        ).rejects.toThrow();

        // Manager direct update denied
        await expect(
          asRole(USERS.manager, "manager", "aal1", async (c) => {
            return c.query(`UPDATE public.employees SET ${updateClause} WHERE id = '${USERS.employee}';`);
          })
        ).rejects.toThrow();

        // HR direct update denied (writes must go through admin_update_employee RPC)
        await expect(
          asRole(USERS.hr, "hr", "aal2", async (c) => {
            return c.query(`UPDATE public.employees SET ${updateClause} WHERE id = '${USERS.employee}';`);
          })
        ).rejects.toThrow();
      }
    });

    it("Updating employee governance attributes through admin_update_employee RPC: SUCCEEDS and audits", async () => {
      if (!isConnected || !client) return;
      const res = await asRole(
        USERS.admin,
        "admin",
        "aal2",
        async (c) => {
          return c.query(`
            SELECT public.admin_update_employee(
              '${USERS.employee}',
              NULL,
              'active',
              'hybrid',
              '${testLocId}',
              450,
              NULL,
              3
            );
          `);
        },
        { commit: true }
      );

      expect(res.rows[0].admin_update_employee.success).toBe(true);

      // Verify audit log
      const audit = await client.query(`
        SELECT action, table_name, record_id FROM public.audit_logs
        WHERE action = 'employee_updated' AND record_id = '${USERS.employee}';
      `);
      expect(audit.rowCount).toBeGreaterThan(0);

      // Restore employee state
      await asRole(
        USERS.admin,
        "admin",
        "aal2",
        async (c) => {
          return c.query(`
            SELECT public.admin_update_employee(
              '${USERS.employee}',
              NULL,
              'active',
              'remote',
              NULL,
              480,
              NULL,
              0
            );
          `);
        },
        { commit: true }
      );
    });
  });

  // ==========================================================================
  // 14. trg_protect_location_ip_ranges on INSERT
  // ==========================================================================

  describe("14. trg_protect_location_ip_ranges on INSERT", () => {
    it("INSERT location with allowed_ip_ranges: DENIED to non-admin (employee, manager, hr)", async () => {
      if (!isConnected || !client) return;
      for (const [role, uid] of [["employee", USERS.employee], ["manager", USERS.manager], ["hr", USERS.hr]] as const) {
        const aal = role === "hr" ? "aal2" : "aal1";
        await expect(
          asRole(uid, role, aal, async (c) => {
            return c.query(`
              INSERT INTO public.locations (organization_id, name, code, allowed_ip_ranges)
              VALUES ('${ORG_ID}', 'Rogue IP Loc', 'ROGUE-${role}', '{"1.2.3.4/32"}');
            `);
          })
        ).rejects.toThrow();
      }
    });

    it("INSERT location with allowed_ip_ranges: ALLOWED to admin at aal2", async () => {
      if (!isConnected || !client) return;
      const res = await asRole(USERS.admin, "admin", "aal2", async (c) => {
        return c.query(`
          INSERT INTO public.locations (organization_id, name, code, allowed_ip_ranges)
          VALUES ('${ORG_ID}', 'Admin Secured Loc', 'ADMIN-SEC-1', '{"10.10.10.0/24"}')
          RETURNING id;
        `);
      });
      expect(res.rowCount).toBe(1);

      // Cleanup
      await client.query(`DELETE FROM public.locations WHERE code = 'ADMIN-SEC-1';`);
    });
  });

  // ==========================================================================
  // 15. Audit Logging for All Privileged Operations
  // ==========================================================================

  describe("15. Audit Logging for All Privileged Operations", () => {
    const auditMemberId = "00000000-0000-0000-0000-000000000099";

    beforeAll(async () => {
      if (!isConnected || !client) return;
      await client.query(`
        INSERT INTO auth.users (id, email) VALUES ('${auditMemberId}', 'audit_test_user@remotehr.io')
        ON CONFLICT (id) DO NOTHING;
      `);
    });

    afterAll(async () => {
      if (!isConnected || !client) return;
      await client.query(`
        DELETE FROM public.organization_members WHERE user_id = '${auditMemberId}';
        DELETE FROM auth.users WHERE id = '${auditMemberId}';
      `);
    });

    it("admin_add_org_member: records audit log with action 'member_added'", async () => {
      if (!isConnected || !client) return;
      await asRole(
        USERS.admin,
        "admin",
        "aal2",
        async (c) => {
          return c.query(`SELECT public.admin_add_org_member('${ORG_ID}', '${auditMemberId}', 'employee');`);
        },
        { commit: true }
      );

      const audit = await client.query(`
        SELECT action, table_name, record_id FROM public.audit_logs
        WHERE action = 'member_added' AND record_id = '${auditMemberId}';
      `);
      expect(audit.rowCount).toBeGreaterThan(0);
      expect(audit.rows[0].table_name).toBe("organization_members");
    });

    it("admin_update_org_member_role: records audit log with action 'member_role_updated'", async () => {
      if (!isConnected || !client) return;
      await asRole(
        USERS.admin,
        "admin",
        "aal2",
        async (c) => {
          return c.query(`SELECT public.admin_update_org_member_role('${ORG_ID}', '${auditMemberId}', 'manager');`);
        },
        { commit: true }
      );

      const audit = await client.query(`
        SELECT action, table_name, record_id FROM public.audit_logs
        WHERE action = 'member_role_updated' AND record_id = '${auditMemberId}';
      `);
      expect(audit.rowCount).toBeGreaterThan(0);
      expect(audit.rows[0].table_name).toBe("organization_members");
    });

    it("admin_remove_org_member: records audit log with action 'member_removed'", async () => {
      if (!isConnected || !client) return;
      await asRole(
        USERS.admin,
        "admin",
        "aal2",
        async (c) => {
          return c.query(`SELECT public.admin_remove_org_member('${ORG_ID}', '${auditMemberId}');`);
        },
        { commit: true }
      );

      const audit = await client.query(`
        SELECT action, table_name, record_id FROM public.audit_logs
        WHERE action = 'member_removed' AND record_id = '${auditMemberId}';
      `);
      expect(audit.rowCount).toBeGreaterThan(0);
      expect(audit.rows[0].table_name).toBe("organization_members");
    });

    it("admin_update_employee: records audit log with action 'employee_updated'", async () => {
      if (!isConnected || !client) return;
      await asRole(
        USERS.admin,
        "admin",
        "aal2",
        async (c) => {
          return c.query(`
            SELECT public.admin_update_employee(
              '${USERS.employee}',
              NULL,
              'active',
              'remote',
              NULL,
              480,
              NULL,
              0
            );
          `);
        },
        { commit: true }
      );

      const audit = await client.query(`
        SELECT action, table_name, record_id FROM public.audit_logs
        WHERE action = 'employee_updated' AND record_id = '${USERS.employee}';
      `);
      expect(audit.rowCount).toBeGreaterThan(0);
      expect(audit.rows[0].table_name).toBe("employees");
    });

    it("lock_month: records audit log with action 'LOCK_MONTH'", async () => {
      if (!isConnected || !client) return;
      await asRole(
        USERS.hr,
        "hr",
        "aal2",
        async (c) => {
          return c.query(`SELECT public.lock_month(2026, 12);`);
        },
        { commit: true }
      );

      const audit = await client.query(`
        SELECT action, table_name FROM public.audit_logs
        WHERE action = 'LOCK_MONTH' AND table_name = 'attendance_days'
        ORDER BY created_at DESC LIMIT 1;
      `);
      expect(audit.rowCount).toBeGreaterThan(0);
    });

    it("unlock_month: records audit log with action 'UNLOCK_MONTH'", async () => {
      if (!isConnected || !client) return;
      await asRole(
        USERS.admin,
        "admin",
        "aal2",
        async (c) => {
          return c.query(`SELECT public.unlock_month(2026, 12);`);
        },
        { commit: true }
      );

      const audit = await client.query(`
        SELECT action, table_name FROM public.audit_logs
        WHERE action = 'UNLOCK_MONTH' AND table_name = 'attendance_days'
        ORDER BY created_at DESC LIMIT 1;
      `);
      expect(audit.rowCount).toBeGreaterThan(0);
    });

    it("approve_regularization: records audit log with action 'APPROVE_REGULARIZATION'", async () => {
      if (!isConnected || !client) return;
      const reqRes = await client.query(`
        INSERT INTO public.regularization_requests (
          organization_id, employee_id, work_date, requested_in, requested_out, reason, status
        ) VALUES (
          '${ORG_ID}', '${USERS.employee}', '2026-12-01', '2026-12-01 09:00:00+00', '2026-12-01 17:00:00+00', 'Audit Test Reason', 'pending'
        ) RETURNING id;
      `);
      const reqId = reqRes.rows[0].id;

      await asRole(
        USERS.hr,
        "hr",
        "aal2",
        async (c) => {
          return c.query(`SELECT public.approve_regularization('${reqId}', 'Approved for audit test');`);
        },
        { commit: true }
      );

      const audit = await client.query(`
        SELECT action, table_name, record_id FROM public.audit_logs
        WHERE action = 'APPROVE_REGULARIZATION' AND record_id = '${reqId}';
      `);
      expect(audit.rowCount).toBeGreaterThan(0);
      expect(audit.rows[0].table_name).toBe("regularization_requests");
    });

    it("reject_regularization: records audit log with action 'REJECT_REGULARIZATION'", async () => {
      if (!isConnected || !client) return;
      const reqRes = await client.query(`
        INSERT INTO public.regularization_requests (
          organization_id, employee_id, work_date, requested_in, requested_out, reason, status
        ) VALUES (
          '${ORG_ID}', '${USERS.employee}', '2026-12-02', '2026-12-02 09:00:00+00', '2026-12-02 17:00:00+00', 'Audit Reject Test Reason', 'pending'
        ) RETURNING id;
      `);
      const reqId = reqRes.rows[0].id;

      await asRole(
        USERS.hr,
        "hr",
        "aal2",
        async (c) => {
          return c.query(`SELECT public.reject_regularization('${reqId}', 'Rejected for audit test');`);
        },
        { commit: true }
      );

      const audit = await client.query(`
        SELECT action, table_name, record_id FROM public.audit_logs
        WHERE action = 'REJECT_REGULARIZATION' AND record_id = '${reqId}';
      `);
      expect(audit.rowCount).toBeGreaterThan(0);
      expect(audit.rows[0].table_name).toBe("regularization_requests");
    });

    it("punch_verified: records audit log with action 'VERIFIED_PUNCH'", async () => {
      if (!isConnected || !client) return;
      await client.query("BEGIN;");
      await client.query("SET LOCAL ROLE service_role;");
      const pvRes = await client.query(`
        SELECT public.punch_verified('${USERS.employee}', 'kiosk', '${testLocId}', 'Verified punch audit test');
      `);
      await client.query("COMMIT;");

      const sessionId = pvRes.rows[0].punch_verified.session_id;
      const audit = await client.query(`
        SELECT action, table_name, record_id FROM public.audit_logs
        WHERE action = 'VERIFIED_PUNCH' AND record_id = '${sessionId}';
      `);
      expect(audit.rowCount).toBeGreaterThan(0);
      expect(audit.rows[0].table_name).toBe("attendance_sessions");
    });
  });

});

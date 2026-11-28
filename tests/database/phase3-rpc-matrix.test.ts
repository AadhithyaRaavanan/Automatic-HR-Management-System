/**
 * Phase 3 RPC Security & Privilege Matrix Test Suite
 *
 * Exhaustively verifies all 14 Phase 3 Organization Admin RPC functions against:
 * 1. Cross-Tenant Denial (foreign tenant admin cannot target other org objects)
 * 2. Same-Org Wrong-Role Denial (employee/manager cannot call admin RPCs)
 * 3. AAL1 Assurance Level Denial (admin at aal1 is denied elevated actions)
 * 4. Audit Log Row Generation (valid aal2 admin action produces verified audit_logs entry)
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

describe("Phase 3 RPC Security & Privilege Matrix Suite", () => {
  let client: Client;
  let org1DeptId: string;
  let org1LocId: string;
  let org1ShiftId: string;

  beforeAll(async () => {
    client = new Client({
      connectionString: dbUrl,
      ssl: false,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();

    // Ensure Org 2 exists
    await client.query(`
      INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone)
      VALUES ('${ORG_2_ID}', 'Acme Matrix Corp', 'acme-matrix', 'hybrid', 'active', 'UTC')
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
        ON CONFLICT (organization_id, user_id) DO UPDATE SET organization_id = '${ORG_2_ID}', role = '${role}', status = 'active';
      `);
      await client.query(`
        INSERT INTO public.employees (id, organization_id, email, full_name, work_mode, timezone)
        VALUES ('${uid}', '${ORG_2_ID}', 'matrix-${role}@example.com', 'Matrix ${role}', 'hybrid', 'UTC')
        ON CONFLICT (id) DO UPDATE SET organization_id = '${ORG_2_ID}';
      `);
    }

    // Fixture department for Org 1
    const dRes = await client.query(`
      INSERT INTO public.departments (organization_id, name, code)
      VALUES ('${ORG_1_ID}', 'Matrix Engineering', 'MENG')
      RETURNING id;
    `);
    org1DeptId = dRes.rows[0].id;

    // Fixture location for Org 1
    const lRes = await client.query(`
      INSERT INTO public.locations (organization_id, name, code, timezone)
      VALUES ('${ORG_1_ID}', 'Matrix HQ', 'MHQ', 'UTC')
      RETURNING id;
    `);
    org1LocId = lRes.rows[0].id;

    // Fixture shift template for Org 1
    const sRes = await client.query(`
      INSERT INTO public.shift_templates (organization_id, name, code, start_time, end_time)
      VALUES ('${ORG_1_ID}', 'Matrix Standard', 'MSTD', '09:00:00', '17:00:00')
      RETURNING id;
    `);
    org1ShiftId = sRes.rows[0].id;
  });

  afterAll(async () => {
    if (client) {
      await client.query("RESET ROLE;");
      await client.query(`DELETE FROM public.departments WHERE id = '${org1DeptId}';`).catch(() => {});
      await client.query(`DELETE FROM public.locations WHERE id = '${org1LocId}';`).catch(() => {});
      await client.query(`DELETE FROM public.shift_templates WHERE id = '${org1ShiftId}';`).catch(() => {});
      await client.query(`DELETE FROM public.audit_logs WHERE organization_id = '${ORG_2_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.organization_members WHERE organization_id = '${ORG_2_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.employees WHERE organization_id = '${ORG_2_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.organizations WHERE id = '${ORG_2_ID}';`).catch(() => {});
      await client.end();
    }
  });

  async function asUser<T = any>(
    userId: string,
    orgId: string,
    role: string,
    aal: "aal1" | "aal2",
    queryFn: (c: Client) => Promise<T>
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
      await client.query("ROLLBACK;");
      return res;
    } catch (err) {
      await client.query("ROLLBACK;");
      throw err;
    }
  }

  // 1. admin_update_employee_governance
  describe("1. admin_update_employee_governance", () => {
    it("denies cross-tenant caller updating another org's employee", async () => {
      await expect(
        asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
          await c.query(`SELECT public.admin_update_employee_governance('${ORG_1_USERS.employee}', 'Hacked Name');`);
        })
      ).rejects.toThrow();
    });

    it("denies employee wrong-role caller", async () => {
      await expect(
        asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          await c.query(`SELECT public.admin_update_employee_governance('${ORG_1_USERS.employee}', 'Self Update');`);
        })
      ).rejects.toThrow();
    });

    it("denies admin at aal1", async () => {
      await expect(
        asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal1", async (c) => {
          await c.query(`SELECT public.admin_update_employee_governance('${ORG_1_USERS.employee}', 'AAL1 Update');`);
        })
      ).rejects.toThrow();
    });

    it("succeeds for admin at aal2 and generates audit row", async () => {
      await asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal2", async (c) => {
        const res = await c.query(`SELECT public.admin_update_employee_governance('${ORG_1_USERS.employee}', 'Valid Governance Update');`);
        expect(res.rows[0].admin_update_employee_governance.success).toBe(true);

        const audit = await c.query(`
          SELECT action, table_name, record_id FROM public.audit_logs
          WHERE record_id = '${ORG_1_USERS.employee}' AND action = 'EMPLOYEE_UPDATED'
          ORDER BY created_at DESC LIMIT 1;
        `);
        expect(audit.rows.length).toBe(1);
      });
    });
  });

  // 2. admin_deactivate_member
  describe("2. admin_deactivate_member", () => {
    it("denies cross-tenant caller deactivating another org's member", async () => {
      await expect(
        asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
          await c.query(`SELECT public.admin_deactivate_member('${ORG_1_USERS.employee}');`);
        })
      ).rejects.toThrow();
    });

    it("denies employee wrong-role caller", async () => {
      await expect(
        asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          await c.query(`SELECT public.admin_deactivate_member('${ORG_1_USERS.employee}');`);
        })
      ).rejects.toThrow();
    });

    it("denies hr at aal2 (admin-only)", async () => {
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_deactivate_member('${ORG_1_USERS.employee}');`);
        })
      ).rejects.toThrow();
    });

    it("denies admin at aal1", async () => {
      await expect(
        asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal1", async (c) => {
          await c.query(`SELECT public.admin_deactivate_member('${ORG_1_USERS.employee}');`);
        })
      ).rejects.toThrow();
    });

    it("succeeds for admin at aal2 and generates audit row", async () => {
      await asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal2", async (c) => {
        const res = await c.query(`SELECT public.admin_deactivate_member('${ORG_1_USERS.employee}');`);
        expect(res.rows[0].admin_deactivate_member.success).toBe(true);

        const audit = await c.query(`
          SELECT action, table_name, record_id FROM public.audit_logs
          WHERE record_id = '${ORG_1_USERS.employee}' AND action = 'MEMBER_DEACTIVATED'
          ORDER BY created_at DESC LIMIT 1;
        `);
        expect(audit.rows.length).toBe(1);
      });
    });
  });

  // 3. Departments: admin_create_department, admin_update_department, admin_delete_department
  describe("3-5. Departments (create, update, delete)", () => {
    it("denies cross-tenant caller updating another org's department", async () => {
      await expect(
        asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
          await c.query(`SELECT public.admin_update_department('${org1DeptId}', 'Foreign Dept', 'F1', NULL, NULL);`);
        })
      ).rejects.toThrow();
    });

    it("denies employee wrong-role caller creating department", async () => {
      await expect(
        asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          await c.query(`SELECT public.admin_create_department('Emp Dept', 'ED', NULL, NULL);`);
        })
      ).rejects.toThrow();
    });

    it("denies admin at aal1 creating department", async () => {
      await expect(
        asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal1", async (c) => {
          await c.query(`SELECT public.admin_create_department('AAL1 Dept', 'A1', NULL, NULL);`);
        })
      ).rejects.toThrow();
    });

    it("succeeds for admin at aal2 and generates audit rows across lifecycle", async () => {
      await asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal2", async (c) => {
        // Create
        const cRes = await c.query(`SELECT public.admin_create_department('Temp Matrix Dept', 'TMD', NULL, NULL);`);
        const deptId = cRes.rows[0].admin_create_department.department_id;
        expect(deptId).toBeTruthy();

        let audit = await c.query(`
          SELECT action FROM public.audit_logs WHERE record_id = '${deptId}' AND action = 'DEPARTMENT_CREATED';
        `);
        expect(audit.rows.length).toBe(1);

        // Update
        await c.query(`SELECT public.admin_update_department('${deptId}', 'Updated Temp Dept', 'UTMD', NULL, NULL);`);
        audit = await c.query(`
          SELECT action FROM public.audit_logs WHERE record_id = '${deptId}' AND action = 'DEPARTMENT_UPDATED';
        `);
        expect(audit.rows.length).toBe(1);

        // Delete
        await c.query(`SELECT public.admin_delete_department('${deptId}');`);
        audit = await c.query(`
          SELECT action FROM public.audit_logs WHERE record_id = '${deptId}' AND action = 'DEPARTMENT_DELETED';
        `);
        expect(audit.rows.length).toBe(1);
      });
    });
  });

  // 6-8. Locations: admin_create_location, admin_update_location, admin_delete_location
  describe("6-8. Locations (create, update, delete)", () => {
    it("denies cross-tenant caller updating another org's location", async () => {
      await expect(
        asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
          await c.query(`SELECT public.admin_update_location('${org1LocId}', 'Foreign Loc', 'Address');`);
        })
      ).rejects.toThrow();
    });

    it("denies employee wrong-role caller creating location", async () => {
      await expect(
        asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          await c.query(`SELECT public.admin_create_location('Emp Loc', 'EL');`);
        })
      ).rejects.toThrow();
    });

    it("denies hr at aal2 (admin-only) creating, updating, or deleting location", async () => {
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_create_location('HR Loc', 'HRL');`);
        })
      ).rejects.toThrow();
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_update_location('${org1LocId}', 'HR Loc', 'Address');`);
        })
      ).rejects.toThrow();
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_delete_location('${org1LocId}');`);
        })
      ).rejects.toThrow();
    });

    it("denies admin at aal1 creating location", async () => {
      await expect(
        asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal1", async (c) => {
          await c.query(`SELECT public.admin_create_location('AAL1 Loc', 'AL');`);
        })
      ).rejects.toThrow();
    });

    it("succeeds for admin at aal2 and generates audit rows across lifecycle", async () => {
      await asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal2", async (c) => {
        // Create
        const cRes = await c.query(`SELECT public.admin_create_location('Temp Location', 'TLOC', '123 Main St', 'UTC', 480);`);
        const locId = cRes.rows[0].admin_create_location.location_id;
        expect(locId).toBeTruthy();

        let audit = await c.query(`
          SELECT action FROM public.audit_logs WHERE record_id = '${locId}' AND action = 'LOCATION_CREATED';
        `);
        expect(audit.rows.length).toBe(1);

        // Update
        await c.query(`SELECT public.admin_update_location('${locId}', 'Updated Temp Loc', '456 Elm St');`);
        audit = await c.query(`
          SELECT action FROM public.audit_logs WHERE record_id = '${locId}' AND action = 'LOCATION_UPDATED';
        `);
        expect(audit.rows.length).toBe(1);

        // Delete
        await c.query(`SELECT public.admin_delete_location('${locId}');`);
        audit = await c.query(`
          SELECT action FROM public.audit_logs WHERE record_id = '${locId}' AND action = 'LOCATION_DELETED';
        `);
        expect(audit.rows.length).toBe(1);
      });
    });
  });

  // 9-11. Shifts: admin_create_shift_template, admin_update_shift_template, admin_delete_shift_template
  describe("9-11. Shift Templates (create, update, delete)", () => {
    it("denies cross-tenant caller updating another org's shift template", async () => {
      await expect(
        asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
          await c.query(`SELECT public.admin_update_shift_template('${org1ShiftId}', 'Foreign Shift', '10:00:00', '18:00:00');`);
        })
      ).rejects.toThrow();
    });

    it("denies employee wrong-role caller creating shift template", async () => {
      await expect(
        asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          await c.query(`SELECT public.admin_create_shift_template('Emp Shift', 'ES', '09:00:00', '17:00:00');`);
        })
      ).rejects.toThrow();
    });

    it("denies hr at aal2 (admin-only) creating, updating, or deleting shift template", async () => {
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_create_shift_template('HR Shift', 'HS', '09:00:00', '17:00:00');`);
        })
      ).rejects.toThrow();
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_update_shift_template('${org1ShiftId}', 'HR Shift', '10:00:00', '18:00:00');`);
        })
      ).rejects.toThrow();
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_delete_shift_template('${org1ShiftId}');`);
        })
      ).rejects.toThrow();
    });

    it("denies admin at aal1 creating shift template", async () => {
      await expect(
        asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal1", async (c) => {
          await c.query(`SELECT public.admin_create_shift_template('AAL1 Shift', 'AS', '09:00:00', '17:00:00');`);
        })
      ).rejects.toThrow();
    });

    it("succeeds for admin at aal2 and generates audit rows across lifecycle", async () => {
      await asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal2", async (c) => {
        // Create
        const cRes = await c.query(`SELECT public.admin_create_shift_template('Temp Shift', 'TSH', '08:00:00', '16:00:00', 45);`);
        const shiftId = cRes.rows[0].admin_create_shift_template.shift_template_id;
        expect(shiftId).toBeTruthy();

        let audit = await c.query(`
          SELECT action FROM public.audit_logs WHERE record_id = '${shiftId}' AND action = 'SHIFT_CREATED';
        `);
        expect(audit.rows.length).toBe(1);

        // Update
        await c.query(`SELECT public.admin_update_shift_template('${shiftId}', 'Updated Temp Shift', '08:30:00', '16:30:00', 60);`);
        audit = await c.query(`
          SELECT action FROM public.audit_logs WHERE record_id = '${shiftId}' AND action = 'SHIFT_UPDATED';
        `);
        expect(audit.rows.length).toBe(1);

        // Delete
        await c.query(`SELECT public.admin_delete_shift_template('${shiftId}');`);
        audit = await c.query(`
          SELECT action FROM public.audit_logs WHERE record_id = '${shiftId}' AND action = 'SHIFT_DELETED';
        `);
        expect(audit.rows.length).toBe(1);
      });
    });
  });

  // 12. admin_assign_shift
  describe("12. admin_assign_shift", () => {
    it("denies cross-tenant caller assigning shift to another org's employee", async () => {
      await expect(
        asUser(ORG_2_USERS.admin, ORG_2_ID, "admin", "aal2", async (c) => {
          await c.query(`SELECT public.admin_assign_shift('${ORG_1_USERS.employee}', '${org1ShiftId}', '2026-11-01');`);
        })
      ).rejects.toThrow();
    });

    it("denies employee wrong-role caller", async () => {
      await expect(
        asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          await c.query(`SELECT public.admin_assign_shift('${ORG_1_USERS.employee}', '${org1ShiftId}', '2026-11-01');`);
        })
      ).rejects.toThrow();
    });

    it("denies hr at aal2 (admin-only)", async () => {
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_assign_shift('${ORG_1_USERS.employee}', '${org1ShiftId}', '2026-11-01');`);
        })
      ).rejects.toThrow();
    });

    it("denies admin at aal1", async () => {
      await expect(
        asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal1", async (c) => {
          await c.query(`SELECT public.admin_assign_shift('${ORG_1_USERS.employee}', '${org1ShiftId}', '2026-11-01');`);
        })
      ).rejects.toThrow();
    });

    it("succeeds for admin at aal2 and generates audit row", async () => {
      await asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal2", async (c) => {
        const res = await c.query(`SELECT public.admin_assign_shift('${ORG_1_USERS.employee}', '${org1ShiftId}', '2026-11-01');`);
        const assignId = res.rows[0].admin_assign_shift.assignment_id;
        expect(assignId).toBeTruthy();

        const audit = await c.query(`
          SELECT action FROM public.audit_logs
          WHERE record_id = '${assignId}' AND action = 'SHIFT_ASSIGNED'
          ORDER BY created_at DESC LIMIT 1;
        `);
        expect(audit.rows.length).toBe(1);
      });
    });
  });

  // 13. admin_update_organization_settings
  describe("13. admin_update_organization_settings", () => {
    it("denies employee wrong-role caller", async () => {
      await expect(
        asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          await c.query(`SELECT public.admin_update_organization_settings('Hacked Org', 'UTC', 'remote');`);
        })
      ).rejects.toThrow();
    });

    it("denies hr at aal2 (admin-only)", async () => {
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_update_organization_settings('HR Org', 'UTC', 'remote');`);
        })
      ).rejects.toThrow();
    });

    it("denies admin at aal1", async () => {
      await expect(
        asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal1", async (c) => {
          await c.query(`SELECT public.admin_update_organization_settings('AAL1 Org', 'UTC', 'remote');`);
        })
      ).rejects.toThrow();
    });

    it("succeeds for admin at aal2 and generates audit row", async () => {
      await asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal2", async (c) => {
        const res = await c.query(`SELECT public.admin_update_organization_settings('RemoteHR Updated', 'UTC', 'remote');`);
        expect(res.rows[0].admin_update_organization_settings.success).toBe(true);

        const audit = await c.query(`
          SELECT action FROM public.audit_logs
          WHERE record_id = '${ORG_1_ID}' AND action = 'ORGANIZATION_UPDATED'
          ORDER BY created_at DESC LIMIT 1;
        `);
        expect(audit.rows.length).toBe(1);
      });
    });
  });

  // 14. admin_update_attendance_policy
  describe("14. admin_update_attendance_policy", () => {
    it("denies employee wrong-role caller", async () => {
      await expect(
        asUser(ORG_1_USERS.employee, ORG_1_ID, "employee", "aal1", async (c) => {
          await c.query(`SELECT public.admin_update_attendance_policy(30, 300, '19:00:00');`);
        })
      ).rejects.toThrow();
    });

    it("denies hr at aal2 (admin-only)", async () => {
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_update_attendance_policy(30, 300, '19:00:00');`);
        })
      ).rejects.toThrow();
    });

    it("denies admin at aal1", async () => {
      await expect(
        asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal1", async (c) => {
          await c.query(`SELECT public.admin_update_attendance_policy(30, 300, '19:00:00');`);
        })
      ).rejects.toThrow();
    });

    it("succeeds for admin at aal2 and generates audit row", async () => {
      await asUser(ORG_1_USERS.admin, ORG_1_ID, "admin", "aal2", async (c) => {
        const res = await c.query(`SELECT public.admin_update_attendance_policy(20, 240, '18:30:00');`);
        expect(res.rows[0].admin_update_attendance_policy.success).toBe(true);

        const audit = await c.query(`
          SELECT action FROM public.audit_logs
          WHERE action = 'POLICY_UPDATED'
          ORDER BY created_at DESC LIMIT 1;
        `);
        expect(audit.rows.length).toBe(1);
      });
    });
  });

  // 15. Admin-Only Membership & Month Unlock RPCs (HR denial)
  describe("15. Admin-Only Org Member & Unlock RPCs (HR aal2 denial)", () => {
    it("denies hr at aal2 on admin_add_org_member, admin_update_org_member_role, admin_remove_org_member, and unlock_month", async () => {
      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_add_org_member('${ORG_1_ID}', '${ORG_1_USERS.employee}', 'manager');`);
        })
      ).rejects.toThrow();

      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_update_org_member_role('${ORG_1_ID}', '${ORG_1_USERS.employee}', 'hr');`);
        })
      ).rejects.toThrow();

      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.admin_remove_org_member('${ORG_1_ID}', '${ORG_1_USERS.employee}');`);
        })
      ).rejects.toThrow();

      await expect(
        asUser(ORG_1_USERS.hr, ORG_1_ID, "hr", "aal2", async (c) => {
          await c.query(`SELECT public.unlock_month(2026, 12, 'HR matrix test reason');`);
        })
      ).rejects.toThrow();
    });
  });
});

/**
 * Grants Snapshot Test
 *
 * Verifies strict database privilege hardening:
 * 1. Role 'anon' has 0 table grants and 0 routine grants on any object in public schema.
 * 2. Role 'authenticated' has exactly the expected table, column, and routine privileges.
 * 3. Sensitive columns (e.g. kiosk_devices.enrollment_token_hash) are hidden from SELECT.
 * 4. Sensitive governance columns on employees (manager_id, status, work_mode, etc.) cannot be UPDATED directly.
 * 5. Direct INSERT and DELETE on employees are completely revoked from authenticated.
 * 6. Fails if any unexpected grant or new table appears with extra permissions.
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

describe("Database Grants Snapshot Test", () => {
  let client: Client;

  beforeAll(async () => {
    if (!dbUrl) {
      throw new Error("DATABASE_URL must be configured in .env.staging or process.env");
    }
    client = new Client({ connectionString: dbUrl });
    await client.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  it("ensures role 'anon' has ZERO table grants on any public table or view", async () => {
    const res = await client.query(`
      SELECT table_name, privilege_type 
      FROM information_schema.role_table_grants 
      WHERE table_schema = 'public' AND grantee = 'anon'
      ORDER BY table_name, privilege_type;
    `);

    expect(res.rows).toEqual([]);
  });

  it("ensures role 'anon' has ZERO routine grants on any public function", async () => {
    const res = await client.query(`
      SELECT routine_name, privilege_type 
      FROM information_schema.role_routine_grants 
      WHERE specific_schema = 'public' AND grantee = 'anon'
      ORDER BY routine_name;
    `);

    expect(res.rows).toEqual([]);
  });

  it("ensures role 'authenticated' has exactly the expected table grants", async () => {
    const res = await client.query(`
      SELECT table_name, privilege_type 
      FROM information_schema.role_table_grants 
      WHERE table_schema = 'public' AND grantee = 'authenticated'
      ORDER BY table_name, privilege_type;
    `);

    // Canonical table grant whitelist
    const expectedTableGrants = [
      { table_name: "attendance_days", privilege_type: "SELECT" },
      { table_name: "attendance_policies", privilege_type: "SELECT" },
      { table_name: "attendance_policies", privilege_type: "UPDATE" },
      { table_name: "attendance_sessions", privilege_type: "SELECT" },
      { table_name: "audit_logs", privilege_type: "SELECT" },
      { table_name: "employee_shift_assignments", privilege_type: "DELETE" },
      { table_name: "employee_shift_assignments", privilege_type: "INSERT" },
      { table_name: "employee_shift_assignments", privilege_type: "SELECT" },
      { table_name: "employee_shift_assignments", privilege_type: "UPDATE" },
      { table_name: "employees", privilege_type: "SELECT" },
      { table_name: "holidays", privilege_type: "DELETE" },
      { table_name: "holidays", privilege_type: "INSERT" },
      { table_name: "holidays", privilege_type: "SELECT" },
      { table_name: "holidays", privilege_type: "UPDATE" },
      { table_name: "kiosk_devices", privilege_type: "DELETE" },
      { table_name: "kiosk_devices", privilege_type: "INSERT" },
      { table_name: "kiosk_devices", privilege_type: "UPDATE" },
      { table_name: "locations", privilege_type: "DELETE" },
      { table_name: "locations", privilege_type: "INSERT" },
      { table_name: "locations", privilege_type: "SELECT" },
      { table_name: "locations", privilege_type: "UPDATE" },
      { table_name: "notifications", privilege_type: "SELECT" },
      { table_name: "organization_members", privilege_type: "SELECT" },
      { table_name: "organizations", privilege_type: "SELECT" },
      { table_name: "privacy_acknowledgments", privilege_type: "INSERT" },
      { table_name: "privacy_acknowledgments", privilege_type: "SELECT" },
      { table_name: "regularization_requests", privilege_type: "INSERT" },
      { table_name: "regularization_requests", privilege_type: "SELECT" },
      { table_name: "shift_templates", privilege_type: "DELETE" },
      { table_name: "shift_templates", privilege_type: "INSERT" },
      { table_name: "shift_templates", privilege_type: "SELECT" },
      { table_name: "shift_templates", privilege_type: "UPDATE" },
      { table_name: "user_roles", privilege_type: "REFERENCES" },
      { table_name: "user_roles", privilege_type: "SELECT" },
      { table_name: "user_roles", privilege_type: "TRIGGER" },
      { table_name: "user_roles", privilege_type: "TRUNCATE" },
    ];

    expect(res.rows).toEqual(expectedTableGrants);
  });

  it("ensures kiosk_devices hides enrollment_token_hash from authenticated SELECT", async () => {
    const res = await client.query(`
      SELECT column_name, privilege_type 
      FROM information_schema.role_column_grants 
      WHERE table_schema = 'public' 
        AND table_name = 'kiosk_devices' 
        AND grantee = 'authenticated'
        AND privilege_type = 'SELECT'
      ORDER BY column_name;
    `);

    const selectColumns = res.rows.map((r: any) => r.column_name);
    expect(selectColumns).not.toContain("enrollment_token_hash");
    expect(selectColumns).toEqual([
      "created_at",
      "device_name",
      "id",
      "is_active",
      "location_id",
      "organization_id",
    ]);
  });

  it("ensures employees table has NO direct INSERT or DELETE, and UPDATE is strictly restricted to self-edit fields", async () => {
    // 1. Table-level check for INSERT and DELETE
    const tableGrants = await client.query(`
      SELECT privilege_type 
      FROM information_schema.role_table_grants 
      WHERE table_schema = 'public' 
        AND table_name = 'employees' 
        AND grantee = 'authenticated'
        AND privilege_type IN ('INSERT', 'DELETE');
    `);
    expect(tableGrants.rows).toEqual([]);

    // 2. Column-level UPDATE check
    const updateColumns = await client.query(`
      SELECT column_name 
      FROM information_schema.role_column_grants 
      WHERE table_schema = 'public' 
        AND table_name = 'employees' 
        AND grantee = 'authenticated'
        AND privilege_type = 'UPDATE'
      ORDER BY column_name;
    `);

    const allowedUpdateColumns = updateColumns.rows.map((r: any) => r.column_name);
    expect(allowedUpdateColumns).toEqual(["avatar_url", "full_name", "timezone"]);

    // Sensitive governance columns must NOT have UPDATE privilege
    const sensitiveColumns = [
      "manager_id",
      "status",
      "work_mode",
      "primary_location_id",
      "work_target_minutes",
      "expected_office_days",
      "required_office_days_per_week",
    ];
    for (const col of sensitiveColumns) {
      expect(allowedUpdateColumns).not.toContain(col);
    }
  });

  it("ensures authenticated has execute privileges on exactly the 16 authorized RPCs", async () => {
    const res = await client.query(`
      SELECT DISTINCT p.proname
      FROM information_schema.role_routine_grants r
      JOIN pg_proc p ON p.proname = r.routine_name
      JOIN pg_namespace n ON p.pronamespace = n.oid AND n.nspname = 'public'
      LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
      WHERE r.grantee = 'authenticated'
        AND d.objid IS NULL
      ORDER BY p.proname;
    `);

    const routineNames = res.rows.map((r: any) => r.proname);
    const expectedRoutines = [
      "admin_add_org_member",
      "admin_create_employee",
      "admin_remove_org_member",
      "admin_update_employee",
      "admin_update_org_member_role",
      "approve_regularization",
      "check_in",
      "check_out",
      "current_org_id",
      "current_organization_id",
      "current_user_role",
      "get_user_role",
      "is_active_org_member",
      "lock_month",
      "reject_regularization",
      "unlock_month",
    ];

    expect(routineNames).toEqual(expectedRoutines);
  });
});

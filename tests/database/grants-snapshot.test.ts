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
      { table_name: "approval_delegations", privilege_type: "SELECT" },
      { table_name: "attendance_days", privilege_type: "SELECT" },
      { table_name: "attendance_policies", privilege_type: "SELECT" },
      { table_name: "attendance_policies", privilege_type: "UPDATE" },
      { table_name: "attendance_sessions", privilege_type: "SELECT" },
      { table_name: "audit_logs", privilege_type: "SELECT" },
      { table_name: "company_days_off", privilege_type: "SELECT" },
      { table_name: "departments", privilege_type: "SELECT" },
      { table_name: "employee_shift_assignments", privilege_type: "DELETE" },
      { table_name: "employee_shift_assignments", privilege_type: "INSERT" },
      { table_name: "employee_shift_assignments", privilege_type: "SELECT" },
      { table_name: "employee_shift_assignments", privilege_type: "UPDATE" },
      { table_name: "employees", privilege_type: "SELECT" },
      { table_name: "holiday_templates", privilege_type: "SELECT" },
      { table_name: "holidays", privilege_type: "SELECT" },
      { table_name: "kiosk_devices", privilege_type: "DELETE" },
      { table_name: "kiosk_devices", privilege_type: "INSERT" },
      { table_name: "kiosk_devices", privilege_type: "UPDATE" },
      { table_name: "leave_balance_adjustments", privilege_type: "SELECT" },
      { table_name: "leave_balances", privilege_type: "SELECT" },
      { table_name: "leave_policies", privilege_type: "SELECT" },
      { table_name: "leave_requests", privilege_type: "SELECT" },
      { table_name: "leave_types", privilege_type: "SELECT" },
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
      { table_name: "retention_archives", privilege_type: "SELECT" },
      { table_name: "retention_policies", privilege_type: "SELECT" },
      { table_name: "shift_templates", privilege_type: "DELETE" },
      { table_name: "shift_templates", privilege_type: "INSERT" },
      { table_name: "shift_templates", privilege_type: "SELECT" },
      { table_name: "shift_templates", privilege_type: "UPDATE" },
      { table_name: "user_roles", privilege_type: "SELECT" },
    ];

    expect(res.rows).toEqual(expectedTableGrants);
  });

  it("ensures role 'authenticated' holds ZERO TRUNCATE, TRIGGER, or REFERENCES on any public table or view", async () => {
    const res = await client.query(`
      SELECT table_name, privilege_type 
      FROM information_schema.role_table_grants 
      WHERE table_schema = 'public' 
        AND grantee = 'authenticated'
        AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')
      ORDER BY table_name, privilege_type;
    `);

    expect(res.rows).toEqual([]);
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
    expect(allowedUpdateColumns).toEqual(["avatar_url", "emergency_contact", "full_name", "phone"]);

    // Sensitive governance and timezone attributes must NOT have direct UPDATE privilege
    const sensitiveColumns = [
      "timezone",
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

  it("ensures authenticated has execute privileges on exactly the authorized RPCs", async () => {
    const res = await client.query(`
      SELECT DISTINCT p.proname, p.oid::regprocedure::text AS signature
      FROM information_schema.role_routine_grants r
      JOIN pg_proc p ON p.proname = r.routine_name
      JOIN pg_namespace n ON p.pronamespace = n.oid AND n.nspname = 'public'
      LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
      WHERE r.grantee = 'authenticated'
        AND d.objid IS NULL
      ORDER BY p.proname, signature;
    `);

    const routineNames = Array.from(new Set(res.rows.map((r: any) => r.proname)));
    const expectedRoutines = [
      "admin_add_org_member",
      "admin_assign_shift",
      "admin_create_department",
      "admin_create_location",
      "admin_create_shift_template",
      "admin_deactivate_member",
      "admin_delete_department",
      "admin_delete_location",
      "admin_delete_shift_template",
      "admin_remove_org_member",
      "admin_update_attendance_policy",
      "admin_update_department",
      "admin_update_employee",
      "admin_update_employee_governance",
      "admin_update_location",
      "admin_update_org_member_role",
      "admin_update_organization_settings",
      "admin_update_retention_policy",
      "admin_update_shift_template",
      "allocate_yearly_balances",
      "approve_leave",
      "approve_regularization",
      "calculate_working_days",
      "cancel_leave",
      "check_in",
      "check_out",
      "complete_onboarding",
      "create_approval_delegation",
      "create_holiday",
      "current_org_id",
      "current_organization_id",
      "current_user_role",
      "declare_company_day_off",
      "delete_holiday",
      "get_month_close_checklist",
      "get_org_retention_preview",
      "get_org_system_health",
      "get_organization_leave_period",
      "get_user_role",
      "hr_adjust_balance",
      "hr_assign_leave",
      "hr_correct_attendance",
      "import_holiday_template",
      "is_active_delegated_approver",
      "is_active_org_member",
      "leave_slot_range",
      "lock_month",
      "reject_leave",
      "reject_regularization",
      "request_leave",
      "revoke_approval_delegation",
      "unlock_month",
      "update_holiday",
    ];

    expect(routineNames).toEqual(expectedRoutines);

    // Ensure no legacy duplicate check_out(uuid, uuid) overload remains granted
    const signatures = res.rows.map((r: any) => r.signature);
    expect(signatures).not.toContain("check_out(uuid,uuid)");
    expect(signatures).toContain("check_out()");
    expect(signatures).toContain("check_in(text)");
    expect(signatures).toContain("check_in(uuid,text)");
  });
});

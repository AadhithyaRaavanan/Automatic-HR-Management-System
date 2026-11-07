/**
 * Policy Inventory Snapshot Test
 *
 * Captures the exact inventory of PostgreSQL Row Level Security (RLS) policies
 * across all public tables, asserting:
 * 1. Expected policy names per table
 * 2. Permissive vs Restrictive type (RESTRICTIVE AAL2 and Active Org Membership policies)
 * 3. Specific SQL commands (SELECT, INSERT, UPDATE, DELETE, ALL)
 *
 * FAILS if any expected policy is dropped, renamed, or modified.
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

// Canonical Expected RLS Policy Inventory (65 Policies across 13 public tables)
const EXPECTED_POLICY_INVENTORY: Array<{
  tablename: string;
  policyname: string;
  permissive: "PERMISSIVE" | "RESTRICTIVE";
  cmd: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
}> = [
  {
    "tablename": "attendance_days",
    "policyname": "attendance_days_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "attendance_days",
    "policyname": "enforce_active_org_membership_attendance_days",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "attendance_days",
    "policyname": "enforce_mfa_aal2_attendance_days",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "attendance_policies",
    "policyname": "attendance_policies_admin_policy",
    "permissive": "PERMISSIVE",
    "cmd": "UPDATE"
  },
  {
    "tablename": "attendance_policies",
    "policyname": "attendance_policies_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "attendance_policies",
    "policyname": "enforce_active_org_membership_attendance_policies",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "attendance_policies",
    "policyname": "enforce_mfa_aal2_attendance_policies",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "attendance_sessions",
    "policyname": "attendance_sessions_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "attendance_sessions",
    "policyname": "enforce_active_org_membership_attendance_sessions",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "attendance_sessions",
    "policyname": "enforce_mfa_aal2_attendance_sessions",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "audit_logs",
    "policyname": "audit_logs_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "audit_logs",
    "policyname": "enforce_active_org_membership_audit_logs",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "audit_logs",
    "policyname": "enforce_mfa_aal2_audit_logs",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "departments",
    "policyname": "departments_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "departments",
    "policyname": "enforce_active_org_membership_departments",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "employee_shift_assignments",
    "policyname": "enforce_active_org_membership_shift_assignments",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "employee_shift_assignments",
    "policyname": "enforce_mfa_aal2_shift_assignments",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "employee_shift_assignments",
    "policyname": "tenant_shift_assignments_delete_policy",
    "permissive": "PERMISSIVE",
    "cmd": "DELETE"
  },
  {
    "tablename": "employee_shift_assignments",
    "policyname": "tenant_shift_assignments_insert_policy",
    "permissive": "PERMISSIVE",
    "cmd": "INSERT"
  },
  {
    "tablename": "employee_shift_assignments",
    "policyname": "tenant_shift_assignments_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "employee_shift_assignments",
    "policyname": "tenant_shift_assignments_update_policy",
    "permissive": "PERMISSIVE",
    "cmd": "UPDATE"
  },
  {
    "tablename": "employees",
    "policyname": "employees_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "employees",
    "policyname": "employees_update_policy",
    "permissive": "PERMISSIVE",
    "cmd": "UPDATE"
  },
  {
    "tablename": "employees",
    "policyname": "enforce_active_org_membership_employees",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "employees",
    "policyname": "enforce_mfa_aal2_employees",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "holidays",
    "policyname": "enforce_active_org_membership_holidays",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "holidays",
    "policyname": "enforce_mfa_aal2_holidays",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "holidays",
    "policyname": "holidays_delete_policy",
    "permissive": "PERMISSIVE",
    "cmd": "DELETE"
  },
  {
    "tablename": "holidays",
    "policyname": "holidays_insert_policy",
    "permissive": "PERMISSIVE",
    "cmd": "INSERT"
  },
  {
    "tablename": "holidays",
    "policyname": "holidays_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "holidays",
    "policyname": "holidays_update_policy",
    "permissive": "PERMISSIVE",
    "cmd": "UPDATE"
  },
  {
    "tablename": "kiosk_devices",
    "policyname": "enforce_active_org_membership_kiosk_devices",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "kiosk_devices",
    "policyname": "enforce_mfa_aal2_kiosk_devices",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "kiosk_devices",
    "policyname": "tenant_kiosk_devices_delete_policy",
    "permissive": "PERMISSIVE",
    "cmd": "DELETE"
  },
  {
    "tablename": "kiosk_devices",
    "policyname": "tenant_kiosk_devices_insert_policy",
    "permissive": "PERMISSIVE",
    "cmd": "INSERT"
  },
  {
    "tablename": "kiosk_devices",
    "policyname": "tenant_kiosk_devices_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "kiosk_devices",
    "policyname": "tenant_kiosk_devices_update_policy",
    "permissive": "PERMISSIVE",
    "cmd": "UPDATE"
  },
  {
    "tablename": "locations",
    "policyname": "enforce_active_org_membership_locations",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "locations",
    "policyname": "enforce_mfa_aal2_locations",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "locations",
    "policyname": "tenant_locations_delete_policy",
    "permissive": "PERMISSIVE",
    "cmd": "DELETE"
  },
  {
    "tablename": "locations",
    "policyname": "tenant_locations_insert_policy",
    "permissive": "PERMISSIVE",
    "cmd": "INSERT"
  },
  {
    "tablename": "locations",
    "policyname": "tenant_locations_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "locations",
    "policyname": "tenant_locations_update_policy",
    "permissive": "PERMISSIVE",
    "cmd": "UPDATE"
  },
  {
    "tablename": "notifications",
    "policyname": "enforce_active_org_membership_notifications",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "notifications",
    "policyname": "notifications_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "notifications",
    "policyname": "notifications_update_policy",
    "permissive": "PERMISSIVE",
    "cmd": "UPDATE"
  },
  {
    "tablename": "organization_members",
    "policyname": "enforce_active_org_membership_members",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "organization_members",
    "policyname": "enforce_mfa_aal2_organization_members",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "organization_members",
    "policyname": "tenant_members_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "organizations",
    "policyname": "enforce_active_org_membership_organizations",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "organizations",
    "policyname": "enforce_mfa_aal2_organizations",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "organizations",
    "policyname": "tenant_organizations_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "organizations",
    "policyname": "tenant_organizations_update_policy",
    "permissive": "PERMISSIVE",
    "cmd": "UPDATE"
  },
  {
    "tablename": "privacy_acknowledgments",
    "policyname": "enforce_active_org_membership_privacy_acknowledgments",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "privacy_acknowledgments",
    "policyname": "enforce_mfa_aal2_privacy_acknowledgments",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "privacy_acknowledgments",
    "policyname": "tenant_privacy_acknowledgments_insert_policy",
    "permissive": "PERMISSIVE",
    "cmd": "INSERT"
  },
  {
    "tablename": "privacy_acknowledgments",
    "policyname": "tenant_privacy_acknowledgments_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "regularization_requests",
    "policyname": "enforce_active_org_membership_regularization_requests",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "regularization_requests",
    "policyname": "enforce_mfa_aal2_regularization_requests",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "regularization_requests",
    "policyname": "regularization_requests_insert_policy",
    "permissive": "PERMISSIVE",
    "cmd": "INSERT"
  },
  {
    "tablename": "regularization_requests",
    "policyname": "regularization_requests_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "shift_templates",
    "policyname": "enforce_active_org_membership_shift_templates",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "shift_templates",
    "policyname": "enforce_mfa_aal2_shift_templates",
    "permissive": "RESTRICTIVE",
    "cmd": "ALL"
  },
  {
    "tablename": "shift_templates",
    "policyname": "tenant_shift_templates_delete_policy",
    "permissive": "PERMISSIVE",
    "cmd": "DELETE"
  },
  {
    "tablename": "shift_templates",
    "policyname": "tenant_shift_templates_insert_policy",
    "permissive": "PERMISSIVE",
    "cmd": "INSERT"
  },
  {
    "tablename": "shift_templates",
    "policyname": "tenant_shift_templates_select_policy",
    "permissive": "PERMISSIVE",
    "cmd": "SELECT"
  },
  {
    "tablename": "shift_templates",
    "policyname": "tenant_shift_templates_update_policy",
    "permissive": "PERMISSIVE",
    "cmd": "UPDATE"
  }
];

describe("Policy Inventory Snapshot Test", () => {
  let client: Client;

  beforeAll(async () => {
    if (!dbUrl) {
      throw new Error("DATABASE_URL must be configured in .env.staging or process.env");
    }
    const isLocal = dbUrl.includes("127.0.0.1") || dbUrl.includes("localhost");
    client = new Client({
      connectionString: dbUrl,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.end().catch(() => {});
    }
  });

  it("matches the exact canonical inventory of RLS policies across all public tables", async () => {
    const res = await client.query(`
      SELECT 
        tablename, 
        policyname, 
        permissive, 
        cmd 
      FROM pg_policies 
      WHERE schemaname = 'public' 
      ORDER BY tablename, policyname;
    `);

    const livePolicies = res.rows.map((r: any) => ({
      tablename: r.tablename,
      policyname: r.policyname,
      permissive: r.permissive,
      cmd: r.cmd,
    }));

    // 1. Total policy count check
    expect(livePolicies.length).toBe(EXPECTED_POLICY_INVENTORY.length);

    // 2. Exact match check
    expect(livePolicies).toEqual(EXPECTED_POLICY_INVENTORY);
  });
});

/**
 * Public SECURITY DEFINER Function Reconciliation Suite (Section 0d)
 *
 * Queries live `pg_proc` for EVERY `SECURITY DEFINER` function in schema `public`
 * and asserts:
 * 1. `search_path=""` is pinned (`proconfig` contains `search_path=""`).
 * 2. Zero EXECUTE privileges exist for `PUBLIC` or `anon`.
 * 3. Every function signature maps explicitly to at least one existing test suite
 *    in `tests/database/` covering its authorization, tenant isolation, or invariants.
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
    throw new Error(`CRITICAL SECURITY FAILURE: Database tests must run only against localhost (attempted: ${host})`);
  }
  return url;
}

const dbUrl = enforceLocalDatabaseHost(getDatabaseUrl());

/**
 * Exhaustive registry mapping every `public` SECURITY DEFINER function signature
 * to the test files that directly verify its security & behavior.
 */
const FUNCTION_TEST_MAP: Record<string, { role: "authenticated" | "service_role" | "supabase_auth_admin" | "trigger"; tests: string[] }> = {
  "admin_add_org_member(uuid,uuid,text)": {
    role: "authenticated",
    tests: ["intra-tenant-authorization.test.ts", "phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_assign_shift(uuid,uuid,date,date)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "cross-tenant-isolation.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_create_department(text,text,uuid,uuid)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_create_location(text,text,text,text,integer,integer[])": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_create_organization(text,text,text,text)": {
    role: "service_role",
    tests: ["grants-snapshot.test.ts", "schema-meta.test.ts"],
  },
  "admin_create_shift_template(text,text,time without time zone,time without time zone,integer,integer)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_deactivate_member(uuid)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_delete_department(uuid)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_delete_location(uuid)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_delete_shift_template(uuid)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_remove_org_member(uuid,uuid)": {
    role: "authenticated",
    tests: ["intra-tenant-authorization.test.ts", "phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_update_attendance_policy(integer,integer,time without time zone)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_update_department(uuid,text,text,uuid,uuid)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_update_employee(uuid,uuid,text,text,uuid,integer,integer[],integer,text)": {
    role: "authenticated",
    tests: ["intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_update_employee_governance(uuid,text,uuid,uuid,text,text,uuid,integer,integer[],integer,text)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_update_location(uuid,text,text,text,integer,integer[])": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_update_org_member_role(uuid,uuid,text)": {
    role: "authenticated",
    tests: ["intra-tenant-authorization.test.ts", "phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_update_organization_settings(text,text,text)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "admin_update_shift_template(uuid,text,time without time zone,time without time zone,integer,integer)": {
    role: "authenticated",
    tests: ["phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
  "allocate_yearly_balances(uuid,integer)": {
    role: "authenticated",
    tests: ["leave-rpcs.test.ts", "suspended-member-isolation.test.ts"],
  },
  "approve_leave(uuid,text)": {
    role: "authenticated",
    tests: ["leave-rpcs.test.ts", "suspended-member-isolation.test.ts"],
  },
  "approve_regularization(uuid,text)": {
    role: "authenticated",
    tests: ["cross-tenant-isolation.test.ts", "intra-tenant-authorization.test.ts", "leave-rpcs.test.ts", "suspended-member-isolation.test.ts"],
  },
  "calculate_working_days(uuid,date,date,text)": {
    role: "authenticated",
    tests: ["leave-rpcs.test.ts", "suspended-member-isolation.test.ts"],
  },
  "can_approve_for(uuid,uuid)": {
    role: "service_role",
    tests: ["leave-rpcs.test.ts", "grants-snapshot.test.ts"],
  },
  "cancel_leave(uuid,text)": {
    role: "authenticated",
    tests: ["leave-rpcs.test.ts", "suspended-member-isolation.test.ts"],
  },
  "check_employee_field_protection()": {
    role: "trigger",
    tests: ["grants-snapshot.test.ts", "intra-tenant-authorization.test.ts"],
  },
  "check_in(text)": {
    role: "authenticated",
    tests: ["intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "check_in(uuid,text)": {
    role: "authenticated",
    tests: ["cross-tenant-isolation.test.ts", "intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "check_out()": {
    role: "authenticated",
    tests: ["grants-snapshot.test.ts", "intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "cron_auto_checkout()": {
    role: "service_role",
    tests: ["grants-snapshot.test.ts", "schema-meta.test.ts"],
  },
  "cron_nightly_finalize()": {
    role: "service_role",
    tests: ["grants-snapshot.test.ts", "schema-meta.test.ts"],
  },
  "current_org_id()": {
    role: "authenticated",
    tests: ["policy-inventory.test.ts", "cross-tenant-isolation.test.ts", "suspended-member-isolation.test.ts"],
  },
  "current_organization_id()": {
    role: "authenticated",
    tests: ["grants-snapshot.test.ts", "cross-tenant-isolation.test.ts"],
  },
  "current_user_role()": {
    role: "authenticated",
    tests: ["intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "custom_access_token_hook(jsonb)": {
    role: "supabase_auth_admin",
    tests: ["grants-snapshot.test.ts", "admin-routes-integration.test.ts"],
  },
  "declare_company_day_off(date,text,uuid)": {
    role: "authenticated",
    tests: ["leave-rpcs.test.ts", "suspended-member-isolation.test.ts"],
  },
  "get_organization_leave_period(uuid,date)": {
    role: "authenticated",
    tests: ["leave-rpcs.test.ts", "suspended-member-isolation.test.ts"],
  },
  "get_user_role(uuid)": {
    role: "authenticated",
    tests: ["suspended-member-isolation.test.ts", "grants-snapshot.test.ts"],
  },
  "hr_adjust_balance(uuid,uuid,numeric,text)": {
    role: "authenticated",
    tests: ["leave-rpcs.test.ts", "suspended-member-isolation.test.ts"],
  },
  "hr_assign_leave(uuid[],uuid,date,date,text,text,boolean)": {
    role: "authenticated",
    tests: ["leave-rpcs.test.ts", "suspended-member-isolation.test.ts"],
  },
  "is_active_org_member()": {
    role: "authenticated",
    tests: ["policy-inventory.test.ts", "suspended-member-isolation.test.ts"],
  },
  "lock_month(integer,integer)": {
    role: "authenticated",
    tests: ["cross-tenant-isolation.test.ts", "intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "protect_organization_fields()": {
    role: "trigger",
    tests: ["grants-snapshot.test.ts", "intra-tenant-authorization.test.ts"],
  },
  "provision_invited_employee(uuid,uuid,text,text,text,text,text,uuid,uuid,uuid,integer,integer[],integer)": {
    role: "service_role",
    tests: ["intra-tenant-authorization.test.ts", "admin-routes-integration.test.ts"],
  },
  "punch_verified(uuid,text,uuid,text)": {
    role: "service_role",
    tests: ["cross-tenant-isolation.test.ts", "intra-tenant-authorization.test.ts"],
  },
  "recalculate_day(uuid,date)": {
    role: "service_role",
    tests: ["schema-meta.test.ts", "leave-rpcs.test.ts"],
  },
  "reject_leave(uuid,text)": {
    role: "authenticated",
    tests: ["leave-rpcs.test.ts", "suspended-member-isolation.test.ts"],
  },
  "reject_regularization(uuid,text)": {
    role: "authenticated",
    tests: ["cross-tenant-isolation.test.ts", "intra-tenant-authorization.test.ts", "suspended-member-isolation.test.ts"],
  },
  "request_leave(uuid,date,date,text,text)": {
    role: "authenticated",
    tests: ["leave-rpcs.test.ts", "suspended-member-isolation.test.ts"],
  },
  "trg_derive_audit_log_org_id()": {
    role: "trigger",
    tests: ["grants-snapshot.test.ts", "cross-tenant-isolation.test.ts"],
  },
  "trg_derive_day_org_id()": {
    role: "trigger",
    tests: ["grants-snapshot.test.ts", "cross-tenant-isolation.test.ts"],
  },
  "trg_derive_notification_org_id()": {
    role: "trigger",
    tests: ["grants-snapshot.test.ts", "cross-tenant-isolation.test.ts"],
  },
  "trg_derive_request_org_id()": {
    role: "trigger",
    tests: ["grants-snapshot.test.ts", "cross-tenant-isolation.test.ts"],
  },
  "trg_derive_session_org_id()": {
    role: "trigger",
    tests: ["grants-snapshot.test.ts", "cross-tenant-isolation.test.ts"],
  },
  "trg_protect_employee_fields()": {
    role: "trigger",
    tests: ["grants-snapshot.test.ts", "intra-tenant-authorization.test.ts"],
  },
  "trg_protect_location_ip_ranges()": {
    role: "trigger",
    tests: ["grants-snapshot.test.ts"],
  },
  "trg_set_privacy_acknowledgment_defaults()": {
    role: "trigger",
    tests: ["grants-snapshot.test.ts"],
  },
  "unlock_month(integer,integer)": {
    role: "authenticated",
    tests: ["intra-tenant-authorization.test.ts", "phase3-rpc-matrix.test.ts", "suspended-member-isolation.test.ts"],
  },
};

describe("Section 0d: Public SECURITY DEFINER Function Reconciliation", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({
      connectionString: dbUrl,
      ssl: false,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  it("reconciles every public SECURITY DEFINER function in pg_proc with search_path='', tight EXECUTE grants, and test coverage", async () => {
    const res = await client.query(`
      SELECT
        p.oid::regprocedure::text AS sig,
        p.proconfig,
        has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
      WHERE n.nspname = 'public'
        AND d.objid IS NULL
        AND p.prosecdef = true
      ORDER BY sig;
    `);

    const dbSigs = res.rows.map((r: any) => r.sig).sort();
    const mappedSigs = Object.keys(FUNCTION_TEST_MAP).sort();

    // 1. Exact reconciliation: no unmapped functions in pg_proc and no stale entries in map
    expect(dbSigs).toEqual(mappedSigs);

    // 2. Every SECURITY DEFINER function pins search_path="" and blocks PUBLIC & anon
    for (const row of res.rows) {
      expect(row.proconfig, `${row.sig} must set search_path = ''`).toContain('search_path=""');
      expect(row.public_exec, `${row.sig} must NOT be executable by PUBLIC`).toBe(false);
      expect(row.anon_exec, `${row.sig} must NOT be executable by anon`).toBe(false);

      const meta = FUNCTION_TEST_MAP[row.sig];
      if (meta.role !== "authenticated") {
        expect(row.auth_exec, `${row.sig} (${meta.role}-only) must NOT be executable by authenticated`).toBe(false);
      }

      // 3. Verify every referenced test file exists on disk
      for (const tf of meta.tests) {
        const testPath = path.resolve(process.cwd(), "tests", "database", tf);
        expect(fs.existsSync(testPath), `Missing mapped test file: ${testPath}`).toBe(true);
      }
    }

    // 4. Legacy check_out(uuid, uuid) overload must be gone
    expect(dbSigs).not.toContain("check_out(uuid,uuid)");
  });

  it("verifies audit_logs trigger/RPC writes conform to UPPER_SNAKE naming convention", async () => {
    const allowedNonUpperSeedOnly = ["approve_regularization", "update_policy"];
    const res = await client.query(`
      SELECT DISTINCT action FROM public.audit_logs;
    `);
    for (const row of res.rows) {
      if (!allowedNonUpperSeedOnly.includes(row.action)) {
        expect(row.action).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
    }
  });
});


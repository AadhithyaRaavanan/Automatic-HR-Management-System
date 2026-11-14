/**
 * Section 1: Core Architecture & Multi-Tenancy Automated Test Suite
 *
 * Covers features:
 *   [F1.1.1] Row-Level Security (RLS) on all tenant tables
 *   [F1.1.2] Tenant Context Hook (custom_access_token_hook)
 *   [F1.1.3] Cross-Tenant Attack Shielding on all SECDEF functions
 *   [F1.1.4] Tenant Lifecycle (trial, active, suspended, cancelled)
 *   [F1.1.5] Immediate Suspension Lockout
 *   [F1.2.1] Work Mode Policy (remote, office, hybrid)
 *   [F1.2.2] Organization Timezone Behavior Configuration
 *   [F1.2.3] Leave Year Fiscal Cycle Configuration
 *   [F1.2.4] Auto-Checkout Policy Cutoff
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

const ORG_2_ID = "00000000-0000-0000-0000-000000000002";
const ORG_2_EMPLOYEE = "00000000-0000-0000-0000-000000000024";

describe("Section 1: Core Architecture & Multi-Tenancy", () => {
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

  // [F1.1.1] Row-Level Security (RLS) on all tenant tables
  it("[F1.1.1] enforces Row-Level Security (RLS) on all tenant tables with organization_id", async () => {
    // 1. Query all tables in public schema that have an organization_id column
    const res = await client.query(`
      SELECT c.relname as table_name, c.relrowsecurity as rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attname = 'organization_id'
        AND NOT a.attisdropped;
    `);

    expect(res.rows.length).toBeGreaterThan(10);
    for (const row of res.rows) {
      expect(row.rls_enabled, `Table ${row.table_name} must have RLS enabled`).toBe(true);
    }

    // 2. An anonymous or claimless query must return 0 rows for tenant-isolated data
    await client.query("BEGIN;");
    try {
      await client.query("SET LOCAL ROLE authenticated;");
      await client.query(`SELECT set_config('request.jwt.claims', '{}', true);`);
      const empRes = await client.query("SELECT * FROM public.employees;");
      expect(empRes.rows.length).toBe(0);
      const attRes = await client.query("SELECT * FROM public.attendance_days;");
      expect(attRes.rows.length).toBe(0);
    } finally {
      await client.query("ROLLBACK;");
      await client.query("RESET ROLE;").catch(() => {});
    }
  });

  // [F1.1.2] Tenant Context Hook (custom_access_token_hook)
  it("[F1.1.2] injects organization_id, user_role, and status in custom_access_token_hook", async () => {
    // 1. Valid active user
    const inputEvent = {
      user_id: ORG_1_EMPLOYEE,
      claims: { aud: "authenticated" },
    };
    const hookRes = await client.query(
      `SELECT public.custom_access_token_hook($1::jsonb) as event;`,
      [JSON.stringify(inputEvent)]
    );
    const returnedEvent = hookRes.rows[0].event;
    expect(returnedEvent.claims.organization_id).toBe(ORG_1_ID);
    expect(returnedEvent.claims.user_role).toBe("employee");
    expect(returnedEvent.claims.organization_status).toBe("active");

    // 2. Suspended user's organization must raise exception
    const suspendedOrgId = "00000000-0000-0000-0000-000000000999";
    const suspendedUserId = "00000000-0000-0000-0000-000000000998";
    await client.query(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'suspended-hook@remotehr.io', 'fake', now(), '{}', '{}', now(), now())
       ON CONFLICT (id) DO NOTHING;`,
      [suspendedUserId]
    );
    await client.query(
      `INSERT INTO public.organizations (id, name, slug, status)
       VALUES ($1, 'Suspended Hook Org', 'suspended-hook-org', 'suspended')
       ON CONFLICT (id) DO NOTHING;`,
      [suspendedOrgId]
    );
    await client.query(
      `INSERT INTO public.organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, 'employee', 'active')
       ON CONFLICT (user_id) DO NOTHING;`,
      [suspendedOrgId, suspendedUserId]
    );

    const suspendedEvent = {
      user_id: suspendedUserId,
      claims: { aud: "authenticated" },
    };
    await expect(
      client.query(`SELECT public.custom_access_token_hook($1::jsonb);`, [JSON.stringify(suspendedEvent)])
    ).rejects.toThrow(/Organization account is suspended: access denied/);

    // Clean up
    await client.query(`DELETE FROM public.organization_members WHERE organization_id = $1;`, [suspendedOrgId]);
    await client.query(`DELETE FROM public.organizations WHERE id = $1;`, [suspendedOrgId]);
    await client.query(`DELETE FROM auth.users WHERE id = $1;`, [suspendedUserId]);
  });

  // [F1.1.3] Cross-Tenant Attack Shielding on all SECDEF functions
  it("[F1.1.3] shields SECDEF functions from cross-tenant access with 42501 or empty results", async () => {
    // Org 1 admin attempts to invoke get_organization_leave_period targeting Org 2
    await asUser(ORG_1_ADMIN, ORG_1_ID, "admin", async (c) => {
      await expect(
        c.query(`SELECT * FROM public.get_organization_leave_period($1, CURRENT_DATE);`, [ORG_2_ID])
      ).rejects.toThrow();
    }, "aal2");

    // Org 1 employee attempts to read Org 2 employees
    await asUser(ORG_1_EMPLOYEE, ORG_1_ID, "employee", async (c) => {
      const res = await c.query("SELECT * FROM public.employees WHERE organization_id = $1;", [ORG_2_ID]);
      expect(res.rows.length).toBe(0);
    });
  });

  // [F1.1.4] Tenant Lifecycle (trial, active, suspended, cancelled)
  it("[F1.1.4] enforces tenant lifecycle status constraints (trial, active, suspended, cancelled)", async () => {
    const statuses = ["trial", "active", "suspended", "cancelled"];
    for (let i = 0; i < statuses.length; i++) {
      const s = statuses[i];
      const orgId = `00000000-0000-0000-0000-00000000088${i}`;
      await client.query(
        `INSERT INTO public.organizations (id, name, slug, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING;`,
        [orgId, `Lifecycle Org ${s}`, `lifecycle-org-${s}-${i}`, s]
      );
      const res = await client.query("SELECT status FROM public.organizations WHERE id = $1;", [orgId]);
      expect(res.rows[0].status).toBe(s);

      // Attempting direct status update is prevented by trigger immutability
      const newStatus = s === "active" ? "suspended" : "active";
      await expect(
        client.query("UPDATE public.organizations SET status = $1 WHERE id = $2;", [newStatus, orgId])
      ).rejects.toThrow(/Forbidden: Organization status is immutable/);

      // Clean up
      await client.query("DELETE FROM public.organizations WHERE id = $1;", [orgId]);
    }

    // Attempting to insert an unknown status violates CHECK constraint
    const badOrgId = "00000000-0000-0000-0000-000000000889";
    await expect(
      client.query(
        `INSERT INTO public.organizations (id, name, slug, status)
         VALUES ($1, 'Bad Org', 'bad-org', 'invalid_status');`,
        [badOrgId]
      )
    ).rejects.toThrow(/check constraint/i);
  });

  // [F1.1.5] Immediate Suspension Lockout
  it("[F1.1.5] immediately revokes reads, writes, and RPC execution when organization is suspended", async () => {
    const tempOrgId = "00000000-0000-0000-0000-000000000777";
    const tempUserId = "00000000-0000-0000-0000-000000000778";

    // Create temp user and suspended org & member
    await client.query(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'temp-suspended@remotehr.io', 'fake', now(), '{}', '{}', now(), now())
       ON CONFLICT (id) DO NOTHING;`,
      [tempUserId]
    );
    await client.query(
      `INSERT INTO public.organizations (id, name, slug, status)
       VALUES ($1, 'Temp Suspended Org', 'temp-suspended-org', 'suspended')
       ON CONFLICT (id) DO NOTHING;`,
      [tempOrgId]
    );
    await client.query(
      `INSERT INTO public.organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, 'employee', 'active')
       ON CONFLICT (user_id) DO NOTHING;`,
      [tempOrgId, tempUserId]
    );

    // User attempts queries with their token claims for the suspended org
    await asUser(tempUserId, tempOrgId, "employee", async (c) => {
      // 1. Reading tenant tables must return 0 rows under RESTRICTIVE policy
      const empRes = await c.query("SELECT * FROM public.employees WHERE organization_id = $1;", [tempOrgId]);
      expect(empRes.rows.length).toBe(0);

      // 2. Authenticated RPCs must fail
      await expect(
        c.query("SELECT public.check_in('web');")
      ).rejects.toThrow(/42501|suspended|Forbidden/);
    });

    // Clean up
    await client.query("DELETE FROM public.organization_members WHERE organization_id = $1;", [tempOrgId]);
    await client.query("DELETE FROM public.organizations WHERE id = $1;", [tempOrgId]);
    await client.query("DELETE FROM auth.users WHERE id = $1;", [tempUserId]);
  });

  // [F1.2.1] Work Mode Policy (remote, office, hybrid)
  it("[F1.2.1] persists and validates work mode policies (remote, office, hybrid)", async () => {
    // Check constraint on attendance_policies.work_mode
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'attendance_policies' AND column_name = 'work_mode';
    `);
    expect(res.rows.length).toBe(1);

    // Update work mode to remote, office, hybrid
    for (const mode of ["remote", "office", "hybrid"]) {
      await client.query(
        "UPDATE public.attendance_policies SET work_mode = $1 WHERE organization_id = $2;",
        [mode, ORG_1_ID]
      );
      const chk = await client.query(
        "SELECT work_mode FROM public.attendance_policies WHERE organization_id = $1;",
        [ORG_1_ID]
      );
      expect(chk.rows[0].work_mode).toBe(mode);
    }

    // Invalid work mode must be rejected
    await expect(
      client.query("UPDATE public.attendance_policies SET work_mode = 'anywhere' WHERE organization_id = $1;", [ORG_1_ID])
    ).rejects.toThrow();

    // Restore to remote
    await client.query("UPDATE public.attendance_policies SET work_mode = 'remote' WHERE organization_id = $1;", [ORG_1_ID]);
  });

  // [F1.2.2] Organization Timezone Behavior Configuration
  it("[F1.2.2] isolates organization timezone configuration across tenants", async () => {
    // Verify Org 1 has Asia/Kolkata and Org 2 has UTC or distinct timezone
    await client.query("UPDATE public.organizations SET timezone = 'Asia/Kolkata' WHERE id = $1;", [ORG_1_ID]);
    
    // Ensure Org 2 exists with UTC
    await client.query(`
      INSERT INTO public.organizations (id, name, slug, timezone, status)
      VALUES ($1, 'Acme UTC Org', 'acme-utc-org', 'UTC', 'active')
      ON CONFLICT (id) DO UPDATE SET timezone = 'UTC';
    `, [ORG_2_ID]);

    const org1 = await client.query("SELECT timezone FROM public.organizations WHERE id = $1;", [ORG_1_ID]);
    const org2 = await client.query("SELECT timezone FROM public.organizations WHERE id = $1;", [ORG_2_ID]);

    expect(org1.rows[0].timezone).toBe("Asia/Kolkata");
    expect(org2.rows[0].timezone).toBe("UTC");
  });

  // [F1.2.3] Leave Year Fiscal Cycle Configuration
  it("[F1.2.3] supports configurable fiscal leave year start month (1 vs 4)", async () => {
    // Set Org 1 to January (1)
    await client.query("UPDATE public.organizations SET leave_year_start_month = 1 WHERE id = $1;", [ORG_1_ID]);
    const pJan = await client.query(
      "SELECT to_char(period_start, 'YYYY-MM-DD') as period_start, to_char(period_end, 'YYYY-MM-DD') as period_end FROM public.get_organization_leave_period($1, '2026-02-15'::date);",
      [ORG_1_ID]
    );
    expect(pJan.rows[0].period_start).toBe("2026-01-01");
    expect(pJan.rows[0].period_end).toBe("2026-12-31");

    // Set Org 1 to April (4)
    await client.query("UPDATE public.organizations SET leave_year_start_month = 4 WHERE id = $1;", [ORG_1_ID]);
    const pApr = await client.query(
      "SELECT to_char(period_start, 'YYYY-MM-DD') as period_start, to_char(period_end, 'YYYY-MM-DD') as period_end FROM public.get_organization_leave_period($1, '2026-02-15'::date);",
      [ORG_1_ID]
    );
    // On 2026-02-15 with April cycle, start is 2025-04-01 and end is 2026-03-31
    expect(pApr.rows[0].period_start).toBe("2025-04-01");
    expect(pApr.rows[0].period_end).toBe("2026-03-31");

    // Restore to January
    await client.query("UPDATE public.organizations SET leave_year_start_month = 1 WHERE id = $1;", [ORG_1_ID]);
  });

  // [F1.2.4] Auto-Checkout Policy Cutoff
  it("[F1.2.4] persists configurable auto-checkout policy cutoff", async () => {
    await client.query(
      "UPDATE public.attendance_policies SET auto_checkout_time = '21:30:00' WHERE organization_id = $1;",
      [ORG_1_ID]
    );
    const res = await client.query(
      "SELECT auto_checkout_time FROM public.attendance_policies WHERE organization_id = $1;",
      [ORG_1_ID]
    );
    expect(res.rows[0].auto_checkout_time).toBe("21:30:00");

    // Restore default
    await client.query(
      "UPDATE public.attendance_policies SET auto_checkout_time = '23:59:00' WHERE organization_id = $1;",
      [ORG_1_ID]
    );
  });
});

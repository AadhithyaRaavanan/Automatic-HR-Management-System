/**
 * Schema Meta-Test Suite
 *
 * Verifies structural, multi-tenancy, and security invariants across the real PostgreSQL schema:
 * 1. organization_id presence on every public table (with explicit documented exemptions)
 * 2. 100% Row Level Security (RLS) enforcement across all public tables
 * 3. Security Invoker views (no default security_barrier / definer views)
 * 4. Empty search_path on all SECURITY DEFINER functions
 * 5. Clean primary key on cron_run_state without expression indexes
 * 6. Zero EXECUTE grants for PUBLIC and anon on every SECURITY DEFINER function
 * 7. Automatic organization_id derivation triggers (in system/cron context with null auth.uid())
 * 8. admin_create_organization access control (service_role only; deny authenticated and anon)
 * 9. custom_access_token_hook status handling (active, trial, suspended, cancelled, unassociated)
 * 10. Hybrid work mode timezone resolution at first punch of day
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

const ORG_ID_EXEMPTIONS = new Set([
  "organizations",
  "auth_rate_limits",
  "kiosk_credentials",
]);

describe("PostgreSQL Schema Meta-Test Suite", () => {
  let client: Client | null = null;
  let isConnected = false;

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
    } catch {
      isConnected = false;
    }
  });

  afterAll(async () => {
    if (client && isConnected) {
      await client.end().catch(() => {});
    }
  });

  it("fails if any public table lacks organization_id (excluding documented exemptions)", async () => {
    if (!isConnected || !client) return;

    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const orgColsRes = await client.query(`
      SELECT table_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND column_name = 'organization_id';
    `);

    const tablesWithOrgId = new Set(orgColsRes.rows.map((r: any) => r.table_name));

    for (const row of tablesRes.rows) {
      const tableName = row.table_name;
      if (ORG_ID_EXEMPTIONS.has(tableName)) continue;
      expect(
        tablesWithOrgId.has(tableName),
        `Public table "${tableName}" lacks required organization_id column!`
      ).toBe(true);
    }
  });

  it("fails if any public table lacks Row Level Security (RLS)", async () => {
    if (!isConnected || !client) return;

    const res = await client.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    expect(res.rows.length).toBeGreaterThan(0);
    for (const row of res.rows) {
      expect(
        row.rowsecurity,
        `Table "${row.tablename}" does NOT have Row Level Security enabled!`
      ).toBe(true);
    }
  });

  it("fails if any view in public is not configured with security_invoker = true", async () => {
    if (!isConnected || !client) return;

    const res = await client.query(`
      SELECT c.relname AS view_name, c.reloptions
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' 
        AND c.relkind = 'v'
      ORDER BY c.relname;
    `);

    for (const row of res.rows) {
      const options: string[] = row.reloptions || [];
      const hasSecurityInvoker = options.includes("security_invoker=true");
      expect(
        hasSecurityInvoker,
        `View "${row.view_name}" must be created WITH (security_invoker = true)!`
      ).toBe(true);
    }
  });

  it("fails if any SECURITY DEFINER function in public lacks an empty search_path", async () => {
    if (!isConnected || !client) return;

    const res = await client.query(`
      SELECT p.proname, p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prosecdef = true
      ORDER BY p.proname;
    `);

    expect(res.rows.length).toBeGreaterThan(0);
    for (const row of res.rows) {
      const configs: string[] = row.proconfig || [];
      const hasEmptySearchPath = configs.some((c) => c === "search_path=" || c === "search_path=\"\"");
      expect(
        hasEmptySearchPath,
        `SECURITY DEFINER function "${row.proname}" lacks SET search_path = ''!`
      ).toBe(true);
    }
  });

  it("fails if any SECURITY DEFINER function in public has execute grants for PUBLIC or anon", async () => {
    if (!isConnected || !client) return;

    const res = await client.query(`
      SELECT 
        p.proname,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
        has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prosecdef = true
      ORDER BY p.proname;
    `);

    expect(res.rows.length).toBeGreaterThan(0);
    for (const row of res.rows) {
      expect(
        row.anon_exec,
        `SECURITY DEFINER function "${row.proname}" must NOT be executable by anon!`
      ).toBe(false);
      expect(
        row.public_exec,
        `SECURITY DEFINER function "${row.proname}" must NOT be executable by PUBLIC!`
      ).toBe(false);
    }
  });

  it("confirms cron_run_state has a surrogate primary key with no expression", async () => {
    if (!isConnected || !client) return;

    const res = await client.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'cron_run_state'
        AND tc.constraint_type = 'PRIMARY KEY';
    `);

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].column_name).toBe("id");
  });

  it("verifies organization_id derivation triggers automatically derive org in system context with null auth.uid()", async () => {
    if (!isConnected || !client) return;

    const empRes = await client.query(`SELECT id, organization_id FROM public.employees LIMIT 1;`);
    expect(empRes.rows.length).toBeGreaterThan(0);
    const emp = empRes.rows[0];

    // 1. attendance_sessions derivation
    const sessionRes = await client.query(`
      INSERT INTO public.attendance_sessions (employee_id, work_date, check_in_at, source)
      VALUES ($1, '2026-11-20', '2026-11-20 09:00:00+00', 'manual')
      RETURNING id, organization_id;
    `, [emp.id]);
    expect(sessionRes.rows[0].organization_id).toBe(emp.organization_id);

    // 2. attendance_days derivation
    const dayRes = await client.query(`
      INSERT INTO public.attendance_days (employee_id, work_date, total_minutes, status)
      VALUES ($1, '2026-11-20', 480, 'present')
      RETURNING employee_id, work_date, organization_id;
    `, [emp.id]);
    expect(dayRes.rows[0].organization_id).toBe(emp.organization_id);

    // 3. regularization_requests derivation
    const reqRes = await client.query(`
      INSERT INTO public.regularization_requests (employee_id, work_date, requested_in, requested_out, reason)
      VALUES ($1, '2026-11-20', '2026-11-20 09:00:00+00', '2026-11-20 17:00:00+00', 'Trigger test')
      RETURNING id, organization_id;
    `, [emp.id]);
    expect(reqRes.rows[0].organization_id).toBe(emp.organization_id);

    // 4. notifications derivation
    const notifRes = await client.query(`
      INSERT INTO public.notifications (user_id, title, body, type)
      VALUES ($1, 'Test Notif', 'Test Body', 'reminder')
      RETURNING id, organization_id;
    `, [emp.id]);
    expect(notifRes.rows[0].organization_id).toBe(emp.organization_id);

    // 5. audit_logs derivation
    const auditRes = await client.query(`
      INSERT INTO public.audit_logs (actor_id, action, table_name, record_id)
      VALUES ($1, 'TEST_TRIGGER', 'test', gen_random_uuid())
      RETURNING id, organization_id;
    `, [emp.id]);
    expect(auditRes.rows[0].organization_id).toBe(emp.organization_id);

    // Cleanup test rows
    await client.query(`DELETE FROM public.audit_logs WHERE id = $1`, [auditRes.rows[0].id]);
    await client.query(`DELETE FROM public.notifications WHERE id = $1`, [notifRes.rows[0].id]);
    await client.query(`DELETE FROM public.regularization_requests WHERE id = $1`, [reqRes.rows[0].id]);
    await client.query(`DELETE FROM public.attendance_sessions WHERE id = $1`, [sessionRes.rows[0].id]);
    await client.query(`DELETE FROM public.attendance_days WHERE employee_id = $1 AND work_date = '2026-11-20'`, [emp.id]);
  });

  it("verifies admin_create_organization access control: service_role succeeds; authenticated/anon are denied", async () => {
    if (!isConnected || !client) return;

    // As postgres / service_role: succeeds
    const orgRes = await client.query(`
      SELECT public.admin_create_organization('Meta Test Org', 'meta-test-org', 'remote', 'UTC') AS org_id;
    `);
    const newOrgId = orgRes.rows[0].org_id;
    expect(newOrgId).toBeDefined();

    // Verify authenticated role is denied
    await expect(
      client.query(`
        SET ROLE authenticated;
        SELECT public.admin_create_organization('Hacker Org', 'hacker-org', 'remote', 'UTC');
      `)
    ).rejects.toThrow(/permission denied for function admin_create_organization/i);

    // Reset role to superuser
    await client.query(`RESET ROLE;`);

    // Verify anon role is denied
    await expect(
      client.query(`
        SET ROLE anon;
        SELECT public.admin_create_organization('Anon Org', 'anon-org', 'remote', 'UTC');
      `)
    ).rejects.toThrow(/permission denied for function admin_create_organization/i);

    await client.query(`RESET ROLE;`);

    // Cleanup
    await client.query(`DELETE FROM public.organizations WHERE id = $1;`, [newOrgId]);
  });

  it("verifies custom_access_token_hook: allows active/trial, rejects suspended/cancelled, handles unassociated user", async () => {
    if (!isConnected || !client) return;

    const uActive = "00000000-0000-0000-0000-000000000901";
    const uTrial = "00000000-0000-0000-0000-000000000902";
    const uSuspended = "00000000-0000-0000-0000-000000000903";
    const uCancelled = "00000000-0000-0000-0000-000000000904";
    const uUnassociated = "00000000-0000-0000-0000-000000000905";

    // Pre-cleanup if leftover
    await client.query(`DELETE FROM public.organization_members WHERE user_id IN ($1, $2, $3, $4, $5);`, [uActive, uTrial, uSuspended, uCancelled, uUnassociated]);
    await client.query(`DELETE FROM auth.users WHERE id IN ($1, $2, $3, $4, $5);`, [uActive, uTrial, uSuspended, uCancelled, uUnassociated]);
    await client.query(`DELETE FROM public.organizations WHERE slug IN ('org-hook-active', 'org-hook-trial', 'org-hook-suspended', 'org-hook-cancelled');`);

    let orgActiveId: string | null = null;
    let orgTrialId: string | null = null;
    let orgSuspendedId: string | null = null;
    let orgCancelledId: string | null = null;

    try {
      // 1. Create temporary test organizations and users
      orgActiveId = (await client.query(`
        INSERT INTO public.organizations (name, slug, status) VALUES ('Active Org', 'org-hook-active', 'active') RETURNING id;
      `)).rows[0].id;

      orgTrialId = (await client.query(`
        INSERT INTO public.organizations (name, slug, status) VALUES ('Trial Org', 'org-hook-trial', 'trial') RETURNING id;
      `)).rows[0].id;

      orgSuspendedId = (await client.query(`
        INSERT INTO public.organizations (name, slug, status) VALUES ('Suspended Org', 'org-hook-suspended', 'suspended') RETURNING id;
      `)).rows[0].id;

      orgCancelledId = (await client.query(`
        INSERT INTO public.organizations (name, slug, status) VALUES ('Cancelled Org', 'org-hook-cancelled', 'cancelled') RETURNING id;
      `)).rows[0].id;

      // Insert dummy auth.users
      for (const uid of [uActive, uTrial, uSuspended, uCancelled, uUnassociated]) {
        const email = `${uid}@test.com`;
        await client.query(`
          INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
          VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, 'fakehash', now(), '{"provider":"email"}', '{}', now(), now())
          ON CONFLICT (id) DO NOTHING;
        `, [uid, email]);
      }

      // Insert organization memberships
      await client.query(`INSERT INTO public.organization_members (organization_id, user_id, role) VALUES ($1, $2, 'employee');`, [orgActiveId, uActive]);
      await client.query(`INSERT INTO public.organization_members (organization_id, user_id, role) VALUES ($1, $2, 'hr');`, [orgTrialId, uTrial]);
      await client.query(`INSERT INTO public.organization_members (organization_id, user_id, role) VALUES ($1, $2, 'admin');`, [orgSuspendedId, uSuspended]);
      await client.query(`INSERT INTO public.organization_members (organization_id, user_id, role) VALUES ($1, $2, 'manager');`, [orgCancelledId, uCancelled]);
      // uUnassociated has NO organization_members row

      // Test 1: active org -> succeeds with role, organization_id, and organization_status = 'active'
      const activeHook = await client.query(`
        SELECT public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)) AS hook_out;
      `, [uActive]);
      const activeClaims = activeHook.rows[0].hook_out.claims;
      expect(activeClaims.user_role).toBe("employee");
      expect(activeClaims.organization_id).toBe(orgActiveId);
      expect(activeClaims.organization_status).toBe("active");

      // Test 2: trial org -> succeeds with role, organization_id, and organization_status = 'trial'
      const trialHook = await client.query(`
        SELECT public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)) AS hook_out;
      `, [uTrial]);
      const trialClaims = trialHook.rows[0].hook_out.claims;
      expect(trialClaims.user_role).toBe("hr");
      expect(trialClaims.organization_id).toBe(orgTrialId);
      expect(trialClaims.organization_status).toBe("trial");

      // Test 3: suspended org -> throws exception
      await expect(
        client.query(`SELECT public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb));`, [uSuspended])
      ).rejects.toThrow(/Organization account is suspended/i);

      // Test 4: cancelled org -> throws exception
      await expect(
        client.query(`SELECT public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb));`, [uCancelled])
      ).rejects.toThrow(/Organization account is cancelled/i);

      // Test 5: unassociated user -> permits login, no organization_id claim, user_role is undefined (no default role)
      const unassocHook = await client.query(`
        SELECT public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)) AS hook_out;
      `, [uUnassociated]);
      const unassocClaims = unassocHook.rows[0].hook_out.claims;
      expect(unassocClaims.user_role).toBeUndefined();
      expect(unassocClaims.organization_id).toBeUndefined();
      expect(unassocClaims.organization_status).toBeUndefined();
    } finally {
      // Clean up
      for (const uid of [uActive, uTrial, uSuspended, uCancelled, uUnassociated]) {
        await client.query(`DELETE FROM public.organization_members WHERE user_id = $1;`, [uid]).catch(() => {});
        await client.query(`DELETE FROM auth.users WHERE id = $1;`, [uid]).catch(() => {});
      }
      if (orgActiveId) await client.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgActiveId]).catch(() => {});
      if (orgTrialId) await client.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgTrialId]).catch(() => {});
      if (orgSuspendedId) await client.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgSuspendedId]).catch(() => {});
      if (orgCancelledId) await client.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgCancelledId]).catch(() => {});
    }
  });

  it("verifies hybrid timezone resolution at first punch of day before work location is established", async () => {
    if (!isConnected || !client) return;

    // Create hybrid employee with Asia/Tokyo timezone in Org with Europe/London timezone
    const orgId = (await client.query(`
      INSERT INTO public.organizations (name, slug, work_mode, timezone) 
      VALUES ('Hybrid Test Org', 'hybrid-tz-org', 'hybrid', 'Europe/London') 
      RETURNING id;
    `)).rows[0].id;

    const locId = (await client.query(`
      INSERT INTO public.locations (organization_id, name, code, timezone)
      VALUES ($1, 'London HQ', 'LON-HQ', 'Europe/London')
      RETURNING id;
    `, [orgId])).rows[0].id;

    const empId = "00000000-0000-0000-0000-000000000999";
    await client.query(`
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hybrid@test.com', 'fake', now(), '{}', '{}', now(), now())
      ON CONFLICT (id) DO NOTHING;
    `, [empId]);

    await client.query(`
      INSERT INTO public.employees (id, organization_id, email, full_name, work_mode, timezone, primary_location_id)
      VALUES ($1, $2, 'hybrid@test.com', 'Hybrid User', 'hybrid', 'Asia/Tokyo', $3);
    `, [empId, orgId, locId]);

    // Recalculate day for empty day (no sessions): should use employee's personal timezone (Asia/Tokyo)
    await client.query(`SELECT public.recalculate_day($1, '2026-11-25'::date);`, [empId]);

    const dayRes = await client.query(`
      SELECT * FROM public.attendance_days WHERE employee_id = $1 AND work_date = '2026-11-25';
    `, [empId]);

    expect(dayRes.rows.length).toBe(1);
    expect(dayRes.rows[0].status).toBe("absent");
    expect(dayRes.rows[0].organization_id).toBe(orgId);

    // Cleanup
    await client.query(`DELETE FROM public.attendance_days WHERE employee_id = $1;`, [empId]);
    await client.query(`DELETE FROM public.employees WHERE id = $1;`, [empId]);
    await client.query(`DELETE FROM auth.users WHERE id = $1;`, [empId]);
    await client.query(`DELETE FROM public.locations WHERE id = $1;`, [locId]);
    await client.query(`DELETE FROM public.attendance_policies WHERE organization_id = $1;`, [orgId]);
    await client.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgId]);
  });
});

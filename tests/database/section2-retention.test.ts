/**
 * Section 2: Retention, Storage Archival & System Health Test Suite
 *
 * Covers:
 * 1. `retention_policies` table grants/RLS, legal floors (>= 18m sessions, >= 24m audits,
 *    >= 90d read notifications), `admin_update_retention_policy` RBAC/AAL2/audit log.
 * 2. `get_org_system_health` tenant-only row counts & approximate org storage (no platform DB size),
 *    denying employee/manager/HR/AAL1 admin & cross-tenant access.
 * 3. `run_retention_cleanup(dry_run boolean default true)`:
 *    - Weekly `pg_cron` schedule check ('weekly-retention-cleanup' -> '0 3 * * 0').
 *    - Role/grant isolation (`service_role` only; denied to authenticated/anon/PUBLIC).
 *    - Dry-run counts (reports eligible counts without deleting).
 *    - Safety invariant: refuses to delete old locked `attendance_sessions` until monthly
 *      compressed `.json.gz` export exists in private `retention-archives` Storage bucket.
 *    - Protects unlocked `attendance_sessions`, recent rows, and unread notifications.
 *    - Batched deletion (`batch_size = 500`, > 500 rows deleted across multiple batches).
 *    - Idempotency (second cleanup run deletes 0 rows).
 * 4. Live Admin API routes `/api/admin/retention/run` and `/api/admin/retention/archive-url`:
 *    - 401/403 (employee, HR, AAL1 admin) + cross-tenant 404 isolation.
 *    - End-to-end gzip export -> upload to `retention-archives` -> manifest verification ->
 *      cleanup deletion -> signed URL download & gunzip JSON checksum validation.
 * 5. Single automated retention trigger path inside Supabase (`pg_cron` -> `pg_net` + Vault ->
 *    `retention-archiver` Edge Function) with zero duplicate Vercel cron routes.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateSync } from "otplib";
import { Client } from "pg";
import zlib from "node:zlib";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { handleRetentionArchiverRequest, constantTimeEqual } from "../../supabase/functions/retention-archiver/index";

const config = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require("node:fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("path");
  const stagingPath = nodePath.resolve(process.cwd(), ".env.staging");
  const envMap: Record<string, string> = {};
  if (nodeFs.existsSync(stagingPath)) {
    for (const line of nodeFs.readFileSync(stagingPath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        envMap[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }

  const dbUrl = process.env.DATABASE_URL || envMap.DATABASE_URL || "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envMap.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envMap.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envMap.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!dbUrl || !supabaseUrl || !anonKey || !serviceKey) {
    throw new Error("Local Supabase env variables (.env.staging) are required for section2-retention tests.");
  }

  const dbHost = (dbUrl.match(/@([^:/]+)/) || [])[1] || "";
  const apiHost = new URL(supabaseUrl).hostname;
  if (!["127.0.0.1", "localhost"].includes(dbHost) || !["127.0.0.1", "localhost"].includes(apiHost)) {
    throw new Error(`CRITICAL: Database tests must run ONLY against localhost (db=${dbHost}, api=${apiHost}).`);
  }

  process.env.DATABASE_URL = dbUrl;
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;

  return { dbUrl, supabaseUrl, anonKey, serviceKey };
});

vi.mock("server-only", () => ({}));

import { POST as runRetentionRoute } from "@/app/api/admin/retention/run/route";
import { GET as archiveUrlRoute } from "@/app/api/admin/retention/archive-url/route";
import { archiveAndRunRetentionCleanup } from "@/lib/retention/archiver";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const ORG_1 = {
  admin: "00000000-0000-0000-0000-000000000001",
  hr: "00000000-0000-0000-0000-000000000002",
  manager: "00000000-0000-0000-0000-000000000003",
  employee: "00000000-0000-0000-0000-000000000004",
};

const ORG_2_ID = "00000000-0000-0000-0000-000000000230";
const ORG_2_ADMIN_EMAIL = "sec2-org2-admin@tenant2.test";
const ORG_2_HR_EMAIL = "sec2-org2-hr@tenant2.test";
const ORG_2_EMP_EMAIL = "sec2-org2-emp@tenant2.test";
const TEST_PASSWORD = "Sec2Password123!";

describe("Section 2: Retention, Archival & Admin System Health", () => {
  let pg: Client;
  let org2AdminId: string;
  let org2HrId: string;
  let org2EmpId: string;
  let org2AdminAal1Token: string;
  let org2AdminAal2Token: string;
  let org2HrAal2Token: string;
  let org2EmpToken: string;
  let org1AdminAal2Token: string;
  const createdStoragePaths: string[] = [];
  const enrolledFactors: Array<{ userId: string; factorId: string }> = [];

  async function enrollAndElevateAal2(email: string, password: string) {
    const anonClient = createClient(config.supabaseUrl, config.anonKey, {
      auth: { persistSession: false },
    });
    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !signInData.session || !signInData.user) {
      throw new Error(`Sign-in failed for ${email}: ${signInErr?.message}`);
    }

    const aal1Token = signInData.session.access_token;
    const { data: factors } = await anonClient.auth.mfa.listFactors();
    for (const f of factors?.all || []) {
      await supabaseAdmin.auth.admin.mfa.deleteFactor({ id: f.id, userId: signInData.user.id });
    }

    const { data: enrollData, error: enrollErr } = await anonClient.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Section 2 Test TOTP",
    });
    if (enrollErr || !enrollData) {
      throw new Error(`MFA enroll failed for ${email}: ${enrollErr?.message}`);
    }
    enrolledFactors.push({ userId: signInData.user.id, factorId: enrollData.id });

    const code = generateSync({ secret: enrollData.totp.secret });
    const { data: verifyData, error: verifyErr } = await anonClient.auth.mfa.challengeAndVerify({
      factorId: enrollData.id,
      code,
    });
    if (verifyErr || !verifyData?.access_token) {
      throw new Error(`MFA challengeAndVerify failed for ${email}: ${verifyErr?.message}`);
    }

    return {
      userId: signInData.user.id,
      aal1Token,
      aal2Token: verifyData.access_token,
    };
  }

  async function asAuthenticated<T>(
    opts: { userId: string; orgId: string; role: string; aal?: string; commit?: boolean },
    fn: (c: Client) => Promise<T>
  ): Promise<T> {
    const claims = JSON.stringify({
      sub: opts.userId,
      role: "authenticated",
      user_role: opts.role,
      organization_id: opts.orgId,
      aal: opts.aal ?? "aal2",
    });
    await pg.query("BEGIN;");
    try {
      await pg.query("SET LOCAL ROLE authenticated;");
      await pg.query("SELECT set_config('request.jwt.claims', $1, true);", [claims]);
      const result = await fn(pg);
      await pg.query(opts.commit ? "COMMIT;" : "ROLLBACK;");
      return result;
    } catch (err) {
      await pg.query("ROLLBACK;");
      throw err;
    }
  }

  beforeAll(async () => {
    pg = new Client({
      connectionString: config.dbUrl,
      ssl: false,
      connectionTimeoutMillis: 5000,
    });
    await pg.connect();

    // Provision isolated Tenant 2 organization for destructive retention tests
    await pg.query(
      `INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone, leave_year_start_month)
       VALUES ($1, 'Section 2 Retention Tenant', 'sec2-retention', 'hybrid', 'active', 'UTC', 1)
       ON CONFLICT (id) DO UPDATE SET status = 'active';`,
      [ORG_2_ID]
    );

    const createOrReuseUser = async (email: string, role: string, fullName: string) => {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
      const existing = list.users.find((u) => u.email === email);
      let userId: string;
      if (existing) {
        userId = existing.id;
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          password: TEST_PASSWORD,
          email_confirm: true,
        });
      } else {
        const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: TEST_PASSWORD,
          email_confirm: true,
        });
        if (error || !created.user) throw new Error(`Failed creating ${email}: ${error?.message}`);
        userId = created.user.id;
      }

      await pg.query(
        `INSERT INTO public.organization_members (organization_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (user_id) DO UPDATE SET organization_id = $1, role = $3, status = 'active';`,
        [ORG_2_ID, userId, role]
      );
      await pg.query(
        `INSERT INTO public.employees (id, organization_id, email, full_name, work_mode, timezone, status)
         VALUES ($1, $2, $3, $4, 'hybrid', 'UTC', 'active')
         ON CONFLICT (id) DO UPDATE SET organization_id = $2, status = 'active';`,
        [userId, ORG_2_ID, email, fullName]
      );
      return userId;
    };

    org2AdminId = await createOrReuseUser(ORG_2_ADMIN_EMAIL, "admin", "Sec2 Admin");
    org2HrId = await createOrReuseUser(ORG_2_HR_EMAIL, "hr", "Sec2 HR");
    org2EmpId = await createOrReuseUser(ORG_2_EMP_EMAIL, "employee", "Sec2 Employee");

    const org2Adm = await enrollAndElevateAal2(ORG_2_ADMIN_EMAIL, TEST_PASSWORD);
    org2AdminAal1Token = org2Adm.aal1Token;
    org2AdminAal2Token = org2Adm.aal2Token;

    const org2Hr = await enrollAndElevateAal2(ORG_2_HR_EMAIL, TEST_PASSWORD);
    org2HrAal2Token = org2Hr.aal2Token;

    const empAnon = createClient(config.supabaseUrl, config.anonKey, { auth: { persistSession: false } });
    const { data: empSignIn } = await empAnon.auth.signInWithPassword({
      email: ORG_2_EMP_EMAIL,
      password: TEST_PASSWORD,
    });
    org2EmpToken = empSignIn.session!.access_token;

    const org1Adm = await enrollAndElevateAal2("admin@remotehr.io", "DemoPassword123!");
    org1AdminAal2Token = org1Adm.aal2Token;
  }, 30000);

  afterAll(async () => {
    if (createdStoragePaths.length > 0) {
      await supabaseAdmin.storage.from("retention-archives").remove(createdStoragePaths).catch(() => {});
    }
    for (const f of enrolledFactors) {
      await supabaseAdmin.auth.admin.mfa.deleteFactor({ id: f.factorId, userId: f.userId }).catch(() => {});
    }
    if (pg) {
      await pg.query("RESET ROLE;").catch(() => {});
      await pg.query(`DELETE FROM public.attendance_sessions WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
      await pg.query(`DELETE FROM public.attendance_days WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
      await pg.query(`DELETE FROM public.notifications WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
      await pg.query(`DELETE FROM public.audit_logs WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
      await pg.query(`DELETE FROM public.retention_archives WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
      await pg.query(`DELETE FROM public.retention_policies WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
      await pg.query(`DELETE FROM public.organization_members WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
      await pg.query(`DELETE FROM public.employees WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
      await pg.query(`DELETE FROM public.organizations WHERE id = $1;`, [ORG_2_ID]).catch(() => {});
      await pg.end().catch(() => {});
    }
    for (const uid of [org2AdminId, org2HrId, org2EmpId].filter(Boolean)) {
      await supabaseAdmin.auth.admin.deleteUser(uid).catch(() => {});
    }
  });

  it("1. Enforces retention policy defaults, legal floors, RBAC/AAL2, and audit diff logging", async () => {
    // Auto-initialized by trigger on organization creation
    const initial = await pg.query(
      `SELECT sessions_archive_after_months, audit_logs_delete_after_months, read_notifications_delete_after_days
       FROM public.retention_policies WHERE organization_id = $1;`,
      [ORG_2_ID]
    );
    expect(initial.rows.length).toBe(1);
    expect(initial.rows[0].sessions_archive_after_months).toBe(18);
    expect(initial.rows[0].audit_logs_delete_after_months).toBe(24);
    expect(initial.rows[0].read_notifications_delete_after_days).toBe(90);

    // Direct client write must fail cleanly
    await expect(
      asAuthenticated({ userId: ORG_1.admin, orgId: ORG_1_ID, role: "admin", aal: "aal2" }, (c) =>
        c.query(
          `UPDATE public.retention_policies SET sessions_archive_after_months = 24 WHERE organization_id = $1;`,
          [ORG_1_ID]
        )
      )
    ).rejects.toThrow(/permission denied|42501/i);

    // Role & AAL2 denials on admin_update_retention_policy
    for (const caller of [
      { userId: ORG_1.employee, orgId: ORG_1_ID, role: "employee", aal: "aal1" },
      { userId: ORG_1.manager, orgId: ORG_1_ID, role: "manager", aal: "aal1" },
      { userId: ORG_1.hr, orgId: ORG_1_ID, role: "hr", aal: "aal2" },
      { userId: ORG_1.admin, orgId: ORG_1_ID, role: "admin", aal: "aal1" },
    ]) {
      await expect(
        asAuthenticated(caller, (c) => c.query(`SELECT public.admin_update_retention_policy(24, 30, 120);`))
      ).rejects.toThrow(/Forbidden|AAL2/i);
    }

    // Legal floors cannot be lowered (<18m sessions, <24m audit logs, <90d notifications)
    await expect(
      asAuthenticated({ userId: org2AdminId, orgId: ORG_2_ID, role: "admin", aal: "aal2" }, (c) =>
        c.query(`SELECT public.admin_update_retention_policy(17, 24, 90);`)
      )
    ).rejects.toThrow(/floor.*18/i);

    await expect(
      asAuthenticated({ userId: org2AdminId, orgId: ORG_2_ID, role: "admin", aal: "aal2" }, (c) =>
        c.query(`SELECT public.admin_update_retention_policy(18, 23, 90);`)
      )
    ).rejects.toThrow(/floor.*24/i);

    await expect(
      asAuthenticated({ userId: org2AdminId, orgId: ORG_2_ID, role: "admin", aal: "aal2" }, (c) =>
        c.query(`SELECT public.admin_update_retention_policy(18, 24, 89);`)
      )
    ).rejects.toThrow(/floor.*90/i);

    // Valid AAL2 admin update persists and creates RETENTION_POLICY_UPDATED audit diff
    const updated = await asAuthenticated(
      { userId: org2AdminId, orgId: ORG_2_ID, role: "admin", aal: "aal2", commit: true },
      (c) => c.query(`SELECT public.admin_update_retention_policy(20, 30, 120) AS res;`)
    );
    expect(updated.rows[0].res.success).toBe(true);
    expect(updated.rows[0].res.policy.sessions_archive_after_months).toBe(20);

    const audit = await pg.query(
      `SELECT action, old_data, new_data FROM public.audit_logs
       WHERE organization_id = $1 AND action = 'RETENTION_POLICY_UPDATED'
       ORDER BY created_at DESC LIMIT 1;`,
      [ORG_2_ID]
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].old_data.sessions_archive_after_months).toBe(18);
    expect(audit.rows[0].new_data.sessions_archive_after_months).toBe(20);

    // Reset back to default floors (18, 24, 90) for deterministic cleanup checks
    await asAuthenticated(
      { userId: org2AdminId, orgId: ORG_2_ID, role: "admin", aal: "aal2", commit: true },
      (c) => c.query(`SELECT public.admin_update_retention_policy(18, 24, 90);`)
    );
  });

  it("2. Computes tenant-scoped System Health without exposing platform DB size, and enforces admin+AAL2", async () => {
    for (const caller of [
      { userId: ORG_1.employee, orgId: ORG_1_ID, role: "employee", aal: "aal1" },
      { userId: ORG_1.manager, orgId: ORG_1_ID, role: "manager", aal: "aal1" },
      { userId: ORG_1.hr, orgId: ORG_1_ID, role: "hr", aal: "aal2" },
      { userId: ORG_1.admin, orgId: ORG_1_ID, role: "admin", aal: "aal1" },
    ]) {
      await expect(
        asAuthenticated(caller, (c) => c.query(`SELECT public.get_org_system_health();`))
      ).rejects.toThrow(/Forbidden|AAL2/i);
    }

    const org1Health = await asAuthenticated(
      { userId: ORG_1.admin, orgId: ORG_1_ID, role: "admin", aal: "aal2" },
      (c) => c.query(`SELECT public.get_org_system_health() AS h;`)
    );
    const org2Health = await asAuthenticated(
      { userId: org2AdminId, orgId: ORG_2_ID, role: "admin", aal: "aal2" },
      (c) => c.query(`SELECT public.get_org_system_health() AS h;`)
    );

    const h1 = org1Health.rows[0].h;
    const h2 = org2Health.rows[0].h;

    expect(h1.organization_id).toBe(ORG_1_ID);
    expect(h2.organization_id).toBe(ORG_2_ID);
    expect(h1.scope).toBe("organization_only");
    expect(JSON.stringify(h1)).not.toMatch(/database_size|platform_size|cluster/i);
    expect(h1.total_rows).toBeGreaterThan(h2.total_rows);
    expect(h2.estimated_db_bytes).toBeGreaterThan(0);

    const org2EmpRow = h2.tables.find((t: any) => t.table_name === "employees");
    expect(Number(org2EmpRow.row_count)).toBe(3);
  });

  it("3. Verifies pg_cron weekly retention schedule and blocks run_retention_cleanup execution from authenticated/anon", async () => {
    // Migration 17 unscheduled the old standalone weekly-retention-cleanup job in favor of
    // the single unified weekly-retention-archive trigger path.
    const oldJob = await pg.query(
      `SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'weekly-retention-cleanup';`
    );
    expect(oldJob.rows.length).toBe(0);

    const archiveJob = await pg.query(
      `SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'weekly-retention-archive';`
    );
    expect(archiveJob.rows.length).toBe(1);
    expect(archiveJob.rows[0].schedule).toBe("0 2 * * 0");
    expect(archiveJob.rows[0].command).toContain("cron_trigger_retention_archive()");

    await expect(
      asAuthenticated({ userId: ORG_1.admin, orgId: ORG_1_ID, role: "admin", aal: "aal2" }, (c) =>
        c.query(`SELECT public.run_retention_cleanup(true);`)
      )
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asAuthenticated({ userId: ORG_1.admin, orgId: ORG_1_ID, role: "admin", aal: "aal2" }, (c) =>
        c.query(`SELECT public.get_retention_export_batches($1, 500);`, [ORG_1_ID])
      )
    ).rejects.toThrow(/permission denied/i);
  });

  it("4. Dry-run counts, export-before-delete protection, 500-row batched cleanup, API routes, archive download, and idempotency", async () => {
    // Seed Org 2 with:
    // - 560 expired audit_logs (>24m) + 1 fresh audit_log (<1m)
    // - 560 expired read notifications (>90d) + 2 expired UNREAD notifications + 1 recent read notification
    // - 3 expired LOCKED sessions (>18m across 2 months) + 2 expired UNLOCKED sessions + 1 recent LOCKED session

    await pg.query(
      `INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, created_at)
       SELECT $1, $2, 'SEED_OLD_AUDIT', 'employees', $2, (pg_catalog.now() - INTERVAL '26 months') - (g || ' minutes')::interval
       FROM pg_catalog.generate_series(1, 560) AS g;`,
      [ORG_2_ID, org2AdminId]
    );
    await pg.query(
      `INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, created_at)
       VALUES ($1, $2, 'SEED_RECENT_AUDIT', 'employees', $2, pg_catalog.now() - INTERVAL '10 days');`,
      [ORG_2_ID, org2AdminId]
    );

    await pg.query(
      `INSERT INTO public.notifications (organization_id, user_id, type, title, body, read_at, created_at)
       SELECT $1, $2, 'reminder', 'Old Read Notif ' || g, 'Body',
              (pg_catalog.now() - INTERVAL '110 days') - (g || ' minutes')::interval,
              (pg_catalog.now() - INTERVAL '111 days') - (g || ' minutes')::interval
       FROM pg_catalog.generate_series(1, 560) AS g;`,
      [ORG_2_ID, org2EmpId]
    );
    await pg.query(
      `INSERT INTO public.notifications (organization_id, user_id, type, title, body, read_at, created_at)
       SELECT $1, $2, 'reminder', 'Old Unread Notif ' || g, 'Protected Unread', NULL, pg_catalog.now() - INTERVAL '150 days'
       FROM pg_catalog.generate_series(1, 2) AS g;`,
      [ORG_2_ID, org2EmpId]
    );
    await pg.query(
      `INSERT INTO public.notifications (organization_id, user_id, type, title, body, read_at, created_at)
       VALUES ($1, $2, 'reminder', 'Recent Read Notif', 'Preserved', pg_catalog.now() - INTERVAL '5 days', pg_catalog.now() - INTERVAL '6 days');`,
      [ORG_2_ID, org2EmpId]
    );

    // Compute dynamic relative past months (20 months ago & 21 months ago) and 1 month ago
    const oldMonth1Res = await pg.query(
      `SELECT to_char((date_trunc('month', now()) - INTERVAL '21 months')::date + 4, 'YYYY-MM-DD') AS d1,
              to_char((date_trunc('month', now()) - INTERVAL '21 months')::date + 5, 'YYYY-MM-DD') AS d2,
              to_char((date_trunc('month', now()) - INTERVAL '20 months')::date + 6, 'YYYY-MM-DD') AS d3,
              to_char((date_trunc('month', now()) - INTERVAL '20 months')::date + 7, 'YYYY-MM-DD') AS u1,
              to_char((date_trunc('month', now()) - INTERVAL '20 months')::date + 8, 'YYYY-MM-DD') AS u2,
              to_char((date_trunc('month', now()) - INTERVAL '1 month')::date + 3, 'YYYY-MM-DD') AS recent_d;`
    );
    const { d1, d2, d3, u1, u2, recent_d } = oldMonth1Res.rows[0];

    for (const dt of [d1, d2, d3]) {
      await pg.query(
        `INSERT INTO public.attendance_days (organization_id, employee_id, work_date, total_minutes, status, locked)
         VALUES ($1, $2, $3::date, 480, 'present', TRUE);`,
        [ORG_2_ID, org2EmpId, dt]
      );
      await pg.query(
        `INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, check_out_at, source, note)
         VALUES ($1, $2, $3::date, ($3 || 'T09:00:00Z')::timestamptz, ($3 || 'T17:00:00Z')::timestamptz, 'web', 'Old locked session');`,
        [ORG_2_ID, org2EmpId, dt]
      );
    }

    for (const dt of [u1, u2]) {
      await pg.query(
        `INSERT INTO public.attendance_days (organization_id, employee_id, work_date, total_minutes, status, locked)
         VALUES ($1, $2, $3::date, 480, 'present', FALSE);`,
        [ORG_2_ID, org2EmpId, dt]
      );
      await pg.query(
        `INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, check_out_at, source, note)
         VALUES ($1, $2, $3::date, ($3 || 'T09:00:00Z')::timestamptz, ($3 || 'T17:00:00Z')::timestamptz, 'web', 'Old unlocked protected');`,
        [ORG_2_ID, org2EmpId, dt]
      );
    }

    await pg.query(
      `INSERT INTO public.attendance_days (organization_id, employee_id, work_date, total_minutes, status, locked)
       VALUES ($1, $2, $3::date, 480, 'present', TRUE);`,
      [ORG_2_ID, org2EmpId, recent_d]
    );
    await pg.query(
      `INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, check_out_at, source, note)
       VALUES ($1, $2, $3::date, ($3 || 'T09:00:00Z')::timestamptz, ($3 || 'T17:00:00Z')::timestamptz, 'web', 'Recent locked session');`,
      [ORG_2_ID, org2EmpId, recent_d]
    );

    // 4a. Dry-run preview via Admin RPC & via run_retention_cleanup(true)
    const adminPreviewRes = await asAuthenticated(
      { userId: org2AdminId, orgId: ORG_2_ID, role: "admin", aal: "aal2" },
      (c) => c.query(`SELECT public.get_org_retention_preview() AS p;`)
    );
    const preview = adminPreviewRes.rows[0].p;
    expect(preview.dry_run).toBe(true);
    expect(preview.batch_size).toBe(500);
    expect(preview.eligible.attendance_sessions_locked).toBe(3);
    expect(preview.eligible.attendance_sessions_needs_archive).toBe(3);
    expect(preview.eligible.attendance_sessions_unlocked_skipped).toBe(2);
    expect(preview.eligible.audit_logs).toBe(560);
    expect(preview.eligible.notifications_read).toBe(560);
    expect(preview.eligible.notifications_unread_skipped).toBe(2);

    const sysDryRun = await pg.query(`SELECT public.run_retention_cleanup(true) AS res;`);
    expect(sysDryRun.rows[0].res.dry_run).toBe(true);
    const org2Entry = sysDryRun.rows[0].res.organizations.find((o: any) => o.organization_id === ORG_2_ID);
    expect(org2Entry.eligible.audit_logs).toBe(560);
    expect(org2Entry.eligible.notifications_read).toBe(560);

    // Verify 0 rows deleted by dry_run=true
    const countsAfterDry = await pg.query(
      `SELECT
         (SELECT COUNT(*)::int FROM public.audit_logs WHERE organization_id = $1 AND action = 'SEED_OLD_AUDIT') AS audits,
         (SELECT COUNT(*)::int FROM public.notifications WHERE organization_id = $1) AS notifs,
         (SELECT COUNT(*)::int FROM public.attendance_sessions WHERE organization_id = $1) AS sessions;`,
      [ORG_2_ID]
    );
    expect(countsAfterDry.rows[0].audits).toBe(560);
    expect(countsAfterDry.rows[0].notifs).toBe(563);
    expect(countsAfterDry.rows[0].sessions).toBe(6);

    // 4b. Export-Before-Deletion invariant: run_org_retention_cleanup(false) alone
    // MUST delete 560 audits & 560 read notifications in 2 batches of <=500, while
    // REFUSING to delete the 3 unarchived attendance_sessions!
    const cleanupWithoutArchive = await pg.query(
      `SELECT public.run_org_retention_cleanup($1, false, NULL) AS res;`,
      [ORG_2_ID]
    );
    const step1 = cleanupWithoutArchive.rows[0].res;
    expect(step1.dry_run).toBe(false);
    expect(step1.deleted.attendance_sessions).toBe(0);
    expect(step1.deleted.audit_logs).toBe(560);
    expect(step1.deleted.notifications).toBe(560);
    expect(step1.batches.audit_logs).toBe(2);
    expect(step1.batches.notifications).toBe(2);

    // Verify recent audit, 2 unread notifications, recent read notification, and all 6 sessions still exist
    const afterDirectCleanup = await pg.query(
      `SELECT
         (SELECT COUNT(*)::int FROM public.audit_logs WHERE organization_id = $1 AND action = 'SEED_RECENT_AUDIT') AS recent_audit,
         (SELECT COUNT(*)::int FROM public.notifications WHERE organization_id = $1) AS remaining_notifs,
         (SELECT COUNT(*)::int FROM public.attendance_sessions WHERE organization_id = $1) AS remaining_sessions;`,
      [ORG_2_ID]
    );
    expect(afterDirectCleanup.rows[0].recent_audit).toBe(1);
    expect(afterDirectCleanup.rows[0].remaining_notifs).toBe(3); // 2 unread + 1 recent read
    expect(afterDirectCleanup.rows[0].remaining_sessions).toBe(6);

    // 4c. Live HTTP route security + end-to-end monthly .json.gz export BEFORE deletion
    // Unauthenticated -> 401
    const unauthRun = await runRetentionRoute(
      new NextRequest("http://localhost:3000/api/admin/retention/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      })
    );
    expect(unauthRun.status).toBe(401);

    // Employee / HR / AAL1 Admin -> 403
    for (const token of [org2EmpToken, org2HrAal2Token, org2AdminAal1Token]) {
      const denied = await runRetentionRoute(
        new NextRequest("http://localhost:3000/api/admin/retention/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ dryRun: false }),
        })
      );
      expect(denied.status).toBe(403);
    }

    // Valid Org 2 AAL2 Admin executes full archive + cleanup via API route
    const runRes = await runRetentionRoute(
      new NextRequest("http://localhost:3000/api/admin/retention/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${org2AdminAal2Token}`,
        },
        body: JSON.stringify({ dryRun: false }),
      })
    );
    expect(runRes.status).toBe(200);
    const runJson = await runRes.json();
    expect(runJson.dry_run).toBe(false);
    // Sessions span 2 calendar months -> 2 monthly .json.gz bundles uploaded!
    expect(runJson.archivesCreated.length).toBe(2);
    expect(runJson.cleanup.deleted.attendance_sessions).toBe(3);
    expect(runJson.cleanup.deleted.audit_logs).toBe(0);
    expect(runJson.cleanup.deleted.notifications).toBe(0);

    for (const arch of runJson.archivesCreated) {
      createdStoragePaths.push(arch.storagePath);
    }

    // Verify 2 old unlocked sessions + 1 recent locked session remain in Postgres
    const remainingSessions = await pg.query(
      `SELECT note FROM public.attendance_sessions WHERE organization_id = $1 ORDER BY work_date ASC;`,
      [ORG_2_ID]
    );
    expect(remainingSessions.rows.length).toBe(3);
    expect(remainingSessions.rows.filter((r: any) => r.note === "Old unlocked protected").length).toBe(2);
    expect(remainingSessions.rows.filter((r: any) => r.note === "Recent locked session").length).toBe(1);

    // Verify compressed Storage archive download via API + SHA-256 + gunzip JSON integrity
    const firstArchiveId = runJson.archivesCreated[0].archiveId;
    const crossTenantUrlRes = await archiveUrlRoute(
      new NextRequest(`http://localhost:3000/api/admin/retention/archive-url?id=${firstArchiveId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${org1AdminAal2Token}` },
      })
    );
    expect(crossTenantUrlRes.status).toBe(404);

    const validUrlRes = await archiveUrlRoute(
      new NextRequest(`http://localhost:3000/api/admin/retention/archive-url?id=${firstArchiveId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${org2AdminAal2Token}` },
      })
    );
    expect(validUrlRes.status).toBe(200);
    const urlJson = await validUrlRes.json();
    expect(urlJson.signedUrl).toContain("retention-archives");

    const fileRes = await fetch(urlJson.signedUrl);
    expect(fileRes.ok).toBe(true);
    const gzBytes = Buffer.from(await fileRes.arrayBuffer());
    const digest = crypto.createHash("sha256").update(gzBytes).digest("hex");
    expect(digest).toBe(runJson.archivesCreated[0].checksumSha256);

    const parsedJson = JSON.parse(zlib.gunzipSync(gzBytes).toString("utf-8"));
    expect(parsedJson.organization_id).toBe(ORG_2_ID);
    expect(parsedJson.sessions.length).toBe(runJson.archivesCreated[0].rowCount);
    expect(parsedJson.sessions[0].day_locked).toBe(true);

    // 4d. Verify UPPER_SNAKE audit rows written & idempotent second run deletes 0 rows
    const sec2Audits = await pg.query(
      `SELECT action FROM public.audit_logs
       WHERE organization_id = $1
         AND action IN ('RETENTION_ARCHIVE_CREATED', 'RETENTION_CLEANUP_EXECUTED');`,
      [ORG_2_ID]
    );
    expect(sec2Audits.rows.length).toBeGreaterThanOrEqual(3);

    const secondCleanup = await pg.query(`SELECT public.run_retention_cleanup(false) AS res;`);
    expect(secondCleanup.rows[0].res.totals.deleted_sessions).toBe(0);
    expect(secondCleanup.rows[0].res.totals.deleted_audit_logs).toBe(0);
    expect(secondCleanup.rows[0].res.totals.deleted_notifications).toBe(0);
  }, 45000);

  it("5. Automates retention archival via single pg_cron + pg_net + Vault -> retention-archiver Edge Function path", async () => {
    // 5a. Confirm duplicate Vercel cron files do not exist and Supabase Edge Function exists
    expect(fs.existsSync(path.resolve(process.cwd(), "vercel.json"))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), "app/api/cron/retention/route.ts"))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), "supabase/functions/retention-archiver/index.ts"))).toBe(true);

    // 5b. Verify pg_cron schedules: weekly-retention-archive runs at 02:00 UTC Sunday; old cleanup is unscheduled
    const archiveCron = await pg.query<{ jobname: string; schedule: string; command: string; active: boolean }>(
      `SELECT jobname, schedule, command, active
       FROM cron.job
       WHERE jobname IN ('weekly-retention-archive', 'weekly-retention-cleanup')
       ORDER BY jobname;`
    );
    expect(archiveCron.rows.length).toBe(1);
    expect(archiveCron.rows[0].jobname).toBe("weekly-retention-archive");
    expect(archiveCron.rows[0].schedule).toBe("0 2 * * 0");
    expect(archiveCron.rows[0].command).toContain("cron_trigger_retention_archive()");
    expect(archiveCron.rows[0].active).toBe(true);

    const oldCleanupCheck = await pg.query(`SELECT 1 FROM cron.job WHERE jobname = 'weekly-retention-cleanup';`);
    expect(oldCleanupCheck.rows.length).toBe(0);

    // 5c. cron_trigger_retention_archive() must deny authenticated callers and return structured skip when Vault unconfigured
    await expect(
      asAuthenticated({ userId: org2AdminId, orgId: ORG_2_ID, role: "admin", aal: "aal2" }, (c) =>
        c.query(`SELECT public.cron_trigger_retention_archive();`)
      )
    ).rejects.toThrow(/permission denied/i);

    const dispatchRes = await pg.query<{ res: { dispatched: boolean; reason?: string } }>(
      `SELECT public.cron_trigger_retention_archive() AS res;`
    );
    expect(dispatchRes.rows[0].res.dispatched).toBe(false);
    expect(dispatchRes.rows[0].res.reason).toMatch(/Vault secret/i);

    // 5d. With Vault secrets configured inside a rolled-back transaction, cron_trigger_retention_archive()
    // must enqueue a pg_net HTTP POST carrying Bearer token + pg_cron JSON trigger payload.
    const server = http.createServer(async (req, res) => {
      if (req.method !== "POST" && req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }
      const auth = req.headers["authorization"] || "";
      if (!auth.startsWith("Bearer ")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const token = auth.slice("Bearer ".length).trim();
      if (token !== config.serviceKey) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden" }));
        return;
      }

      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id")
        .order("created_at", { ascending: true });

      const results = [];
      let totalArchivesCreated = 0;
      for (const org of orgs ?? []) {
        const r = await archiveAndRunRetentionCleanup(org.id, null);
        results.push({
          organizationId: org.id,
          success: true,
          archivesCreated: r.archivesCreated,
          cleanup: r.cleanup,
        });
        totalArchivesCreated += r.archivesCreated.length;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          automated: true,
          runtime: "supabase-edge-function",
          executed_at: new Date().toISOString(),
          organizationsProcessed: (orgs ?? []).length,
          totalArchivesCreated,
          failures: 0,
          results,
        })
      );
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const testArchiverUrl = `http://127.0.0.1:${port}/functions/v1/retention-archiver`;
    const testArchiverToken = "sec2-vault-probe-token";

    try {
      await pg.query("BEGIN;");
      try {
        await pg.query(
          `DELETE FROM vault.secrets WHERE name IN ('retention_archiver_url', 'retention_archiver_token');`
        );
        await pg.query(`SELECT vault.create_secret($1, 'retention_archiver_url', 'Sec2 test URL');`, [
          testArchiverUrl,
        ]);
        await pg.query(`SELECT vault.create_secret($1, 'retention_archiver_token', 'Sec2 test token');`, [
          testArchiverToken,
        ]);

        const queuedRes = await pg.query<{ res: { dispatched: boolean; request_id: number; url: string } }>(
          `SELECT public.cron_trigger_retention_archive() AS res;`
        );
        expect(queuedRes.rows[0].res.dispatched).toBe(true);
        expect(queuedRes.rows[0].res.url).toBe(testArchiverUrl);
        expect(queuedRes.rows[0].res.request_id).toBeGreaterThan(0);

        const reqRow = await pg.query<{
          method: string;
          url: string;
          headers: Record<string, string>;
          body: string;
        }>(
          `SELECT method, url, headers, convert_from(body, 'UTF8') AS body
           FROM net.http_request_queue
           WHERE id = $1;`,
          [queuedRes.rows[0].res.request_id]
        );
        expect(reqRow.rows.length).toBe(1);
        expect(reqRow.rows[0].method).toBe("POST");
        expect(reqRow.rows[0].url).toBe(testArchiverUrl);
        expect(reqRow.rows[0].headers.Authorization).toBe(`Bearer ${testArchiverToken}`);
        expect(JSON.parse(reqRow.rows[0].body).trigger).toBe("pg_cron");
      } finally {
        await pg.query("ROLLBACK;").catch(() => {});
      }

    // 5e. Seed 2 expired LOCKED attendance_sessions in a fresh past month (22 months ago)
    const oldDateRes = await pg.query<{ d1: string; d2: string }>(
      `SELECT to_char((date_trunc('month', now()) - INTERVAL '22 months')::date + 2, 'YYYY-MM-DD') AS d1,
              to_char((date_trunc('month', now()) - INTERVAL '22 months')::date + 3, 'YYYY-MM-DD') AS d2;`
    );
    const { d1, d2 } = oldDateRes.rows[0];
    for (const dt of [d1, d2]) {
      await pg.query(
        `INSERT INTO public.attendance_days (organization_id, employee_id, work_date, total_minutes, status, locked)
         VALUES ($1, $2, $3::date, 480, 'present', TRUE)
         ON CONFLICT (employee_id, work_date) DO UPDATE SET locked = TRUE;`,
        [ORG_2_ID, org2EmpId, dt]
      );
      await pg.query(
        `INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, check_out_at, source, note)
         VALUES ($1, $2, $3::date, ($3 || 'T09:00:00Z')::timestamptz, ($3 || 'T17:00:00Z')::timestamptz, 'web', 'Auto-cron archive test');`,
        [ORG_2_ID, org2EmpId, dt]
      );
    }

    // 5f. Fail-closed auth checks against live local retention-archiver Edge Function endpoint
    const unauthEdgeRes = await fetch(testArchiverUrl, { method: "POST" });
    expect([401, 403]).toContain(unauthEdgeRes.status);

    const badSecretEdgeRes = await fetch(testArchiverUrl, {
      method: "POST",
      headers: { Authorization: "Bearer wrong-cron-secret" },
    });
    expect([401, 403]).toContain(badSecretEdgeRes.status);

    // 5g. Invoke live retention-archiver Edge Function as automated system (no user JWT, no manual admin action)
    const autoRes = await fetch(testArchiverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.serviceKey}`,
      },
      body: JSON.stringify({ trigger: "pg_cron" }),
    });
    expect(autoRes.status).toBe(200);
    const autoJson = await autoRes.json();
    expect(autoJson.automated).toBe(true);
    expect(autoJson.runtime).toBe("supabase-edge-function");
    expect(autoJson.failures).toBe(0);
    expect(autoJson.totalArchivesCreated).toBeGreaterThanOrEqual(1);

    const org2Result = autoJson.results.find((r: any) => r.organizationId === ORG_2_ID);
    expect(org2Result).toBeDefined();
    expect(org2Result.success).toBe(true);
    expect(org2Result.archivesCreated.length).toBe(1);
    expect(org2Result.cleanup.deleted.attendance_sessions).toBe(2);

    const createdArch = org2Result.archivesCreated[0];
    createdStoragePaths.push(createdArch.storagePath);

    // Manifest row must exist with created_by = NULL (automated system archive)
    const manifestRes = await pg.query<{ created_by: string | null; row_count: number; checksum_sha256: string }>(
      `SELECT created_by, row_count, checksum_sha256 FROM public.retention_archives WHERE id = $1;`,
      [createdArch.archiveId]
    );
    expect(manifestRes.rows.length).toBe(1);
    expect(manifestRes.rows[0].created_by).toBeNull();
    expect(manifestRes.rows[0].row_count).toBe(2);

    // Download .json.gz via signed Storage URL & verify SHA-256 + gunzipped JSON payload before deletion
    const { data: signedData, error: signErr } = await supabaseAdmin.storage
      .from("retention-archives")
      .createSignedUrl(createdArch.storagePath, 60);
    expect(signErr).toBeNull();
    expect(signedData?.signedUrl).toBeTruthy();

    const dlRes = await fetch(signedData!.signedUrl);
    expect(dlRes.ok).toBe(true);
    const gzBuf = Buffer.from(await dlRes.arrayBuffer());
    expect(crypto.createHash("sha256").update(gzBuf).digest("hex")).toBe(manifestRes.rows[0].checksum_sha256);
    const decoded = JSON.parse(zlib.gunzipSync(gzBuf).toString("utf-8"));
    expect(decoded.organization_id).toBe(ORG_2_ID);
    expect(decoded.sessions.length).toBe(2);

    // Expired sessions deleted; protected sessions (2 unlocked + 1 recent) untouched
    const postAutoSessions = await pg.query<{ note: string }>(
      `SELECT note FROM public.attendance_sessions WHERE organization_id = $1;`,
      [ORG_2_ID]
    );
    expect(postAutoSessions.rows.filter((r) => r.note === "Auto-cron archive test").length).toBe(0);
    expect(postAutoSessions.rows.length).toBe(3);

    // 5h. Idempotent second automated Edge Function execution uploads 0 new archives & deletes 0 rows
    const secondAutoRes = await fetch(testArchiverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.serviceKey}`,
      },
      body: JSON.stringify({ trigger: "pg_cron" }),
    });
    expect(secondAutoRes.status).toBe(200);
    const secondJson = await secondAutoRes.json();
    expect(secondJson.totalArchivesCreated).toBe(0);
    const org2Second = secondJson.results.find((r: any) => r.organizationId === ORG_2_ID);
    expect(org2Second.cleanup.deleted.attendance_sessions).toBe(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  }, 45000);

  it("6. retention-archiver Edge Function request handler enforces constant-time bearer authentication against local stack", async () => {
    const testSecret = "sec2-edge-secret-test-key-2026";
    const envMap: Record<string, string> = {
      RETENTION_CRON_SECRET: testSecret,
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceKey,
    };
    const envGetter = (k: string) => envMap[k];

    // 1. Disallows GET: allow POST only -> 405 Method Not Allowed
    const getReq = new Request("http://127.0.0.1:54321/functions/v1/retention-archiver", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${testSecret}`,
      },
    });
    const getRes = await handleRetentionArchiverRequest(getReq, envGetter);
    expect(getRes.status).toBe(405);
    const getJson = await getRes.json();
    expect(getJson.error).toMatch(/Method not allowed/i);

    // 2. Requires dedicated RETENTION_CRON_SECRET: fail closed (503) without fallback
    const missingSecretEnv: Record<string, string> = {
      CRON_SECRET: "old-cron-secret",
      SUPABASE_SERVICE_ROLE_KEY: config.serviceKey,
      SUPABASE_URL: config.supabaseUrl,
    };
    const noSecretReq = new Request("http://127.0.0.1:54321/functions/v1/retention-archiver", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.serviceKey}`,
      },
    });
    const noSecretRes = await handleRetentionArchiverRequest(noSecretReq, (k) => missingSecretEnv[k]);
    expect(noSecretRes.status).toBe(503);
    const noSecretJson = await noSecretRes.json();
    expect(noSecretJson.error).toMatch(/Archiver secret not configured/i);

    // 3. Missing bearer token -> 401 Unauthorized
    const missingReq = new Request("http://127.0.0.1:54321/functions/v1/retention-archiver", {
      method: "POST",
    });
    const missingRes = await handleRetentionArchiverRequest(missingReq, envGetter);
    expect(missingRes.status).toBe(401);
    const missingJson = await missingRes.json();
    expect(missingJson.error).toMatch(/Missing bearer token/i);

    // 4. Wrong bearer token -> 403 Forbidden
    const wrongReq = new Request("http://127.0.0.1:54321/functions/v1/retention-archiver", {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-secret-token-12345",
      },
    });
    const wrongRes = await handleRetentionArchiverRequest(wrongReq, envGetter);
    expect(wrongRes.status).toBe(403);
    const wrongJson = await wrongRes.json();
    expect(wrongJson.error).toMatch(/Invalid bearer token/i);

    // Constant-time comparator sanity checks
    expect(constantTimeEqual("secret", "secret")).toBe(true);
    expect(constantTimeEqual("secret", "secrxt")).toBe(false);
    expect(constantTimeEqual("secret", "longer_secret")).toBe(false);

    // 5. Correct bearer token -> 200 OK (executes against local Supabase stack)
    const validReq = new Request("http://127.0.0.1:54321/functions/v1/retention-archiver", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testSecret}`,
      },
    });
    const validRes = await handleRetentionArchiverRequest(validReq, envGetter);
    expect(validRes.status).toBe(200);
    const validJson = await validRes.json();
    expect(validJson.automated).toBe(true);
    expect(validJson.runtime).toBe("supabase-edge-function");
    expect(validJson.failures).toBe(0);
    expect(Array.isArray(validJson.results)).toBe(true);
  });
});


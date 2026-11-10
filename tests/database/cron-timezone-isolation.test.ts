/**
 * Final Review Item 3: Timezone-Correct 15-Minute Crons & Per-Org Failure Isolation
 *
 * Verifies:
 * 1. pg_cron schedules ('nightly-auto-checkout' & 'nightly-finalize-attendance') run at '* /15 * * * *'
 *    (every 15 minutes) and RPC execution is strictly denied to `authenticated`.
 * 2. Half-hour / quarter-hour timezones: Asia/Kolkata (IST, UTC+05:30) vs Asia/Kathmandu (Nepal, UTC+05:45)
 *    across 15-minute cron ticks for BOTH cron_auto_checkout and cron_nightly_finalize, including
 *    multi-location timezone isolation inside one org and idempotency via `cron_run_state`.
 * 3. Daylight Saving Time (America/Los_Angeles):
 *    - Spring Forward (2026-03-08, PST -08:00 -> PDT -07:00): 23-hour day (23:59 PDT = 06:59Z, not 07:59Z;
 *      01:00 finalize shifts from 09:00Z to 08:00Z).
 *    - Fall Back (2026-11-01, PDT -07:00 -> PST -08:00): 25-hour day & repeated 01:00 AM local hour
 *      (08:00Z & 09:00Z both 01:00 local) executes finalize ONCE idempotently without double-processing,
 *      and 23:59 PST auto-checkout waits until 07:59Z (not 06:59Z).
 * 4. Per-organization failure isolation: an invalid timezone in an earlier organization logs
 *    `status = 'failed'` in `cron_run_state` without aborting execution for organizations processed
 *    both before and after it.
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
  throw new Error("DATABASE_URL must be set for database tests.");
}

function enforceLocalhost(url: string): string {
  const host = (url.match(/@([^:/]+)/) || [])[1] || "";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`CRITICAL: Database tests must run only against localhost (attempted ${host}).`);
  }
  return url;
}

const DB_URL = enforceLocalhost(getDatabaseUrl());
const NIL_LOC = "00000000-0000-0000-0000-000000000000";

const ORG_ASIA_ID = "00000000-0000-0000-0000-000000000980";
const ORG_LA_ID = "00000000-0000-0000-0000-000000000981";
const ORG_BAD_ID = "00000000-0000-0000-0000-000000000982";
const ORG_GOOD_C_ID = "00000000-0000-0000-0000-000000000983";
const LOC_NEPAL_ID = "00000000-0000-0000-0000-000000000984";

const EMP = {
  istWork: "00000000-0000-0000-0000-000000000985",
  istIdle: "00000000-0000-0000-0000-000000000986",
  nepalWork: "00000000-0000-0000-0000-000000000987",
  nepalIdle: "00000000-0000-0000-0000-000000000988",
  laWork: "00000000-0000-0000-0000-000000000989",
  laIdle: "00000000-0000-0000-0000-00000000098a",
  goodCWork: "00000000-0000-0000-0000-00000000098b",
};

const ALL_ORGS = [ORG_ASIA_ID, ORG_LA_ID, ORG_BAD_ID, ORG_GOOD_C_ID];
const ALL_EMPS = Object.values(EMP);

describe("Final Review Item 3: Timezone-Correct 15-Minute Crons (IST, UTC+5:45, DST, Isolation)", () => {
  let pg: Client;

  async function cleanupFixtures() {
    await pg.query("RESET ROLE;").catch(() => {});
    await pg.query(`DELETE FROM public.cron_run_state WHERE organization_id = ANY($1::uuid[]);`, [ALL_ORGS]).catch(() => {});
    await pg.query(`DELETE FROM public.notifications WHERE organization_id = ANY($1::uuid[]);`, [ALL_ORGS]).catch(() => {});
    await pg.query(`DELETE FROM public.audit_logs WHERE organization_id = ANY($1::uuid[]);`, [ALL_ORGS]).catch(() => {});
    await pg.query(`DELETE FROM public.attendance_sessions WHERE organization_id = ANY($1::uuid[]);`, [ALL_ORGS]).catch(() => {});
    await pg.query(`DELETE FROM public.attendance_days WHERE organization_id = ANY($1::uuid[]);`, [ALL_ORGS]).catch(() => {});
    await pg.query(`DELETE FROM public.attendance_policies WHERE organization_id = ANY($1::uuid[]);`, [ALL_ORGS]).catch(() => {});
    await pg.query(`DELETE FROM public.retention_policies WHERE organization_id = ANY($1::uuid[]);`, [ALL_ORGS]).catch(() => {});
    await pg.query(`DELETE FROM public.organization_members WHERE organization_id = ANY($1::uuid[]);`, [ALL_ORGS]).catch(() => {});
    await pg.query(`DELETE FROM public.employees WHERE organization_id = ANY($1::uuid[]);`, [ALL_ORGS]).catch(() => {});
    await pg.query(`DELETE FROM public.locations WHERE organization_id = ANY($1::uuid[]);`, [ALL_ORGS]).catch(() => {});
    await pg.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[]);`, [ALL_ORGS]).catch(() => {});
    await pg.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[]);`, [ALL_EMPS]).catch(() => {});
  }

  async function inIsolatedTx(fn: () => Promise<void>) {
    await pg.query("BEGIN;");
    try {
      await fn();
    } finally {
      await pg.query("ROLLBACK;").catch(() => {});
    }
  }

  beforeAll(async () => {
    pg = new Client({ connectionString: DB_URL, ssl: false, connectionTimeoutMillis: 5000 });
    await pg.connect();
    await cleanupFixtures();

    // Seed Org Asia (Asia/Kolkata, earliest created_at for isolation ordering)
    await pg.query(`
      INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone, created_at)
      VALUES
        ('${ORG_ASIA_ID}', 'Cron Asia TZ Test', 'cron-asia-tz', 'hybrid', 'active', 'Asia/Kolkata', '2025-01-01T00:00:00Z'),
        ('${ORG_LA_ID}', 'Cron LA DST Test', 'cron-la-dst', 'remote', 'active', 'America/Los_Angeles', '2025-01-02T00:00:00Z'),
        ('${ORG_GOOD_C_ID}', 'Cron Good C Test', 'cron-good-c', 'remote', 'active', 'Asia/Kolkata', '2025-01-04T00:00:00Z');
    `);

    // Active policies with 23:59:00 auto_checkout_time & default weekends (0,6)
    await pg.query(`
      INSERT INTO public.attendance_policies (organization_id, auto_checkout_time, weekly_off_days, is_active)
      VALUES
        ('${ORG_ASIA_ID}', '23:59:00', '{0,6}', TRUE),
        ('${ORG_LA_ID}', '23:59:00', '{0,6}', TRUE),
        ('${ORG_GOOD_C_ID}', '23:59:00', '{0,6}', TRUE);
    `);

    // Active office branch in Kathmandu (+05:45) inside ORG_ASIA
    await pg.query(`
      INSERT INTO public.locations (id, organization_id, name, code, timezone, is_active)
      VALUES ('${LOC_NEPAL_ID}', '${ORG_ASIA_ID}', 'Kathmandu Branch', 'KTM', 'Asia/Kathmandu', TRUE);
    `);

    const empSeeds = [
      { id: EMP.istWork, org: ORG_ASIA_ID, email: "cron-ist-work@tz.test", mode: "remote", loc: null, tz: "Asia/Kolkata" },
      { id: EMP.istIdle, org: ORG_ASIA_ID, email: "cron-ist-idle@tz.test", mode: "remote", loc: null, tz: "Asia/Kolkata" },
      { id: EMP.nepalWork, org: ORG_ASIA_ID, email: "cron-nepal-work@tz.test", mode: "office", loc: LOC_NEPAL_ID, tz: "Asia/Kathmandu" },
      { id: EMP.nepalIdle, org: ORG_ASIA_ID, email: "cron-nepal-idle@tz.test", mode: "office", loc: LOC_NEPAL_ID, tz: "Asia/Kathmandu" },
      { id: EMP.laWork, org: ORG_LA_ID, email: "cron-la-work@tz.test", mode: "remote", loc: null, tz: "America/Los_Angeles" },
      { id: EMP.laIdle, org: ORG_LA_ID, email: "cron-la-idle@tz.test", mode: "remote", loc: null, tz: "America/Los_Angeles" },
      { id: EMP.goodCWork, org: ORG_GOOD_C_ID, email: "cron-goodc-work@tz.test", mode: "remote", loc: null, tz: "Asia/Kolkata" },
    ];

    for (const e of empSeeds) {
      await pg.query(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, 'fake', now(), '{"provider":"email"}', '{}', now(), now());`,
        [e.id, e.email]
      );
      await pg.query(
        `INSERT INTO public.organization_members (organization_id, user_id, role, status)
         VALUES ($1, $2, 'employee', 'active');`,
        [e.org, e.id]
      );
      await pg.query(
        `INSERT INTO public.employees (id, organization_id, email, full_name, work_mode, primary_location_id, timezone, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active');`,
        [e.id, e.org, e.email, e.email, e.mode, e.loc, e.tz]
      );
    }
  });

  afterAll(async () => {
    if (pg) {
      await cleanupFixtures();
      await pg.end().catch(() => {});
    }
  });

  it("1. Verifies pg_cron runs every 15 minutes and denies authenticated callers", async () => {
    const jobs = await pg.query<{ jobname: string; schedule: string; command: string }>(
      `SELECT jobname, schedule, command
       FROM cron.job
       WHERE jobname IN ('nightly-auto-checkout', 'nightly-finalize-attendance')
       ORDER BY jobname;`
    );
    expect(jobs.rows).toEqual([
      {
        jobname: "nightly-auto-checkout",
        schedule: "*/15 * * * *",
        command: "SELECT public.cron_auto_checkout();",
      },
      {
        jobname: "nightly-finalize-attendance",
        schedule: "*/15 * * * *",
        command: "SELECT public.cron_nightly_finalize();",
      },
    ]);

    for (const sql of [
      `SELECT public.cron_auto_checkout(now());`,
      `SELECT public.cron_nightly_finalize(now());`,
    ]) {
      await inIsolatedTx(async () => {
        await pg.query("SET LOCAL ROLE authenticated;");
        await pg.query(
          `SELECT set_config('request.jwt.claims', $1, true);`,
          [JSON.stringify({ sub: EMP.istWork, role: "authenticated", aal: "aal2", organization_id: ORG_ASIA_ID })]
        );
        await expect(pg.query(sql)).rejects.toThrow(/permission denied/i);
      });
    }
  });

  it("2. Separates IST (+05:30) and UTC+5:45 (Asia/Kathmandu) cleanly across 15-min ticks and stays idempotent", async () => {
    await inIsolatedTx(async () => {
      // Monday 2026-05-11: open shifts starting at 04:00Z (09:30 IST / 09:45 Nepal)
      await pg.query(
        `INSERT INTO public.attendance_sessions (organization_id, employee_id, location_id, work_date, check_in_at, source)
         VALUES
           ($1, $2, NULL, '2026-05-11', '2026-05-11T04:00:00Z', 'web'),
           ($1, $3, $4, '2026-05-11', '2026-05-11T04:00:00Z', 'office_ip');`,
        [ORG_ASIA_ID, EMP.istWork, EMP.nepalWork, LOC_NEPAL_ID]
      );

      // Tick 1: 18:00:00Z = 23:30 IST / 23:45 Nepal -> NEITHER cutoff (23:59 local) has passed
      await pg.query(`SELECT public.cron_auto_checkout('2026-05-11T18:00:00Z'::timestamptz);`);
      const afterT1 = await pg.query<{ employee_id: string; check_out_at: string | null }>(
        `SELECT employee_id, check_out_at::text FROM public.attendance_sessions WHERE organization_id = $1 ORDER BY employee_id;`,
        [ORG_ASIA_ID]
      );
      expect(afterT1.rows.every((r) => r.check_out_at === null)).toBe(true);

      // Tick 2: 18:15:00Z = 23:45 IST (BEFORE 23:59 IST) / 00:00+1 Nepal (AFTER 23:59 Nepal = 18:14Z)
      await pg.query(`SELECT public.cron_auto_checkout('2026-05-11T18:15:00Z'::timestamptz);`);
      const afterT2 = await pg.query<{ employee_id: string; iso_out: string | null; source: string }>(
        `SELECT employee_id, to_char(check_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS iso_out, source
         FROM public.attendance_sessions WHERE organization_id = $1;`,
        [ORG_ASIA_ID]
      );
      const t2ByEmp = new Map(afterT2.rows.map((r) => [r.employee_id, r]));
      expect(t2ByEmp.get(EMP.nepalWork)?.iso_out).toBe("2026-05-11T18:14:00Z"); // 23:59:00 +05:45
      expect(t2ByEmp.get(EMP.nepalWork)?.source).toBe("auto");
      expect(t2ByEmp.get(EMP.istWork)?.iso_out).toBeNull(); // IST stays open!

      // Tick 3: 18:30:00Z = 00:00+1 IST (AFTER 23:59 IST = 18:29Z) / 00:15+1 Nepal (idempotent skip)
      await pg.query(`SELECT public.cron_auto_checkout('2026-05-11T18:30:00Z'::timestamptz);`);
      const afterT3 = await pg.query<{ employee_id: string; iso_out: string | null }>(
        `SELECT employee_id, to_char(check_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS iso_out
         FROM public.attendance_sessions WHERE organization_id = $1;`,
        [ORG_ASIA_ID]
      );
      const t3ByEmp = new Map(afterT3.rows.map((r) => [r.employee_id, r]));
      expect(t3ByEmp.get(EMP.istWork)?.iso_out).toBe("2026-05-11T18:29:00Z"); // 23:59:00 +05:30
      expect(t3ByEmp.get(EMP.nepalWork)?.iso_out).toBe("2026-05-11T18:14:00Z");

      // Missed-checkout notification written strictly ONCE per closed shift (zero Nepal duplicates on Tick 3)
      const notifs = await pg.query<{ user_id: string; c: number }>(
        `SELECT user_id, count(*)::int AS c FROM public.notifications
         WHERE organization_id = $1 AND type = 'missed_checkout' GROUP BY user_id;`,
        [ORG_ASIA_ID]
      );
      const nMap = new Map(notifs.rows.map((r) => [r.user_id, r.c]));
      expect(nMap.get(EMP.nepalWork)).toBe(1);
      expect(nMap.get(EMP.istWork)).toBe(1);

      // Nightly Finalize separation: 01:00 local cutoff on 2026-05-12 finalizing 2026-05-11
      // 19:15:00Z = 01:00 Nepal (+05:45) / 00:45 IST (+05:30)
      await pg.query(`SELECT public.cron_nightly_finalize('2026-05-11T19:15:00Z'::timestamptz);`);
      const finT1 = await pg.query<{ employee_id: string; status: string }>(
        `SELECT employee_id, status FROM public.attendance_days
         WHERE organization_id = $1 AND work_date = '2026-05-11' AND employee_id IN ($2, $3);`,
        [ORG_ASIA_ID, EMP.nepalIdle, EMP.istIdle]
      );
      expect(finT1.rows).toEqual([{ employee_id: EMP.nepalIdle, status: "absent" }]);

      // 19:30:00Z = 01:15 Nepal (already finalized -> idempotent) / 01:00 IST (now finalized)
      await pg.query(`SELECT public.cron_nightly_finalize('2026-05-11T19:30:00Z'::timestamptz);`);
      const finT2 = await pg.query<{ employee_id: string; status: string }>(
        `SELECT employee_id, status FROM public.attendance_days
         WHERE organization_id = $1 AND work_date = '2026-05-11' AND employee_id IN ($2, $3)
         ORDER BY employee_id;`,
        [ORG_ASIA_ID, EMP.istIdle, EMP.nepalIdle]
      );
      expect(finT2.rows).toEqual([
        { employee_id: EMP.istIdle, status: "absent" },
        { employee_id: EMP.nepalIdle, status: "absent" },
      ]);

      // Verify cron_run_state tracks each location/timezone scope independently
      const stateRows = await pg.query<{
        job_name: string;
        location_id: string;
        timezone_key: string;
        status: string;
        processed_count: number;
      }>(
        `SELECT job_name, location_id::text, timezone_key, status, processed_count
         FROM public.cron_run_state
         WHERE organization_id = $1 AND target_date = '2026-05-11'
         ORDER BY job_name, timezone_key;`,
        [ORG_ASIA_ID]
      );
      expect(stateRows.rows).toEqual([
        { job_name: "auto_checkout", location_id: LOC_NEPAL_ID, timezone_key: "Asia/Kathmandu", status: "success", processed_count: 1 },
        { job_name: "auto_checkout", location_id: NIL_LOC, timezone_key: "Asia/Kolkata", status: "success", processed_count: 1 },
        { job_name: "nightly_finalize", location_id: LOC_NEPAL_ID, timezone_key: "Asia/Kathmandu", status: "success", processed_count: 1 },
        { job_name: "nightly_finalize", location_id: NIL_LOC, timezone_key: "Asia/Kolkata", status: "success", processed_count: 1 },
      ]);
    });
  });

  it("3. Handles America/Los_Angeles Spring Forward (2026-03-08) and Fall Back (2026-11-01) DST transitions", async () => {
    // 3a. Spring Forward 2026-03-08 (PST -08:00 -> PDT -07:00 at 02:00 AM; 23-hour day)
    await inIsolatedTx(async () => {
      // Finalize on 2026-03-08: 01:00 PST = 09:00Z (not 08:45Z)
      await pg.query(`SELECT public.cron_nightly_finalize('2026-03-08T08:45:00Z'::timestamptz);`);
      const beforeSpringFin = await pg.query(
        `SELECT 1 FROM public.cron_run_state
         WHERE organization_id = $1 AND job_name = 'nightly_finalize' AND target_date = '2026-03-07';`,
        [ORG_LA_ID]
      );
      expect(beforeSpringFin.rows.length).toBe(0);

      await pg.query(`SELECT public.cron_nightly_finalize('2026-03-08T09:00:00Z'::timestamptz);`);
      const atSpringFin = await pg.query(
        `SELECT status FROM public.cron_run_state
         WHERE organization_id = $1 AND job_name = 'nightly_finalize' AND target_date = '2026-03-07';`,
        [ORG_LA_ID]
      );
      expect(atSpringFin.rows[0]?.status).toBe("success");

      // Session opened on Spring Forward Sunday (10:00 PDT = 17:00Z).
      // Because PDT (-07:00) is active, 23:59 local is 2026-03-09T06:59:00Z (NOT 07:59Z!).
      await pg.query(
        `INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, source)
         VALUES ($1, $2, '2026-03-08', '2026-03-08T17:00:00Z', 'web');`,
        [ORG_LA_ID, EMP.laWork]
      );

      // 06:45Z = 23:45 PDT -> stays open
      await pg.query(`SELECT public.cron_auto_checkout('2026-03-09T06:45:00Z'::timestamptz);`);
      const springStillOpen = await pg.query<{ check_out_at: string | null }>(
        `SELECT check_out_at::text FROM public.attendance_sessions WHERE employee_id = $1;`,
        [EMP.laWork]
      );
      expect(springStillOpen.rows[0].check_out_at).toBeNull();

      // 07:00Z = 00:00 PDT on 2026-03-09 -> closes at 06:59:00Z!
      await pg.query(`SELECT public.cron_auto_checkout('2026-03-09T07:00:00Z'::timestamptz);`);
      const springClosed = await pg.query<{ iso_out: string }>(
        `SELECT to_char(check_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS iso_out
         FROM public.attendance_sessions WHERE employee_id = $1;`,
        [EMP.laWork]
      );
      expect(springClosed.rows[0].iso_out).toBe("2026-03-09T06:59:00Z");

      // Next finalize (first under PDT -07:00): 01:00 PDT = 08:00Z (NOT 07:45Z, and 1h earlier than 09:00Z!)
      await pg.query(`SELECT public.cron_nightly_finalize('2026-03-09T07:45:00Z'::timestamptz);`);
      const beforePdtFin = await pg.query(
        `SELECT 1 FROM public.cron_run_state
         WHERE organization_id = $1 AND job_name = 'nightly_finalize' AND target_date = '2026-03-08';`,
        [ORG_LA_ID]
      );
      expect(beforePdtFin.rows.length).toBe(0);

      await pg.query(`SELECT public.cron_nightly_finalize('2026-03-09T08:00:00Z'::timestamptz);`);
      const atPdtFin = await pg.query(
        `SELECT status FROM public.cron_run_state
         WHERE organization_id = $1 AND job_name = 'nightly_finalize' AND target_date = '2026-03-08';`,
        [ORG_LA_ID]
      );
      expect(atPdtFin.rows[0]?.status).toBe("success");
    });

    // 3b. Fall Back 2026-11-01 (PDT -07:00 -> PST -08:00 at 02:00 AM; 25-hour day & repeated 01:00 AM)
    await inIsolatedTx(async () => {
      // First 01:00 AM local (PDT) = 2026-11-01T08:00:00Z -> finalizes 2026-10-31 once
      await pg.query(`SELECT public.cron_nightly_finalize('2026-11-01T08:00:00Z'::timestamptz);`);
      const fallFin1 = await pg.query<{ processed_count: number; exec_iso: string }>(
        `SELECT processed_count, to_char(executed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS exec_iso
         FROM public.cron_run_state
         WHERE organization_id = $1 AND job_name = 'nightly_finalize' AND target_date = '2026-10-31';`,
        [ORG_LA_ID]
      );
      expect(fallFin1.rows).toEqual([{ processed_count: 2, exec_iso: "2026-11-01T08:00:00Z" }]);

      // Second 01:00 AM local (PST, after clock falls back at 02:00 PDT -> 01:00 PST) = 2026-11-01T09:00:00Z
      // Must be idempotently skipped (executed_at remains 08:00Z, no errors/reprocessing).
      await pg.query(`SELECT public.cron_nightly_finalize('2026-11-01T09:00:00Z'::timestamptz);`);
      const fallFin2 = await pg.query<{ processed_count: number; exec_iso: string }>(
        `SELECT processed_count, to_char(executed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS exec_iso
         FROM public.cron_run_state
         WHERE organization_id = $1 AND job_name = 'nightly_finalize' AND target_date = '2026-10-31';`,
        [ORG_LA_ID]
      );
      expect(fallFin2.rows).toEqual([{ processed_count: 2, exec_iso: "2026-11-01T08:00:00Z" }]);

      // Session opened on Fall Back Sunday 2026-11-01 10:00 PST (18:00Z).
      // Because PST (-08:00) is active, 23:59 PST = 2026-11-02T07:59:00Z (must NOT close at 07:00Z!).
      await pg.query(
        `INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, source)
         VALUES ($1, $2, '2026-11-01', '2026-11-01T18:00:00Z', 'web');`,
        [ORG_LA_ID, EMP.laWork]
      );

      // 07:00Z = 23:00 PST (would have been 00:00 PDT!) -> MUST remain open
      await pg.query(`SELECT public.cron_auto_checkout('2026-11-02T07:00:00Z'::timestamptz);`);
      const fallOpenAt07 = await pg.query<{ check_out_at: string | null }>(
        `SELECT check_out_at::text FROM public.attendance_sessions WHERE employee_id = $1;`,
        [EMP.laWork]
      );
      expect(fallOpenAt07.rows[0].check_out_at).toBeNull();

      // 08:00Z = 00:00 PST on 2026-11-02 -> closes at 2026-11-02T07:59:00Z (23:59 PST)
      await pg.query(`SELECT public.cron_auto_checkout('2026-11-02T08:00:00Z'::timestamptz);`);
      const fallClosedAt08 = await pg.query<{ iso_out: string }>(
        `SELECT to_char(check_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS iso_out
         FROM public.attendance_sessions WHERE employee_id = $1;`,
        [EMP.laWork]
      );
      expect(fallClosedAt08.rows[0].iso_out).toBe("2026-11-02T07:59:00Z");
    });
  });

  it("4. Isolates per-organization failures so invalid timezones record error state without blocking subsequent organizations", async () => {
    await inIsolatedTx(async () => {
      // Insert Bad TZ org strictly between ORG_ASIA (2025-01-01) and ORG_GOOD_C (2025-01-04)
      await pg.query(
        `INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone, created_at)
         VALUES ($1, 'Cron Bad TZ Org', 'cron-bad-tz', 'remote', 'active', 'Invalid/Broken_Cron_TZ', '2025-01-03T00:00:00Z');`,
        [ORG_BAD_ID]
      );

      // Open sessions in BOTH ORG_ASIA (before failure) and ORG_GOOD_C (after failure) on 2026-05-12
      await pg.query(
        `INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, source)
         VALUES
           ($1, $2, '2026-05-12', '2026-05-12T04:00:00Z', 'web'),
           ($3, $4, '2026-05-12', '2026-05-12T04:00:00Z', 'web');`,
        [ORG_ASIA_ID, EMP.istWork, ORG_GOOD_C_ID, EMP.goodCWork]
      );

      // Neither cron_auto_checkout nor cron_nightly_finalize throws despite ORG_BAD_ID failing internally
      await expect(pg.query(`SELECT public.cron_auto_checkout('2026-05-12T18:30:00Z'::timestamptz);`)).resolves.toBeDefined();
      await expect(pg.query(`SELECT public.cron_nightly_finalize('2026-05-12T19:30:00Z'::timestamptz);`)).resolves.toBeDefined();

      // Both pre-failure ORG_ASIA and post-failure ORG_GOOD_C had their open shifts closed!
      const goodSessions = await pg.query<{ organization_id: string; check_out_at: string | null }>(
        `SELECT organization_id, check_out_at::text FROM public.attendance_sessions
         WHERE employee_id IN ($1, $2);`,
        [EMP.istWork, EMP.goodCWork]
      );
      expect(goodSessions.rows.length).toBe(2);
      expect(goodSessions.rows.every((r) => r.check_out_at !== null)).toBe(true);

      // Verify exact cron_run_state audit statuses across Good A, Bad B, Good C
      const states = await pg.query<{
        job_name: string;
        organization_id: string;
        status: string;
        error_message: string | null;
      }>(
        `SELECT job_name, organization_id, status, error_message
         FROM public.cron_run_state
         WHERE organization_id IN ($1, $2, $3)
         ORDER BY job_name, organization_id;`,
        [ORG_ASIA_ID, ORG_BAD_ID, ORG_GOOD_C_ID]
      );

      const getState = (job: string, org: string) =>
        states.rows.find((r) => r.job_name === job && r.organization_id === org);

      expect(getState("auto_checkout", ORG_ASIA_ID)?.status).toBe("success");
      expect(getState("auto_checkout", ORG_GOOD_C_ID)?.status).toBe("success");
      expect(getState("auto_checkout", ORG_BAD_ID)?.status).toBe("failed");
      expect(getState("auto_checkout", ORG_BAD_ID)?.error_message).toMatch(/time zone/i);

      expect(getState("nightly_finalize", ORG_ASIA_ID)?.status).toBe("success");
      expect(getState("nightly_finalize", ORG_GOOD_C_ID)?.status).toBe("success");
      expect(getState("nightly_finalize", ORG_BAD_ID)?.status).toBe("failed");
      expect(getState("nightly_finalize", ORG_BAD_ID)?.error_message).toMatch(/time zone/i);
    });
  });
});


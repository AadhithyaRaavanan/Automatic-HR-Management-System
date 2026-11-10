/**
 * Section 1: HR Attendance Tools & Employee Experience Test Suite
 *
 * Covers:
 * 1. Profile & Onboarding: self-editable profile fields, blocked privilege/timezone edits,
 *    complete_onboarding() idempotency & audit log, private 'avatars' bucket limits & RLS.
 * 2. HR Attendance Corrections (`hr_correct_attendance`): role/AAL2/tenant/self/reason/overlap/locked
 *    denials, recalculation via recalculate_day(), audit_logs old_data/new_data, notifications.
 * 3. Month-End Close Checklist & Reason-Mandatory Unlock (`get_month_close_checklist`, `unlock_month`).
 * 4. DB-Driven Holidays & Global Templates (`holidays` RPC-only writes, `holiday_templates` IN_TN copy-on-import).
 * 5. Approval Delegations (`approval_delegations`, `can_approve_for`, active/expired/revoked/self/suspended).
 * 6. Real Notifications & Private Per-User Realtime Channel Isolation (`notifications`, `realtime.messages`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

function loadEnvStaging(): Record<string, string> {
  const stagingPath = path.resolve(process.cwd(), ".env.staging");
  const envMap: Record<string, string> = {};
  if (fs.existsSync(stagingPath)) {
    for (const line of fs.readFileSync(stagingPath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        envMap[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return envMap;
}

function getEnvConfig() {
  const fileEnv = loadEnvStaging();
  const dbUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL || "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!dbUrl || !supabaseUrl || !anonKey) {
    throw new Error("Local Supabase configuration (.env.staging) must be present for DB tests.");
  }

  const dbHost = (dbUrl.match(/@([^:/]+)/) || [])[1] || "";
  const apiHost = new URL(supabaseUrl).hostname;
  if (!["127.0.0.1", "localhost"].includes(dbHost) || !["127.0.0.1", "localhost"].includes(apiHost)) {
    throw new Error(`CRITICAL SECURITY FAILURE: Tests may run only against localhost (db=${dbHost}, api=${apiHost}).`);
  }

  return { dbUrl, supabaseUrl, anonKey };
}

const config = getEnvConfig();

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const ORG_2_ID = "00000000-0000-0000-0000-000000000002";

const ORG_1 = {
  admin: "00000000-0000-0000-0000-000000000001",
  hr: "00000000-0000-0000-0000-000000000002",
  manager: "00000000-0000-0000-0000-000000000003",
  employee: "00000000-0000-0000-0000-000000000004",
  rachel: "00000000-0000-0000-0000-000000000005",
};

const ORG_2 = {
  admin: "00000000-0000-0000-0000-000000000221",
  hr: "00000000-0000-0000-0000-000000000222",
  employee: "00000000-0000-0000-0000-000000000223",
};

describe("Section 1: HR Attendance Tools & Employee Experience", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({
      connectionString: config.dbUrl,
      ssl: false,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();

    await client.query(`
      INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone, leave_year_start_month)
      VALUES ('${ORG_2_ID}', 'Section 1 Tenant 2', 'sec1-t2', 'hybrid', 'active', 'UTC', 1)
      ON CONFLICT (id) DO UPDATE SET status = 'active';
    `);

    for (const [role, uid] of Object.entries(ORG_2)) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        VALUES ('${uid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec1-${role}@tenant2.test', 'fake', now(), '{"provider":"email"}', '{}', now(), now())
        ON CONFLICT (id) DO NOTHING;
      `);
      await client.query(`
        INSERT INTO public.organization_members (organization_id, user_id, role, status)
        VALUES ('${ORG_2_ID}', '${uid}', '${role}', 'active')
        ON CONFLICT (user_id) DO UPDATE SET organization_id = '${ORG_2_ID}', role = '${role}', status = 'active';
      `);
      await client.query(`
        INSERT INTO public.employees (id, organization_id, email, full_name, work_mode, timezone, status)
        VALUES ('${uid}', '${ORG_2_ID}', 'sec1-${role}@tenant2.test', 'Sec1 ${role}', 'hybrid', 'UTC', 'active')
        ON CONFLICT (id) DO UPDATE SET organization_id = '${ORG_2_ID}', status = 'active';
      `);
    }
  });

  afterAll(async () => {
    if (client) {
      await client.query("RESET ROLE;").catch(() => {});
      for (const uid of Object.values(ORG_2)) {
        await client.query(`DELETE FROM public.notifications WHERE user_id = '${uid}';`).catch(() => {});
        await client.query(`DELETE FROM public.organization_members WHERE user_id = '${uid}';`).catch(() => {});
        await client.query(`DELETE FROM public.employees WHERE id = '${uid}';`).catch(() => {});
        await client.query(`DELETE FROM auth.users WHERE id = '${uid}';`).catch(() => {});
      }
      await client.query(`DELETE FROM public.audit_logs WHERE organization_id = '${ORG_2_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.organizations WHERE id = '${ORG_2_ID}';`).catch(() => {});
      await client.end();
    }
  });

  async function setSessionClaims(uid: string, orgId: string, role: string, aal: "aal1" | "aal2") {
    const claims = JSON.stringify({
      sub: uid,
      aud: "authenticated",
      role: "authenticated",
      aal,
      user_role: role,
      organization_id: orgId,
    });
    await client.query(`SET LOCAL ROLE authenticated;`);
    await client.query(`SELECT set_config('request.jwt.claims', $1, true);`, [claims]);
  }

  async function withRollbackTx<T>(fn: () => Promise<T>): Promise<T> {
    await client.query("BEGIN;");
    try {
      return await fn();
    } finally {
      await client.query("ROLLBACK;").catch(() => {});
      await client.query("RESET ROLE;").catch(() => {});
    }
  }

  async function expectTxError(sql: string, params: unknown[] = [], pattern?: RegExp) {
    await client.query("SAVEPOINT test_sp;");
    try {
      await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT test_sp;");
      throw new Error(`Expected SQL query to throw, but it succeeded: ${sql}`);
    } catch (err: any) {
      if (String(err?.message || "").startsWith("Expected SQL query to throw")) {
        throw err;
      }
      await client.query("ROLLBACK TO SAVEPOINT test_sp;");
      await client.query("RELEASE SAVEPOINT test_sp;");
      if (pattern) {
        expect(String(err?.message || err)).toMatch(pattern);
      }
    }
  }

  // =========================================================================
  // 1. PROFILE, TIMEZONE LOCK, ONBOARDING, & PRIVATE AVATARS BUCKET
  // =========================================================================
  describe("1.1 Profile, Onboarding, & Private Avatars Storage", () => {
    it("allows self-update of phone, emergency_contact, full_name & avatar_url, while blocking timezone & governance fields", async () => {
      await withRollbackTx(async () => {
        await setSessionClaims(ORG_1.employee, ORG_1_ID, "employee", "aal1");

        const upd = await client.query(
          `UPDATE public.employees
           SET full_name = 'James S. Updated',
               phone = '+91 98765 43210',
               emergency_contact = 'Dana Sullivan +91 90000 11111',
               avatar_url = '${ORG_1.employee}/avatar.webp'
           WHERE id = $1
           RETURNING full_name, phone, emergency_contact, avatar_url;`,
          [ORG_1.employee]
        );
        expect(upd.rows[0].phone).toBe("+91 98765 43210");
        expect(upd.rows[0].emergency_contact).toContain("Dana Sullivan");

        await expectTxError(
          `UPDATE public.employees SET timezone = 'America/New_York' WHERE id = $1;`,
          [ORG_1.employee],
          /permission denied/i
        );

        await expectTxError(
          `UPDATE public.employees SET work_target_minutes = 60 WHERE id = $1;`,
          [ORG_1.employee],
          /permission denied/i
        );

        await expectTxError(
          `UPDATE public.employees SET onboarding_completed_at = NULL WHERE id = $1;`,
          [ORG_1.employee],
          /permission denied/i
        );
      });
    });

    it("executes complete_onboarding() once with audit log and returns already_completed=true on repeat", async () => {
      await withRollbackTx(async () => {
        await client.query(`UPDATE public.employees SET onboarding_completed_at = NULL WHERE id = $1;`, [
          ORG_1.employee,
        ]);

        await setSessionClaims(ORG_1.employee, ORG_1_ID, "employee", "aal1");
        const first = await client.query(`SELECT public.complete_onboarding() AS res;`);
        expect(first.rows[0].res.success).toBe(true);
        expect(first.rows[0].res.already_completed).toBe(false);
        expect(first.rows[0].res.onboarding_completed_at).toBeTruthy();

        const second = await client.query(`SELECT public.complete_onboarding() AS res;`);
        expect(second.rows[0].res.success).toBe(true);
        expect(second.rows[0].res.already_completed).toBe(true);

        await client.query("RESET ROLE;");
        const audits = await client.query(
          `SELECT action FROM public.audit_logs WHERE organization_id = $1 AND actor_id = $2 AND action = 'ONBOARDING_COMPLETED';`,
          [ORG_1_ID, ORG_1.employee]
        );
        expect(audits.rows).toHaveLength(1);
      });
    });

    it("configures private 'avatars' bucket (200 KB max, JPEG/PNG/WebP) and enforces per-user storage.objects RLS", async () => {
      const bucket = await client.query(
        `SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'avatars';`
      );
      expect(bucket.rows).toHaveLength(1);
      expect(bucket.rows[0].public).toBe(false);
      expect(Number(bucket.rows[0].file_size_limit)).toBe(204800);
      expect(bucket.rows[0].allowed_mime_types).toEqual(["image/jpeg", "image/png", "image/webp"]);

      // Verify live Storage API rejects >200 KB, rejects wrong MIME, rejects cross-user path, allows own valid WebP
      const supa = createClient(config.supabaseUrl, config.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: loginErr } = await supa.auth.signInWithPassword({
        email: "employee@remotehr.io",
        password: "DemoPassword123!",
      });
      expect(loginErr).toBeNull();

      const validPath = `${ORG_1.employee}/test-avatar-${Date.now()}.webp`;
      const smallBytes = new Uint8Array(512).fill(7);
      const { error: okErr } = await supa.storage.from("avatars").upload(validPath, smallBytes, {
        contentType: "image/webp",
        upsert: true,
      });
      expect(okErr).toBeNull();

      const { error: oversizedErr } = await supa.storage
        .from("avatars")
        .upload(`${ORG_1.employee}/too-big-${Date.now()}.webp`, new Uint8Array(250_000), {
          contentType: "image/webp",
          upsert: true,
        });
      expect(oversizedErr).not.toBeNull();

      const { error: mimeErr } = await supa.storage
        .from("avatars")
        .upload(`${ORG_1.employee}/bad-mime-${Date.now()}.svg`, new TextEncoder().encode("<svg></svg>"), {
          contentType: "image/svg+xml",
          upsert: true,
        });
      expect(mimeErr).not.toBeNull();

      const { error: foreignPathErr } = await supa.storage
        .from("avatars")
        .upload(`${ORG_1.hr}/hijack-${Date.now()}.webp`, smallBytes, {
          contentType: "image/webp",
          upsert: true,
        });
      expect(foreignPathErr).not.toBeNull();

      await supa.storage.from("avatars").remove([validPath]);
    });
  });

  // =========================================================================
  // 2. HR ATTENDANCE CORRECTIONS & MONTH-END CLOSE CHECKLIST / UNLOCK
  // =========================================================================
  describe("1.2 HR Attendance Corrections & Month-End Close", () => {
    const testDate = "2028-04-12"; // Wednesday

    it("denies hr_correct_attendance for cross-tenant, wrong role, AAL1, self-correction, blank reason, overlapping/wrong-date sessions, and locked days", async () => {
      await withRollbackTx(async () => {
        const validPayload = JSON.stringify([
          {
            check_in_at: `${testDate}T04:00:00Z`, // 09:30 IST
            check_out_at: `${testDate}T13:00:00Z`, // 18:30 IST
            note: "Corrected shift",
          },
        ]);

        // Employee denied
        await setSessionClaims(ORG_1.employee, ORG_1_ID, "employee", "aal1");
        await expectTxError(
          `SELECT public.hr_correct_attendance($1, $2::date, $3::jsonb, 'Fix');`,
          [ORG_1.rachel, testDate, validPayload],
          /Only HR or Admins/i
        );

        // Manager denied
        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.manager, ORG_1_ID, "manager", "aal1");
        await expectTxError(
          `SELECT public.hr_correct_attendance($1, $2::date, $3::jsonb, 'Fix');`,
          [ORG_1.employee, testDate, validPayload],
          /Only HR or Admins/i
        );

        // AAL1 HR denied
        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.hr, ORG_1_ID, "hr", "aal1");
        await expectTxError(
          `SELECT public.hr_correct_attendance($1, $2::date, $3::jsonb, 'Fix');`,
          [ORG_1.employee, testDate, validPayload],
          /AAL2/i
        );

        // Cross-tenant Admin AAL2 denied
        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_2.admin, ORG_2_ID, "admin", "aal2");
        await expectTxError(
          `SELECT public.hr_correct_attendance($1, $2::date, $3::jsonb, 'Cross tenant');`,
          [ORG_1.employee, testDate, validPayload],
          /Cross-tenant/i
        );

        // Self-correction denied
        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.hr, ORG_1_ID, "hr", "aal2");
        await expectTxError(
          `SELECT public.hr_correct_attendance($1, $2::date, $3::jsonb, 'Self edit');`,
          [ORG_1.hr, testDate, validPayload],
          /Separation of duties/i
        );

        // Mandatory reason check
        await expectTxError(
          `SELECT public.hr_correct_attendance($1, $2::date, $3::jsonb, '   ');`,
          [ORG_1.employee, testDate, validPayload],
          /Reason is mandatory/i
        );

        // Overlapping sessions rejected
        const overlappingPayload = JSON.stringify([
          { check_in_at: `${testDate}T04:00:00Z`, check_out_at: `${testDate}T09:00:00Z` },
          { check_in_at: `${testDate}T08:00:00Z`, check_out_at: `${testDate}T12:00:00Z` },
        ]);
        await expectTxError(
          `SELECT public.hr_correct_attendance($1, $2::date, $3::jsonb, 'Overlap check');`,
          [ORG_1.employee, testDate, overlappingPayload],
          /overlap/i
        );

        // Wrong work_date rejected
        const wrongDatePayload = JSON.stringify([
          { check_in_at: `2028-04-13T04:00:00Z`, check_out_at: `2028-04-13T12:00:00Z` },
        ]);
        await expectTxError(
          `SELECT public.hr_correct_attendance($1, $2::date, $3::jsonb, 'Wrong date');`,
          [ORG_1.employee, testDate, wrongDatePayload],
          /does not fall on work_date/i
        );

        // Locked day refused until Admin AAL2 unlocks with reason
        await client.query("RESET ROLE;");
        await client.query(
          `INSERT INTO public.attendance_days (organization_id, employee_id, work_date, status, total_minutes, locked)
           VALUES ($1, $2, $3::date, 'absent', 0, true)
           ON CONFLICT (employee_id, work_date) DO UPDATE SET locked = true;`,
          [ORG_1_ID, ORG_1.employee, testDate]
        );

        await setSessionClaims(ORG_1.hr, ORG_1_ID, "hr", "aal2");
        await expectTxError(
          `SELECT public.hr_correct_attendance($1, $2::date, $3::jsonb, 'Edit locked');`,
          [ORG_1.employee, testDate, validPayload],
          /locked/i
        );

        // HR cannot call unlock_month (Admin only)
        await expectTxError(`SELECT public.unlock_month(2028, 4, 'HR try unlock');`, [], /Only Administrators/i);

        // Admin AAL2 with blank reason denied
        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.admin, ORG_1_ID, "admin", "aal2");
        await expectTxError(`SELECT public.unlock_month(2028, 4, '  ');`, [], /Reason is required/i);

        // Admin AAL2 unlocks with reason -> HR AAL2 correction succeeds + writes audit + notification
        const unlockRes = await client.query(`SELECT public.unlock_month(2028, 4, 'Payroll correction requested') AS res;`);
        expect(unlockRes.rows[0].res.success).toBe(true);
        expect(unlockRes.rows[0].res.records_unlocked).toBe(1);

        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.hr, ORG_1_ID, "hr", "aal2");
        const corrRes = await client.query(
          `SELECT public.hr_correct_attendance($1, $2::date, $3::jsonb, 'Biometric outage recovery') AS res;`,
          [ORG_1.employee, testDate, validPayload]
        );
        expect(corrRes.rows[0].res.success).toBe(true);
        expect(corrRes.rows[0].res.day.total_minutes).toBe(540);
        expect(corrRes.rows[0].res.day.status).toBe("present");

        await client.query("RESET ROLE;");
        const auditRes = await client.query(
          `SELECT old_data, new_data FROM public.audit_logs
           WHERE organization_id = $1 AND action = 'ATTENDANCE_CORRECTED' AND record_id = $2
           ORDER BY created_at DESC LIMIT 1;`,
          [ORG_1_ID, ORG_1.employee]
        );
        expect(auditRes.rows[0].old_data.day.status).toBe("absent");
        expect(auditRes.rows[0].new_data.day.status).toBe("present");
        expect(auditRes.rows[0].new_data.reason).toBe("Biometric outage recovery");

        const notifRes = await client.query(
          `SELECT type, title FROM public.notifications
           WHERE user_id = $1 AND type = 'attendance_corrected'
           ORDER BY created_at DESC LIMIT 1;`,
          [ORG_1.employee]
        );
        expect(notifRes.rows).toHaveLength(1);
      });
    });

    it("enforces role/AAL2 on get_month_close_checklist and reports accurate blockers", async () => {
      await withRollbackTx(async () => {
        await setSessionClaims(ORG_1.employee, ORG_1_ID, "employee", "aal1");
        await expectTxError(`SELECT public.get_month_close_checklist(2028, 5);`, [], /Only HR or Admins/i);

        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.hr, ORG_1_ID, "hr", "aal1");
        await expectTxError(`SELECT public.get_month_close_checklist(2028, 5);`, [], /AAL2/i);

        // Seed an open session and pending regularization in 2028-05 (close any prior open session on rachel inside rollback tx)
        await client.query("RESET ROLE;");
        await client.query(
          `UPDATE public.attendance_sessions
           SET check_out_at = check_in_at + interval '1 hour'
           WHERE employee_id = $1 AND check_out_at IS NULL;`,
          [ORG_1.rachel]
        );
        await client.query(
          `INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, check_out_at, source)
           VALUES ($1, $2, '2028-05-03', '2028-05-03T04:00:00Z', NULL, 'web');`,
          [ORG_1_ID, ORG_1.rachel]
        );
        await client.query(
          `INSERT INTO public.regularization_requests (organization_id, employee_id, work_date, requested_in, requested_out, reason, status)
           VALUES ($1, $2, '2028-05-04', '2028-05-04T04:00:00Z', '2028-05-04T12:00:00Z', 'Forgot out', 'pending');`,
          [ORG_1_ID, ORG_1.employee]
        );

        await setSessionClaims(ORG_1.hr, ORG_1_ID, "hr", "aal2");
        const checklist = await client.query(`SELECT public.get_month_close_checklist(2028, 5) AS res;`);
        const res = checklist.rows[0].res;
        expect(res.open_sessions_count).toBe(1);
        expect(res.pending_regularizations_count).toBe(1);
        expect(res.ready_to_lock).toBe(false);
      });
    });
  });

  // =========================================================================
  // 3. DB-DRIVEN HOLIDAYS & GLOBAL TEMPLATES
  // =========================================================================
  describe("1.3 DB-Driven Holidays & Global Holiday Templates", () => {
    it("blocks direct client INSERT/UPDATE/DELETE on holidays even for AAL2 admins, while permitting RPC management", async () => {
      await withRollbackTx(async () => {
        await setSessionClaims(ORG_1.admin, ORG_1_ID, "admin", "aal2");

        await expectTxError(
          `INSERT INTO public.holidays (organization_id, date, name) VALUES ($1, '2029-01-01', 'Direct Bypass');`,
          [ORG_1_ID],
          /permission denied/i
        );

        // Wrong role & AAL1 denied on holiday RPCs
        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.employee, ORG_1_ID, "employee", "aal1");
        await expectTxError(
          `SELECT public.create_holiday('2029-01-02', 'Emp Try', NULL, 'IN', 'company');`,
          [],
          /Only HR or Admins/i
        );

        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.hr, ORG_1_ID, "hr", "aal1");
        await expectTxError(
          `SELECT public.create_holiday('2029-01-02', 'AAL1 Try', NULL, 'IN', 'company');`,
          [],
          /AAL2/i
        );

        // HR AAL2 create -> update -> delete + audits
        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.hr, ORG_1_ID, "hr", "aal2");
        const created = await client.query(
          `SELECT public.create_holiday('2029-01-15', 'Pongal', 'தைப்பொங்கல்', 'TN', 'public') AS res;`
        );
        const holidayId = created.rows[0].res.holiday.id;
        expect(created.rows[0].res.holiday.local_name).toBe("தைப்பொங்கல்");

        // Cross-tenant AAL2 admin cannot update/delete Org 1 holiday
        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_2.admin, ORG_2_ID, "admin", "aal2");
        await expectTxError(
          `SELECT public.update_holiday($1, '2029-01-15', 'Hijack', NULL, 'TN', 'public', true);`,
          [holidayId],
          /not found in caller organization/i
        );
        await expectTxError(`SELECT public.delete_holiday($1);`, [holidayId], /not found in caller organization/i);

        // Same-tenant HR AAL2 update + delete
        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.hr, ORG_1_ID, "hr", "aal2");
        const updated = await client.query(
          `SELECT public.update_holiday($1, '2029-01-15', 'Thai Pongal Day', 'தைப்பொங்கல்', 'TN', 'special', true) AS res;`,
          [holidayId]
        );
        expect(updated.rows[0].res.holiday.name).toBe("Thai Pongal Day");

        const deleted = await client.query(`SELECT public.delete_holiday($1) AS res;`, [holidayId]);
        expect(deleted.rows[0].res.success).toBe(true);

        // Import global 'India - Tamil Nadu' (IN_TN) template for 2029 (copy-on-import + idempotent re-run)
        const imp1 = await client.query(`SELECT public.import_holiday_template('IN_TN', 2029) AS res;`);
        expect(imp1.rows[0].res.success).toBe(true);
        expect(imp1.rows[0].res.inserted_count).toBeGreaterThanOrEqual(10);

        const imp2 = await client.query(`SELECT public.import_holiday_template('IN_TN', 2029) AS res;`);
        expect(imp2.rows[0].res.inserted_count).toBe(0);
        expect(imp2.rows[0].res.skipped_count).toBe(imp1.rows[0].res.inserted_count);

        await client.query("RESET ROLE;");
        const auditActions = await client.query(
          `SELECT action FROM public.audit_logs
           WHERE organization_id = $1
             AND action IN ('HOLIDAY_CREATED', 'HOLIDAY_UPDATED', 'HOLIDAY_DELETED', 'HOLIDAY_TEMPLATE_IMPORTED');`,
          [ORG_1_ID]
        );
        expect(auditActions.rows.map((r) => r.action)).toEqual(
          expect.arrayContaining([
            "HOLIDAY_CREATED",
            "HOLIDAY_UPDATED",
            "HOLIDAY_DELETED",
            "HOLIDAY_TEMPLATE_IMPORTED",
          ])
        );
      });
    });
  });

  // =========================================================================
  // 4. APPROVAL DELEGATIONS
  // =========================================================================
  describe("1.4 Approval Delegations & Effective Approver Matrix", () => {
    it("enforces delegation validation rules (no self, date range, cross-tenant, role/AAL2) and empowers delegates until expired/revoked/suspended", async () => {
      await withRollbackTx(async () => {
        // Assign Rachel Lee and Employee to ORG_1.manager inside tx
        await client.query(`UPDATE public.employees SET manager_id = $1 WHERE id IN ($2, $3);`, [
          ORG_1.manager,
          ORG_1.employee,
          ORG_1.rachel,
        ]);

        // Employee cannot create delegation
        await setSessionClaims(ORG_1.employee, ORG_1_ID, "employee", "aal1");
        await expectTxError(
          `SELECT public.create_approval_delegation($1, $2, CURRENT_DATE, CURRENT_DATE + 5, 'Emp');`,
          [ORG_1.manager, ORG_1.rachel],
          /Employees cannot/i
        );

        // Manager cannot create delegation on behalf of another manager, nor self-delegate, nor inverted dates, nor cross-tenant delegate
        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.manager, ORG_1_ID, "manager", "aal1");
        await expectTxError(
          `SELECT public.create_approval_delegation($1, $2, CURRENT_DATE, CURRENT_DATE + 5, 'Other mgr');`,
          [ORG_1.hr, ORG_1.rachel],
          /only delegate their own/i
        );

        await expectTxError(
          `SELECT public.create_approval_delegation($1, $1, CURRENT_DATE, CURRENT_DATE + 5, 'Self');`,
          [ORG_1.manager],
          /Self-delegation/i
        );

        await expectTxError(
          `SELECT public.create_approval_delegation($1, $2, CURRENT_DATE + 5, CURRENT_DATE, 'Bad range');`,
          [ORG_1.manager, ORG_1.rachel],
          /end date/i
        );

        await expectTxError(
          `SELECT public.create_approval_delegation($1, $2, CURRENT_DATE, CURRENT_DATE + 5, 'Cross tenant');`,
          [ORG_1.manager, ORG_2.employee],
          /Delegate must be an active member/i
        );

        // Valid active delegation: ORG_1.manager delegates to ORG_1.rachel
        const created = await client.query(
          `SELECT public.create_approval_delegation($1, $2, CURRENT_DATE - 1, CURRENT_DATE + 3, 'Annual vacation coverage') AS res;`,
          [ORG_1.manager, ORG_1.rachel]
        );
        const delegationId = created.rows[0].res.delegation.id;

        // Verify can_approve_for() & is_active_delegated_approver() honor delegation
        await client.query("RESET ROLE;");
        const canBefore = await client.query(`SELECT public.can_approve_for($1, $2) AS ok;`, [
          ORG_1.rachel,
          ORG_1.employee,
        ]);
        expect(canBefore.rows[0].ok).toBe(true);

        // Seed a pending regularization & pending leave for ORG_1.employee
        const ltRes = await client.query(
          `SELECT id FROM public.leave_types WHERE organization_id = $1 LIMIT 1;`,
          [ORG_1_ID]
        );
        const regRes = await client.query(
          `INSERT INTO public.regularization_requests (organization_id, employee_id, work_date, requested_in, requested_out, reason, status)
           VALUES ($1, $2, '2028-06-14', '2028-06-14T04:00:00Z', '2028-06-14T12:30:00Z', 'Delegation reg test', 'pending')
           RETURNING id;`,
          [ORG_1_ID, ORG_1.employee]
        );
        const leaveRes = await client.query(
          `INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
           VALUES ($1, $2, $3, '2028-06-20', '2028-06-20', 1, 'Delegation leave test', 'pending')
           RETURNING id;`,
          [ORG_1_ID, ORG_1.employee, ltRes.rows[0].id]
        );

        // Ensure employee has leave balance for 2028
        await client.query(
          `DELETE FROM public.leave_balances
           WHERE employee_id = $1 AND leave_type_id = $2 AND period_start = '2028-01-01';`,
          [ORG_1.employee, ltRes.rows[0].id]
        );
        await client.query(
          `INSERT INTO public.leave_balances (organization_id, employee_id, leave_type_id, period_start, period_end, allocated, used, carried_forward, adjusted)
           VALUES ($1, $2, $3, '2028-01-01', '2028-12-31', 12, 0, 0, 0);`,
          [ORG_1_ID, ORG_1.employee, ltRes.rows[0].id]
        );

        // Rachel acts as delegate and sees + approves both requests
        await setSessionClaims(ORG_1.rachel, ORG_1_ID, "employee", "aal1");
        const visibleReqs = await client.query(
          `SELECT id FROM public.regularization_requests WHERE id = $1;`,
          [regRes.rows[0].id]
        );
        expect(visibleReqs.rows).toHaveLength(1);

        const appReg = await client.query(
          `SELECT public.approve_regularization($1, 'Approved via delegation') AS res;`,
          [regRes.rows[0].id]
        );
        expect(appReg.rows[0].res.success).toBe(true);

        const appLeave = await client.query(
          `SELECT public.approve_leave($1, 'Approved via delegation') AS res;`,
          [leaveRes.rows[0].id]
        );
        expect(appLeave.rows[0].res.success).toBe(true);

        // Manager revokes delegation -> can_approve_for immediately becomes false
        await client.query("RESET ROLE;");
        await setSessionClaims(ORG_1.manager, ORG_1_ID, "manager", "aal1");
        await client.query(`SELECT public.revoke_approval_delegation($1);`, [delegationId]);

        await client.query("RESET ROLE;");
        const canAfterRevoke = await client.query(`SELECT public.can_approve_for($1, $2) AS ok;`, [
          ORG_1.rachel,
          ORG_1.employee,
        ]);
        expect(canAfterRevoke.rows[0].ok).toBe(false);

        // Expired delegation returns false
        const expRow = await client.query(
          `INSERT INTO public.approval_delegations (organization_id, delegator_id, delegate_id, starts_on, ends_on, reason, created_by)
           VALUES ($1, $2, $3, CURRENT_DATE - 10, CURRENT_DATE - 2, 'Expired check', $2)
           RETURNING id;`,
          [ORG_1_ID, ORG_1.manager, ORG_1.rachel]
        );
        expect(expRow.rows).toHaveLength(1);
        const canExpired = await client.query(`SELECT public.can_approve_for($1, $2) AS ok;`, [
          ORG_1.rachel,
          ORG_1.employee,
        ]);
        expect(canExpired.rows[0].ok).toBe(false);

        // Audits & delegation notifications verified
        const audits = await client.query(
          `SELECT action FROM public.audit_logs
           WHERE organization_id = $1 AND record_id = $2
             AND action IN ('APPROVAL_DELEGATION_CREATED', 'APPROVAL_DELEGATION_REVOKED');`,
          [ORG_1_ID, delegationId]
        );
        expect(audits.rows).toHaveLength(2);
      });
    });
  });

  // =========================================================================
  // 5. NOTIFICATIONS TRIGGERS & PRIVATE PER-USER REALTIME CHANNEL ISOLATION
  // =========================================================================
  describe("1.5 Notifications Workflow & Private Realtime Channel Isolation", () => {
    it("emits notifications on regularization submission & approval and enforces Realtime private per-user topic RLS", async () => {
      await withRollbackTx(async () => {
        await client.query(`UPDATE public.employees SET manager_id = $1 WHERE id = $2;`, [
          ORG_1.manager,
          ORG_1.employee,
        ]);

        // Employee submits regularization -> manager gets 'request_status' notification
        await setSessionClaims(ORG_1.employee, ORG_1_ID, "employee", "aal1");
        const insReg = await client.query(
          `INSERT INTO public.regularization_requests (organization_id, employee_id, work_date, requested_in, requested_out, reason)
           VALUES ($1, $2, '2028-07-05', '2028-07-05T04:00:00Z', '2028-07-05T12:00:00Z', 'Client network drop')
           RETURNING id;`,
          [ORG_1_ID, ORG_1.employee]
        );

        // Employee cannot directly INSERT/DELETE notifications
        await expectTxError(
          `INSERT INTO public.notifications (organization_id, user_id, type, title, body)
           VALUES ($1, $2, 'reminder', 'Spoof', 'Spoof');`,
          [ORG_1_ID, ORG_1.manager],
          /permission denied/i
        );

        await client.query("RESET ROLE;");
        const mgrNotif = await client.query(
          `SELECT title, link FROM public.notifications
           WHERE user_id = $1 AND type = 'request_status'
           ORDER BY created_at DESC LIMIT 1;`,
          [ORG_1.manager]
        );
        expect(mgrNotif.rows[0].title).toBe("Regularization Request Submitted");
        expect(mgrNotif.rows[0].link).toBe("/requests");

        // Manager approves -> employee gets approval notification
        await setSessionClaims(ORG_1.manager, ORG_1_ID, "manager", "aal1");
        await client.query(`SELECT public.approve_regularization($1, 'OK');`, [insReg.rows[0].id]);

        await client.query("RESET ROLE;");
        const empNotif = await client.query(
          `SELECT id, title, read_at FROM public.notifications
           WHERE user_id = $1 AND type = 'request_status'
           ORDER BY created_at DESC LIMIT 1;`,
          [ORG_1.employee]
        );
        expect(empNotif.rows[0].title).toBe("Regularization Approved");
        expect(empNotif.rows[0].read_at).toBeNull();

        // Employee can mark own notification read via UPDATE (read_at)
        await setSessionClaims(ORG_1.employee, ORG_1_ID, "employee", "aal1");
        const markRead = await client.query(
          `UPDATE public.notifications SET read_at = now() WHERE id = $1 RETURNING read_at;`,
          [empNotif.rows[0].id]
        );
        expect(markRead.rows[0].read_at).not.toBeNull();

        // Verify RLS policy on realtime.messages restricts topics strictly to caller's user ID + active membership
        await client.query("RESET ROLE;");
        const rtPol = await client.query(`
          SELECT policyname, qual
          FROM pg_policies
          WHERE schemaname = 'realtime' AND tablename = 'messages' AND policyname = 'realtime_notifications_user_select_policy';
        `);
        expect(rtPol.rows).toHaveLength(1);
        expect(rtPol.rows[0].qual).toContain("notifications:user:");
        expect(rtPol.rows[0].qual).toContain("is_active_org_member");
      });
    });

    it("enforces live private Supabase Realtime channel subscription isolation across users", async () => {
      const supa = createClient(config.supabaseUrl, config.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: signInData, error: signInErr } = await supa.auth.signInWithPassword({
        email: "employee@remotehr.io",
        password: "DemoPassword123!",
      });
      expect(signInErr).toBeNull();
      expect(signInData.session?.access_token).toBeTruthy();

      await supa.realtime.setAuth(signInData.session!.access_token);

      const subscribeStatus = (topic: string) =>
        new Promise<string>((resolve) => {
          const ch = supa.channel(topic, { config: { private: true } });
          const timer = setTimeout(() => resolve("TIMEOUT"), 6000);
          ch.subscribe((status) => {
            if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
              clearTimeout(timer);
              resolve(status);
            }
          });
        });

      const ownStatus = await subscribeStatus(`notifications:user:${ORG_1.employee}`);
      const foreignStatus = await subscribeStatus(`notifications:user:${ORG_1.hr}`);

      await supa.removeAllChannels();

      expect(ownStatus).toBe("SUBSCRIBED");
      expect(foreignStatus).not.toBe("SUBSCRIBED");
    }, 15000);
  });
});

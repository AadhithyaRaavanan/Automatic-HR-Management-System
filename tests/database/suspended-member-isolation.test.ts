/**
 * Suspended Organization Member Behavior Test Suite (Section 0b)
 *
 * Verifies that suspending a member (`organization_members.status = 'suspended'`)
 * immediately revokes ALL access across EVERY tenant table and EVERY authenticated RPC
 * even while the caller still holds a valid `aal2` JWT with `user_role = 'admin'`
 * and `organization_id`.
 *
 * Also acts as a load-bearing detector for Mutation 4:
 *   DROP POLICY "enforce_active_org_membership_attendance_sessions" ON public.attendance_sessions;
 * If that RESTRICTIVE policy is dropped, the suspended admin's still-valid JWT claims
 * can read `attendance_sessions` rows, causing this suite to FAIL.
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
const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const SUSPENDED_ADMIN_ID = "00000000-0000-0000-0000-000000000901";
const TARGET_EMP_ID = "00000000-0000-0000-0000-000000000004";
const MANAGER_ID = "00000000-0000-0000-0000-000000000003";

describe("Section 0b: Suspended Member Behavior Isolation Suite", () => {
  let client: Client;
  let leaveTypeId: string;
  let leaveReqId: string;
  let regReqId: string;

  beforeAll(async () => {
    client = new Client({
      connectionString: dbUrl,
      ssl: false,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();

    // Create dedicated test admin user in Org 1
    await client.query(`
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES ('${SUSPENDED_ADMIN_ID}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'suspended-admin@remotehr.io', 'fake', now(), '{}', '{}', now(), now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES ('${ORG_1_ID}', '${SUSPENDED_ADMIN_ID}', 'admin', 'active')
      ON CONFLICT (organization_id, user_id) DO UPDATE SET organization_id = '${ORG_1_ID}', role = 'admin', status = 'active';
    `);
    await client.query(`
      INSERT INTO public.employees (id, organization_id, email, full_name, status)
      VALUES ('${SUSPENDED_ADMIN_ID}', '${ORG_1_ID}', 'suspended-admin@remotehr.io', 'Suspended Admin Probe', 'active')
      ON CONFLICT (id) DO UPDATE SET organization_id = '${ORG_1_ID}', status = 'active';
    `);

    // Own attendance session for SUSPENDED_ADMIN_ID so self-access (`employee_id = auth.uid()`)
    // genuinely depends on RESTRICTIVE `enforce_active_org_membership_attendance_sessions`
    await client.query(`
      INSERT INTO public.attendance_sessions (organization_id, employee_id, work_date, check_in_at, check_out_at, source, note)
      VALUES ('${ORG_1_ID}', '${SUSPENDED_ADMIN_ID}', '2026-10-01', '2026-10-01T09:00:00Z', '2026-10-01T17:00:00Z', 'web', 'Suspended probe own session')
      ON CONFLICT DO NOTHING;
    `);

    const lt = await client.query(`SELECT id FROM public.leave_types WHERE organization_id = '${ORG_1_ID}' LIMIT 1;`);
    leaveTypeId = lt.rows[0].id;

    const lr = await client.query(`SELECT id FROM public.leave_requests WHERE organization_id = '${ORG_1_ID}' LIMIT 1;`);
    if (lr.rows.length > 0) {
      leaveReqId = lr.rows[0].id;
    } else {
      const inserted = await client.query(`
        INSERT INTO public.leave_requests (organization_id, employee_id, leave_type_id, start_date, end_date, total_days, reason, status)
        VALUES ('${ORG_1_ID}', '${TARGET_EMP_ID}', '${leaveTypeId}', '2026-12-28', '2026-12-28', 1, 'Seed probe', 'pending')
        RETURNING id;
      `);
      leaveReqId = inserted.rows[0].id;
    }

    const rr = await client.query(`SELECT id FROM public.regularization_requests WHERE organization_id = '${ORG_1_ID}' LIMIT 1;`);
    regReqId = rr.rows[0].id;
  });

  afterAll(async () => {
    if (client) {
      await client.query("RESET ROLE;");
      await client.query(`DELETE FROM public.attendance_sessions WHERE employee_id = '${SUSPENDED_ADMIN_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.attendance_days WHERE employee_id = '${SUSPENDED_ADMIN_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.organization_members WHERE user_id = '${SUSPENDED_ADMIN_ID}';`).catch(() => {});
      await client.query(`DELETE FROM public.employees WHERE id = '${SUSPENDED_ADMIN_ID}';`).catch(() => {});
      await client.query(`DELETE FROM auth.users WHERE id = '${SUSPENDED_ADMIN_ID}';`).catch(() => {});
      await client.end();
    }
  });

  async function withStaleAal2AdminJwt<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const claims = JSON.stringify({
      sub: SUSPENDED_ADMIN_ID,
      role: "authenticated",
      user_role: "admin",
      organization_id: ORG_1_ID,
      aal: "aal2",
    });

    await client.query("BEGIN;");
    try {
      await client.query("SET LOCAL ROLE authenticated;");
      await client.query(`SELECT set_config('request.jwt.claims', '${claims}', true);`);
      const res = await fn(client);
      await client.query("ROLLBACK;");
      return res;
    } catch (err) {
      await client.query("ROLLBACK;");
      throw err;
    }
  }

  it("Positive control: active admin reads attendance_sessions and calls helper RPCs before suspension", async () => {
    await client.query(`UPDATE public.organization_members SET status = 'active' WHERE user_id = '${SUSPENDED_ADMIN_ID}';`);
    await withStaleAal2AdminJwt(async (c) => {
      const sess = await c.query(`SELECT count(*)::int AS cnt FROM public.attendance_sessions;`);
      expect(sess.rows[0].cnt).toBeGreaterThan(0);

      const activeCheck = await c.query(`SELECT public.is_active_org_member() AS ok;`);
      expect(activeCheck.rows[0].ok).toBe(true);

      const roleCheck = await c.query(`SELECT public.get_user_role('${TARGET_EMP_ID}') AS r;`);
      expect(roleCheck.rows[0].r).toBe("employee");
    });
  });

  it("Denies SELECT and mutations on EVERY tenant table when suspended despite valid aal2 admin JWT", async () => {
    await client.query(`UPDATE public.organization_members SET status = 'suspended' WHERE user_id = '${SUSPENDED_ADMIN_ID}';`);

    // Discover every public table dynamically to ensure complete coverage
    const tablesRes = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
    `);
    const publicTables: string[] = tablesRes.rows.map((r: any) => r.tablename);
    expect(publicTables.length).toBeGreaterThanOrEqual(20);

    await withStaleAal2AdminJwt(async (c) => {
      // Explicit Mutation 4 load-bearing check on attendance_sessions:
      const sessRes = await c.query(`SELECT id FROM public.attendance_sessions;`);
      expect(sessRes.rows.length).toBe(0);
    });

    // Every single public table returns 0 rows or raises permission denied (42501) on SELECT
    for (const tbl of publicTables) {
      await withStaleAal2AdminJwt(async (c) => {
        try {
          const r = await c.query(`SELECT count(*)::int AS cnt FROM public."${tbl}";`);
          expect(r.rows[0].cnt, `Expected 0 readable rows on ${tbl} while suspended`).toBe(0);
        } catch (err: any) {
          // Tables with zero SELECT grants (e.g. auth_rate_limits, cron_run_state, kiosk_credentials) reject at privilege layer
          expect(String(err.code || err.message)).toMatch(/42501|permission denied/i);
        }
      });
    }

    // Write denial probe on tenant tables with direct write RLS policies
    const writeProbes: Array<{ name: string; sql: string }> = [
      {
        name: "UPDATE organizations",
        sql: `UPDATE public.organizations SET name = 'Hijacked' WHERE id = '${ORG_1_ID}' RETURNING id;`,
      },
      {
        name: "INSERT departments",
        sql: `INSERT INTO public.departments (organization_id, name, code) VALUES ('${ORG_1_ID}', 'SuspDept', 'SD');`,
      },
      {
        name: "UPDATE departments",
        sql: `UPDATE public.departments SET name = 'Hacked' RETURNING id;`,
      },
      {
        name: "INSERT locations",
        sql: `INSERT INTO public.locations (organization_id, name, code) VALUES ('${ORG_1_ID}', 'SuspLoc', 'SL');`,
      },
      {
        name: "INSERT holidays",
        sql: `INSERT INTO public.holidays (organization_id, date, name) VALUES ('${ORG_1_ID}', '2026-12-30', 'SuspHoliday');`,
      },
      {
        name: "INSERT leave_types",
        sql: `INSERT INTO public.leave_types (organization_id, name, code) VALUES ('${ORG_1_ID}', 'SuspLeave', 'SLV');`,
      },
      {
        name: "UPDATE notifications",
        sql: `UPDATE public.notifications SET read_at = now() RETURNING id;`,
      },
      {
        name: "UPDATE employees",
        sql: `UPDATE public.employees SET full_name = 'Hijacked' WHERE id = '${SUSPENDED_ADMIN_ID}' RETURNING id;`,
      },
      {
        name: "UPDATE attendance_days",
        sql: `UPDATE public.attendance_days SET locked = false RETURNING employee_id;`,
      },
      {
        name: "INSERT regularization_requests",
        sql: `INSERT INTO public.regularization_requests (organization_id, employee_id, work_date, requested_in, requested_out, reason) VALUES ('${ORG_1_ID}', '${SUSPENDED_ADMIN_ID}', '2026-11-05', '2026-11-05T09:00:00Z', '2026-11-05T17:00:00Z', 'Hack');`,
      },
    ];

    for (const probe of writeProbes) {
      await withStaleAal2AdminJwt(async (c) => {
        try {
          const res = await c.query(probe.sql);
          // For UPDATE RETURNING when RLS filters all rows, rowCount must be 0
          expect(res.rowCount || 0, `Expected 0 rows affected for ${probe.name}`).toBe(0);
        } catch (err: any) {
          expect(String(err.code || err.message)).toMatch(/42501|row-level security|permission denied/i);
        }
      });
    }
  });

  it("Denies EVERY authenticated SECURITY DEFINER RPC with SQLSTATE 42501 while suspended", async () => {
    await client.query(`UPDATE public.organization_members SET status = 'suspended' WHERE user_id = '${SUSPENDED_ADMIN_ID}';`);

    // Context helpers still safe & non-elevated
    await withStaleAal2AdminJwt(async (c) => {
      const active = await c.query(`SELECT public.is_active_org_member() AS ok, public.current_user_role() AS role, public.is_active_delegated_approver('${TARGET_EMP_ID}') AS delegated;`);
      expect(active.rows[0].ok).toBe(false);
      expect(active.rows[0].role).toBeNull();
      expect(active.rows[0].delegated).toBe(false);
    });

    const dummyId = "00000000-0000-0000-0000-000000000001";
    const rpcCalls: Array<{ name: string; sql: string }> = [
      { name: "check_in(text)", sql: `SELECT public.check_in('Susp note');` },
      { name: "check_in(uuid,text)", sql: `SELECT public.check_in('${TARGET_EMP_ID}', 'Susp override');` },
      { name: "check_out()", sql: `SELECT public.check_out();` },
      { name: "lock_month(int,int)", sql: `SELECT public.lock_month(2026, 10);` },
      { name: "unlock_month(int,int,text)", sql: `SELECT public.unlock_month(2026, 10, 'Suspended probe reason');` },
      { name: "approve_regularization(uuid,text)", sql: `SELECT public.approve_regularization('${regReqId}', 'Susp');` },
      { name: "reject_regularization(uuid,text)", sql: `SELECT public.reject_regularization('${regReqId}', 'Susp');` },
      { name: "get_user_role(uuid)", sql: `SELECT public.get_user_role('${TARGET_EMP_ID}');` },
      { name: "calculate_working_days", sql: `SELECT public.calculate_working_days('${TARGET_EMP_ID}', '2026-11-02', '2026-11-03', 'full');` },
      { name: "get_organization_leave_period", sql: `SELECT * FROM public.get_organization_leave_period('${ORG_1_ID}', '2026-11-02');` },
      { name: "request_leave", sql: `SELECT public.request_leave('${leaveTypeId}', '2026-12-28', '2026-12-28', 'full', 'Susp');` },
      { name: "approve_leave", sql: `SELECT public.approve_leave('${leaveReqId}', 'Susp');` },
      { name: "reject_leave", sql: `SELECT public.reject_leave('${leaveReqId}', 'Susp');` },
      { name: "cancel_leave", sql: `SELECT public.cancel_leave('${leaveReqId}', 'Susp');` },
      { name: "hr_assign_leave", sql: `SELECT public.hr_assign_leave(ARRAY['${TARGET_EMP_ID}']::uuid[], '${leaveTypeId}', '2026-12-28', '2026-12-28', 'full', 'Susp', false);` },
      { name: "hr_adjust_balance", sql: `SELECT public.hr_adjust_balance('${TARGET_EMP_ID}', '${leaveTypeId}', 1.0, 'Susp');` },
      { name: "allocate_yearly_balances", sql: `SELECT public.allocate_yearly_balances('${ORG_1_ID}', 2026);` },
      { name: "declare_company_day_off", sql: `SELECT public.declare_company_day_off('2026-12-29', 'Susp');` },
      { name: "admin_update_employee_governance", sql: `SELECT public.admin_update_employee_governance('${TARGET_EMP_ID}', 'Susp');` },
      { name: "admin_update_employee", sql: `SELECT public.admin_update_employee('${TARGET_EMP_ID}', NULL, NULL, NULL, '${MANAGER_ID}');` },
      { name: "admin_deactivate_member", sql: `SELECT public.admin_deactivate_member('${TARGET_EMP_ID}');` },
      { name: "admin_create_department", sql: `SELECT public.admin_create_department('SuspDept', 'SD');` },
      { name: "admin_update_department", sql: `SELECT public.admin_update_department('${dummyId}', 'SuspDept', 'SD');` },
      { name: "admin_delete_department", sql: `SELECT public.admin_delete_department('${dummyId}');` },
      { name: "admin_create_location", sql: `SELECT public.admin_create_location('SuspLoc', 'SL');` },
      { name: "admin_update_location", sql: `SELECT public.admin_update_location('${dummyId}', 'SuspLoc');` },
      { name: "admin_delete_location", sql: `SELECT public.admin_delete_location('${dummyId}');` },
      { name: "admin_create_shift_template", sql: `SELECT public.admin_create_shift_template('SuspShift', 'SS', '09:00:00', '17:00:00');` },
      { name: "admin_update_shift_template", sql: `SELECT public.admin_update_shift_template('${dummyId}', 'SuspShift', '09:00:00', '17:00:00');` },
      { name: "admin_delete_shift_template", sql: `SELECT public.admin_delete_shift_template('${dummyId}');` },
      { name: "admin_assign_shift", sql: `SELECT public.admin_assign_shift('${TARGET_EMP_ID}', '${dummyId}', '2026-11-01');` },
      { name: "admin_update_organization_settings", sql: `SELECT public.admin_update_organization_settings('SuspOrg', 'UTC', 'remote');` },
      { name: "admin_update_attendance_policy", sql: `SELECT public.admin_update_attendance_policy(15, 240, '23:59:00');` },
      { name: "admin_add_org_member", sql: `SELECT public.admin_add_org_member('${ORG_1_ID}', '${TARGET_EMP_ID}', 'manager');` },
      { name: "admin_update_org_member_role", sql: `SELECT public.admin_update_org_member_role('${ORG_1_ID}', '${TARGET_EMP_ID}', 'hr');` },
      { name: "admin_remove_org_member", sql: `SELECT public.admin_remove_org_member('${ORG_1_ID}', '${TARGET_EMP_ID}');` },
      { name: "complete_onboarding()", sql: `SELECT public.complete_onboarding();` },
      { name: "create_holiday", sql: `SELECT public.create_holiday('2026-12-30', 'Susp Holiday', 'சோதனை', 'IN_TN', 'public');` },
      { name: "update_holiday", sql: `SELECT public.update_holiday('${dummyId}', '2026-12-30', 'Susp Holiday', 'சோதனை', 'IN_TN', 'public', true);` },
      { name: "delete_holiday", sql: `SELECT public.delete_holiday('${dummyId}');` },
      { name: "import_holiday_template", sql: `SELECT public.import_holiday_template('IN_TN', 2026);` },
      { name: "get_month_close_checklist", sql: `SELECT public.get_month_close_checklist(2026, 10);` },
      { name: "hr_correct_attendance", sql: `SELECT public.hr_correct_attendance('${TARGET_EMP_ID}', '2026-10-01', '[]'::jsonb, 'Susp test');` },
      { name: "create_approval_delegation", sql: `SELECT public.create_approval_delegation('${TARGET_EMP_ID}', '${MANAGER_ID}', '2026-11-01', '2026-11-30', 'Susp test');` },
      { name: "revoke_approval_delegation", sql: `SELECT public.revoke_approval_delegation('${dummyId}');` },
      { name: "admin_update_retention_policy", sql: `SELECT public.admin_update_retention_policy(18, 24, 90);` },
      { name: "get_org_system_health", sql: `SELECT public.get_org_system_health();` },
      { name: "get_org_retention_preview", sql: `SELECT public.get_org_retention_preview();` },
      { name: "create_project", sql: `SELECT public.create_project('Susp Project');` },
      { name: "create_task", sql: `SELECT public.create_task('Susp Task');` },
      { name: "assign_task", sql: `SELECT public.assign_task('${dummyId}', '${TARGET_EMP_ID}');` },
      { name: "update_task_status", sql: `SELECT public.update_task_status('${dummyId}', 'in_progress');` },
      { name: "complete_task", sql: `SELECT public.complete_task('${dummyId}', 'Susp');` },
      { name: "cancel_task", sql: `SELECT public.cancel_task('${dummyId}', 'Susp');` },
      { name: "add_task_comment", sql: `SELECT public.add_task_comment('${dummyId}', 'Susp');` },
      { name: "log_task_time", sql: `SELECT public.log_task_time('${dummyId}', '2026-11-01', 30);` },
      { name: "upsert_kpi_definition", sql: `SELECT public.upsert_kpi_definition('Susp KPI', 'tasks_completed', 5, 'higher_is_better', 1.0);` },
      { name: "delete_kpi_definition", sql: `SELECT public.delete_kpi_definition('${dummyId}');` },
      { name: "create_kpi_period", sql: `SELECT public.create_kpi_period('Susp Period', 'monthly', '2026-11-01', '2026-11-30');` },
      { name: "compute_kpi_scores", sql: `SELECT public.compute_kpi_scores('${dummyId}');` },
      { name: "close_kpi_period", sql: `SELECT public.close_kpi_period('${dummyId}');` },
      { name: "submit_kpi_review", sql: `SELECT public.submit_kpi_review('${dummyId}', '${TARGET_EMP_ID}', 4.0, 'Susp');` },
    ];

    for (const rpc of rpcCalls) {
      let caughtError: any = null;
      try {
        await withStaleAal2AdminJwt(async (c) => {
          await c.query(rpc.sql);
        });
      } catch (err) {
        caughtError = err;
      }
      expect(caughtError, `Expected RPC ${rpc.name} to deny suspended member`).not.toBeNull();
      expect(String(caughtError?.code || "")).toBe("42501");
    }
  });
});


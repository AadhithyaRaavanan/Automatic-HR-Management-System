/**
 * Item 1: Exhaustive UUID Argument Tenant-Isolation Suite
 *
 * Queries `pg_proc` for EVERY `authenticated`-executable function in schema `public`
 * that accepts at least one `uuid` or `uuid[]` parameter (47 signatures), asserts 100%
 * reconciliation with this test manifest, and verifies that an Org 2 caller passing
 * Org 1 UUIDs (including compound secondary UUID arguments such as leave types,
 * departments, locations, managers, shifts, projects, parent tasks, and JSONB location_ids)
 * is strictly denied or returns empty/false/null with zero cross-tenant leaks or writes.
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
const ORG_1 = {
  admin: "00000000-0000-0000-0000-000000000001",
  hr: "00000000-0000-0000-0000-000000000002",
  manager: "00000000-0000-0000-0000-000000000003",
  employee: "00000000-0000-0000-0000-000000000004",
};

const ORG_2_ID = "00000000-0000-0000-0000-000000000950";
const ORG_2 = {
  admin: "00000000-0000-0000-0000-000000000951",
  hr: "00000000-0000-0000-0000-000000000952",
  manager: "00000000-0000-0000-0000-000000000953",
  employee: "00000000-0000-0000-0000-000000000954",
  deptId: "00000000-0000-0000-0000-000000000955",
  locId: "00000000-0000-0000-0000-000000000956",
  shiftId: "00000000-0000-0000-0000-000000000957",
  leaveTypeId: "00000000-0000-0000-0000-000000000958",
  projectId: "00000000-0000-0000-0000-000000000959",
  taskId: "00000000-0000-0000-0000-00000000095a",
  kpiDefId: "00000000-0000-0000-0000-00000000095b",
  kpiPeriodId: "00000000-0000-0000-0000-00000000095c",
};

const ORG_1_FIXTURES = {
  deptId: "00000000-0000-0000-0000-000000000961",
  locId: "00000000-0000-0000-0000-000000000962",
  shiftId: "00000000-0000-0000-0000-000000000963",
  leaveReqId: "00000000-0000-0000-0000-000000000964",
  regReqId: "00000000-0000-0000-0000-000000000965",
  holidayId: "00000000-0000-0000-0000-000000000966",
  delegationId: "00000000-0000-0000-0000-000000000967",
  projectId: "00000000-0000-0000-0000-000000000968",
  taskId: "00000000-0000-0000-0000-000000000969",
  kpiDefId: "00000000-0000-0000-0000-00000000096a",
  kpiPeriodId: "00000000-0000-0000-0000-00000000096b",
};

const ALL_EXPECTED_UUID_SIGNATURES = [
  "add_task_comment(uuid,text)",
  "admin_add_org_member(uuid,uuid,text)",
  "admin_assign_shift(uuid,uuid,date,date)",
  "admin_create_department(text,text,uuid,uuid)",
  "admin_deactivate_member(uuid)",
  "admin_delete_department(uuid)",
  "admin_delete_location(uuid)",
  "admin_delete_shift_template(uuid)",
  "admin_remove_org_member(uuid,uuid)",
  "admin_update_department(uuid,text,text,uuid,uuid)",
  "admin_update_employee(uuid,uuid,text,text,uuid,integer,integer[],integer,text)",
  "admin_update_employee_governance(uuid,text,uuid,uuid,text,text,uuid,integer,integer[],integer,text)",
  "admin_update_location(uuid,text,text,text,integer,integer[])",
  "admin_update_org_member_role(uuid,uuid,text)",
  "admin_update_shift_template(uuid,text,time without time zone,time without time zone,integer,integer)",
  "allocate_yearly_balances(uuid,integer)",
  "approve_leave(uuid,text)",
  "approve_regularization(uuid,text)",
  "assign_task(uuid,uuid)",
  "calculate_working_days(uuid,date,date,text)",
  "cancel_leave(uuid,text)",
  "cancel_task(uuid,text)",
  "check_in(uuid,text)",
  "close_kpi_period(uuid)",
  "complete_task(uuid,text)",
  "compute_kpi_scores(uuid)",
  "create_approval_delegation(uuid,uuid,date,date,text)",
  "create_project(text,uuid,text,text)",
  "create_task(text,text,uuid,text,date,integer,uuid,uuid)",
  "declare_company_day_off(date,text,uuid)",
  "delete_holiday(uuid)",
  "delete_kpi_definition(uuid)",
  "get_organization_leave_period(uuid,date)",
  "get_user_role(uuid)",
  "hr_adjust_balance(uuid,uuid,numeric,text)",
  "hr_assign_leave(uuid[],uuid,date,date,text,text,boolean)",
  "hr_correct_attendance(uuid,date,jsonb,text)",
  "is_active_delegated_approver(uuid)",
  "log_task_time(uuid,date,integer,text)",
  "reject_leave(uuid,text)",
  "reject_regularization(uuid,text)",
  "request_leave(uuid,date,date,text,text)",
  "revoke_approval_delegation(uuid)",
  "submit_kpi_review(uuid,uuid,numeric,text)",
  "update_holiday(uuid,date,text,text,text,text,boolean)",
  "update_task_status(uuid,text,text)",
  "upsert_kpi_definition(text,text,numeric,text,numeric,text,text,uuid,boolean,uuid)",
].sort();

describe("Item 1: UUID Argument Tenant-Isolation Suite", () => {
  let client: Client;
  let org1LeaveTypeId: string;

  async function asOrg2<T>(
    role: "admin" | "hr" | "manager" | "employee",
    fn: (c: Client) => Promise<T>,
    aal: "aal1" | "aal2" = "aal2"
  ): Promise<T> {
    const uid = ORG_2[role];
    const claims = JSON.stringify({
      sub: uid,
      aud: "authenticated",
      role: "authenticated",
      aal,
      user_role: role,
      organization_id: ORG_2_ID,
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

  async function cleanupFixtures() {
    await client.query("RESET ROLE;").catch(() => {});
    await client.query(`DELETE FROM public.notifications WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
    await client.query(`DELETE FROM public.audit_logs WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
    await client.query(`DELETE FROM public.task_events WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
    await client.query(`DELETE FROM public.tasks WHERE id IN ($1, $2);`, [ORG_2.taskId, ORG_1_FIXTURES.taskId]).catch(() => {});
    await client.query(`DELETE FROM public.projects WHERE id IN ($1, $2);`, [ORG_2.projectId, ORG_1_FIXTURES.projectId]).catch(() => {});
    await client.query(`DELETE FROM public.kpi_reviews WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
    await client.query(`DELETE FROM public.kpi_scores WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
    await client.query(`DELETE FROM public.kpi_periods WHERE id IN ($1, $2);`, [ORG_2.kpiPeriodId, ORG_1_FIXTURES.kpiPeriodId]).catch(() => {});
    await client.query(`DELETE FROM public.kpi_definitions WHERE id IN ($1, $2);`, [ORG_2.kpiDefId, ORG_1_FIXTURES.kpiDefId]).catch(() => {});
    await client.query(`DELETE FROM public.approval_delegations WHERE id = $1;`, [ORG_1_FIXTURES.delegationId]).catch(() => {});
    await client.query(`DELETE FROM public.holidays WHERE id = $1;`, [ORG_1_FIXTURES.holidayId]).catch(() => {});
    await client.query(`DELETE FROM public.regularization_requests WHERE id = $1;`, [ORG_1_FIXTURES.regReqId]).catch(() => {});
    await client.query(`DELETE FROM public.leave_requests WHERE id = $1;`, [ORG_1_FIXTURES.leaveReqId]).catch(() => {});
    await client.query(`DELETE FROM public.leave_balances WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
    await client.query(`DELETE FROM public.leave_policies WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});
    await client.query(`DELETE FROM public.leave_types WHERE id = $1;`, [ORG_2.leaveTypeId]).catch(() => {});
    await client.query(`DELETE FROM public.shift_templates WHERE id IN ($1, $2);`, [ORG_2.shiftId, ORG_1_FIXTURES.shiftId]).catch(() => {});
    await client.query(`DELETE FROM public.locations WHERE id IN ($1, $2);`, [ORG_2.locId, ORG_1_FIXTURES.locId]).catch(() => {});
    await client.query(`DELETE FROM public.departments WHERE id IN ($1, $2);`, [ORG_2.deptId, ORG_1_FIXTURES.deptId]).catch(() => {});
    await client.query(`DELETE FROM public.retention_policies WHERE organization_id = $1;`, [ORG_2_ID]).catch(() => {});

    for (const uid of [ORG_2.admin, ORG_2.hr, ORG_2.manager, ORG_2.employee]) {
      await client.query(`DELETE FROM public.organization_members WHERE user_id = $1;`, [uid]).catch(() => {});
      await client.query(`DELETE FROM public.employees WHERE id = $1;`, [uid]).catch(() => {});
      await client.query(`DELETE FROM auth.users WHERE id = $1;`, [uid]).catch(() => {});
    }
    await client.query(`DELETE FROM public.organizations WHERE id = $1;`, [ORG_2_ID]).catch(() => {});
  }

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL, ssl: false, connectionTimeoutMillis: 5000 });
    await client.connect();
    await cleanupFixtures();

    const lt = await client.query<{ id: string }>(
      `SELECT id FROM public.leave_types WHERE organization_id = $1 AND is_active = TRUE LIMIT 1;`,
      [ORG_1_ID]
    );
    org1LeaveTypeId = lt.rows[0].id;

    // Org 2 tenant + users
    await client.query(
      `INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone, leave_year_start_month)
       VALUES ($1, 'UUID Isolation Tenant 2', 'uuid-iso-t2', 'hybrid', 'active', 'UTC', 1)
       ON CONFLICT (id) DO UPDATE SET status = 'active';`,
      [ORG_2_ID]
    );

    const org2Users: Array<{ id: string; role: string; mgr: string | null }> = [
      { id: ORG_2.admin, role: "admin", mgr: null },
      { id: ORG_2.hr, role: "hr", mgr: ORG_2.admin },
      { id: ORG_2.manager, role: "manager", mgr: ORG_2.admin },
      { id: ORG_2.employee, role: "employee", mgr: ORG_2.manager },
    ];
    for (const u of org2Users) {
      const email = `uuid-iso-${u.role}@tenant2.test`;
      await client.query(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, 'fake', now(), '{"provider":"email"}', '{}', now(), now());`,
        [u.id, email]
      );
      await client.query(
        `INSERT INTO public.organization_members (organization_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active');`,
        [ORG_2_ID, u.id, u.role]
      );
      await client.query(
        `INSERT INTO public.employees (id, organization_id, email, full_name, manager_id, status, work_mode, timezone)
         VALUES ($1, $2, $3, $4, $5, 'active', 'hybrid', 'UTC');`,
        [u.id, ORG_2_ID, email, `T2 ${u.role}`, u.mgr]
      );
    }

    // Org 2 entities (so compound secondary Org 1 UUIDs can be tested alongside valid Org 2 primary IDs)
    await client.query(
      `INSERT INTO public.departments (id, organization_id, name, code) VALUES ($1, $2, 'T2 Dept', 'T2D');`,
      [ORG_2.deptId, ORG_2_ID]
    );
    await client.query(
      `INSERT INTO public.locations (id, organization_id, name, code, timezone) VALUES ($1, $2, 'T2 Loc', 'T2L', 'UTC');`,
      [ORG_2.locId, ORG_2_ID]
    );
    await client.query(
      `INSERT INTO public.shift_templates (id, organization_id, name, code, start_time, end_time) VALUES ($1, $2, 'T2 Shift', 'T2S', '09:00', '17:00');`,
      [ORG_2.shiftId, ORG_2_ID]
    );
    await client.query(
      `INSERT INTO public.leave_types (id, organization_id, name, code, is_active) VALUES ($1, $2, 'T2 Annual', 'T2AL', TRUE);`,
      [ORG_2.leaveTypeId, ORG_2_ID]
    );
    await client.query(
      `INSERT INTO public.projects (id, organization_id, name, code, created_by) VALUES ($1, $2, 'T2 Project', 'T2P', $3);`,
      [ORG_2.projectId, ORG_2_ID, ORG_2.admin]
    );
    await client.query(
      `INSERT INTO public.tasks (id, organization_id, title, creator_id, assignee_id, status) VALUES ($1, $2, 'T2 Task', $3, $4, 'todo');`,
      [ORG_2.taskId, ORG_2_ID, ORG_2.admin, ORG_2.employee]
    );
    await client.query(
      `INSERT INTO public.kpi_definitions (id, organization_id, name, source_metric, target_value, direction, created_by)
       VALUES ($1, $2, 'T2 KPI', 'tasks_completed', 5, 'higher_is_better', $3);`,
      [ORG_2.kpiDefId, ORG_2_ID, ORG_2.admin]
    );
    await client.query(
      `INSERT INTO public.kpi_periods (id, organization_id, name, period_type, start_date, end_date, status, created_by)
       VALUES ($1, $2, 'T2 KPI Period', 'monthly', '2098-01-01', '2098-01-31', 'open', $3);`,
      [ORG_2.kpiPeriodId, ORG_2_ID, ORG_2.admin]
    );

    // Deterministic Org 1 target entities
    await client.query(
      `INSERT INTO public.departments (id, organization_id, name, code) VALUES ($1, $2, 'T1 UUID Target Dept', 'T1UD');`,
      [ORG_1_FIXTURES.deptId, ORG_1_ID]
    );
    await client.query(
      `INSERT INTO public.locations (id, organization_id, name, code, timezone) VALUES ($1, $2, 'T1 UUID Target Loc', 'T1UL', 'UTC');`,
      [ORG_1_FIXTURES.locId, ORG_1_ID]
    );
    await client.query(
      `INSERT INTO public.shift_templates (id, organization_id, name, code, start_time, end_time) VALUES ($1, $2, 'T1 UUID Target Shift', 'T1US', '09:00', '17:00');`,
      [ORG_1_FIXTURES.shiftId, ORG_1_ID]
    );
    await client.query(
      `INSERT INTO public.leave_requests (id, organization_id, employee_id, leave_type_id, start_date, end_date, day_part, total_days, reason, status)
       VALUES ($1, $2, $3, $4, '2098-06-15', '2098-06-15', 'full', 1, 'UUID target', 'pending');`,
      [ORG_1_FIXTURES.leaveReqId, ORG_1_ID, ORG_1.employee, org1LeaveTypeId]
    );
    await client.query(
      `INSERT INTO public.regularization_requests (id, organization_id, employee_id, work_date, requested_in, requested_out, reason, status)
       VALUES ($1, $2, $3, '2098-06-14', '2098-06-14T09:00:00Z', '2098-06-14T17:00:00Z', 'UUID target', 'pending');`,
      [ORG_1_FIXTURES.regReqId, ORG_1_ID, ORG_1.employee]
    );
    await client.query(
      `INSERT INTO public.holidays (id, organization_id, date, name, region, holiday_type, is_active)
       VALUES ($1, $2, '2098-06-16', 'UUID Target Holiday', 'GLOBAL', 'company', TRUE);`,
      [ORG_1_FIXTURES.holidayId, ORG_1_ID]
    );
    await client.query(
      `INSERT INTO public.approval_delegations (id, organization_id, delegator_id, delegate_id, starts_on, ends_on, is_active, created_by)
       VALUES ($1, $2, $3, $4, CURRENT_DATE - 1, CURRENT_DATE + 7, TRUE, $3);`,
      [ORG_1_FIXTURES.delegationId, ORG_1_ID, ORG_1.manager, ORG_1.employee]
    );
    await client.query(
      `INSERT INTO public.projects (id, organization_id, name, code, created_by) VALUES ($1, $2, 'T1 UUID Project', 'T1UP', $3);`,
      [ORG_1_FIXTURES.projectId, ORG_1_ID, ORG_1.admin]
    );
    await client.query(
      `INSERT INTO public.tasks (id, organization_id, title, creator_id, assignee_id, status) VALUES ($1, $2, 'T1 UUID Task', $3, $4, 'todo');`,
      [ORG_1_FIXTURES.taskId, ORG_1_ID, ORG_1.manager, ORG_1.employee]
    );
    await client.query(
      `INSERT INTO public.kpi_definitions (id, organization_id, name, source_metric, target_value, direction, created_by)
       VALUES ($1, $2, 'T1 UUID KPI', 'tasks_completed', 5, 'higher_is_better', $3);`,
      [ORG_1_FIXTURES.kpiDefId, ORG_1_ID, ORG_1.admin]
    );
    await client.query(
      `INSERT INTO public.kpi_periods (id, organization_id, name, period_type, start_date, end_date, status, created_by)
       VALUES ($1, $2, 'T1 UUID KPI Period', 'monthly', '2098-06-01', '2098-06-30', 'open', $3);`,
      [ORG_1_FIXTURES.kpiPeriodId, ORG_1_ID, ORG_1.admin]
    );
  });

  afterAll(async () => {
    if (client) {
      await cleanupFixtures();
      await client.end();
    }
  });

  it("reconciles 100% of authenticated-executable UUID-argument functions from live pg_proc", async () => {
    const res = await client.query<{ sig: string }>(`
      SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
      WHERE n.nspname = 'public'
        AND d.objid IS NULL
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND EXISTS (
          SELECT 1 FROM pg_catalog.unnest(p.proargtypes) AS t
          WHERE t IN ('uuid'::regtype, 'uuid[]'::regtype)
        )
      ORDER BY sig;
    `);
    const liveSigs = res.rows.map((r) => r.sig).sort();
    expect(liveSigs).toEqual(ALL_EXPECTED_UUID_SIGNATURES);
    expect(liveSigs.length).toBe(47);
  });

  it("explicitly validates the 5 core review RPCs plus newly hardened compound-UUID edge cases", async () => {
    // 1. get_user_role(uuid): returns NULL for Org 1 target when queried by Org 2 caller
    const roleLookup = await asOrg2("employee", (c) =>
      c.query<{ r: string | null }>(`SELECT public.get_user_role($1) AS r;`, [ORG_1.admin])
    );
    expect(roleLookup.rows[0].r).toBeNull();

    // 2. calculate_working_days(uuid,...): denies Org 1 employee even when start_date > end_date (M16 fix)
    await expect(
      asOrg2("employee", (c) =>
        c.query(`SELECT public.calculate_working_days($1, '2098-06-15', '2098-06-16', 'full');`, [ORG_1.employee])
      )
    ).rejects.toThrow(/Cross-tenant violation/i);

    await expect(
      asOrg2("employee", (c) =>
        c.query(`SELECT public.calculate_working_days($1, '2098-06-20', '2098-06-10', 'full');`, [ORG_1.employee])
      )
    ).rejects.toThrow(/Cross-tenant violation/i);

    // 3. get_organization_leave_period(uuid,date): denies Org 1 org UUID from Org 2 caller
    await expect(
      asOrg2("employee", (c) =>
        c.query(`SELECT * FROM public.get_organization_leave_period($1, '2098-06-15');`, [ORG_1_ID])
      )
    ).rejects.toThrow(/Cross-tenant violation/i);

    // 4. allocate_yearly_balances(uuid,integer): denies Org 1 org UUID from Org 2 AAL2 admin
    await expect(
      asOrg2("admin", (c) => c.query(`SELECT public.allocate_yearly_balances($1, 2098);`, [ORG_1_ID]))
    ).rejects.toThrow(/another organization/i);

    // 5. admin_add_org_member(uuid,uuid,text): denies Org 1 org UUID, NULL org UUID, and Org 1 user UUID
    await expect(
      asOrg2("admin", (c) =>
        c.query(`SELECT public.admin_add_org_member($1, $2, 'employee');`, [ORG_1_ID, ORG_2.employee])
      )
    ).rejects.toThrow(/Cross-tenant violation/i);

    await expect(
      asOrg2("admin", (c) =>
        c.query(`SELECT public.admin_add_org_member(NULL::uuid, $1, 'employee');`, [ORG_2.employee])
      )
    ).rejects.toThrow(/organization_id is required/i);

    await expect(
      asOrg2("admin", (c) =>
        c.query(`SELECT public.admin_add_org_member($1, $2, 'employee');`, [ORG_2_ID, ORG_1.employee])
      )
    ).rejects.toThrow(/Cross-tenant violation/i);

    // 6. Compound-UUID M16 hardening: Org 2 admin passing Org 2 employee + Org 1 leave_type_id
    await expect(
      asOrg2("admin", (c) =>
        c.query(`SELECT public.hr_adjust_balance($1, $2, 1.0, 'Cross leave type');`, [ORG_2.employee, org1LeaveTypeId])
      )
    ).rejects.toThrow(/Leave type does not belong/i);

    await expect(
      asOrg2("admin", (c) =>
        c.query(
          `SELECT public.hr_assign_leave(ARRAY[$1]::uuid[], $2, '2098-07-01', '2098-07-01', 'full', 'Cross leave type', true);`,
          [ORG_2.employee, org1LeaveTypeId]
        )
      )
    ).rejects.toThrow(/leave type not found in caller organization/i);
  });

  it("denies or returns empty for ALL 47 authenticated UUID-argument functions when Org 2 passes Org 1 UUIDs", async () => {
    const executedSignatures = new Set<string>();

    const expectThrows = async (
      sig: string,
      role: "admin" | "hr" | "manager" | "employee",
      sql: string,
      params: unknown[],
      pattern?: RegExp
    ) => {
      executedSignatures.add(sig);
      let err: any = null;
      try {
        await asOrg2(role, (c) => c.query(sql, params));
      } catch (e) {
        err = e;
      }
      expect(err, `Expected ${sig} to throw on Org 1 UUID`).not.toBeNull();
      if (pattern) {
        expect(String(err.message || err)).toMatch(pattern);
      }
    };

    const expectJsonFailure = async (
      sig: string,
      role: "admin" | "hr" | "manager" | "employee",
      sql: string,
      params: unknown[]
    ) => {
      executedSignatures.add(sig);
      const res = await asOrg2(role, (c) => c.query<{ r: { success: boolean } }>(sql, params));
      expect(res.rows[0].r.success, `Expected ${sig} to return success=false`).toBe(false);
    };

    // --- Admin & Member Management ---
    await expectThrows(
      "admin_add_org_member(uuid,uuid,text)",
      "admin",
      `SELECT public.admin_add_org_member($1, $2, 'employee');`,
      [ORG_1_ID, ORG_2.employee]
    );
    await expectThrows(
      "admin_remove_org_member(uuid,uuid)",
      "admin",
      `SELECT public.admin_remove_org_member($1, $2);`,
      [ORG_1_ID, ORG_1.employee]
    );
    await expectThrows(
      "admin_remove_org_member(uuid,uuid)",
      "admin",
      `SELECT public.admin_remove_org_member($1, $2);`,
      [ORG_2_ID, ORG_1.employee]
    );
    await expectThrows(
      "admin_update_org_member_role(uuid,uuid,text)",
      "admin",
      `SELECT public.admin_update_org_member_role($1, $2, 'hr');`,
      [ORG_1_ID, ORG_1.employee]
    );
    await expectThrows(
      "admin_update_org_member_role(uuid,uuid,text)",
      "admin",
      `SELECT public.admin_update_org_member_role($1, $2, 'hr');`,
      [ORG_2_ID, ORG_1.employee]
    );
    await expectThrows(
      "admin_deactivate_member(uuid)",
      "admin",
      `SELECT public.admin_deactivate_member($1);`,
      [ORG_1.employee]
    );

    // --- Org Structure (Departments, Locations, Shifts, Employees) ---
    await expectThrows(
      "admin_create_department(text,text,uuid,uuid)",
      "admin",
      `SELECT public.admin_create_department('CrossDept', 'CD1', $1, NULL);`,
      [ORG_1.manager]
    );
    await expectThrows(
      "admin_create_department(text,text,uuid,uuid)",
      "admin",
      `SELECT public.admin_create_department('CrossDept2', 'CD2', NULL, $1);`,
      [ORG_1_FIXTURES.deptId]
    );
    await expectThrows(
      "admin_update_department(uuid,text,text,uuid,uuid)",
      "admin",
      `SELECT public.admin_update_department($1, 'Hijack', 'HJ');`,
      [ORG_1_FIXTURES.deptId]
    );
    await expectThrows(
      "admin_update_department(uuid,text,text,uuid,uuid)",
      "admin",
      `SELECT public.admin_update_department($1, 'T2 Dept', 'T2D', $2, NULL);`,
      [ORG_2.deptId, ORG_1.manager]
    );
    await expectThrows(
      "admin_delete_department(uuid)",
      "admin",
      `SELECT public.admin_delete_department($1);`,
      [ORG_1_FIXTURES.deptId]
    );
    await expectThrows(
      "admin_update_location(uuid,text,text,text,integer,integer[])",
      "admin",
      `SELECT public.admin_update_location($1, 'HijackLoc');`,
      [ORG_1_FIXTURES.locId]
    );
    await expectThrows(
      "admin_delete_location(uuid)",
      "admin",
      `SELECT public.admin_delete_location($1);`,
      [ORG_1_FIXTURES.locId]
    );
    await expectThrows(
      "admin_update_shift_template(uuid,text,time without time zone,time without time zone,integer,integer)",
      "admin",
      `SELECT public.admin_update_shift_template($1, 'HijackShift', '09:00', '17:00');`,
      [ORG_1_FIXTURES.shiftId]
    );
    await expectThrows(
      "admin_delete_shift_template(uuid)",
      "admin",
      `SELECT public.admin_delete_shift_template($1);`,
      [ORG_1_FIXTURES.shiftId]
    );
    await expectThrows(
      "admin_assign_shift(uuid,uuid,date,date)",
      "admin",
      `SELECT public.admin_assign_shift($1, $2, '2098-06-01');`,
      [ORG_1.employee, ORG_2.shiftId]
    );
    await expectThrows(
      "admin_assign_shift(uuid,uuid,date,date)",
      "admin",
      `SELECT public.admin_assign_shift($1, $2, '2098-06-01');`,
      [ORG_2.employee, ORG_1_FIXTURES.shiftId]
    );
    await expectThrows(
      "admin_update_employee(uuid,uuid,text,text,uuid,integer,integer[],integer,text)",
      "admin",
      `SELECT public.admin_update_employee($1);`,
      [ORG_1.employee]
    );
    await expectThrows(
      "admin_update_employee(uuid,uuid,text,text,uuid,integer,integer[],integer,text)",
      "admin",
      `SELECT public.admin_update_employee($1, $2);`,
      [ORG_2.employee, ORG_1.manager]
    );
    await expectThrows(
      "admin_update_employee_governance(uuid,text,uuid,uuid,text,text,uuid,integer,integer[],integer,text)",
      "admin",
      `SELECT public.admin_update_employee_governance($1, 'Hijacked');`,
      [ORG_1.employee]
    );
    await expectThrows(
      "admin_update_employee_governance(uuid,text,uuid,uuid,text,text,uuid,integer,integer[],integer,text)",
      "admin",
      `SELECT public.admin_update_employee_governance($1, NULL, $2);`,
      [ORG_2.employee, ORG_1_FIXTURES.deptId]
    );

    // --- Attendance & Regularizations & Holidays ---
    await expectJsonFailure(
      "check_in(uuid,text)",
      "admin",
      `SELECT public.check_in($1, 'Cross-tenant') AS r;`,
      [ORG_1.employee]
    );
    await expectJsonFailure(
      "approve_regularization(uuid,text)",
      "admin",
      `SELECT public.approve_regularization($1, 'Cross-tenant') AS r;`,
      [ORG_1_FIXTURES.regReqId]
    );
    await expectJsonFailure(
      "reject_regularization(uuid,text)",
      "admin",
      `SELECT public.reject_regularization($1, 'Cross-tenant') AS r;`,
      [ORG_1_FIXTURES.regReqId]
    );
    await expectThrows(
      "hr_correct_attendance(uuid,date,jsonb,text)",
      "hr",
      `SELECT public.hr_correct_attendance($1, '2098-06-15', '[]'::jsonb, 'Cross-tenant');`,
      [ORG_1.employee]
    );
    await expectThrows(
      "hr_correct_attendance(uuid,date,jsonb,text)",
      "hr",
      `SELECT public.hr_correct_attendance($1, '2098-06-15', $2::jsonb, 'Cross loc');`,
      [
        ORG_2.employee,
        JSON.stringify([
          { check_in_at: "2098-06-15T09:00:00Z", check_out_at: "2098-06-15T17:00:00Z", location_id: ORG_1_FIXTURES.locId },
        ]),
      ]
    );
    await expectThrows(
      "update_holiday(uuid,date,text,text,text,text,boolean)",
      "hr",
      `SELECT public.update_holiday($1, '2098-06-16', 'Hijacked Holiday');`,
      [ORG_1_FIXTURES.holidayId]
    );
    await expectThrows(
      "delete_holiday(uuid)",
      "hr",
      `SELECT public.delete_holiday($1);`,
      [ORG_1_FIXTURES.holidayId]
    );
    await expectThrows(
      "declare_company_day_off(date,text,uuid)",
      "hr",
      `SELECT public.declare_company_day_off('2098-06-17', 'Cross Off', $1);`,
      [ORG_1_FIXTURES.deptId]
    );

    // --- Leave & Delegations ---
    await expectThrows(
      "calculate_working_days(uuid,date,date,text)",
      "employee",
      `SELECT public.calculate_working_days($1, '2098-06-15', '2098-06-16', 'full');`,
      [ORG_1.employee]
    );
    await expectThrows(
      "get_organization_leave_period(uuid,date)",
      "employee",
      `SELECT * FROM public.get_organization_leave_period($1, '2098-06-15');`,
      [ORG_1_ID]
    );
    await expectThrows(
      "allocate_yearly_balances(uuid,integer)",
      "hr",
      `SELECT public.allocate_yearly_balances($1, 2098);`,
      [ORG_1_ID]
    );
    await expectThrows(
      "request_leave(uuid,date,date,text,text)",
      "employee",
      `SELECT public.request_leave($1, '2098-06-15', '2098-06-15', 'full', 'Cross leave');`,
      [org1LeaveTypeId]
    );
    await expectThrows(
      "approve_leave(uuid,text)",
      "admin",
      `SELECT public.approve_leave($1, 'Cross approve');`,
      [ORG_1_FIXTURES.leaveReqId]
    );
    await expectThrows(
      "reject_leave(uuid,text)",
      "admin",
      `SELECT public.reject_leave($1, 'Cross reject');`,
      [ORG_1_FIXTURES.leaveReqId]
    );
    await expectThrows(
      "cancel_leave(uuid,text)",
      "admin",
      `SELECT public.cancel_leave($1, 'Cross cancel');`,
      [ORG_1_FIXTURES.leaveReqId]
    );
    await expectThrows(
      "hr_adjust_balance(uuid,uuid,numeric,text)",
      "hr",
      `SELECT public.hr_adjust_balance($1, $2, 1.0, 'Cross emp');`,
      [ORG_1.employee, ORG_2.leaveTypeId]
    );
    await expectThrows(
      "hr_adjust_balance(uuid,uuid,numeric,text)",
      "hr",
      `SELECT public.hr_adjust_balance($1, $2, 1.0, 'Cross lt');`,
      [ORG_2.employee, org1LeaveTypeId]
    );
    await expectThrows(
      "hr_assign_leave(uuid[],uuid,date,date,text,text,boolean)",
      "hr",
      `SELECT public.hr_assign_leave(ARRAY[$1]::uuid[], $2, '2098-06-15', '2098-06-15', 'full', 'Cross emp', true);`,
      [ORG_1.employee, ORG_2.leaveTypeId]
    );
    await expectThrows(
      "hr_assign_leave(uuid[],uuid,date,date,text,text,boolean)",
      "hr",
      `SELECT public.hr_assign_leave(ARRAY[$1]::uuid[], $2, '2098-06-15', '2098-06-15', 'full', 'Cross lt', true);`,
      [ORG_2.employee, org1LeaveTypeId]
    );
    await expectThrows(
      "create_approval_delegation(uuid,uuid,date,date,text)",
      "admin",
      `SELECT public.create_approval_delegation($1, $2, CURRENT_DATE, CURRENT_DATE + 1, 'Cross mgr');`,
      [ORG_1.manager, ORG_2.employee]
    );
    await expectThrows(
      "create_approval_delegation(uuid,uuid,date,date,text)",
      "admin",
      `SELECT public.create_approval_delegation($1, $2, CURRENT_DATE, CURRENT_DATE + 1, 'Cross del');`,
      [ORG_2.manager, ORG_1.employee]
    );
    await expectThrows(
      "revoke_approval_delegation(uuid)",
      "admin",
      `SELECT public.revoke_approval_delegation($1);`,
      [ORG_1_FIXTURES.delegationId]
    );

    executedSignatures.add("get_user_role(uuid)");
    const getRoleRes = await asOrg2("admin", (c) =>
      c.query<{ r: string | null }>(`SELECT public.get_user_role($1) AS r;`, [ORG_1.employee])
    );
    expect(getRoleRes.rows[0].r).toBeNull();

    executedSignatures.add("is_active_delegated_approver(uuid)");
    const delCheck = await asOrg2("employee", (c) =>
      c.query<{ ok: boolean }>(`SELECT public.is_active_delegated_approver($1) AS ok;`, [ORG_1.manager])
    );
    expect(delCheck.rows[0].ok).toBe(false);

    // --- Projects & Tasks ---
    await expectThrows(
      "create_project(text,uuid,text,text)",
      "admin",
      `SELECT public.create_project('Cross Proj', $1);`,
      [ORG_1_FIXTURES.deptId]
    );
    await expectThrows(
      "create_task(text,text,uuid,text,date,integer,uuid,uuid)",
      "admin",
      `SELECT public.create_task('Cross Task Assignee', NULL, $1);`,
      [ORG_1.employee]
    );
    await expectThrows(
      "create_task(text,text,uuid,text,date,integer,uuid,uuid)",
      "admin",
      `SELECT public.create_task('Cross Task Proj', NULL, NULL, 'medium', NULL, NULL, $1, NULL);`,
      [ORG_1_FIXTURES.projectId]
    );
    await expectThrows(
      "create_task(text,text,uuid,text,date,integer,uuid,uuid)",
      "admin",
      `SELECT public.create_task('Cross Task Parent', NULL, NULL, 'medium', NULL, NULL, NULL, $1);`,
      [ORG_1_FIXTURES.taskId]
    );
    await expectThrows(
      "assign_task(uuid,uuid)",
      "admin",
      `SELECT public.assign_task($1, $2);`,
      [ORG_1_FIXTURES.taskId, ORG_2.employee]
    );
    await expectThrows(
      "assign_task(uuid,uuid)",
      "admin",
      `SELECT public.assign_task($1, $2);`,
      [ORG_2.taskId, ORG_1.employee]
    );
    await expectThrows(
      "update_task_status(uuid,text,text)",
      "admin",
      `SELECT public.update_task_status($1, 'in_progress', 'Cross');`,
      [ORG_1_FIXTURES.taskId]
    );
    await expectThrows(
      "complete_task(uuid,text)",
      "admin",
      `SELECT public.complete_task($1, 'Cross');`,
      [ORG_1_FIXTURES.taskId]
    );
    await expectThrows(
      "cancel_task(uuid,text)",
      "admin",
      `SELECT public.cancel_task($1, 'Cross');`,
      [ORG_1_FIXTURES.taskId]
    );
    await expectThrows(
      "add_task_comment(uuid,text)",
      "admin",
      `SELECT public.add_task_comment($1, 'Cross comment');`,
      [ORG_1_FIXTURES.taskId]
    );
    await expectThrows(
      "log_task_time(uuid,date,integer,text)",
      "admin",
      `SELECT public.log_task_time($1, '2098-06-15', 30, 'Cross time');`,
      [ORG_1_FIXTURES.taskId]
    );

    // --- KPIs ---
    await expectThrows(
      "upsert_kpi_definition(text,text,numeric,text,numeric,text,text,uuid,boolean,uuid)",
      "admin",
      `SELECT public.upsert_kpi_definition('Cross KPI Dept', 'tasks_completed', 1, 'higher_is_better', 1, NULL, NULL, $1, TRUE, NULL);`,
      [ORG_1_FIXTURES.deptId]
    );
    await expectThrows(
      "upsert_kpi_definition(text,text,numeric,text,numeric,text,text,uuid,boolean,uuid)",
      "admin",
      `SELECT public.upsert_kpi_definition('Cross KPI ID', 'tasks_completed', 1, 'higher_is_better', 1, NULL, NULL, NULL, TRUE, $1);`,
      [ORG_1_FIXTURES.kpiDefId]
    );
    await expectThrows(
      "delete_kpi_definition(uuid)",
      "admin",
      `SELECT public.delete_kpi_definition($1);`,
      [ORG_1_FIXTURES.kpiDefId]
    );
    await expectThrows(
      "compute_kpi_scores(uuid)",
      "admin",
      `SELECT public.compute_kpi_scores($1);`,
      [ORG_1_FIXTURES.kpiPeriodId]
    );
    await expectThrows(
      "close_kpi_period(uuid)",
      "admin",
      `SELECT public.close_kpi_period($1);`,
      [ORG_1_FIXTURES.kpiPeriodId]
    );
    await expectThrows(
      "submit_kpi_review(uuid,uuid,numeric,text)",
      "admin",
      `SELECT public.submit_kpi_review($1, $2, 4.0, 'Cross period');`,
      [ORG_1_FIXTURES.kpiPeriodId, ORG_2.employee]
    );
    await expectThrows(
      "submit_kpi_review(uuid,uuid,numeric,text)",
      "admin",
      `SELECT public.submit_kpi_review($1, $2, 4.0, 'Cross employee');`,
      [ORG_2.kpiPeriodId, ORG_1.employee]
    );

    // Assert every single one of the 47 signatures was executed
    expect(Array.from(executedSignatures).sort()).toEqual(ALL_EXPECTED_UUID_SIGNATURES);
  });
});


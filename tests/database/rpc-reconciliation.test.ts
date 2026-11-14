/**
 * Item 2 & Section 0d: Dynamic pg_proc Security Matrix & Function Reconciliation Suite
 *
 * Replaces static file-mention checks with a live, database-executed 4-cell security
 * matrix generated directly from `pg_proc`:
 *   1. Reconciles EVERY `SECURITY DEFINER` function in `public` (96 functions) for
 *      `search_path=""`, zero `PUBLIC`/`anon` EXECUTE grants, and role gating.
 *   2. Queries `pg_proc` dynamically for EVERY `authenticated`-executable `SECURITY DEFINER`
 *      function (68 functions) and executes live probes for:
 *        - crossTenant (`Org 2` caller targeting `Org 1` IDs / spoofed org claim)
 *        - wrongRole (`employee` / `manager` / `hr@aal2` attempting unauthorized RPC)
 *        - aal1 (`hr` or `admin` holding only `aal = 'aal1'` on AAL2-gated RPC)
 *        - suspendedMember (member with `status = 'suspended'` holding valid `aal2` JWT)
 *   3. Logs the complete 68-row matrix summary and lists every function with any
 *      missing (`N/A`) cell and its exact architectural justification.
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

const FIX = {
  org2Id: "00000000-0000-0000-0000-000000000970",
  org2Admin: "00000000-0000-0000-0000-000000000971",
  org2Employee: "00000000-0000-0000-0000-000000000972",
  org1SuspendedAdmin: "00000000-0000-0000-0000-000000000973",
  org1OtherEmp: "00000000-0000-0000-0000-000000000974",
  org1Dept: "00000000-0000-0000-0000-000000000975",
  org1Loc: "00000000-0000-0000-0000-000000000976",
  org1Shift: "00000000-0000-0000-0000-000000000977",
  org1LeaveReq: "00000000-0000-0000-0000-000000000978",
  org1RegReq: "00000000-0000-0000-0000-000000000979",
  org1Holiday: "00000000-0000-0000-0000-00000000097a",
  org1Delegation: "00000000-0000-0000-0000-00000000097b",
  org1Task: "00000000-0000-0000-0000-00000000097c",
  org1KpiDef: "00000000-0000-0000-0000-00000000097d",
  org1KpiPeriod: "00000000-0000-0000-0000-00000000097e",
};

const NON_AUTHENTICATED_SECDEF_ROLES: Record<string, "service_role" | "supabase_auth_admin" | "trigger"> = {
  "admin_create_organization(text,text,text,text)": "service_role",
  "can_approve_for(uuid,uuid)": "service_role",
  "check_employee_field_protection()": "trigger",
  "cron_auto_checkout(timestamp with time zone)": "service_role",
  "cron_nightly_finalize(timestamp with time zone)": "service_role",
  "cron_trigger_retention_archive()": "service_role",
  "custom_access_token_hook(jsonb)": "supabase_auth_admin",
  "dispatch_task_due_notifications()": "service_role",
  "get_retention_export_batches(uuid,integer)": "service_role",
  "protect_organization_fields()": "trigger",
  "provision_invited_employee(uuid,uuid,text,text,text,text,text,uuid,uuid,uuid,integer,integer[],integer)": "service_role",
  "punch_verified(uuid,text,uuid,text)": "service_role",
  "recalculate_day(uuid,date)": "service_role",
  "record_retention_archive(uuid,text,date,date,timestamp with time zone,text,bigint,text,uuid[],uuid)": "service_role",
  "run_org_retention_cleanup(uuid,boolean,uuid)": "service_role",
  "run_retention_cleanup(boolean)": "service_role",
  "trg_broadcast_notification()": "trigger",
  "trg_derive_audit_log_org_id()": "trigger",
  "trg_derive_day_org_id()": "trigger",
  "trg_derive_notification_org_id()": "trigger",
  "trg_derive_request_org_id()": "trigger",
  "trg_derive_session_org_id()": "trigger",
  "trg_enforce_kpi_closed_immutability()": "trigger",
  "trg_init_org_retention_policy()": "trigger",
  "trg_notify_regularization_submitted()": "trigger",
  "trg_protect_employee_fields()": "trigger",
  "trg_protect_location_ip_ranges()": "trigger",
  "trg_set_privacy_acknowledgment_defaults()": "trigger",
};

type ProbeOutcome = "throws" | "json_false" | "null" | "false";

interface CellProbe {
  kind: "probe";
  actor: "org2_admin" | "org2_emp" | "org1_emp" | "org1_other_emp" | "org1_mgr" | "org1_hr" | "org1_admin" | "org1_suspended";
  aal: "aal1" | "aal2";
  spoofOrgId?: string;
  sql: string;
  expected: ProbeOutcome;
}

interface CellNA {
  kind: "na";
  reason: string;
}

type MatrixCell = CellProbe | CellNA;

interface FunctionMatrixSpec {
  crossTenant: MatrixCell;
  wrongRole: MatrixCell;
  aal1: MatrixCell;
  suspendedMember: MatrixCell;
}

const na = (reason: string): CellNA => ({ kind: "na", reason });

const p = (
  actor: CellProbe["actor"],
  aal: "aal1" | "aal2",
  sql: string,
  expected: ProbeOutcome = "throws",
  spoofOrgId?: string
): CellProbe => ({
  kind: "probe",
  actor,
  aal,
  spoofOrgId,
  sql,
  expected,
});

function buildAuthenticatedMatrix(org1LeaveTypeId: string): Record<string, FunctionMatrixSpec> {
  return {
    // 1. Admin-only RPCs (17)
    "admin_add_org_member(uuid,uuid,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_add_org_member('${ORG_1_ID}', '${FIX.org2Employee}', 'employee');`),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_add_org_member('${ORG_1_ID}', '${ORG_1.employee}', 'employee');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_add_org_member('${ORG_1_ID}', '${ORG_1.employee}', 'employee');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_add_org_member('${ORG_1_ID}', '${ORG_1.employee}', 'employee');`),
    },
    "admin_assign_shift(uuid,uuid,date,date)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_assign_shift('${ORG_1.employee}', '${FIX.org1Shift}', '2098-08-01');`),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_assign_shift('${ORG_1.employee}', '${FIX.org1Shift}', '2098-08-01');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_assign_shift('${ORG_1.employee}', '${FIX.org1Shift}', '2098-08-01');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_assign_shift('${ORG_1.employee}', '${FIX.org1Shift}', '2098-08-01');`),
    },
    "admin_create_location(text,text,text,text,integer,integer[])": {
      crossTenant: na("No UUID argument; derives caller org strictly from current_org_id()"),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_create_location('ProbeLoc', 'PL');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_create_location('ProbeLoc', 'PL');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_create_location('ProbeLoc', 'PL');`),
    },
    "admin_create_shift_template(text,text,time without time zone,time without time zone,integer,integer)": {
      crossTenant: na("No UUID argument; derives caller org strictly from current_org_id()"),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_create_shift_template('ProbeShift', 'PS', '09:00', '17:00');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_create_shift_template('ProbeShift', 'PS', '09:00', '17:00');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_create_shift_template('ProbeShift', 'PS', '09:00', '17:00');`),
    },
    "admin_deactivate_member(uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_deactivate_member('${ORG_1.employee}');`),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_deactivate_member('${ORG_1.employee}');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_deactivate_member('${ORG_1.employee}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_deactivate_member('${ORG_1.employee}');`),
    },
    "admin_delete_location(uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_delete_location('${FIX.org1Loc}');`),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_delete_location('${FIX.org1Loc}');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_delete_location('${FIX.org1Loc}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_delete_location('${FIX.org1Loc}');`),
    },
    "admin_delete_shift_template(uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_delete_shift_template('${FIX.org1Shift}');`),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_delete_shift_template('${FIX.org1Shift}');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_delete_shift_template('${FIX.org1Shift}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_delete_shift_template('${FIX.org1Shift}');`),
    },
    "admin_remove_org_member(uuid,uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_remove_org_member('${ORG_1_ID}', '${ORG_1.employee}');`),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_remove_org_member('${ORG_1_ID}', '${ORG_1.employee}');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_remove_org_member('${ORG_1_ID}', '${ORG_1.employee}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_remove_org_member('${ORG_1_ID}', '${ORG_1.employee}');`),
    },
    "admin_update_attendance_policy(integer,integer,time without time zone)": {
      crossTenant: na("No UUID argument; updates caller org policy via current_org_id()"),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_update_attendance_policy(15, 240, '23:59:00');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_update_attendance_policy(15, 240, '23:59:00');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_update_attendance_policy(15, 240, '23:59:00');`),
    },
    "admin_update_location(uuid,text,text,text,integer,integer[])": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_update_location('${FIX.org1Loc}', 'HijackLoc');`),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_update_location('${FIX.org1Loc}', 'HijackLoc');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_update_location('${FIX.org1Loc}', 'HijackLoc');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_update_location('${FIX.org1Loc}', 'HijackLoc');`),
    },
    "admin_update_org_member_role(uuid,uuid,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_update_org_member_role('${ORG_1_ID}', '${ORG_1.employee}', 'hr');`),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_update_org_member_role('${ORG_1_ID}', '${ORG_1.employee}', 'hr');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_update_org_member_role('${ORG_1_ID}', '${ORG_1.employee}', 'hr');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_update_org_member_role('${ORG_1_ID}', '${ORG_1.employee}', 'hr');`),
    },
    "admin_update_organization_settings(text,text,text)": {
      crossTenant: na("No UUID argument; updates caller org via current_org_id()"),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_update_organization_settings('ProbeOrg', 'UTC', 'remote');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_update_organization_settings('ProbeOrg', 'UTC', 'remote');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_update_organization_settings('ProbeOrg', 'UTC', 'remote');`),
    },
    "admin_update_retention_policy(integer,integer,integer)": {
      crossTenant: na("No UUID argument; updates caller org policy via current_org_id()"),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_update_retention_policy(18, 24, 90);`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_update_retention_policy(18, 24, 90);`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_update_retention_policy(18, 24, 90);`),
    },
    "admin_update_shift_template(uuid,text,time without time zone,time without time zone,integer,integer)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_update_shift_template('${FIX.org1Shift}', 'Hijack', '09:00', '17:00');`),
      wrongRole: p("org1_hr", "aal2", `SELECT public.admin_update_shift_template('${FIX.org1Shift}', 'Hijack', '09:00', '17:00');`),
      aal1: p("org1_admin", "aal1", `SELECT public.admin_update_shift_template('${FIX.org1Shift}', 'Hijack', '09:00', '17:00');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_update_shift_template('${FIX.org1Shift}', 'Hijack', '09:00', '17:00');`),
    },
    "get_org_retention_preview()": {
      crossTenant: na("No UUID argument; scopes preview strictly to current_org_id()"),
      wrongRole: p("org1_hr", "aal2", `SELECT public.get_org_retention_preview();`),
      aal1: p("org1_admin", "aal1", `SELECT public.get_org_retention_preview();`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.get_org_retention_preview();`),
    },
    "get_org_system_health()": {
      crossTenant: na("No UUID argument; measures caller org tables via current_org_id()"),
      wrongRole: p("org1_hr", "aal2", `SELECT public.get_org_system_health();`),
      aal1: p("org1_admin", "aal1", `SELECT public.get_org_system_health();`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.get_org_system_health();`),
    },
    "unlock_month(integer,integer,text)": {
      crossTenant: na("No UUID argument; updates caller org attendance_days via current_org_id()"),
      wrongRole: p("org1_hr", "aal2", `SELECT public.unlock_month(2098, 8, 'HR attempt');`),
      aal1: p("org1_admin", "aal1", `SELECT public.unlock_month(2098, 8, 'AAL1 attempt');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.unlock_month(2098, 8, 'Suspended');`),
    },

    // 2. HR / Admin AAL2 RPCs (23)
    "admin_create_department(text,text,uuid,uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_create_department('CrossDept', 'CD9', '${ORG_1.manager}', NULL);`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.admin_create_department('MgrDept', 'MD9');`),
      aal1: p("org1_hr", "aal1", `SELECT public.admin_create_department('HrDept', 'HD9');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_create_department('SuspDept', 'SD9');`),
    },
    "admin_delete_department(uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_delete_department('${FIX.org1Dept}');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.admin_delete_department('${FIX.org1Dept}');`),
      aal1: p("org1_hr", "aal1", `SELECT public.admin_delete_department('${FIX.org1Dept}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_delete_department('${FIX.org1Dept}');`),
    },
    "admin_update_department(uuid,text,text,uuid,uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_update_department('${FIX.org1Dept}', 'Hijack', 'HJ');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.admin_update_department('${FIX.org1Dept}', 'Hijack', 'HJ');`),
      aal1: p("org1_hr", "aal1", `SELECT public.admin_update_department('${FIX.org1Dept}', 'Hijack', 'HJ');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_update_department('${FIX.org1Dept}', 'Hijack', 'HJ');`),
    },
    "admin_update_employee(uuid,uuid,text,text,uuid,integer,integer[],integer,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_update_employee('${ORG_1.employee}');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.admin_update_employee('${ORG_1.employee}');`),
      aal1: p("org1_hr", "aal1", `SELECT public.admin_update_employee('${ORG_1.employee}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_update_employee('${ORG_1.employee}');`),
    },
    "admin_update_employee_governance(uuid,text,uuid,uuid,text,text,uuid,integer,integer[],integer,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.admin_update_employee_governance('${ORG_1.employee}', 'Hijacked');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.admin_update_employee_governance('${ORG_1.employee}', 'Hijacked');`),
      aal1: p("org1_hr", "aal1", `SELECT public.admin_update_employee_governance('${ORG_1.employee}', 'Hijacked');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.admin_update_employee_governance('${ORG_1.employee}', 'Hijacked');`),
    },
    "allocate_yearly_balances(uuid,integer)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.allocate_yearly_balances('${ORG_1_ID}', 2098);`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.allocate_yearly_balances('${ORG_1_ID}', 2098);`),
      aal1: p("org1_hr", "aal1", `SELECT public.allocate_yearly_balances('${ORG_1_ID}', 2098);`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.allocate_yearly_balances('${ORG_1_ID}', 2098);`),
    },
    "check_in(uuid,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.check_in('${ORG_1.employee}', 'Cross') AS r;`, "json_false"),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.check_in('${ORG_1.employee}', 'Mgr override') AS r;`, "json_false"),
      aal1: p("org1_hr", "aal1", `SELECT public.check_in('${ORG_1.employee}', 'AAL1 override') AS r;`, "json_false"),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.check_in('${ORG_1.employee}', 'Suspended');`),
    },
    "close_kpi_period(uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.close_kpi_period('${FIX.org1KpiPeriod}');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.close_kpi_period('${FIX.org1KpiPeriod}');`),
      aal1: p("org1_hr", "aal1", `SELECT public.close_kpi_period('${FIX.org1KpiPeriod}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.close_kpi_period('${FIX.org1KpiPeriod}');`),
    },
    "compute_kpi_scores(uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.compute_kpi_scores('${FIX.org1KpiPeriod}');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.compute_kpi_scores('${FIX.org1KpiPeriod}');`),
      aal1: p("org1_hr", "aal1", `SELECT public.compute_kpi_scores('${FIX.org1KpiPeriod}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.compute_kpi_scores('${FIX.org1KpiPeriod}');`),
    },
    "create_holiday(date,text,text,text,text)": {
      crossTenant: na("No UUID argument; inserts holiday in current_org_id()"),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.create_holiday('2098-08-18', 'Mgr Holiday');`),
      aal1: p("org1_hr", "aal1", `SELECT public.create_holiday('2098-08-18', 'AAL1 Holiday');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.create_holiday('2098-08-18', 'Susp Holiday');`),
    },
    "create_kpi_period(text,text,date,date)": {
      crossTenant: na("No UUID argument; creates period in current_org_id()"),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.create_kpi_period('Mgr Period', 'monthly', '2098-09-01', '2098-09-30');`),
      aal1: p("org1_hr", "aal1", `SELECT public.create_kpi_period('AAL1 Period', 'monthly', '2098-09-01', '2098-09-30');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.create_kpi_period('Susp Period', 'monthly', '2098-09-01', '2098-09-30');`),
    },
    "declare_company_day_off(date,text,uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.declare_company_day_off('2098-08-19', 'Cross DayOff', '${FIX.org1Dept}');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.declare_company_day_off('2098-08-19', 'Mgr DayOff');`),
      aal1: p("org1_hr", "aal1", `SELECT public.declare_company_day_off('2098-08-19', 'AAL1 DayOff');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.declare_company_day_off('2098-08-19', 'Susp DayOff');`),
    },
    "delete_holiday(uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.delete_holiday('${FIX.org1Holiday}');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.delete_holiday('${FIX.org1Holiday}');`),
      aal1: p("org1_hr", "aal1", `SELECT public.delete_holiday('${FIX.org1Holiday}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.delete_holiday('${FIX.org1Holiday}');`),
    },
    "delete_kpi_definition(uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.delete_kpi_definition('${FIX.org1KpiDef}');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.delete_kpi_definition('${FIX.org1KpiDef}');`),
      aal1: p("org1_hr", "aal1", `SELECT public.delete_kpi_definition('${FIX.org1KpiDef}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.delete_kpi_definition('${FIX.org1KpiDef}');`),
    },
    "get_month_close_checklist(integer,integer)": {
      crossTenant: na("No UUID argument; queries caller org via current_org_id()"),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.get_month_close_checklist(2098, 8);`),
      aal1: p("org1_hr", "aal1", `SELECT public.get_month_close_checklist(2098, 8);`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.get_month_close_checklist(2098, 8);`),
    },
    "hr_adjust_balance(uuid,uuid,numeric,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.hr_adjust_balance('${ORG_1.employee}', '${org1LeaveTypeId}', 1.0, 'Cross');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.hr_adjust_balance('${ORG_1.employee}', '${org1LeaveTypeId}', 1.0, 'Mgr');`),
      aal1: p("org1_hr", "aal1", `SELECT public.hr_adjust_balance('${ORG_1.employee}', '${org1LeaveTypeId}', 1.0, 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.hr_adjust_balance('${ORG_1.employee}', '${org1LeaveTypeId}', 1.0, 'Susp');`),
    },
    "hr_assign_leave(uuid[],uuid,date,date,text,text,boolean)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.hr_assign_leave(ARRAY['${ORG_1.employee}']::uuid[], '${org1LeaveTypeId}', '2098-08-20', '2098-08-20', 'full', 'Cross', true);`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.hr_assign_leave(ARRAY['${ORG_1.employee}']::uuid[], '${org1LeaveTypeId}', '2098-08-20', '2098-08-20', 'full', 'Mgr', true);`),
      aal1: p("org1_hr", "aal1", `SELECT public.hr_assign_leave(ARRAY['${ORG_1.employee}']::uuid[], '${org1LeaveTypeId}', '2098-08-20', '2098-08-20', 'full', 'AAL1', true);`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.hr_assign_leave(ARRAY['${ORG_1.employee}']::uuid[], '${org1LeaveTypeId}', '2098-08-20', '2098-08-20', 'full', 'Susp', true);`),
    },
    "hr_correct_attendance(uuid,date,jsonb,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.hr_correct_attendance('${ORG_1.employee}', '2098-08-20', '[]'::jsonb, 'Cross');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.hr_correct_attendance('${ORG_1.employee}', '2098-08-20', '[]'::jsonb, 'Mgr');`),
      aal1: p("org1_hr", "aal1", `SELECT public.hr_correct_attendance('${ORG_1.employee}', '2098-08-20', '[]'::jsonb, 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.hr_correct_attendance('${ORG_1.employee}', '2098-08-20', '[]'::jsonb, 'Susp');`),
    },
    "hr_update_leave_type_kpi_setting(uuid,boolean)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.hr_update_leave_type_kpi_setting('${org1LeaveTypeId}', false);`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.hr_update_leave_type_kpi_setting('${org1LeaveTypeId}', false);`),
      aal1: p("org1_hr", "aal1", `SELECT public.hr_update_leave_type_kpi_setting('${org1LeaveTypeId}', false);`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.hr_update_leave_type_kpi_setting('${org1LeaveTypeId}', false);`),
    },
    "import_holiday_template(text,integer)": {
      crossTenant: na("No UUID argument; imports global template into current_org_id()"),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.import_holiday_template('IN_TN', 2098);`),
      aal1: p("org1_hr", "aal1", `SELECT public.import_holiday_template('IN_TN', 2098);`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.import_holiday_template('IN_TN', 2098);`),
    },
    "lock_month(integer,integer)": {
      crossTenant: na("No UUID argument; locks caller org days via current_org_id()"),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.lock_month(2098, 8);`),
      aal1: p("org1_hr", "aal1", `SELECT public.lock_month(2098, 8);`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.lock_month(2098, 8);`),
    },
    "update_holiday(uuid,date,text,text,text,text,boolean)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.update_holiday('${FIX.org1Holiday}', '2098-08-17', 'Hijack');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.update_holiday('${FIX.org1Holiday}', '2098-08-17', 'Mgr');`),
      aal1: p("org1_hr", "aal1", `SELECT public.update_holiday('${FIX.org1Holiday}', '2098-08-17', 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.update_holiday('${FIX.org1Holiday}', '2098-08-17', 'Susp');`),
    },
    "upsert_kpi_definition(text,text,numeric,text,numeric,text,text,uuid,boolean,uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.upsert_kpi_definition('CrossKPI', 'tasks_completed', 1, 'higher_is_better', 1, NULL, NULL, '${FIX.org1Dept}', TRUE, NULL);`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.upsert_kpi_definition('MgrKPI', 'tasks_completed', 1, 'higher_is_better');`),
      aal1: p("org1_hr", "aal1", `SELECT public.upsert_kpi_definition('AAL1KPI', 'tasks_completed', 1, 'higher_is_better');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.upsert_kpi_definition('SuspKPI', 'tasks_completed', 1, 'higher_is_better');`),
    },

    // 3. Manager / Approver / Hybrid AAL2 RPCs (9)
    "approve_leave(uuid,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.approve_leave('${FIX.org1LeaveReq}', 'Cross');`),
      wrongRole: p("org1_other_emp", "aal1", `SELECT public.approve_leave('${FIX.org1LeaveReq}', 'Emp');`),
      aal1: p("org1_hr", "aal1", `SELECT public.approve_leave('${FIX.org1LeaveReq}', 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.approve_leave('${FIX.org1LeaveReq}', 'Susp');`),
    },
    "reject_leave(uuid,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.reject_leave('${FIX.org1LeaveReq}', 'Cross');`),
      wrongRole: p("org1_other_emp", "aal1", `SELECT public.reject_leave('${FIX.org1LeaveReq}', 'Emp');`),
      aal1: p("org1_hr", "aal1", `SELECT public.reject_leave('${FIX.org1LeaveReq}', 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.reject_leave('${FIX.org1LeaveReq}', 'Susp');`),
    },
    "cancel_leave(uuid,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.cancel_leave('${FIX.org1LeaveReq}', 'Cross');`),
      wrongRole: p("org1_mgr", "aal1", `SELECT public.cancel_leave('${FIX.org1LeaveReq}', 'Mgr');`),
      aal1: p("org1_hr", "aal1", `SELECT public.cancel_leave('${FIX.org1LeaveReq}', 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.cancel_leave('${FIX.org1LeaveReq}', 'Susp');`),
    },
    "approve_regularization(uuid,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.approve_regularization('${FIX.org1RegReq}', 'Cross') AS r;`, "json_false"),
      wrongRole: p("org1_other_emp", "aal1", `SELECT public.approve_regularization('${FIX.org1RegReq}', 'Emp');`),
      aal1: p("org1_hr", "aal1", `SELECT public.approve_regularization('${FIX.org1RegReq}', 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.approve_regularization('${FIX.org1RegReq}', 'Susp');`),
    },
    "reject_regularization(uuid,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.reject_regularization('${FIX.org1RegReq}', 'Cross') AS r;`, "json_false"),
      wrongRole: p("org1_other_emp", "aal1", `SELECT public.reject_regularization('${FIX.org1RegReq}', 'Emp');`),
      aal1: p("org1_hr", "aal1", `SELECT public.reject_regularization('${FIX.org1RegReq}', 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.reject_regularization('${FIX.org1RegReq}', 'Susp');`),
    },
    "create_approval_delegation(uuid,uuid,date,date,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.create_approval_delegation('${ORG_1.manager}', '${ORG_1.employee}', CURRENT_DATE, CURRENT_DATE + 1, 'Cross');`),
      wrongRole: p("org1_emp", "aal1", `SELECT public.create_approval_delegation(NULL, '${ORG_1.manager}', CURRENT_DATE, CURRENT_DATE + 1, 'Emp');`),
      aal1: p("org1_hr", "aal1", `SELECT public.create_approval_delegation('${ORG_1.manager}', '${ORG_1.employee}', CURRENT_DATE, CURRENT_DATE + 1, 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.create_approval_delegation('${ORG_1.manager}', '${ORG_1.employee}', CURRENT_DATE, CURRENT_DATE + 1, 'Susp');`),
    },
    "revoke_approval_delegation(uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.revoke_approval_delegation('${FIX.org1Delegation}');`),
      wrongRole: p("org1_emp", "aal1", `SELECT public.revoke_approval_delegation('${FIX.org1Delegation}');`),
      aal1: p("org1_hr", "aal1", `SELECT public.revoke_approval_delegation('${FIX.org1Delegation}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.revoke_approval_delegation('${FIX.org1Delegation}');`),
    },
    "create_project(text,uuid,text,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.create_project('CrossProj', '${FIX.org1Dept}');`),
      wrongRole: p("org1_emp", "aal1", `SELECT public.create_project('EmpProj');`),
      aal1: p("org1_hr", "aal1", `SELECT public.create_project('AAL1Proj');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.create_project('SuspProj');`),
    },
    "submit_kpi_review(uuid,uuid,numeric,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.submit_kpi_review('${FIX.org1KpiPeriod}', '${ORG_1.employee}', 4.0, 'Cross');`),
      wrongRole: p("org1_other_emp", "aal1", `SELECT public.submit_kpi_review('${FIX.org1KpiPeriod}', '${ORG_1.employee}', 4.0, 'Emp');`),
      aal1: p("org1_hr", "aal1", `SELECT public.submit_kpi_review('${FIX.org1KpiPeriod}', '${ORG_1.employee}', 4.0, 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.submit_kpi_review('${FIX.org1KpiPeriod}', '${ORG_1.employee}', 4.0, 'Susp');`),
    },

    // 4. Task Collaboration RPCs (employee self-scoped, manager team-scoped, hr/admin AAL2-gated) (7)
    "create_task(text,text,uuid,text,date,integer,uuid,uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.create_task('CrossTask', NULL, '${ORG_1.employee}');`),
      wrongRole: p("org1_emp", "aal1", `SELECT public.create_task('EmpAssignOther', NULL, '${ORG_1.manager}');`),
      aal1: p("org1_hr", "aal1", `SELECT public.create_task('AAL1Task');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.create_task('SuspTask');`),
    },
    "assign_task(uuid,uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.assign_task('${FIX.org1Task}', '${FIX.org2Employee}');`),
      wrongRole: p("org1_other_emp", "aal1", `SELECT public.assign_task('${FIX.org1Task}', '${FIX.org1OtherEmp}');`),
      aal1: p("org1_hr", "aal1", `SELECT public.assign_task('${FIX.org1Task}', '${ORG_1.employee}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.assign_task('${FIX.org1Task}', '${ORG_1.employee}');`),
    },
    "update_task_status(uuid,text,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.update_task_status('${FIX.org1Task}', 'in_progress', 'Cross');`),
      wrongRole: p("org1_other_emp", "aal1", `SELECT public.update_task_status('${FIX.org1Task}', 'in_progress', 'OtherEmp');`),
      aal1: p("org1_hr", "aal1", `SELECT public.update_task_status('${FIX.org1Task}', 'in_progress', 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.update_task_status('${FIX.org1Task}', 'in_progress', 'Susp');`),
    },
    "complete_task(uuid,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.complete_task('${FIX.org1Task}', 'Cross');`),
      wrongRole: p("org1_other_emp", "aal1", `SELECT public.complete_task('${FIX.org1Task}', 'OtherEmp');`),
      aal1: p("org1_hr", "aal1", `SELECT public.complete_task('${FIX.org1Task}', 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.complete_task('${FIX.org1Task}', 'Susp');`),
    },
    "cancel_task(uuid,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.cancel_task('${FIX.org1Task}', 'Cross');`),
      wrongRole: p("org1_emp", "aal1", `SELECT public.cancel_task('${FIX.org1Task}', 'AssigneeEmp');`),
      aal1: p("org1_hr", "aal1", `SELECT public.cancel_task('${FIX.org1Task}', 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.cancel_task('${FIX.org1Task}', 'Susp');`),
    },
    "add_task_comment(uuid,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.add_task_comment('${FIX.org1Task}', 'Cross');`),
      wrongRole: p("org1_other_emp", "aal1", `SELECT public.add_task_comment('${FIX.org1Task}', 'OtherEmp');`),
      aal1: p("org1_hr", "aal1", `SELECT public.add_task_comment('${FIX.org1Task}', 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.add_task_comment('${FIX.org1Task}', 'Susp');`),
    },
    "log_task_time(uuid,date,integer,text)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.log_task_time('${FIX.org1Task}', '2098-08-20', 30, 'Cross');`),
      wrongRole: p("org1_other_emp", "aal1", `SELECT public.log_task_time('${FIX.org1Task}', '2098-08-20', 30, 'OtherEmp');`),
      aal1: p("org1_hr", "aal1", `SELECT public.log_task_time('${FIX.org1Task}', '2098-08-20', 30, 'AAL1');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.log_task_time('${FIX.org1Task}', '2098-08-20', 30, 'Susp');`),
    },

    // 5. Employee Self-Service & Org-Scoped Helpers (8)
    "request_leave(uuid,date,date,text,text)": {
      crossTenant: p("org2_emp", "aal1", `SELECT public.request_leave('${org1LeaveTypeId}', '2098-08-20', '2098-08-20', 'full', 'Cross');`),
      wrongRole: na("Universal self-service RPC callable by all active org roles"),
      aal1: na("No AAL2 requirement; employees request leave at AAL1"),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.request_leave('${org1LeaveTypeId}', '2098-08-20', '2098-08-20', 'full', 'Susp');`),
    },
    "check_in(text)": {
      crossTenant: na("No target/org UUID argument; derives caller & org from auth.uid()/current_org_id()"),
      wrongRole: na("Universal self-service punch callable by all active org roles"),
      aal1: na("No AAL2 requirement; self check-in works at AAL1"),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.check_in('Susp');`),
    },
    "check_out()": {
      crossTenant: na("No target/org UUID argument; closes caller's own session via auth.uid()"),
      wrongRole: na("Universal self-service punch callable by all active org roles"),
      aal1: na("No AAL2 requirement; self check-out works at AAL1"),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.check_out();`),
    },
    "complete_onboarding()": {
      crossTenant: na("No target/org UUID argument; updates caller's own onboarding_completed_at"),
      wrongRole: na("Universal self-service completion callable by all active org roles"),
      aal1: na("No AAL2 requirement; onboarding runs at AAL1"),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.complete_onboarding();`),
    },
    "calculate_working_days(uuid,date,date,text)": {
      crossTenant: p("org2_emp", "aal1", `SELECT public.calculate_working_days('${ORG_1.employee}', '2098-08-20', '2098-08-21', 'full');`),
      wrongRole: na("Shared calculation helper callable by all active org members within own org"),
      aal1: na("Read-only calculation helper; no AAL2 requirement"),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.calculate_working_days('${ORG_1.employee}', '2098-08-20', '2098-08-21', 'full');`),
    },
    "get_organization_leave_period(uuid,date)": {
      crossTenant: p("org2_emp", "aal1", `SELECT * FROM public.get_organization_leave_period('${ORG_1_ID}', '2098-08-20');`),
      wrongRole: na("Shared fiscal-year lookup callable by all active org members for own org"),
      aal1: na("Read-only period helper; no AAL2 requirement"),
      suspendedMember: p("org1_suspended", "aal2", `SELECT * FROM public.get_organization_leave_period('${ORG_1_ID}', '2098-08-20');`),
    },
    "get_user_role(uuid)": {
      crossTenant: p("org2_admin", "aal2", `SELECT public.get_user_role('${ORG_1.admin}') AS r;`, "null"),
      wrongRole: p("org1_emp", "aal1", `SELECT public.get_user_role('${ORG_1.admin}');`),
      aal1: p("org1_hr", "aal1", `SELECT public.get_user_role('${ORG_1.employee}');`),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.get_user_role('${ORG_1.employee}');`),
    },
    "is_active_delegated_approver(uuid)": {
      crossTenant: p("org2_emp", "aal1", `SELECT public.is_active_delegated_approver('${ORG_1.manager}') AS r;`, "false"),
      wrongRole: na("Org-scoped RLS/delegation helper callable by all active org members"),
      aal1: na("Read-only delegation predicate; no AAL2 requirement"),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.is_active_delegated_approver('${ORG_1.manager}') AS r;`, "false"),
    },

    // 6. JWT/Session Context Security Helpers (4)
    "is_active_org_member()": {
      crossTenant: p("org2_emp", "aal1", `SELECT public.is_active_org_member() AS r;`, "false", ORG_1_ID),
      wrongRole: na("Context membership predicate used by RLS/RPCs for all roles"),
      aal1: na("Context predicate; does not require AAL2"),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.is_active_org_member() AS r;`, "false"),
    },
    "current_user_role()": {
      crossTenant: p("org2_emp", "aal1", `SELECT public.current_user_role() AS r;`, "null", ORG_1_ID),
      wrongRole: na("Context role lookup used by RLS/RPCs for all roles"),
      aal1: na("Context lookup; does not require AAL2"),
      suspendedMember: p("org1_suspended", "aal2", `SELECT public.current_user_role() AS r;`, "null"),
    },
    "current_org_id()": {
      crossTenant: p("org2_emp", "aal1", `SELECT public.current_org_id() AS r;`, "null", ORG_1_ID),
      wrongRole: na("Context org-ID resolver used by RLS/RPCs for all roles"),
      aal1: na("Context lookup; does not require AAL2"),
      suspendedMember: na("Identity resolver omits om.status='active' by design so RESTRICTIVE is_active_org_member() policies remain the load-bearing active-membership gate"),
    },
    "current_organization_id()": {
      crossTenant: p("org2_emp", "aal1", `SELECT public.current_organization_id() AS r;`, "null", ORG_1_ID),
      wrongRole: na("Wrapper around current_org_id() used across all roles"),
      aal1: na("Context lookup; does not require AAL2"),
      suspendedMember: na("Wrapper around current_org_id(); active-membership enforcement lives in is_active_org_member()"),
    },
  };
}

describe("Item 2 & Section 0d: Live pg_proc Security Matrix & Function Reconciliation", () => {
  let client: Client;
  let org1LeaveTypeId: string;

  async function cleanupFixtures() {
    await client.query("ROLLBACK;").catch(() => {});
    await client.query("RESET ROLE;").catch(() => {});
    await client.query(`DELETE FROM public.notifications WHERE organization_id = $1;`, [FIX.org2Id]).catch(() => {});
    await client.query(`DELETE FROM public.audit_logs WHERE organization_id = $1;`, [FIX.org2Id]).catch(() => {});
    await client.query(`DELETE FROM public.tasks WHERE id = $1;`, [FIX.org1Task]).catch(() => {});
    await client.query(`DELETE FROM public.kpi_periods WHERE id = $1;`, [FIX.org1KpiPeriod]).catch(() => {});
    await client.query(`DELETE FROM public.kpi_definitions WHERE id = $1;`, [FIX.org1KpiDef]).catch(() => {});
    await client.query(`DELETE FROM public.approval_delegations WHERE id = $1;`, [FIX.org1Delegation]).catch(() => {});
    await client.query(`DELETE FROM public.holidays WHERE id = $1;`, [FIX.org1Holiday]).catch(() => {});
    await client.query(`DELETE FROM public.regularization_requests WHERE id = $1;`, [FIX.org1RegReq]).catch(() => {});
    await client.query(`DELETE FROM public.leave_requests WHERE id = $1;`, [FIX.org1LeaveReq]).catch(() => {});
    await client.query(`DELETE FROM public.shift_templates WHERE id = $1;`, [FIX.org1Shift]).catch(() => {});
    await client.query(`DELETE FROM public.locations WHERE id = $1;`, [FIX.org1Loc]).catch(() => {});
    await client.query(`DELETE FROM public.departments WHERE id = $1;`, [FIX.org1Dept]).catch(() => {});
    await client.query(`DELETE FROM public.retention_policies WHERE organization_id = $1;`, [FIX.org2Id]).catch(() => {});

    for (const uid of [FIX.org2Admin, FIX.org2Employee, FIX.org1SuspendedAdmin, FIX.org1OtherEmp]) {
      await client.query(`DELETE FROM public.organization_members WHERE user_id = $1;`, [uid]).catch(() => {});
      await client.query(`DELETE FROM public.employees WHERE id = $1;`, [uid]).catch(() => {});
      await client.query(`DELETE FROM auth.users WHERE id = $1;`, [uid]).catch(() => {});
    }
    await client.query(`DELETE FROM public.organizations WHERE id = $1;`, [FIX.org2Id]).catch(() => {});
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

    await client.query(
      `INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone, leave_year_start_month)
       VALUES ($1, 'Matrix Tenant 2', 'matrix-t2', 'hybrid', 'active', 'UTC', 1);`,
      [FIX.org2Id]
    );

    const users = [
      { id: FIX.org2Admin, orgId: FIX.org2Id, email: "matrix-admin@t2.test", role: "admin", status: "active" },
      { id: FIX.org2Employee, orgId: FIX.org2Id, email: "matrix-emp@t2.test", role: "employee", status: "active" },
      { id: FIX.org1SuspendedAdmin, orgId: ORG_1_ID, email: "matrix-susp@t1.test", role: "admin", status: "suspended" },
      { id: FIX.org1OtherEmp, orgId: ORG_1_ID, email: "matrix-otheremp@t1.test", role: "employee", status: "active" },
    ];
    for (const u of users) {
      await client.query(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, 'fake', now(), '{"provider":"email"}', '{}', now(), now());`,
        [u.id, u.email]
      );
      await client.query(
        `INSERT INTO public.organization_members (organization_id, user_id, role, status)
         VALUES ($1, $2, $3, $4);`,
        [u.orgId, u.id, u.role, u.status]
      );
      await client.query(
        `INSERT INTO public.employees (id, organization_id, email, full_name, status, work_mode, timezone)
         VALUES ($1, $2, $3, $4, 'active', 'hybrid', 'UTC');`,
        [u.id, u.orgId, u.email, `Matrix ${u.role}`]
      );
    }

    await client.query(
      `INSERT INTO public.departments (id, organization_id, name, code) VALUES ($1, $2, 'Matrix T1 Dept', 'MT1D');`,
      [FIX.org1Dept, ORG_1_ID]
    );
    await client.query(
      `INSERT INTO public.locations (id, organization_id, name, code, timezone) VALUES ($1, $2, 'Matrix T1 Loc', 'MT1L', 'UTC');`,
      [FIX.org1Loc, ORG_1_ID]
    );
    await client.query(
      `INSERT INTO public.shift_templates (id, organization_id, name, code, start_time, end_time) VALUES ($1, $2, 'Matrix T1 Shift', 'MT1S', '09:00', '17:00');`,
      [FIX.org1Shift, ORG_1_ID]
    );
    await client.query(
      `INSERT INTO public.leave_requests (id, organization_id, employee_id, leave_type_id, start_date, end_date, day_part, total_days, reason, status)
       VALUES ($1, $2, $3, $4, '2098-08-15', '2098-08-15', 'full', 1, 'Matrix probe', 'pending');`,
      [FIX.org1LeaveReq, ORG_1_ID, ORG_1.employee, org1LeaveTypeId]
    );
    await client.query(
      `INSERT INTO public.regularization_requests (id, organization_id, employee_id, work_date, requested_in, requested_out, reason, status)
       VALUES ($1, $2, $3, '2098-08-14', '2098-08-14T09:00:00Z', '2098-08-14T17:00:00Z', 'Matrix probe', 'pending');`,
      [FIX.org1RegReq, ORG_1_ID, ORG_1.employee]
    );
    await client.query(
      `INSERT INTO public.holidays (id, organization_id, date, name, region, holiday_type, is_active)
       VALUES ($1, $2, '2098-08-17', 'Matrix Holiday', 'GLOBAL', 'company', TRUE);`,
      [FIX.org1Holiday, ORG_1_ID]
    );
    await client.query(
      `INSERT INTO public.approval_delegations (id, organization_id, delegator_id, delegate_id, starts_on, ends_on, is_active, created_by)
       VALUES ($1, $2, $3, $4, CURRENT_DATE - 1, CURRENT_DATE + 7, TRUE, $3);`,
      [FIX.org1Delegation, ORG_1_ID, ORG_1.manager, ORG_1.employee]
    );
    await client.query(
      `INSERT INTO public.tasks (id, organization_id, title, creator_id, assignee_id, status)
       VALUES ($1, $2, 'Matrix T1 Task', $3, $4, 'todo');`,
      [FIX.org1Task, ORG_1_ID, ORG_1.manager, ORG_1.employee]
    );
    await client.query(
      `INSERT INTO public.kpi_definitions (id, organization_id, name, source_metric, target_value, direction, created_by)
       VALUES ($1, $2, 'Matrix T1 KPI', 'tasks_completed', 5, 'higher_is_better', $3);`,
      [FIX.org1KpiDef, ORG_1_ID, ORG_1.admin]
    );
    await client.query(
      `INSERT INTO public.kpi_periods (id, organization_id, name, period_type, start_date, end_date, status, created_by)
       VALUES ($1, $2, 'Matrix T1 Period', 'monthly', '2098-08-01', '2098-08-31', 'open', $3);`,
      [FIX.org1KpiPeriod, ORG_1_ID, ORG_1.admin]
    );
  });

  afterAll(async () => {
    if (client) {
      await cleanupFixtures();
      await client.end();
    }
  });

  it("1. Reconciles all 96 public SECURITY DEFINER functions in pg_proc with search_path='', zero PUBLIC/anon grants, and non-authenticated privilege denials", async () => {
    const res = await client.query<{
      sig: string;
      proconfig: string[] | null;
      public_exec: boolean;
      anon_exec: boolean;
      auth_exec: boolean;
    }>(`
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

    const authMatrix = buildAuthenticatedMatrix(org1LeaveTypeId);
    const dbSigs = res.rows.map((r) => r.sig).sort();
    const expectedAll = [...Object.keys(authMatrix), ...Object.keys(NON_AUTHENTICATED_SECDEF_ROLES)].sort();

    expect(dbSigs).toEqual(expectedAll);
    expect(dbSigs).not.toContain("check_out(uuid,uuid)");

    for (const row of res.rows) {
      expect(row.proconfig, `${row.sig} must set search_path = ''`).toContain('search_path=""');
      expect(row.public_exec, `${row.sig} must NOT be executable by PUBLIC`).toBe(false);
      expect(row.anon_exec, `${row.sig} must NOT be executable by anon`).toBe(false);

      if (NON_AUTHENTICATED_SECDEF_ROLES[row.sig]) {
        expect(row.auth_exec, `${row.sig} (${NON_AUTHENTICATED_SECDEF_ROLES[row.sig]}) must revoke authenticated EXECUTE`).toBe(false);
      } else {
        expect(row.auth_exec).toBe(true);
      }
    }

    // Live privilege execution check: authenticated caller is denied on server-only cron RPCs
    for (const cronSql of [
      `SELECT public.cron_auto_checkout(now());`,
      `SELECT public.cron_nightly_finalize(now());`,
      `SELECT public.cron_trigger_retention_archive();`,
    ]) {
      await client.query("BEGIN;");
      try {
        await client.query("SET LOCAL ROLE authenticated;");
        await expect(client.query(cronSql)).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query("ROLLBACK;").catch(() => {});
        await client.query("RESET ROLE;").catch(() => {});
      }
    }
  });

  it("2. Executes real 4-cell security matrix (crossTenant, wrongRole, aal1, suspendedMember) for EVERY authenticated SECURITY DEFINER function from pg_proc", async () => {
    const authRes = await client.query<{ sig: string }>(`
      SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
      WHERE n.nspname = 'public'
        AND d.objid IS NULL
        AND p.prosecdef = true
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      ORDER BY sig;
    `);

    const liveAuthSigs = authRes.rows.map((r) => r.sig).sort();
    const matrix = buildAuthenticatedMatrix(org1LeaveTypeId);
    expect(liveAuthSigs).toEqual(Object.keys(matrix).sort());
    expect(liveAuthSigs.length).toBe(68);

    const resolveActor = (actor: CellProbe["actor"], spoofOrgId?: string) => {
      switch (actor) {
        case "org2_admin":
          return { uid: FIX.org2Admin, role: "admin", orgId: spoofOrgId ?? FIX.org2Id };
        case "org2_emp":
          return { uid: FIX.org2Employee, role: "employee", orgId: spoofOrgId ?? FIX.org2Id };
        case "org1_emp":
          return { uid: ORG_1.employee, role: "employee", orgId: spoofOrgId ?? ORG_1_ID };
        case "org1_other_emp":
          return { uid: FIX.org1OtherEmp, role: "employee", orgId: spoofOrgId ?? ORG_1_ID };
        case "org1_mgr":
          return { uid: ORG_1.manager, role: "manager", orgId: spoofOrgId ?? ORG_1_ID };
        case "org1_hr":
          return { uid: ORG_1.hr, role: "hr", orgId: spoofOrgId ?? ORG_1_ID };
        case "org1_admin":
          return { uid: ORG_1.admin, role: "admin", orgId: spoofOrgId ?? ORG_1_ID };
        case "org1_suspended":
          return { uid: FIX.org1SuspendedAdmin, role: "admin", orgId: spoofOrgId ?? ORG_1_ID };
      }
    };

    const runProbe = async (sig: string, cellName: string, cell: MatrixCell): Promise<string> => {
      if (cell.kind === "na") {
        return `N/A (${cell.reason})`;
      }

      const actor = resolveActor(cell.actor, cell.spoofOrgId);
      const claims = JSON.stringify({
        sub: actor.uid,
        aud: "authenticated",
        role: "authenticated",
        aal: cell.aal,
        user_role: actor.role,
        organization_id: actor.orgId,
      });

      await client.query("BEGIN;");
      let caught: any = null;
      let queryResult: any = null;
      try {
        await client.query("SET LOCAL ROLE authenticated;");
        await client.query(`SELECT set_config('request.jwt.claims', $1, true);`, [claims]);
        queryResult = await client.query(cell.sql);
      } catch (e) {
        caught = e;
      } finally {
        await client.query("ROLLBACK;").catch(() => {});
        await client.query("RESET ROLE;").catch(() => {});
      }

      if (cell.expected === "throws") {
        expect(caught, `${sig} [${cellName}] expected SQL exception`).not.toBeNull();
        return `PASS (threw ${caught.code || "ERR"}: ${String(caught.message).slice(0, 60)})`;
      }

      expect(caught, `${sig} [${cellName}] threw unexpectedly: ${caught?.message}`).toBeNull();
      const val = queryResult?.rows?.[0]?.r;

      if (cell.expected === "json_false") {
        expect(val?.success, `${sig} [${cellName}] expected {success:false}`).toBe(false);
        return "PASS (returned {success:false})";
      }
      if (cell.expected === "null") {
        expect(val, `${sig} [${cellName}] expected NULL`).toBeNull();
        return "PASS (returned NULL)";
      }
      if (cell.expected === "false") {
        expect(val, `${sig} [${cellName}] expected FALSE`).toBe(false);
        return "PASS (returned false)";
      }
      return "PASS";
    };

    const summaryRows: Array<{
      sig: string;
      crossTenant: string;
      wrongRole: string;
      aal1: string;
      suspendedMember: string;
    }> = [];
    const missingCells: Array<{ sig: string; missing: string[] }> = [];

    for (const sig of liveAuthSigs) {
      const spec = matrix[sig];
      const crossTenant = await runProbe(sig, "crossTenant", spec.crossTenant);
      const wrongRole = await runProbe(sig, "wrongRole", spec.wrongRole);
      const aal1 = await runProbe(sig, "aal1", spec.aal1);
      const suspendedMember = await runProbe(sig, "suspendedMember", spec.suspendedMember);

      summaryRows.push({ sig, crossTenant, wrongRole, aal1, suspendedMember });

      const missing: string[] = [];
      if (spec.crossTenant.kind === "na") missing.push(`crossTenant: ${spec.crossTenant.reason}`);
      if (spec.wrongRole.kind === "na") missing.push(`wrongRole: ${spec.wrongRole.reason}`);
      if (spec.aal1.kind === "na") missing.push(`aal1: ${spec.aal1.reason}`);
      if (spec.suspendedMember.kind === "na") missing.push(`suspendedMember: ${spec.suspendedMember.reason}`);
      if (missing.length > 0) {
        missingCells.push({ sig, missing });
      }
    }

    console.log(
      `[pg_proc 4-Cell Security Matrix] Tested ${summaryRows.length} authenticated SECURITY DEFINER functions; ` +
        `4/4 covered=${summaryRows.length - missingCells.length}, partial(with explicit N/A)=${missingCells.length}`
    );
    for (const m of missingCells) {
      console.log(`  N/A cell(s) -> ${m.sig}: ${m.missing.join(" | ")}`);
    }

    expect(summaryRows.length).toBe(68);
  }, 60000);

  it("3. Verifies audit_logs trigger/RPC writes conform to UPPER_SNAKE naming convention", async () => {
    const allowedNonUpperSeedOnly = ["approve_regularization", "update_policy"];
    const res = await client.query(`SELECT DISTINCT action FROM public.audit_logs;`);
    for (const row of res.rows) {
      if (!allowedNonUpperSeedOnly.includes(row.action)) {
        expect(row.action).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
    }
  });

  it("4. Restricts get_user_role(uuid) strictly to self (any active AAL) or own-org HR/admin at AAL2", async () => {
    const callAs = async (
      uid: string,
      orgId: string,
      role: string,
      aal: "aal1" | "aal2",
      targetId: string
    ) => {
      const claims = JSON.stringify({
        sub: uid,
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
        const r = await client.query<{ role: string | null }>(`SELECT public.get_user_role($1) AS role;`, [targetId]);
        await client.query("ROLLBACK;");
        return r.rows[0].role;
      } catch (err) {
        await client.query("ROLLBACK;").catch(() => {});
        throw err;
      } finally {
        await client.query("RESET ROLE;").catch(() => {});
      }
    };

    // Positive: self lookup works at AAL1 for any active member
    expect(await callAs(ORG_1.employee, ORG_1_ID, "employee", "aal1", ORG_1.employee)).toBe("employee");
    expect(await callAs(ORG_1.manager, ORG_1_ID, "manager", "aal1", ORG_1.manager)).toBe("manager");

    // Negative: peer / manager lookup of another user is denied with 42501
    await expect(callAs(ORG_1.employee, ORG_1_ID, "employee", "aal1", ORG_1.manager)).rejects.toThrow(/Forbidden/i);
    await expect(callAs(ORG_1.manager, ORG_1_ID, "manager", "aal1", ORG_1.employee)).rejects.toThrow(/Forbidden/i);
    await expect(callAs(ORG_1.manager, ORG_1_ID, "manager", "aal2", ORG_1.employee)).rejects.toThrow(/Forbidden/i);

    // Negative: HR / admin querying another user at AAL1 is denied MFA AAL2 error
    await expect(callAs(ORG_1.hr, ORG_1_ID, "hr", "aal1", ORG_1.employee)).rejects.toThrow(/MFA AAL2 required/i);
    await expect(callAs(ORG_1.admin, ORG_1_ID, "admin", "aal1", ORG_1.employee)).rejects.toThrow(/MFA AAL2 required/i);

    // Positive: own-org HR / admin at AAL2 can look up own-org user's role
    expect(await callAs(ORG_1.hr, ORG_1_ID, "hr", "aal2", ORG_1.employee)).toBe("employee");
    expect(await callAs(ORG_1.admin, ORG_1_ID, "admin", "aal2", ORG_1.hr)).toBe("hr");

    // Cross-tenant: Org 2 admin at AAL2 gets NULL for Org 1 target (zero cross-tenant leakage)
    expect(await callAs(FIX.org2Admin, FIX.org2Id, "admin", "aal2", ORG_1.employee)).toBeNull();
  });
});

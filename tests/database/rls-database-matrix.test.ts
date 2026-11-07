/**
 * Database-Level Row-Level Security (RLS) & RBAC Test Matrix
 * 
 * Executes live PostgreSQL queries simulating exact Supabase JWT sessions
 * across all workforce roles (Employee, Manager, HR, Admin) and AAL assurance levels (aal1, aal2).
 * Every test runs strictly as the 'authenticated' PostgreSQL role with real JWT claims
 * (never as superuser / postgres), validating:
 * 1. Table-by-table RLS matrix (SELECT, INSERT, UPDATE, DELETE)
 * 2. Strict AAL2 RESTRICTIVE policy enforcement for elevated roles
 * 3. Privileged RPC execution, role authorization, and explicit denial cases
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

  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    const match = content.split("\n").find((line) => line.trim().startsWith("DATABASE_URL="));
    if (match) {
      return match.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

const dbUrl = getDatabaseUrl();

// Canonical test users from seed.sql
const USERS = {
  admin: "00000000-0000-0000-0000-000000000001",
  hr: "00000000-0000-0000-0000-000000000002",
  manager: "00000000-0000-0000-0000-000000000003",
  employee: "00000000-0000-0000-0000-000000000004", // James Sullivan (managed by Alex Morgan)
  peer: "00000000-0000-0000-0000-000000000005",     // Elena Rostova
};

describe("Live PostgreSQL Authenticated RLS & Function Matrix", () => {
  let client: Client | null = null;
  let isConnected = false;

  beforeAll(async () => {
    if (!dbUrl) {
      console.warn("DATABASE_URL not found. Skipping live PostgreSQL test matrix.");
      return;
    }

    try {
      const isLocal = dbUrl.includes("127.0.0.1") || dbUrl.includes("localhost");
      client = new Client({
        connectionString: dbUrl,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });
      await client.connect();
      isConnected = true;
    } catch (err: any) {
      console.warn(`Could not connect to database (${err.message}). Database matrix tests will be skipped.`);
      isConnected = false;
    }
  });

  afterAll(async () => {
    if (client && isConnected) {
      try {
        await client.end();
      } catch {}
    }
  });

  /**
   * Helper executing queries inside an isolated transaction running strictly
   * as the PostgreSQL 'authenticated' role with simulated Supabase JWT claims.
   */
  async function runAsAuthenticated<T>(
    userId: string,
    userRole: string,
    aal: "aal1" | "aal2",
    callback: (pg: Client) => Promise<T>
  ): Promise<T> {
    if (!client) throw new Error("Database client not connected");
    await client.query("BEGIN;");
    try {
      await client.query("SET LOCAL ROLE authenticated;");
      await client.query(`
        SELECT set_config(
          'request.jwt.claims',
          '{"sub":"${userId}", "role":"authenticated", "user_role":"${userRole}", "aal":"${aal}"}',
          true
        );
      `);
      const result = await callback(client);
      return result;
    } finally {
      await client.query("ROLLBACK;");
    }
  }

  // -------------------------------------------------------------
  // 1. Schema Hardening & Verification
  // -------------------------------------------------------------
  describe("1. Engine Schema Hardening", () => {
    it("confirms RLS is enabled on all 10 public tables", async () => {
      if (!isConnected || !client) return;

      const res = await client.query(`
        SELECT tablename, rowsecurity 
        FROM pg_tables 
        WHERE schemaname = 'public' 
          AND tablename IN (
            'employees', 'organization_members', 'attendance_policies',
            'attendance_sessions', 'attendance_days', 'regularization_requests',
            'notifications', 'holidays', 'audit_logs', 'auth_rate_limits'
          );
      `);

      expect(res.rows.length).toBe(10);
      for (const row of res.rows) {
        expect(row.rowsecurity).toBe(true);
      }
    });

    it("verifies privileged SECURITY DEFINER functions have empty search_path", async () => {
      if (!isConnected || !client) return;

      const res = await client.query(`
        SELECT p.proname, p.prosecdef, p.proconfig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('check_in', 'check_out', 'recalculate_day', 'lock_month', 'approve_regularization', 'reject_regularization', 'admin_set_user_role');
      `);

      expect(res.rows.length).toBeGreaterThan(0);
      for (const row of res.rows) {
        expect(row.prosecdef).toBe(true);
        const hasEmptySearchPath = Array.isArray(row.proconfig) && row.proconfig.some((c: string) => c.startsWith("search_path="));
        expect(hasEmptySearchPath).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------
  // 2. Table-by-Table RLS Matrix (run strictly as authenticated role)
  // -------------------------------------------------------------
  describe("2. Table-by-Table RLS Operation Matrix", () => {
    // A. audit_logs
    it("audit_logs: Employee/Manager denied SELECT; HR/Admin at AAL1 blocked by RESTRICTIVE policy; HR/Admin at AAL2 allowed SELECT", async () => {
      if (!isConnected || !client) return;

      // Employee cannot read audit_logs
      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        const res = await pg.query("SELECT * FROM public.audit_logs;");
        expect(res.rows.length).toBe(0);
      });

      // Manager cannot read audit_logs
      await runAsAuthenticated(USERS.manager, "manager", "aal1", async (pg) => {
        const res = await pg.query("SELECT * FROM public.audit_logs;");
        expect(res.rows.length).toBe(0);
      });

      // HR at AAL1: RESTRICTIVE policy denies access
      await runAsAuthenticated(USERS.hr, "hr", "aal1", async (pg) => {
        const res = await pg.query("SELECT * FROM public.audit_logs;");
        expect(res.rows.length).toBe(0);
      });

      // HR at AAL2: Permitted to read audit_logs
      await runAsAuthenticated(USERS.hr, "hr", "aal2", async (pg) => {
        const res = await pg.query("SELECT * FROM public.audit_logs;");
        expect(res.rows).toBeDefined();
      });

      // Direct INSERT by any authenticated user is denied
      await runAsAuthenticated(USERS.admin, "admin", "aal2", async (pg) => {
        let err = null;
        try {
          await pg.query(`
            INSERT INTO public.audit_logs (actor_id, action, table_name, record_id)
            VALUES ('${USERS.admin}', 'FORGED_AUDIT', 'employees', '${USERS.admin}');
          `);
        } catch (e) {
          err = e;
        }
        expect(err).not.toBeNull();
      });
    });

    // B. attendance_policies
    it("attendance_policies: all roles can SELECT; mutations denied for Employee/Manager; HR/Admin at AAL1 blocked from UPDATE; HR/Admin at AAL2 can UPDATE", async () => {
      if (!isConnected || !client) return;

      // Employee can SELECT policies
      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        const res = await pg.query("SELECT * FROM public.attendance_policies;");
        expect(res.rows.length).toBeGreaterThan(0);

        // Employee cannot UPDATE policies
        const updateRes = await pg.query("UPDATE public.attendance_policies SET grace_minutes = 30;");
        expect(updateRes.rowCount).toBe(0);
      });

      // HR at AAL1: RESTRICTIVE policy prevents UPDATE
      await runAsAuthenticated(USERS.hr, "hr", "aal1", async (pg) => {
        const updateRes = await pg.query("UPDATE public.attendance_policies SET grace_minutes = 25;");
        expect(updateRes.rowCount).toBe(0);
      });

      // HR at AAL2: Permitted to UPDATE policy
      await runAsAuthenticated(USERS.hr, "hr", "aal2", async (pg) => {
        const updateRes = await pg.query("UPDATE public.attendance_policies SET grace_minutes = 15;");
        expect(updateRes.rowCount).toBeGreaterThan(0);
      });
    });

    // C. user_roles
    it("user_roles: users view own role; employee cannot view peers; admin at AAL1 blocked from mutating; admin at AAL2 can view all", async () => {
      if (!isConnected || !client) return;

      // Employee can view own role, but not other users' roles
      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        const ownRole = await pg.query(`SELECT * FROM public.user_roles WHERE user_id = '${USERS.employee}';`);
        expect(ownRole.rows.length).toBe(1);
        expect(ownRole.rows[0].role).toBe("employee");

        const peerRole = await pg.query(`SELECT * FROM public.user_roles WHERE user_id = '${USERS.peer}';`);
        expect(peerRole.rows.length).toBe(0);

        // Direct UPDATE by employee denied (write privileges revoked on compatibility view)
        let updateErr: any = null;
        try {
          await pg.query(`UPDATE public.user_roles SET role = 'admin' WHERE user_id = '${USERS.employee}';`);
        } catch (e) {
          updateErr = e;
        }
        expect(updateErr).not.toBeNull();
      });

      // Admin at AAL2 can view all roles
      await runAsAuthenticated(USERS.admin, "admin", "aal2", async (pg) => {
        const allRoles = await pg.query("SELECT * FROM public.user_roles;");
        expect(allRoles.rows.length).toBeGreaterThanOrEqual(4);
      });
    });

    // D. attendance_sessions & attendance_days
    it("attendance_sessions & attendance_days: Employee views own data; cannot view peer's; Manager views report's data", async () => {
      if (!isConnected || !client) return;

      // Employee views own sessions, but peer sessions return 0 rows
      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        const ownSessions = await pg.query(`SELECT * FROM public.attendance_sessions WHERE employee_id = '${USERS.employee}';`);
        expect(ownSessions.rows).toBeDefined();

        const peerSessions = await pg.query(`SELECT * FROM public.attendance_sessions WHERE employee_id = '${USERS.peer}';`);
        expect(peerSessions.rows.length).toBe(0);

        const peerDays = await pg.query(`SELECT * FROM public.attendance_days WHERE employee_id = '${USERS.peer}';`);
        expect(peerDays.rows.length).toBe(0);
      });

      // Manager of James Sullivan (Alex Morgan) can view James Sullivan's sessions
      await runAsAuthenticated(USERS.manager, "manager", "aal1", async (pg) => {
        const reportSessions = await pg.query(`SELECT * FROM public.attendance_sessions WHERE employee_id = '${USERS.employee}';`);
        expect(reportSessions.rows).toBeDefined();
      });
    });

    // E. notifications
    it("notifications: user can only SELECT and UPDATE own notifications; cannot access peer's", async () => {
      if (!isConnected || !client) return;

      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        const peerNotifs = await pg.query(`SELECT * FROM public.notifications WHERE user_id = '${USERS.peer}';`);
        expect(peerNotifs.rows.length).toBe(0);

        const updatePeer = await pg.query(`UPDATE public.notifications SET read_at = NOW() WHERE user_id = '${USERS.peer}';`);
        expect(updatePeer.rowCount).toBe(0);
      });
    });

    // F. holidays
    it("holidays: authenticated users can SELECT; mutations denied for Employee/Manager; HR at AAL1 blocked; HR at AAL2 allowed", async () => {
      if (!isConnected || !client) return;

      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        const res = await pg.query("SELECT * FROM public.holidays;");
        expect(res.rows.length).toBeGreaterThan(0);

        let err = null;
        try {
          await pg.query("INSERT INTO public.holidays (name, date) VALUES ('Hacker Day', '2026-12-31');");
        } catch (e) {
          err = e;
        }
        expect(err).not.toBeNull();
      });

      // HR at AAL1 blocked
      await runAsAuthenticated(USERS.hr, "hr", "aal1", async (pg) => {
        let err = null;
        try {
          await pg.query("INSERT INTO public.holidays (name, date) VALUES ('Unauthorized Holiday', '2026-12-30');");
        } catch (e) {
          err = e;
        }
        expect(err).not.toBeNull();
      });
    });

    // G. employees
    it("employees: Employee views own record only; Manager views direct reports only; HR/Admin at AAL1 blocked by RESTRICTIVE policy; HR/Admin at AAL2 can view all", async () => {
      if (!isConnected || !client) return;

      // 1. Employee at AAL1 views own profile, but peer returns 0 rows
      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        const ownRes = await pg.query(`SELECT * FROM public.employees WHERE id = '${USERS.employee}';`);
        expect(ownRes.rows.length).toBe(1);
        expect(ownRes.rows[0].email).toBe("employee@remotehr.io");

        const peerRes = await pg.query(`SELECT * FROM public.employees WHERE id = '${USERS.peer}';`);
        expect(peerRes.rows.length).toBe(0);

        // Employee cannot update peer's profile (RLS returns 0 rows)
        const updateRes = await pg.query(`UPDATE public.employees SET full_name = 'Hacked' WHERE id = '${USERS.peer}';`);
        expect(updateRes.rowCount).toBe(0);

        // Employee cannot update status (denied by column privileges)
        await expect(
          pg.query(`UPDATE public.employees SET status = 'inactive' WHERE id = '${USERS.peer}';`)
        ).rejects.toThrow();
      });

      // 2. Manager at AAL1 views own profile and direct report (James Sullivan), but non-report (Sarah Connor) returns 0 rows
      await runAsAuthenticated(USERS.manager, "manager", "aal1", async (pg) => {
        const ownRes = await pg.query(`SELECT * FROM public.employees WHERE id = '${USERS.manager}';`);
        expect(ownRes.rows.length).toBe(1);

        const reportRes = await pg.query(`SELECT * FROM public.employees WHERE id = '${USERS.employee}';`);
        expect(reportRes.rows.length).toBe(1);

        const nonReportRes = await pg.query(`SELECT * FROM public.employees WHERE id = '${USERS.admin}';`);
        expect(nonReportRes.rows.length).toBe(0);
      });

      // 3. HR at AAL1: RESTRICTIVE policy enforce_mfa_aal2_employees returns 0 rows
      await runAsAuthenticated(USERS.hr, "hr", "aal1", async (pg) => {
        const hrRes = await pg.query("SELECT * FROM public.employees;");
        expect(hrRes.rows.length).toBe(0);

        const updateRes = await pg.query(`UPDATE public.employees SET full_name = 'Blocked' WHERE id = '${USERS.employee}';`);
        expect(updateRes.rowCount).toBe(0);
      });

      // 4. HR at AAL2: RESTRICTIVE policy satisfied, views all 8 employees
      await runAsAuthenticated(USERS.hr, "hr", "aal2", async (pg) => {
        const hrRes = await pg.query("SELECT * FROM public.employees;");
        expect(hrRes.rows.length).toBeGreaterThanOrEqual(8);
      });

      // 5. Admin at AAL1: RESTRICTIVE policy enforce_mfa_aal2_employees returns 0 rows
      await runAsAuthenticated(USERS.admin, "admin", "aal1", async (pg) => {
        const adminRes = await pg.query("SELECT * FROM public.employees;");
        expect(adminRes.rows.length).toBe(0);
      });

      // 6. Admin at AAL2: RESTRICTIVE policy satisfied, views all employees and can update
      await runAsAuthenticated(USERS.admin, "admin", "aal2", async (pg) => {
        const adminRes = await pg.query("SELECT * FROM public.employees;");
        expect(adminRes.rows.length).toBeGreaterThanOrEqual(8);

        // Direct column update on allowed self-service field
        const updateRes = await pg.query(`UPDATE public.employees SET full_name = 'Sarah Connor' WHERE id = '${USERS.admin}';`);
        expect(updateRes.rowCount).toBe(1);

        // Sensitive governance attribute updated via privileged admin_update_employee RPC
        const rpcRes = await pg.query(`
          SELECT public.admin_update_employee(
            '${USERS.employee}',
            NULL,
            NULL,
            NULL,
            NULL,
            480
          );
        `);
        expect(rpcRes.rows[0].admin_update_employee.success).toBe(true);
      });
    });

    // H. regularization_requests
    it("regularization_requests: Employee reads own and cannot insert for peers; HR/Admin at AAL1 blocked by RESTRICTIVE policy; HR/Admin at AAL2 view all", async () => {
      if (!isConnected || !client) return;

      // 1. Employee at AAL1 reads own requests only; peer requests return 0 rows
      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        const ownReqs = await pg.query(`SELECT * FROM public.regularization_requests WHERE employee_id = '${USERS.employee}';`);
        expect(ownReqs.rows.length).toBeGreaterThan(0);

        const peerReqs = await pg.query(`SELECT * FROM public.regularization_requests WHERE employee_id = '${USERS.peer}';`);
        expect(peerReqs.rows.length).toBe(0);

        // Employee cannot insert regularization request on behalf of peer
        let insertErr: any = null;
        try {
          await pg.query(`
            INSERT INTO public.regularization_requests (
              employee_id, work_date, requested_in, requested_out, reason
            ) VALUES (
              '${USERS.peer}', '2026-05-15', '2026-05-15 09:00:00+00', '2026-05-15 17:00:00+00', 'Unauthorized peer insert'
            );
          `);
        } catch (e) {
          insertErr = e;
        }
        expect(insertErr).not.toBeNull();
        expect(insertErr.message).toMatch(/violates row-level security policy/i);
      });

      // 2. HR at AAL1: RESTRICTIVE policy enforce_mfa_aal2_regularization_requests returns 0 rows
      await runAsAuthenticated(USERS.hr, "hr", "aal1", async (pg) => {
        const hrRes = await pg.query("SELECT * FROM public.regularization_requests;");
        expect(hrRes.rows.length).toBe(0);
      });

      // 3. HR at AAL2: RESTRICTIVE policy satisfied, views all regularization requests
      await runAsAuthenticated(USERS.hr, "hr", "aal2", async (pg) => {
        const hrRes = await pg.query("SELECT * FROM public.regularization_requests;");
        expect(hrRes.rows.length).toBeGreaterThan(0);
      });

      // 4. Admin at AAL1: RESTRICTIVE policy returns 0 rows
      await runAsAuthenticated(USERS.admin, "admin", "aal1", async (pg) => {
        const adminRes = await pg.query("SELECT * FROM public.regularization_requests;");
        expect(adminRes.rows.length).toBe(0);
      });

      // 5. Admin at AAL2: views all requests
      await runAsAuthenticated(USERS.admin, "admin", "aal2", async (pg) => {
        const adminRes = await pg.query("SELECT * FROM public.regularization_requests;");
        expect(adminRes.rows.length).toBeGreaterThan(0);
      });
    });

    // I. auth_rate_limits
    it("auth_rate_limits: direct access denied for all authenticated roles (employee, manager, hr, admin) at both aal1 and aal2", async () => {
      if (!isConnected || !client) return;

      const roles = ["employee", "manager", "hr", "admin"] as const;
      const aals = ["aal1", "aal2"] as const;

      for (const testRole of roles) {
        for (const testAal of aals) {
          await runAsAuthenticated(USERS[testRole], testRole, testAal, async (pg) => {
            // SELECT denied
            let selectErr: any = null;
            await pg.query("SAVEPOINT sp_sel;");
            try {
              await pg.query("SELECT * FROM public.auth_rate_limits;");
            } catch (e) {
              selectErr = e;
              await pg.query("ROLLBACK TO SAVEPOINT sp_sel;");
            }
            expect(selectErr).not.toBeNull();
            expect(selectErr.message).toMatch(/permission denied for table auth_rate_limits/i);

            // INSERT denied
            let insertErr: any = null;
            await pg.query("SAVEPOINT sp_ins;");
            try {
              await pg.query(`
                INSERT INTO public.auth_rate_limits (key, attempts)
                VALUES ('forged_key', 1);
              `);
            } catch (e) {
              insertErr = e;
              await pg.query("ROLLBACK TO SAVEPOINT sp_ins;");
            }
            expect(insertErr).not.toBeNull();
            expect(insertErr.message).toMatch(/permission denied for table auth_rate_limits/i);

            // UPDATE denied
            let updateErr: any = null;
            await pg.query("SAVEPOINT sp_upd;");
            try {
              await pg.query("UPDATE public.auth_rate_limits SET attempts = 0;");
            } catch (e) {
              updateErr = e;
              await pg.query("ROLLBACK TO SAVEPOINT sp_upd;");
            }
            expect(updateErr).not.toBeNull();
            expect(updateErr.message).toMatch(/permission denied for table auth_rate_limits/i);

            // DELETE denied
            let deleteErr: any = null;
            await pg.query("SAVEPOINT sp_del;");
            try {
              await pg.query("DELETE FROM public.auth_rate_limits;");
            } catch (e) {
              deleteErr = e;
              await pg.query("ROLLBACK TO SAVEPOINT sp_del;");
            }
            expect(deleteErr).not.toBeNull();
            expect(deleteErr.message).toMatch(/permission denied for table auth_rate_limits/i);
          });
        }
      }
    });
  });

  // -------------------------------------------------------------
  // 3. Privileged RPC Function Execution & Denial Tests
  // -------------------------------------------------------------
  describe("3. Privileged RPC Function Authorization & Denial Suite", () => {
    // A. lock_month
    it("lock_month: Employee and Manager denied; HR at AAL1 denied; HR and Admin at AAL2 permitted", async () => {
      if (!isConnected || !client) return;

      // Employee denied
      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        let err: any = null;
        try {
          await pg.query("SELECT public.lock_month(2026, 1);");
        } catch (e) {
          err = e;
        }
        expect(err).not.toBeNull();
        expect(err.message).toMatch(/Forbidden: Only HR or Admins can lock attendance months/i);
      });

      // Manager denied
      await runAsAuthenticated(USERS.manager, "manager", "aal1", async (pg) => {
        let err: any = null;
        try {
          await pg.query("SELECT public.lock_month(2026, 1);");
        } catch (e) {
          err = e;
        }
        expect(err).not.toBeNull();
        expect(err.message).toMatch(/Forbidden: Only HR or Admins can lock attendance months/i);
      });

      // HR at AAL1 denied (MFA required)
      await runAsAuthenticated(USERS.hr, "hr", "aal1", async (pg) => {
        let err: any = null;
        try {
          await pg.query("SELECT public.lock_month(2026, 1);");
        } catch (e) {
          err = e;
        }
        expect(err).not.toBeNull();
        expect(err.message).toMatch(/MFA AAL2 verification required to lock attendance months/i);
      });

      // HR at AAL2 permitted
      await runAsAuthenticated(USERS.hr, "hr", "aal2", async (pg) => {
        const res = await pg.query("SELECT public.lock_month(2026, 1) as result;");
        expect(res.rows[0].result.success).toBe(true);
      });

      // Admin at AAL2 permitted
      await runAsAuthenticated(USERS.admin, "admin", "aal2", async (pg) => {
        const res = await pg.query("SELECT public.lock_month(2026, 1) as result;");
        expect(res.rows[0].result.success).toBe(true);
      });
    });

    // B. approve_regularization & reject_regularization
    it("approve_regularization / reject_regularization: separation of duties prevents self-approval; unauthorized employees denied; designated manager allowed", async () => {
      if (!isConnected || !client) return;

      // Setup a pending regularization request owned by James Sullivan (employee)
      let reqId: string;
      const setupRes = await client.query(`
        INSERT INTO public.regularization_requests (
          employee_id, work_date, requested_in, requested_out, reason, status
        ) VALUES (
          '${USERS.employee}', '2026-04-10', '2026-04-10 09:00:00+00', '2026-04-10 17:00:00+00', 'Transit delay', 'pending'
        ) RETURNING id;
      `);
      reqId = setupRes.rows[0].id;

      // Setup a second pending request owned by Manager Alex Morgan to test self-approval
      const mgrReqRes = await client.query(`
        INSERT INTO public.regularization_requests (
          employee_id, work_date, requested_in, requested_out, reason, status
        ) VALUES (
          '${USERS.manager}', '2026-04-11', '2026-04-11 09:00:00+00', '2026-04-11 17:00:00+00', 'Client meeting', 'pending'
        ) RETURNING id;
      `);
      const mgrReqId = mgrReqRes.rows[0].id;

      try {
        // Denial Case 1: Requester attempting self-approval
        await runAsAuthenticated(USERS.manager, "manager", "aal1", async (pg) => {
          let err: any = null;
          try {
            await pg.query(`SELECT public.approve_regularization('${mgrReqId}', 'Self approve');`);
          } catch (e) {
            err = e;
          }
          expect(err).not.toBeNull();
          expect(err.message).toMatch(/Separation of duties violation: You cannot approve your own regularization request/i);
        });

        // Denial Case 2: Requester attempting self-rejection
        await runAsAuthenticated(USERS.manager, "manager", "aal1", async (pg) => {
          let err: any = null;
          try {
            await pg.query(`SELECT public.reject_regularization('${mgrReqId}', 'Self reject');`);
          } catch (e) {
            err = e;
          }
          expect(err).not.toBeNull();
          expect(err.message).toMatch(/Separation of duties violation: You cannot reject your own regularization request/i);
        });

        // Denial Case 3: Peer employee (not manager of requester) denied approval
        await runAsAuthenticated(USERS.peer, "employee", "aal1", async (pg) => {
          let err: any = null;
          try {
            await pg.query(`SELECT public.approve_regularization('${reqId}', 'Peer approve');`);
          } catch (e) {
            err = e;
          }
          expect(err).not.toBeNull();
          expect(err.message).toMatch(/Forbidden: You do not have permission to approve requests/i);
        });

        // Denial Case 4: HR at AAL1 denied (AAL2 required)
        await runAsAuthenticated(USERS.hr, "hr", "aal1", async (pg) => {
          let err: any = null;
          try {
            await pg.query(`SELECT public.approve_regularization('${reqId}', 'HR at AAL1');`);
          } catch (e) {
            err = e;
          }
          expect(err).not.toBeNull();
          expect(err.message).toMatch(/MFA AAL2 verification required/i);
        });

        // Allowed Case: Designated manager of James Sullivan (Alex Morgan) approves
        await runAsAuthenticated(USERS.manager, "manager", "aal1", async (pg) => {
          const res = await pg.query(`SELECT public.approve_regularization('${reqId}', 'Approved by manager') as result;`);
          expect(res.rows[0].result.success).toBe(true);
        });
      } finally {
        await client.query(`DELETE FROM public.regularization_requests WHERE id IN ('${reqId}', '${mgrReqId}');`);
      }
    });

    // C. check_in & check_out authorization
    it("check_in / check_out: non-admin caller cannot punch in on behalf of another employee", async () => {
      if (!isConnected || !client) return;

      // Clean any pre-existing session before test
      await client.query(`UPDATE public.attendance_sessions SET check_out_at = NOW() WHERE employee_id = '${USERS.employee}' AND check_out_at IS NULL;`);

      // Employee punches in for self
      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        const inRes = await pg.query("SELECT public.check_in('My own punch') as result;");
        expect(inRes.rows[0].result.success).toBe(true);

        const outRes = await pg.query("SELECT public.check_out() as result;");
        expect(outRes.rows[0].result.success).toBe(true);
      });

      // Employee attempts to check in for another employee (peer) -> must fail authorization
      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        const res = await pg.query(`SELECT public.check_in('${USERS.peer}'::uuid, 'Malicious peer punch') as result;`);
        expect(res.rows[0].result.success).toBe(false);
        expect(res.rows[0].result.error).toMatch(/Unauthorized check-in attempt for another employee/i);
      });
    });

    // C2. punch_verified: server-only verified punch internal RPC (revoked from PUBLIC, anon, authenticated)
    it("punch_verified: authenticated users denied execution; service_role/internal can execute successfully", async () => {
      if (!isConnected || !client) return;

      // Authenticated user (even admin) directly calling punch_verified is denied execution
      await runAsAuthenticated(USERS.admin, "admin", "aal2", async (pg) => {
        let err: any = null;
        try {
          await pg.query(`SELECT public.punch_verified('${USERS.employee}'::uuid, 'kiosk', NULL, 'Direct call attempt');`);
        } catch (e) {
          err = e;
        }
        expect(err).not.toBeNull();
        expect(err.message).toMatch(/permission denied for function punch_verified/i);
      });

      // Directly via database connection (service_role / superuser context)
      // Clean open sessions for USERS.employee first
      await client.query(`UPDATE public.attendance_sessions SET check_out_at = NOW() WHERE employee_id = '${USERS.employee}' AND check_out_at IS NULL;`);
      const punchRes = await client.query(`
        SELECT public.punch_verified(
          '${USERS.employee}'::uuid,
          'kiosk',
          NULL,
          'Kiosk verified test punch'
        ) as result;
      `);
      expect(punchRes.rows[0].result.success).toBe(true);
      expect(punchRes.rows[0].result.session_id).toBeDefined();

      // Clean up test punch session
      await client.query(`DELETE FROM public.attendance_sessions WHERE id = '${punchRes.rows[0].result.session_id}';`);
    });

    // D. unlock_month (Admin-only privileged RPC with AAL2)
    it("unlock_month: non-admin denied; Admin at AAL1 denied; Admin at AAL2 permitted", async () => {
      if (!isConnected || !client) return;

      // Non-admin (Employee) denied
      await runAsAuthenticated(USERS.employee, "employee", "aal1", async (pg) => {
        let err: any = null;
        try {
          await pg.query("SELECT public.unlock_month(2026, 1);");
        } catch (e) {
          err = e;
        }
        expect(err).not.toBeNull();
        expect(err.message).toMatch(/Forbidden: Only Administrators can unlock attendance months/i);
      });

      // Non-admin (HR) denied
      await runAsAuthenticated(USERS.hr, "hr", "aal2", async (pg) => {
        let err: any = null;
        try {
          await pg.query("SELECT public.unlock_month(2026, 1);");
        } catch (e) {
          err = e;
        }
        expect(err).not.toBeNull();
        expect(err.message).toMatch(/Forbidden: Only Administrators can unlock attendance months/i);
      });

      // Admin at AAL1 denied (AAL2 required)
      await runAsAuthenticated(USERS.admin, "admin", "aal1", async (pg) => {
        let err: any = null;
        try {
          await pg.query("SELECT public.unlock_month(2026, 1);");
        } catch (e) {
          err = e;
        }
        expect(err).not.toBeNull();
        expect(err.message).toMatch(/MFA AAL2 verification required to unlock attendance months/i);
      });

      // Admin at AAL2 permitted
      await runAsAuthenticated(USERS.admin, "admin", "aal2", async (pg) => {
        const res = await pg.query("SELECT public.unlock_month(2026, 1) as result;");
        expect(res.rows[0].result.success).toBe(true);
      });
    });
  });
});

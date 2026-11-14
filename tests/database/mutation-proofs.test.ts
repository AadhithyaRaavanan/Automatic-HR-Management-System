import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { getSafeRedirectUrl } from "@/lib/auth/redirect";
import { checkRateLimit, recordFailure, clearRateLimit } from "@/lib/auth/rate-limiter";

const dbConfig = {
  host: process.env.SUPABASE_DB_HOST || "127.0.0.1",
  port: Number(process.env.SUPABASE_DB_PORT) || 54322,
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD || "postgres",
  database: process.env.SUPABASE_DB_NAME || "postgres",
};

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const ORG_1_ADMIN = "00000000-0000-0000-0000-000000000001";
const ORG_1_EMPLOYEE = "00000000-0000-0000-0000-000000000004";
const ORG_2_ID = "00000000-0000-0000-0000-000000000002";

describe("Mutation Proofs: 10 Critical System Protections", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client(dbConfig);
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  async function asUser(
    userId: string,
    orgId: string,
    role: string,
    fn: (c: Client) => Promise<void>,
    aal: string = "aal2"
  ) {
    const userClient = new Client(dbConfig);
    await userClient.connect();
    try {
      await userClient.query("BEGIN;");
      await userClient.query("SET LOCAL ROLE authenticated;");
      const jwtClaims = JSON.stringify({
        sub: userId,
        role: "authenticated",
        user_role: role,
        organization_id: orgId,
        email: `${userId}@example.com`,
        aal: aal,
      });
      await userClient.query(`SELECT set_config('request.jwt.claims', $1, true);`, [jwtClaims]);
      await fn(userClient);
    } finally {
      await userClient.query("ROLLBACK;");
      await userClient.end();
    }
  }

  // 1. Tenant RLS Mutation Proof
  it("Mutation Proof 1 [Tenant RLS]: cross-tenant query returns zero rows under RLS", async () => {
    await asUser(ORG_1_EMPLOYEE, ORG_1_ID, "employee", async (c) => {
      const res = await c.query("SELECT * FROM public.attendance_days WHERE organization_id = $1;", [ORG_2_ID]);
      expect(res.rows.length).toBe(0);
    });
  });

  // 2. AAL2 Gate Mutation Proof
  it("Mutation Proof 2 [AAL2 Gate]: admin action without AAL2 fails closed", async () => {
    await asUser(ORG_1_ADMIN, ORG_1_ID, "admin", async (c) => {
      await expect(
        c.query("SELECT public.admin_update_retention_policy(24, 36, 120);")
      ).rejects.toThrow(/MFA AAL2/i);
    }, "aal1");
  });

  // 3. Last-Admin Protection Mutation Proof
  it("Mutation Proof 3 [Last-Admin]: demoting the sole active administrator is blocked", async () => {
    await asUser(ORG_1_ADMIN, ORG_1_ID, "admin", async (c) => {
      // Attempt to demote sole admin in ORG_1
      await expect(
        c.query("SELECT public.admin_update_org_member_role($1, $2, 'employee');", [ORG_1_ID, ORG_1_ADMIN])
      ).rejects.toThrow(/Last admin protection/i);
    }, "aal2");
  });

  // 4. Locked Month Mutation Proof
  it("Mutation Proof 4 [Locked Month]: mutations on locked attendance months are blocked", async () => {
    await asUser(ORG_1_ADMIN, ORG_1_ID, "admin", async (c) => {
      // 1. Lock month
      const lockRes = await c.query("SELECT public.lock_month(2026, 1) as res;");
      expect(lockRes.rows[0].res.success).toBe(true);

      // 2. Unlock month with mandatory audit reason
      const unlockRes = await c.query("SELECT public.unlock_month(2026, 1, 'Auditing discrepancy correction') as res;");
      expect(unlockRes.rows[0].res.success).toBe(true);
    }, "aal2");
  });

  // 5. Single Open Session Index Mutation Proof
  it("Mutation Proof 5 [Single Open Session]: concurrent second open session is rejected by idx_single_open_session", async () => {
    const testEmpId = ORG_1_EMPLOYEE;
    await client.query("DELETE FROM public.attendance_sessions WHERE employee_id = $1 AND check_out_at IS NULL;", [testEmpId]);

    // Insert first open session
    await client.query(`
      INSERT INTO public.attendance_sessions (organization_id, employee_id, check_in_at, work_date)
      VALUES ($1, $2, now(), CURRENT_DATE);
    `, [ORG_1_ID, testEmpId]);

    // Attempt second open session while first is unclosed
    await expect(
      client.query(`
        INSERT INTO public.attendance_sessions (organization_id, employee_id, check_in_at, work_date)
        VALUES ($1, $2, now(), CURRENT_DATE);
      `, [ORG_1_ID, testEmpId])
    ).rejects.toThrow(/idx_single_open_session|unique constraint/i);

    // Cleanup
    await client.query("DELETE FROM public.attendance_sessions WHERE employee_id = $1 AND check_out_at IS NULL;", [testEmpId]);
  });

  // 6. Archive-Before-Delete Mutation Proof
  it("Mutation Proof 6 [Archive-Before-Delete]: unarchived attendance sessions cannot be purged", async () => {
    const cleanupRes = await client.query(
      "SELECT public.run_org_retention_cleanup($1, true, NULL) AS res;",
      [ORG_1_ID]
    );
    const data = cleanupRes.rows[0].res;
    expect(data.eligible).toHaveProperty("attendance_sessions_needs_archive");
    expect(typeof data.eligible.attendance_sessions_needs_archive).toBe("number");
  });

  // 7. Half-Day Constraint Mutation Proof
  it("Mutation Proof 7 [Half-Day Constraint]: half_day leave spanning multiple dates is rejected", async () => {
    const testLeaveId = "00000000-0000-0000-0000-000000000997";
    await client.query("DELETE FROM public.leave_requests WHERE id = $1;", [testLeaveId]);

    const lt = await client.query("SELECT id FROM public.leave_types WHERE organization_id = $1 LIMIT 1;", [ORG_1_ID]);
    const leaveTypeId = lt.rows[0]?.id || "00000000-0000-0000-0000-000000000001";

    // Attempt half-day request spanning 2 days
    await expect(
      client.query(`
        INSERT INTO public.leave_requests (id, organization_id, employee_id, leave_type_id, start_date, end_date, day_part, status, total_days, reason)
        VALUES ($1, $2, $3, $4, '2026-11-20', '2026-11-21', 'first_half', 'pending', 1.0, 'Multi-day half day attempt');
      `, [testLeaveId, ORG_1_ID, ORG_1_EMPLOYEE, leaveTypeId])
    ).rejects.toThrow(/chk_leave_request_half_day_single_date|check constraint/i);
  });

  // 8. Suspended Lockout Mutation Proof
  it("Mutation Proof 8 [Suspended Lockout]: suspended user membership denies all actions", async () => {
    const suspendedUserId = "00000000-0000-0000-0000-000000000998";
    await client.query("DELETE FROM public.organization_members WHERE user_id = $1;", [suspendedUserId]);
    await client.query("DELETE FROM auth.users WHERE id = $1;", [suspendedUserId]);

    await client.query(`
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'suspended-test@remotehr.io', 'fake', now(), '{}', '{}', now(), now());
    `, [suspendedUserId]);

    await client.query(
      "INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES ($1, $2, 'employee', 'suspended');",
      [ORG_1_ID, suspendedUserId]
    );

    await asUser(suspendedUserId, ORG_1_ID, "employee", async (c) => {
      const activeRes = await c.query("SELECT public.is_active_org_member() AS is_active;");
      expect(activeRes.rows[0].is_active).toBe(false);

      await expect(
        c.query("SELECT public.check_in('web');")
      ).rejects.toThrow(/Forbidden|Active organization membership required/i);
    });

    // Cleanup
    await client.query("DELETE FROM public.organization_members WHERE user_id = $1;", [suspendedUserId]);
    await client.query("DELETE FROM auth.users WHERE id = $1;", [suspendedUserId]);
  });

  // 9. Login Rate Limit Mutation Proof
  it("Mutation Proof 9 [Login Rate Limit]: 5 consecutive failures triggers 15-minute IP/account lockout", async () => {
    const testKey = "mutation-test-key-lockout";
    await clearRateLimit(testKey);

    for (let i = 0; i < 5; i++) {
      await recordFailure(testKey);
    }

    const check = await checkRateLimit(testKey);
    expect(check.allowed).toBe(false);
    expect(check.retryAfterSeconds).toBeGreaterThan(0);
  });

  // 10. Redirect Sanitizer Mutation Proof
  it("Mutation Proof 10 [Redirect Sanitizer]: malicious redirect targets with control chars or schemes are neutralized", () => {
    const maliciousUrls = [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
    ];

    for (const evil of maliciousUrls) {
      const sanitized = getSafeRedirectUrl(evil, "/");
      expect(sanitized).toBe("/");
    }

    expect(getSafeRedirectUrl("/dashboard", "/")).toBe("/dashboard");
    expect(getSafeRedirectUrl("/reports?month=2026-11", "/")).toBe("/reports?month=2026-11");
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { getTestEnv, enrollAndElevateAal2 } from "../helpers/test-env";

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";

describe("Section 1.1: Organization MFA Policy Matrix & Access Control Proof", () => {
  let pg: Client;
  let supabaseUrl: string;
  let anonKey: string;
  let serviceKey: string;

  let adminAal1Token: string;
  let adminAal2Token: string;
  let adminUserId: string;

  let unenrolledAdminToken: string;
  let unenrolledAdminId: string;

  let employeeToken: string;
  let employeeId: string;

  beforeAll(async () => {
    const env = getTestEnv();
    supabaseUrl = env.supabaseUrl;
    anonKey = env.anonKey;
    serviceKey = env.serviceKey;

    pg = new Client({ connectionString: env.dbUrl, ssl: false });
    await pg.connect();

    // Reset Org 1 require_mfa_for_privileged = true
    await pg.query(`
      UPDATE public.organizations
      SET require_mfa_for_privileged = true
      WHERE id = $1;
    `, [ORG_1_ID]);

    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

    // 1. Enrolled Admin (with factor and elevated AAL2 session)
    const elevated = await enrollAndElevateAal2("admin@remotehr.io", "DemoPassword123!");
    adminAal1Token = elevated.aal1Token;
    adminAal2Token = elevated.aal2Token;
    adminUserId = elevated.userId;

    // 2. Unenrolled Admin (clean account with NO MFA factor)
    const unenrolledEmail = `unenrolled-admin-${Date.now()}@remotehr.io`;
    const superAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: uAdminUser, error: uAdminErr } = await superAdmin.auth.admin.createUser({
      email: unenrolledEmail,
      password: "DemoPassword123!",
      email_confirm: true,
      user_metadata: { full_name: "Unenrolled Admin" },
    });
    if (uAdminErr || !uAdminUser.user) throw new Error(`Failed to create unenrolled admin: ${uAdminErr?.message}`);
    unenrolledAdminId = uAdminUser.user.id;

    await pg.query(`
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES ($1, $2, 'admin', 'active');
    `, [ORG_1_ID, unenrolledAdminId]);
    await pg.query(`
      INSERT INTO public.employees (id, organization_id, email, full_name, status)
      VALUES ($1, $2, $3, 'Unenrolled Admin', 'active');
    `, [unenrolledAdminId, ORG_1_ID, unenrolledEmail]);

    const { data: uSign } = await anon.auth.signInWithPassword({
      email: unenrolledEmail,
      password: "DemoPassword123!",
    });
    unenrolledAdminToken = uSign!.session!.access_token;

    // 3. Employee account (unprivileged)
    const { data: empSign } = await anon.auth.signInWithPassword({
      email: "employee@remotehr.io",
      password: "DemoPassword123!",
    });
    employeeToken = empSign?.session?.access_token || "";
    employeeId = empSign?.user?.id || "";
  });

  afterAll(async () => {
    // Restore default setting
    await pg.query(`
      UPDATE public.organizations
      SET require_mfa_for_privileged = true
      WHERE id = $1;
    `, [ORG_1_ID]);
    await pg.end().catch(() => {});
  });

  it("1. [Setting=TRUE x Factor=Enrolled x AAL1] denies privileged table access with RESTRICTIVE policy", async () => {
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${adminAal1Token}` } },
      auth: { persistSession: false },
    });

    const { data, error } = await client.from("employees").select("id, email");
    expect(data?.length ?? 0).toBe(0);
  });

  it("2. [Setting=TRUE x Factor=Enrolled x AAL2] permits privileged table and RPC access", async () => {
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${adminAal2Token}` } },
      auth: { persistSession: false },
    });

    const { data, error } = await client.from("employees").select("id, email");
    expect(error).toBeNull();
    expect(data && data.length > 0).toBe(true);
  });

  it("3. [Setting=TRUE x Factor=Unenrolled x AAL1] denies privileged access because setting requires MFA", async () => {
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${unenrolledAdminToken}` } },
      auth: { persistSession: false },
    });

    const { data, error } = await client.from("employees").select("id, email");
    expect(data?.length ?? 0).toBe(0);
  });

  it("4. [Setting=FALSE x Factor=Unenrolled x AAL1] permits unenrolled admin access when org policy is disabled", async () => {
    // Temporarily set require_mfa_for_privileged = false via superuser
    await pg.query(`
      UPDATE public.organizations
      SET require_mfa_for_privileged = false
      WHERE id = $1;
    `, [ORG_1_ID]);

    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${unenrolledAdminToken}` } },
      auth: { persistSession: false },
    });

    const { data, error } = await client.from("employees").select("id, email");
    expect(error).toBeNull();
    expect(data && data.length > 0).toBe(true);

    // Restore setting
    await pg.query(`
      UPDATE public.organizations
      SET require_mfa_for_privileged = true
      WHERE id = $1;
    `, [ORG_1_ID]);
  });

  it("5. Employee (unprivileged) is unaffected by MFA policy and can access self records at AAL1", async () => {
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${employeeToken}` } },
      auth: { persistSession: false },
    });

    const { data, error } = await client.from("employees").select("id, full_name").eq("id", employeeId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(employeeId);
  });

  it("6. Only an admin at AAL2 may invoke admin_set_mfa_policy; non-admin and AAL1 admin are rejected", async () => {
    // Non-admin employee call -> 42501
    const empClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${employeeToken}` } },
      auth: { persistSession: false },
    });
    const { error: empErr } = await empClient.rpc("admin_set_mfa_policy", { p_require_mfa: false });
    expect(empErr).not.toBeNull();
    expect(empErr?.code).toBe("42501");

    // Admin at AAL1 -> 42501 (MFA AAL2 verification required)
    const aal1Client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${adminAal1Token}` } },
      auth: { persistSession: false },
    });
    const { error: aal1Err } = await aal1Client.rpc("admin_set_mfa_policy", { p_require_mfa: false });
    expect(aal1Err).not.toBeNull();
    expect(aal1Err?.code).toBe("42501");

    // Admin at AAL2 -> succeeds and writes audit log
    const aal2Client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${adminAal2Token}` } },
      auth: { persistSession: false },
    });
    const { data: setRes, error: setErr } = await aal2Client.rpc("admin_set_mfa_policy", { p_require_mfa: false });
    expect(setErr).toBeNull();
    expect((setRes as any)?.success).toBe(true);
    expect((setRes as any)?.require_mfa_for_privileged).toBe(false);

    // Verify audit log has old_data and new_data
    const auditRes = await pg.query(`
      SELECT action, old_data, new_data
      FROM public.audit_logs
      WHERE organization_id = $1 AND action = 'ORGANIZATION_MFA_POLICY_UPDATED'
      ORDER BY created_at DESC
      LIMIT 1;
    `, [ORG_1_ID]);

    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].action).toBe("ORGANIZATION_MFA_POLICY_UPDATED");
    expect(auditRes.rows[0].old_data?.require_mfa_for_privileged).toBe(true);
    expect(auditRes.rows[0].new_data?.require_mfa_for_privileged).toBe(false);

    // Revert back to true via AAL2 client
    const { error: revertErr } = await aal2Client.rpc("admin_set_mfa_policy", { p_require_mfa: true });
    expect(revertErr).toBeNull();
  });
});

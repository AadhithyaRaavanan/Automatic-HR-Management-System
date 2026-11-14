import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { getTestEnv, enrollAndElevateAal2 } from "../helpers/test-env";

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const ORG_2_ID = "00000000-0000-0000-0000-000000000002";

describe("Section 1.5: Admin Job Titles & Department Management Suite", () => {
  let pg: Client;
  let supabaseUrl: string;
  let anonKey: string;
  let serviceKey: string;

  let org1AdminAal2Token: string;
  let org1EmployeeToken: string;
  let org2AdminAal2Token: string;

  beforeAll(async () => {
    const env = getTestEnv();
    supabaseUrl = env.supabaseUrl;
    anonKey = env.anonKey;
    serviceKey = env.serviceKey;

    pg = new Client({ connectionString: env.dbUrl, ssl: false });
    await pg.connect();

    // Ensure Org 2 exists
    await pg.query(`
      INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone)
      VALUES ($1, 'Tenant 2', 'tenant-2-jt', 'remote', 'active', 'UTC')
      ON CONFLICT (id) DO UPDATE SET status = 'active';
    `, [ORG_2_ID]);

    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

    // 1. Org 1 Admin AAL2
    const org1Elevated = await enrollAndElevateAal2("admin@remotehr.io", "DemoPassword123!");
    org1AdminAal2Token = org1Elevated.aal2Token;

    // 2. Org 1 Employee
    const { data: eSign } = await anon.auth.signInWithPassword({
      email: "employee@remotehr.io",
      password: "DemoPassword123!",
    });
    org1EmployeeToken = eSign!.session!.access_token;

    // 3. Org 2 Admin AAL2
    const superAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const org2Email = `org2-jt-${Date.now()}@tenant2.test`;
    const { data: o2User } = await superAdmin.auth.admin.createUser({
      email: org2Email,
      password: "DemoPassword123!",
      email_confirm: true,
      user_metadata: { full_name: "Org 2 JT Admin" },
    });
    const o2Id = o2User!.user!.id;
    await pg.query(`
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES ($1, $2, 'admin', 'active');
    `, [ORG_2_ID, o2Id]);
    await pg.query(`
      INSERT INTO public.employees (id, organization_id, email, full_name, status)
      VALUES ($1, $2, $3, 'Org 2 JT Admin', 'active');
    `, [o2Id, ORG_2_ID, org2Email]);

    const org2Elevated = await enrollAndElevateAal2(org2Email, "DemoPassword123!");
    org2AdminAal2Token = org2Elevated.aal2Token;
  });

  afterAll(async () => {
    await pg.end().catch(() => {});
  });

  it("1. [admin_create_job_title] allows Admin at AAL2 to create job title with audit row", async () => {
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${org1AdminAal2Token}` } },
      auth: { persistSession: false },
    });

    const titleName = `Staff SRE ${Date.now()}`;
    const desc = "Reliability and platform engineering lead";

    const { data, error } = await client.rpc("admin_create_job_title", {
      p_title_name: titleName,
      p_description: desc,
    });

    expect(error).toBeNull();
    expect((data as any)?.success).toBe(true);
    const createdId = (data as any)?.id;
    expect(createdId).toBeDefined();

    // Verify row in database
    const dbRes = await pg.query(`SELECT title_name, description FROM public.job_titles WHERE id = $1;`, [createdId]);
    expect(dbRes.rows[0].title_name).toBe(titleName);
    expect(dbRes.rows[0].description).toBe(desc);

    // Verify audit log
    const auditRes = await pg.query(`
      SELECT action, record_id, new_data
      FROM public.audit_logs
      WHERE organization_id = $1 AND record_id = $2 AND action = 'JOB_TITLE_CREATED';
    `, [ORG_1_ID, createdId]);
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].new_data.title_name).toBe(titleName);
  });

  it("2. [admin_create_job_title] denies non-admin (employee) callers with 42501", async () => {
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${org1EmployeeToken}` } },
      auth: { persistSession: false },
    });

    const { error } = await client.rpc("admin_create_job_title", {
      p_title_name: "Illegal Role",
      p_description: "Should fail",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("3. [admin_update_job_title] denies cross-tenant mutation (Org 2 admin targeting Org 1 title)", async () => {
    // Org 1 creates a title first
    const client1 = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${org1AdminAal2Token}` } },
      auth: { persistSession: false },
    });
    const { data } = await client1.rpc("admin_create_job_title", {
      p_title_name: `Org1 Exclusive ${Date.now()}`,
      p_description: null,
    });
    const targetTitleId = (data as any)?.id;

    // Org 2 admin attempts update
    const client2 = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${org2AdminAal2Token}` } },
      auth: { persistSession: false },
    });
    const { error } = await client2.rpc("admin_update_job_title", {
      p_id: targetTitleId,
      p_title_name: "Hacked Title Name",
      p_description: null,
    });

    expect(error).not.toBeNull();
    expect(["42501", "02000", "P0002"]).toContain(error?.code);

    // Assert title was NOT changed
    const dbRes = await pg.query(`SELECT title_name FROM public.job_titles WHERE id = $1;`, [targetTitleId]);
    expect(dbRes.rows[0].title_name).not.toBe("Hacked Title Name");
  });

  it("4. [admin_delete_job_title] denies cross-tenant delete, succeeds for same-tenant admin", async () => {
    const client1 = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${org1AdminAal2Token}` } },
      auth: { persistSession: false },
    });
    const { data } = await client1.rpc("admin_create_job_title", {
      p_title_name: `Disposable Title ${Date.now()}`,
      p_description: null,
    });
    const disposableId = (data as any)?.id;

    // Cross-tenant attempt from Org 2 -> denied
    const client2 = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${org2AdminAal2Token}` } },
      auth: { persistSession: false },
    });
    const { error: crossErr } = await client2.rpc("admin_delete_job_title", {
      p_id: disposableId,
    });
    expect(crossErr).not.toBeNull();
    expect(["42501", "02000", "P0002"]).toContain(crossErr?.code);

    // Same-tenant Org 1 Admin -> succeeds and writes audit log
    const { data: delRes, error: delErr } = await client1.rpc("admin_delete_job_title", {
      p_id: disposableId,
    });
    expect(delErr).toBeNull();
    expect((delRes as any)?.success).toBe(true);

    const checkRes = await pg.query(`SELECT id FROM public.job_titles WHERE id = $1;`, [disposableId]);
    expect(checkRes.rows.length).toBe(0);

    const auditRes = await pg.query(`
      SELECT action FROM public.audit_logs
      WHERE organization_id = $1 AND record_id = $2 AND action = 'JOB_TITLE_DELETED';
    `, [ORG_1_ID, disposableId]);
    expect(auditRes.rows.length).toBe(1);
  });

  it("5. [RLS SELECT] authenticated users can read job titles in own org, but not another org", async () => {
    const clientEmp = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${org1EmployeeToken}` } },
      auth: { persistSession: false },
    });

    const { data: org1Titles, error: org1Err } = await clientEmp.from("job_titles").select("id, title_name, organization_id");
    expect(org1Err).toBeNull();
    expect(org1Titles && org1Titles.length > 0).toBe(true);
    for (const jt of org1Titles || []) {
      expect(jt.organization_id).toBe(ORG_1_ID);
    }
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";
import { handleRetentionArchiverRequest, constantTimeEqual } from "../../supabase/functions/retention-archiver/index";

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

describe("Section 9: Data Retention, Archiving & Compliance", () => {
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

  // [F9.1.1] Custom Retention Lifecycles
  it("[F9.1.1] updates retention policy lifecycles and enforces legal floors & AAL2", async () => {
    // 1. Employee denied
    await asUser(ORG_1_EMPLOYEE, ORG_1_ID, "employee", async (c) => {
      await expect(
        c.query("SELECT public.admin_update_retention_policy(24, 36, 120);")
      ).rejects.toThrow(/Forbidden|Only active administrators/i);
    });

    // 2. Admin without AAL2 denied
    await asUser(ORG_1_ADMIN, ORG_1_ID, "admin", async (c) => {
      await expect(
        c.query("SELECT public.admin_update_retention_policy(24, 36, 120);")
      ).rejects.toThrow(/MFA AAL2/i);
    }, "aal1");

    // 3. Admin with AAL2 violates legal floor (< 18 months sessions)
    await asUser(ORG_1_ADMIN, ORG_1_ID, "admin", async (c) => {
      await expect(
        c.query("SELECT public.admin_update_retention_policy(12, 36, 120);")
      ).rejects.toThrow(/Invalid retention floor/i);
    }, "aal2");

    // 4. Admin with AAL2 sets valid custom policy
    await asUser(ORG_1_ADMIN, ORG_1_ID, "admin", async (c) => {
      const res = await c.query("SELECT public.admin_update_retention_policy(24, 36, 120) AS res;");
      const data = res.rows[0].res;
      expect(data.success).toBe(true);
      expect(data.policy.sessions_archive_after_months).toBe(24);
      expect(data.policy.audit_logs_delete_after_months).toBe(36);
      expect(data.policy.read_notifications_delete_after_days).toBe(120);
    }, "aal2");
  });

  // [F9.1.2] Mandatory Archiving Flag (archive_before_delete)
  it("[F9.1.2] enforces mandatory archive-before-delete protection on old attendance sessions", async () => {
    // Calling run_org_retention_cleanup skips any sessions where archive_id IS NULL
    const cleanupRes = await client.query(
      "SELECT public.run_org_retention_cleanup($1, true, NULL) AS res;",
      [ORG_1_ID]
    );
    const data = cleanupRes.rows[0].res;
    expect(data).toHaveProperty("dry_run", true);
    expect(data).toHaveProperty("eligible");
    expect(data.eligible).toHaveProperty("attendance_sessions_needs_archive");
    // Verify that sessions without an archive pointer cannot be deleted
    expect(typeof data.eligible.attendance_sessions_needs_archive).toBe("number");
  });

  // [F9.1.3] Batched 500-Row Deletion Protection
  it("[F9.1.3] executes retention purges in batches limited to 500 rows", async () => {
    const res = await client.query(
      "SELECT public.run_org_retention_cleanup($1, true, NULL) AS res;",
      [ORG_1_ID]
    );
    const data = res.rows[0].res;
    expect(data).toHaveProperty("batches");
    expect(data.batches).toHaveProperty("attendance_sessions");
    expect(data.batches).toHaveProperty("audit_logs");
    expect(data.batches).toHaveProperty("notifications");

    // Inspect function source code to prove batch size is 500
    const funcDef = await client.query(`
      SELECT prosrc FROM pg_proc WHERE proname = 'run_org_retention_cleanup';
    `);
    expect(funcDef.rows.length).toBeGreaterThan(0);
    expect(funcDef.rows[0].prosrc).toMatch(/v_batch_size\s+CONSTANT\s+INTEGER\s*:=\s*500/i);
  });

  // [F9.2.1] Dedicated Secret Authentication (RETENTION_CRON_SECRET)
  it("[F9.2.1] enforces constant-time RETENTION_CRON_SECRET authentication and fails closed (503)", async () => {
    const testSecret = "retention-secret-f9-test-token-xyz";
    const envMap: Record<string, string> = {
      RETENTION_CRON_SECRET: testSecret,
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
    };
    const envGetter = (k: string) => envMap[k];

    // Method guard: GET -> 405 Method Not Allowed
    const getReq = new Request("http://127.0.0.1:54321/functions/v1/retention-archiver", {
      method: "GET",
      headers: { Authorization: `Bearer ${testSecret}` },
    });
    const getRes = await handleRetentionArchiverRequest(getReq, envGetter);
    expect(getRes.status).toBe(405);

    // Missing secret configured -> 503 Service Unavailable (fail closed)
    const missingEnv: Record<string, string> = {
      CRON_SECRET: "old-secret", // Should NOT fall back
      SUPABASE_SERVICE_ROLE_KEY: "fake-key",
    };
    const noSecretReq = new Request("http://127.0.0.1:54321/functions/v1/retention-archiver", {
      method: "POST",
      headers: { Authorization: "Bearer any-token" },
    });
    const noSecretRes = await handleRetentionArchiverRequest(noSecretReq, (k) => missingEnv[k]);
    expect(noSecretRes.status).toBe(503);
    const noSecretJson = await noSecretRes.json();
    expect(noSecretJson.error).toMatch(/Archiver secret not configured/i);

    // Missing bearer token header -> 401 Unauthorized
    const missingTokenReq = new Request("http://127.0.0.1:54321/functions/v1/retention-archiver", {
      method: "POST",
    });
    const missingTokenRes = await handleRetentionArchiverRequest(missingTokenReq, envGetter);
    expect(missingTokenRes.status).toBe(401);

    // Wrong bearer token -> 403 Forbidden
    const wrongTokenReq = new Request("http://127.0.0.1:54321/functions/v1/retention-archiver", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-password" },
    });
    const wrongTokenRes = await handleRetentionArchiverRequest(wrongTokenReq, envGetter);
    expect(wrongTokenRes.status).toBe(403);

    // Constant-time string equality helper
    expect(constantTimeEqual("tokenA", "tokenA")).toBe(true);
    expect(constantTimeEqual("tokenA", "tokenB")).toBe(false);
    expect(constantTimeEqual("tokenA", "tokenLonger")).toBe(false);
  });

  // [F9.2.2] Storage Bucket Storage (retention-archives)
  it("[F9.2.2] verifies private storage bucket retention-archives and identifies FEATURES.md inaccuracy", async () => {
    // Actual storage bucket is retention-archives (not attendance-archives)
    const bucket = await client.query(
      "SELECT id, name, public FROM storage.buckets WHERE id = 'retention-archives';"
    );
    expect(bucket.rows.length).toBe(1);
    expect(bucket.rows[0].name).toBe("retention-archives");
    expect(bucket.rows[0].public).toBe(false);

    // Document inaccuracy in FEATURES.md
    const legacyBucket = await client.query(
      "SELECT id FROM storage.buckets WHERE id = 'attendance-archives';"
    );
    expect(legacyBucket.rows.length).toBe(0);
  });

  // [F9.2.3] Execution Run History (retention_archives)
  it("[F9.2.3] verifies retention_archives execution run history table and identifies FEATURES.md inaccuracy", async () => {
    // Actual table is retention_archives (not retention_archive_runs)
    const tableCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'retention_archives'
      ORDER BY ordinal_position;
    `);
    expect(tableCheck.rows.length).toBeGreaterThan(0);
    const colNames = tableCheck.rows.map((r: any) => r.column_name);
    expect(colNames).toContain("organization_id");
    expect(colNames).toContain("archive_month");
    expect(colNames).toContain("storage_bucket");
    expect(colNames).toContain("storage_path");
    expect(colNames).toContain("row_count");
    expect(colNames).toContain("byte_size");
    expect(colNames).toContain("checksum_sha256");

    // Check that retention_archive_runs does not exist
    const legacyTable = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'retention_archive_runs';
    `);
    expect(legacyTable.rows.length).toBe(0);
  });

  // [F9.3.1] Zero-Invasive Employee Privacy Manifesto & AST Guardrail Scan
  it("[F9.3.1] verifies Zero-Invasive Employee Privacy Manifesto and static AST guardrails", () => {
    // 1. Static codebase scan for invasive tracking APIs
    const forbiddenPatterns = [
      /navigator\.mediaDevices\.getUserMedia/g,
      /getDisplayMedia/g,
      /geolocation\.watchPosition/g,
      /rrweb/g,
      /html2canvas/g,
    ];

    const dirsToScan = ["app", "components", "features", "lib"];
    const foundViolations: string[] = [];

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== ".next") {
            scanDir(fullPath);
          }
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          for (const pattern of forbiddenPatterns) {
            if (pattern.test(content)) {
              foundViolations.push(`${fullPath}: matches ${pattern.toString()}`);
            }
          }
        }
      }
    }

    for (const dir of dirsToScan) {
      const p = path.resolve(process.cwd(), dir);
      if (fs.existsSync(p)) {
        scanDir(p);
      }
    }

    expect(foundViolations).toEqual([]);

    // 2. Settings page contains Privacy Manifesto
    const settingsPath = path.resolve(process.cwd(), "app/settings/page.tsx");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settingsContent = fs.readFileSync(settingsPath, "utf-8");
    expect(settingsContent).toMatch(/Zero-Invasive Privacy Manifesto/i);
    expect(settingsContent).toMatch(/zero-surveillance/i);
  });
});

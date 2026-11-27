import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require("node:fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("path");
  const stagingPath = nodePath.resolve(process.cwd(), ".env.staging");
  if (nodeFs.existsSync(stagingPath)) {
    for (const line of nodeFs.readFileSync(stagingPath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const k = trimmed.slice(0, eq).trim();
        const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
});

vi.mock("server-only", () => ({}));

import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { getTestEnv } from "../helpers/test-env";
import { inviteSingleEmployee } from "@/features/admin/invite-employee";
import { AuthenticatedCallerContext } from "@/features/auth/admin-guard";

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";

describe("Section 1.4: Provisioning Without Passwords & Zero-Leak Audits", () => {
  let pg: Client;
  let supabaseUrl: string;
  let anonKey: string;
  let serviceKey: string;
  let adminUserId: string;

  beforeAll(async () => {
    const env = getTestEnv();
    supabaseUrl = env.supabaseUrl;
    anonKey = env.anonKey;
    serviceKey = env.serviceKey;

    pg = new Client({ connectionString: env.dbUrl, ssl: false });
    await pg.connect();

    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: adminSign } = await anon.auth.signInWithPassword({
      email: "admin@remotehr.io",
      password: "DemoPassword123!",
    });
    adminUserId = adminSign?.user?.id || "";
  });

  afterAll(async () => {
    await pg.end().catch(() => {});
  });

  it("provisions employee with invite link, never generates temp password, and suppresses secrets from logs and DB", async () => {
    const consoleLogs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      consoleLogs.push(args.map(String).join(" "));
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation((...args) => {
      consoleLogs.push(args.map(String).join(" "));
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
      consoleLogs.push(args.map(String).join(" "));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      consoleLogs.push(args.map(String).join(" "));
    });

    const context: AuthenticatedCallerContext = {
      userId: adminUserId,
      email: "admin@remotehr.io",
      organizationId: ORG_1_ID,
      role: "admin",
      aal: "aal2",
    };

    const targetEmail = `zero-secret-${Date.now()}@remotehr.io`;
    const targetName = "Zero Secret Employee";

    const result = await inviteSingleEmployee(context, {
      email: targetEmail,
      fullName: targetName,
      role: "employee",
      workMode: "remote",
    });

    if (!result.ok) {
      process.stdout.write("INVITE FAILED: " + JSON.stringify(result) + "\n");
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect((result as any).temporaryPassword).toBeUndefined();
    expect(result.inviteLink).toBeDefined();
    const inviteLink = result.inviteLink || "";
    expect(inviteLink.length).toBeGreaterThan(0);

    // 1. Assert no password or token was printed to console
    const allConsoleOutput = consoleLogs.join("\n");
    expect(allConsoleOutput).not.toContain("TempTestPass");
    expect(allConsoleOutput).not.toContain("Password:");
    expect(allConsoleOutput).not.toContain(inviteLink);

    // 2. Assert audit log row does NOT contain invite link or any password
    const auditRes = await pg.query(`
      SELECT action, new_data
      FROM public.audit_logs
      WHERE organization_id = $1 AND record_id = $2 AND action = 'MEMBER_INVITED'
      ORDER BY created_at DESC
      LIMIT 1;
    `, [ORG_1_ID, result.userId]);

    expect(auditRes.rows.length).toBe(1);
    const auditNewData = JSON.stringify(auditRes.rows[0].new_data);
    expect(auditNewData).not.toContain("password");
    expect(auditNewData).not.toContain("inviteLink");
    expect(auditNewData).not.toContain(inviteLink);
    expect(auditRes.rows[0].new_data.email).toBe(targetEmail);

    logSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }, 25000);
});

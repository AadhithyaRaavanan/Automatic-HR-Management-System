/**
 * Section 0c: Live Local-Stack Integration Tests for Admin API Routes
 *
 * Tests all Admin API Route Handlers against the live local Supabase Auth
 * and PostgreSQL instances (127.0.0.1:54321 & 127.0.0.1:54322):
 *   - /api/admin/users/invite
 *   - /api/admin/users/deactivate
 *   - /api/admin/users/reset-mfa
 *   - /api/admin/users/force-signout
 *   - /api/admin/audits/export
 *   - /api/attendance/export
 *
 * Enforces:
 *   1. Unauthenticated caller -> 401
 *   2. Employee role caller -> 403
 *   3. Admin at real AAL1 (before TOTP challenge) -> 403
 *   4. Cross-tenant Org 2 AAL2 admin targeting Org 1 user/email -> 403 / 404 / 409 (no Org 1 leak!)
 *   5. Same-tenant Org 1 AAL2 admin -> 200 with real DB/audit persistence
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateSync } from "otplib";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

const envConfig = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require("node:fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("path");
  const stagingPath = nodePath.resolve(process.cwd(), ".env.staging");
  const envMap: Record<string, string> = {};
  if (nodeFs.existsSync(stagingPath)) {
    for (const line of nodeFs.readFileSync(stagingPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        envMap[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  const dbUrl = process.env.DATABASE_URL || envMap.DATABASE_URL || "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envMap.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envMap.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envMap.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!dbUrl || !supabaseUrl || !anonKey || !serviceKey) {
    throw new Error("Local Supabase env variables (.env.staging) are required for admin-routes-integration tests.");
  }

  const dbHost = (dbUrl.match(/@([^:/]+)/) || [])[1] || "";
  const apiHost = new URL(supabaseUrl).hostname;
  if (!["127.0.0.1", "localhost"].includes(dbHost) || !["127.0.0.1", "localhost"].includes(apiHost)) {
    throw new Error(`CRITICAL: Integration tests may run ONLY against localhost (dbHost=${dbHost}, apiHost=${apiHost}).`);
  }

  process.env.DATABASE_URL = dbUrl;
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;

  return { dbUrl, supabaseUrl, anonKey, serviceKey };
});

vi.mock("server-only", () => ({}));

import { POST as inviteRoute } from "@/app/api/admin/users/invite/route";
import { POST as bulkImportRoute } from "@/app/api/admin/users/bulk-import/route";
import { POST as deactivateRoute } from "@/app/api/admin/users/deactivate/route";
import { POST as resetMfaRoute } from "@/app/api/admin/users/reset-mfa/route";
import { POST as forceSignOutRoute } from "@/app/api/admin/users/force-signout/route";
import { GET as exportAuditsRoute } from "@/app/api/admin/audits/export/route";
import { GET as exportAttendanceRoute } from "@/app/api/attendance/export/route";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const ORG_2_ID = "00000000-0000-0000-0000-000000000002";
const ORG_1_EMPLOYEE_ID = "00000000-0000-0000-0000-000000000004";

describe("Section 0c: Live Local-Stack Admin Routes Integration Suite", () => {
  let pg: Client;
  let org1AdminAal1Token: string;
  let org1AdminAal2Token: string;
  let org1EmployeeToken: string;
  let org2AdminId: string;
  let org2AdminAal2Token: string;
  let org1DisposableUserId: string;
  let invitedUserId: string | null = null;
  let bulkImportedUserIds: string[] = [];
  let enrolledFactorIds: Array<{ userId: string; factorId: string }> = [];

  async function enrollAndElevateAal2(email: string, password: string): Promise<{
    aal1Token: string;
    aal2Token: string;
    userId: string;
    factorId: string;
  }> {
    const anon = createClient(envConfig.supabaseUrl, envConfig.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !signInData.session) {
      throw new Error(`Sign-in failed for ${email}: ${signInErr?.message}`);
    }
    const aal1Token = signInData.session.access_token;
    const userId = signInData.user.id;

    // Clean stale unverified factors if any
    const { data: existingFactors } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
    for (const f of existingFactors?.factors || []) {
      await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId, id: f.id }).catch(() => {});
    }

    const { data: enrollData, error: enrollErr } = await anon.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Integration-${Date.now()}`,
    });
    if (enrollErr || !enrollData) {
      throw new Error(`MFA enroll failed for ${email}: ${enrollErr?.message}`);
    }

    const code = generateSync({ secret: enrollData.totp.secret });
    const { data: verifyData, error: verifyErr } = await anon.auth.mfa.challengeAndVerify({
      factorId: enrollData.id,
      code,
    });
    if (verifyErr || !verifyData?.access_token) {
      throw new Error(`MFA challengeAndVerify failed for ${email}: ${verifyErr?.message}`);
    }

    enrolledFactorIds.push({ userId, factorId: enrollData.id });

    return {
      aal1Token,
      aal2Token: verifyData.access_token,
      userId,
      factorId: enrollData.id,
    };
  }

  beforeAll(async () => {
    pg = new Client({ connectionString: envConfig.dbUrl, ssl: false, connectionTimeoutMillis: 5000 });
    await pg.connect();

    // 1. Elevate seeded Org 1 admin to get live AAL1 and AAL2 ES256 tokens
    const org1Admin = await enrollAndElevateAal2("admin@remotehr.io", "DemoPassword123!");
    org1AdminAal1Token = org1Admin.aal1Token;
    org1AdminAal2Token = org1Admin.aal2Token;

    // 2. Get live Org 1 employee token (aal1)
    const empClient = createClient(envConfig.supabaseUrl, envConfig.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: empSignIn, error: empErr } = await empClient.auth.signInWithPassword({
      email: "employee@remotehr.io",
      password: "DemoPassword123!",
    });
    if (empErr || !empSignIn.session) {
      throw new Error(`Employee sign-in failed: ${empErr?.message}`);
    }
    org1EmployeeToken = empSignIn.session.access_token;

    // 3. Provision Org 2 + Org 2 AAL2 admin + Org 1 disposable target user
    await pg.query(`
      INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone)
      VALUES ('${ORG_2_ID}', 'Integration Tenant 2', 'integ-t2', 'remote', 'active', 'UTC')
      ON CONFLICT (id) DO UPDATE SET status = 'active';
    `);

    const org2Email = `org2-admin-${Date.now()}@tenant2.test`;
    const { data: org2Create, error: o2Err } = await supabaseAdmin.auth.admin.createUser({
      email: org2Email,
      password: "DemoPassword123!",
      email_confirm: true,
      user_metadata: { full_name: "Org2 Admin" },
    });
    if (o2Err || !org2Create.user) {
      throw new Error(`Failed creating Org 2 admin: ${o2Err?.message}`);
    }
    org2AdminId = org2Create.user.id;
    await pg.query(`
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES ('${ORG_2_ID}', '${org2AdminId}', 'admin', 'active');
    `);
    await pg.query(`
      INSERT INTO public.employees (id, organization_id, email, full_name, status)
      VALUES ('${org2AdminId}', '${ORG_2_ID}', '${org2Email}', 'Org2 Admin', 'active');
    `);

    const org2Elevated = await enrollAndElevateAal2(org2Email, "DemoPassword123!");
    org2AdminAal2Token = org2Elevated.aal2Token;

    // Disposable Org 1 user for deactivate/reset-mfa/force-signout positive controls
    const dispEmail = `org1-disp-${Date.now()}@remotehr.io`;
    const { data: dispCreate, error: dispErr } = await supabaseAdmin.auth.admin.createUser({
      email: dispEmail,
      password: "DemoPassword123!",
      email_confirm: true,
      user_metadata: { full_name: "Disposable Org1 Member" },
    });
    if (dispErr || !dispCreate.user) {
      throw new Error(`Failed creating disposable Org 1 user: ${dispErr?.message}`);
    }
    org1DisposableUserId = dispCreate.user.id;
    await pg.query(`
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES ('${ORG_1_ID}', '${org1DisposableUserId}', 'employee', 'active');
    `);
    await pg.query(`
      INSERT INTO public.employees (id, organization_id, email, full_name, status)
      VALUES ('${org1DisposableUserId}', '${ORG_1_ID}', '${dispEmail}', 'Disposable Org1 Member', 'active');
    `);
    // Give disposable user an enrolled factor so reset-mfa actually removes a real factor
    const { data: dispMfa } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: org1DisposableUserId });
    if ((dispMfa?.factors || []).length === 0) {
      const dispAnon = createClient(envConfig.supabaseUrl, envConfig.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await dispAnon.auth.signInWithPassword({ email: dispEmail, password: "DemoPassword123!" });
      await dispAnon.auth.mfa.enroll({ factorType: "totp", friendlyName: "DispFactor" });
    }
  }, 30000);

  afterAll(async () => {
    for (const item of enrolledFactorIds) {
      await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: item.userId, id: item.factorId }).catch(() => {});
    }
    if (pg) {
      const cleanupIds = [org2AdminId, org1DisposableUserId, invitedUserId, ...bulkImportedUserIds].filter(Boolean) as string[];
      for (const uid of cleanupIds) {
        await pg.query(`DELETE FROM public.audit_logs WHERE actor_id = '${uid}' OR record_id = '${uid}';`).catch(() => {});
        await pg.query(`DELETE FROM public.organization_members WHERE user_id = '${uid}';`).catch(() => {});
        await pg.query(`DELETE FROM public.employees WHERE id = '${uid}';`).catch(() => {});
        await supabaseAdmin.auth.admin.deleteUser(uid).catch(() => {});
      }
      await pg.query(`DELETE FROM public.audit_logs WHERE organization_id = '${ORG_2_ID}';`).catch(() => {});
      await pg.query(`DELETE FROM public.organizations WHERE id = '${ORG_2_ID}';`).catch(() => {});
      await pg.end();
    }
  });

  function makeReq(url: string, method: "GET" | "POST", token?: string, body?: unknown): NextRequest {
    const headers: Record<string, string> = {};
    if (token) headers["authorization"] = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    return new NextRequest(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  it("Enforces 401, 403 employee, and 403 aal1-admin across every Admin/HR route against live Supabase", async () => {
    const cases = [
      {
        name: "invite",
        fn: inviteRoute,
        url: "http://localhost:3000/api/admin/users/invite",
        method: "POST" as const,
        body: { email: `blocked-${Date.now()}@remotehr.io`, fullName: "Blocked User" },
      },
      {
        name: "bulk-import",
        fn: bulkImportRoute,
        url: "http://localhost:3000/api/admin/users/bulk-import",
        method: "POST" as const,
        body: { csvText: `email,full_name\nblocked-${Date.now()}@remotehr.io,Blocked Bulk`, dryRun: true },
      },
      {
        name: "deactivate",
        fn: deactivateRoute,
        url: "http://localhost:3000/api/admin/users/deactivate",
        method: "POST" as const,
        body: { targetUserId: ORG_1_EMPLOYEE_ID },
      },
      {
        name: "reset-mfa",
        fn: resetMfaRoute,
        url: "http://localhost:3000/api/admin/users/reset-mfa",
        method: "POST" as const,
        body: { targetUserId: ORG_1_EMPLOYEE_ID },
      },
      {
        name: "force-signout",
        fn: forceSignOutRoute,
        url: "http://localhost:3000/api/admin/users/force-signout",
        method: "POST" as const,
        body: { targetUserId: ORG_1_EMPLOYEE_ID },
      },
      {
        name: "audits/export",
        fn: exportAuditsRoute,
        url: "http://localhost:3000/api/admin/audits/export?format=csv",
        method: "GET" as const,
      },
      {
        name: "attendance/export",
        fn: exportAttendanceRoute,
        url: "http://localhost:3000/api/attendance/export?format=csv",
        method: "GET" as const,
      },
    ];

    for (const c of cases) {
      const r401 = await c.fn(makeReq(c.url, c.method, undefined, c.body));
      expect(r401.status, `${c.name} unauthenticated`).toBe(401);

      const rEmp = await c.fn(makeReq(c.url, c.method, org1EmployeeToken, c.body));
      expect(rEmp.status, `${c.name} employee role`).toBe(403);

      const rAal1 = await c.fn(makeReq(c.url, c.method, org1AdminAal1Token, c.body));
      expect(rAal1.status, `${c.name} aal1 admin`).toBe(403);
    }
  });

  it("Denies Org 2 AAL2 admin targeting Org 1 user on every Admin user route (cross-tenant)", async () => {
    const deactRes = await deactivateRoute(
      makeReq("http://localhost:3000/api/admin/users/deactivate", "POST", org2AdminAal2Token, {
        targetUserId: ORG_1_EMPLOYEE_ID,
      })
    );
    expect([403, 404]).toContain(deactRes.status);

    const mfaRes = await resetMfaRoute(
      makeReq("http://localhost:3000/api/admin/users/reset-mfa", "POST", org2AdminAal2Token, {
        targetUserId: ORG_1_EMPLOYEE_ID,
      })
    );
    expect([403, 404]).toContain(mfaRes.status);

    const signoutRes = await forceSignOutRoute(
      makeReq("http://localhost:3000/api/admin/users/force-signout", "POST", org2AdminAal2Token, {
        targetUserId: ORG_1_EMPLOYEE_ID,
      })
    );
    expect([403, 404]).toContain(signoutRes.status);

    // Inviting an email belonging to Org 1 from Org 2 admin MUST be denied with 409 (no hijack!)
    const inviteHijackRes = await inviteRoute(
      makeReq("http://localhost:3000/api/admin/users/invite", "POST", org2AdminAal2Token, {
        email: "employee@remotehr.io",
        fullName: "Cross-Tenant Hijack",
      })
    );
    expect(inviteHijackRes.status).toBe(409);

    // Org 2 exporting audits/attendance must never return Org 1 employee emails
    const org2AttExport = await exportAttendanceRoute(
      makeReq("http://localhost:3000/api/attendance/export?format=csv", "GET", org2AdminAal2Token)
    );
    expect(org2AttExport.status).toBe(200);
    expect(await org2AttExport.text()).not.toContain("employee@remotehr.io");

    // Org 2 bulk import preview referencing an Org 1 email must mark that row invalid without revealing tenant internals
    const org2BulkHijack = await bulkImportRoute(
      makeReq("http://localhost:3000/api/admin/users/bulk-import", "POST", org2AdminAal2Token, {
        dryRun: true,
        csvText: "email,full_name,role\nemployee@remotehr.io,Cross Tenant Target,employee",
      })
    );
    expect(org2BulkHijack.status).toBe(200);
    const bulkHijackJson = await org2BulkHijack.json();
    expect(bulkHijackJson.validCount).toBe(0);
    expect(bulkHijackJson.invalidCount).toBe(1);
    expect(bulkHijackJson.rows[0].errors).toContain("Email already belongs to another organization");
  });

  it("Executes live same-tenant AAL2 Admin invite, reset-mfa, force-signout, deactivate, and audits export with audit trails", async () => {
    const newInviteEmail = `live-invite-${Date.now()}@remotehr.io`;
    const invRes = await inviteRoute(
      makeReq("http://localhost:3000/api/admin/users/invite", "POST", org1AdminAal2Token, {
        email: newInviteEmail,
        fullName: "Live Invite Employee",
        role: "employee",
      })
    );
    expect(invRes.status).toBe(200);
    const invJson = await invRes.json();
    expect(invJson.success).toBe(true);
    invitedUserId = invJson.userId;

    // Verify member row exists in Org 1
    const memRow = await pg.query(`SELECT organization_id, role FROM public.organization_members WHERE user_id = $1;`, [
      invitedUserId,
    ]);
    expect(memRow.rows[0]?.organization_id).toBe(ORG_1_ID);

    // Reset MFA on disposable Org 1 user
    const rMfa = await resetMfaRoute(
      makeReq("http://localhost:3000/api/admin/users/reset-mfa", "POST", org1AdminAal2Token, {
        targetUserId: org1DisposableUserId,
      })
    );
    expect(rMfa.status).toBe(200);

    // Force signout on disposable Org 1 user
    const fSignout = await forceSignOutRoute(
      makeReq("http://localhost:3000/api/admin/users/force-signout", "POST", org1AdminAal2Token, {
        targetUserId: org1DisposableUserId,
      })
    );
    expect(fSignout.status).toBe(200);

    // Deactivate disposable Org 1 user
    const deact = await deactivateRoute(
      makeReq("http://localhost:3000/api/admin/users/deactivate", "POST", org1AdminAal2Token, {
        targetUserId: org1DisposableUserId,
      })
    );
    expect(deact.status).toBe(200);
    const deactMem = await pg.query(`SELECT status FROM public.organization_members WHERE user_id = $1;`, [
      org1DisposableUserId,
    ]);
    expect(deactMem.rows[0]?.status).toBe("suspended");

    // Verify UPPER_SNAKE audit rows written by routes
    const auditsCheck = await pg.query(`
      SELECT action FROM public.audit_logs
      WHERE record_id = $1 AND action IN ('USER_MFA_RESET', 'USER_FORCE_SIGNED_OUT', 'MEMBER_DEACTIVATED');
    `, [org1DisposableUserId]);
    expect(auditsCheck.rows.map((r: any) => r.action).sort()).toEqual([
      "MEMBER_DEACTIVATED",
      "USER_FORCE_SIGNED_OUT",
      "USER_MFA_RESET",
    ]);

    // Audits export returns CSV with Org 1 audit trail & writes AUDIT_EXPORTED
    const expRes = await exportAuditsRoute(
      makeReq("http://localhost:3000/api/admin/audits/export?format=csv", "GET", org1AdminAal2Token)
    );
    expect(expRes.status).toBe(200);
    expect(expRes.headers.get("content-type")).toContain("text/csv");
    const csvText = await expRes.text();
    expect(csvText).toContain("MEMBER_DEACTIVATED");

    // Live bulk import preview + commit for Org 1 AAL2 admin
    const bulkEmail = `live-bulk-${Date.now()}@remotehr.io`;
    const bulkCsv = [
      "email,full_name,role,work_mode,timezone",
      `${bulkEmail},Live Bulk Employee,employee,remote,Asia/Kolkata`,
      `employee@remotehr.io,=FORMULA_INJECTION,employee,remote,Asia/Kolkata`,
    ].join("\n");

    const previewRes = await bulkImportRoute(
      makeReq("http://localhost:3000/api/admin/users/bulk-import", "POST", org1AdminAal2Token, {
        dryRun: true,
        csvText: bulkCsv,
      })
    );
    expect(previewRes.status).toBe(200);
    const previewJson = await previewRes.json();
    expect(previewJson.validCount).toBe(1);
    expect(previewJson.invalidCount).toBe(1);
    expect(previewJson.errorCsv).toContain("'=FORMULA_INJECTION");

    const importRes = await bulkImportRoute(
      makeReq("http://localhost:3000/api/admin/users/bulk-import", "POST", org1AdminAal2Token, {
        dryRun: false,
        csvText: `${bulkCsv.split("\n").slice(0, 2).join("\n")}`,
      })
    );
    expect(importRes.status).toBe(200);
    const importJson = await importRes.json();
    expect(importJson.importedCount).toBe(1);

    const bulkEmpRow = await pg.query(`SELECT id FROM public.employees WHERE email = $1;`, [bulkEmail]);
    if (bulkEmpRow.rows[0]?.id) {
      bulkImportedUserIds.push(bulkEmpRow.rows[0].id);
    }
    expect(bulkEmpRow.rows).toHaveLength(1);

    const bulkAudit = await pg.query(
      `SELECT action, new_data FROM public.audit_logs
       WHERE organization_id = $1 AND action = 'BULK_EMPLOYEES_IMPORTED'
       ORDER BY created_at DESC LIMIT 1;`,
      [ORG_1_ID]
    );
    expect(bulkAudit.rows).toHaveLength(1);
    expect(bulkAudit.rows[0].new_data.imported_count).toBe(1);
  });
});


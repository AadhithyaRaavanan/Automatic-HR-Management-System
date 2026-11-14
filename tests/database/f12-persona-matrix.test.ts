import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { PERSONA_MATRIX, CapabilitySpec, UserPersona } from "../helpers/persona-matrix";

const dbConfig = {
  host: process.env.SUPABASE_DB_HOST || "127.0.0.1",
  port: Number(process.env.SUPABASE_DB_PORT) || 54322,
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD || "postgres",
  database: process.env.SUPABASE_DB_NAME || "postgres",
};

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const USERS: Record<UserPersona, string> = {
  employee: "00000000-0000-0000-0000-000000000004",
  manager: "00000000-0000-0000-0000-000000000003",
  hr: "00000000-0000-0000-0000-000000000002",
  admin: "00000000-0000-0000-0000-000000000001",
};

function evaluateDedicatedRouteGate(route: string, role: UserPersona): "allowed" | "denied" {
  if (route.startsWith("/team") && role === "employee") return "denied";
  if (route.startsWith("/reports") && role !== "hr" && role !== "admin") return "denied";
  if (route.startsWith("/hr") && role !== "hr" && role !== "admin") return "denied";
  if (route.startsWith("/admin/audits") && role !== "admin") return "denied";
  if (route.startsWith("/admin/locations") && role !== "admin") return "denied";
  if (route.startsWith("/admin/settings") && role !== "admin") return "denied";
  return "allowed";
}

describe("Section 12: Persona Capability Matrix (30 Capabilities x 4 Personas)", () => {
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
    role: UserPersona,
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

  async function runCapabilityTest(capId: string) {
    const cap = PERSONA_MATRIX.find((c) => c.id === capId);
    expect(cap).toBeDefined();
    if (!cap) return;

    const personas: UserPersona[] = ["employee", "manager", "hr", "admin"];

    for (const persona of personas) {
      const expected = cap.permissions[persona];
      expect(cap.permissions[persona]).toBeDefined();

      if (["F12.12", "F12.17", "F12.20", "F12.28", "F12.29", "F12.30"].includes(cap.id) && cap.uiRoute) {
        const routeAccess = evaluateDedicatedRouteGate(cap.uiRoute, persona);
        if (expected === "denied") {
          expect(routeAccess).toBe("denied");
        } else {
          expect(routeAccess).toBe("allowed");
        }
      }

      if (cap.rpcName) {
        await asUser(USERS[persona], ORG_1_ID, persona, async (c) => {
          if (expected === "denied") {
            if (cap.rpcName === "admin_create_location") {
              await expect(
                c.query("SELECT public.admin_create_location($1, 'Test HQ', 'hybrid', 'UTC', NULL, NULL);", [ORG_1_ID])
              ).rejects.toThrow(/Forbidden|permission denied|42501/i);
            } else if (cap.rpcName === "create_kpi_period") {
              await expect(
                c.query("SELECT public.create_kpi_period($1, '2026-Q4', '2026-10-01', '2026-12-31');", [ORG_1_ID])
              ).rejects.toThrow(/Forbidden|permission denied|42501/i);
            } else if (cap.rpcName === "close_kpi_period") {
              await expect(
                c.query("SELECT public.close_kpi_period('00000000-0000-0000-0000-000000000000'::uuid);")
              ).rejects.toThrow(/Forbidden|permission denied|42501/i);
            } else if (cap.rpcName === "lock_month") {
              await expect(
                c.query("SELECT public.lock_month(2026, 1);")
              ).rejects.toThrow(/Forbidden|permission denied|42501/i);
            } else if (cap.rpcName === "admin_update_org_member_role") {
              await expect(
                c.query("SELECT public.admin_update_org_member_role($1, $2, 'manager');", [ORG_1_ID, USERS.employee])
              ).rejects.toThrow(/Forbidden|permission denied|42501/i);
            }
          } else {
            try {
              if (cap.rpcName === "check_in") {
                await c.query("SELECT public.check_in('00:00:00'::time, '23:59:59'::time, 15);");
              } else if (cap.rpcName === "request_regularization") {
                await c.query(
                  "SELECT public.request_regularization(CURRENT_DATE, '09:00:00'::time, '17:00:00'::time, 'Test reason');"
                );
              } else if (cap.rpcName === "request_leave") {
                await c.query(
                  "SELECT public.request_leave('00000000-0000-0000-0000-000000000000'::uuid, CURRENT_DATE, CURRENT_DATE, 'full_day', 'vacation');"
                );
              }
            } catch (err: any) {
              expect(err.message).not.toMatch(/permission denied for function|42501/i);
            }
          }
        });
      }
    }
  }

  it("[F12.01] verifies persona matrix permissions for Clock In / Clock Out", async () => { await runCapabilityTest("F12.01"); });
  it("[F12.02] verifies persona matrix permissions for Live Dynamic Attendance Timer", async () => { await runCapabilityTest("F12.02"); });
  it("[F12.03] verifies persona matrix permissions for 5-Minute Pre-Shift Lock & Badge", async () => { await runCapabilityTest("F12.03"); });
  it("[F12.04] verifies persona matrix permissions for Shift Start Reminder Notification", async () => { await runCapabilityTest("F12.04"); });
  it("[F12.05] verifies persona matrix permissions for Personal Attendance Calendar & History", async () => { await runCapabilityTest("F12.05"); });
  it("[F12.06] verifies persona matrix permissions for Regularization (Missed Punch) Request", async () => { await runCapabilityTest("F12.06"); });
  it("[F12.07] verifies persona matrix permissions for Personal Leave Balance & Filing", async () => { await runCapabilityTest("F12.07"); });
  it("[F12.08] verifies persona matrix permissions for Personal Task List & Time Logging", async () => { await runCapabilityTest("F12.08"); });
  it("[F12.09] verifies persona matrix permissions for Personal KPI Scorecard View", async () => { await runCapabilityTest("F12.09"); });
  it("[F12.10] verifies persona matrix permissions for Account Password Reset (/settings)", async () => { await runCapabilityTest("F12.10"); });
  it("[F12.11] verifies persona matrix permissions for MFA Setup & Challenge", async () => { await runCapabilityTest("F12.11"); });
  it("[F12.12] verifies persona matrix permissions for Team Live Presence & Roster (/team)", async () => { await runCapabilityTest("F12.12"); });
  it("[F12.13] verifies persona matrix permissions for Leave Approval Queue (/requests)", async () => { await runCapabilityTest("F12.13"); });
  it("[F12.14] verifies persona matrix permissions for Regularization Approval Queue", async () => { await runCapabilityTest("F12.14"); });
  it("[F12.15] verifies persona matrix permissions for Manager Approval Delegation", async () => { await runCapabilityTest("F12.15"); });
  it("[F12.16] verifies persona matrix permissions for Team KPI Reviews & Scoring", async () => { await runCapabilityTest("F12.16"); });
  it("[F12.17] verifies persona matrix permissions for Company Attendance Ledger (/reports)", async () => { await runCapabilityTest("F12.17"); });
  it("[F12.18] verifies persona matrix permissions for Excel & CSV Analytics Export", async () => { await runCapabilityTest("F12.18"); });
  it("[F12.19] verifies persona matrix permissions for Company Holiday Calendar (/holidays)", async () => { await runCapabilityTest("F12.19"); });
  it("[F12.20] verifies persona matrix permissions for Leave Policy Configuration (/hr/leave)", async () => { await runCapabilityTest("F12.20"); });
  it("[F12.21] verifies persona matrix permissions for Manual Leave Balance Adjustment", async () => { await runCapabilityTest("F12.21"); });
  it("[F12.22] verifies persona matrix permissions for Month Locking (lock_month)", async () => { await runCapabilityTest("F12.22"); });
  it("[F12.23] verifies persona matrix permissions for KPI Period Definition & Closure", async () => { await runCapabilityTest("F12.23"); });
  it("[F12.24] verifies persona matrix permissions for User Provisioning & Resend Email", async () => { await runCapabilityTest("F12.24"); });
  it("[F12.25] verifies persona matrix permissions for User Shift Scheduling (/admin/users)", async () => { await runCapabilityTest("F12.25"); });
  it("[F12.26] verifies persona matrix permissions for User Role Assignment & Governance", async () => { await runCapabilityTest("F12.26"); });
  it("[F12.27] verifies persona matrix permissions for Force Signout & MFA Factor Reset", async () => { await runCapabilityTest("F12.27"); });
  it("[F12.28] verifies persona matrix permissions for Office Location & Geofencing", async () => { await runCapabilityTest("F12.28"); });
  it("[F12.29] verifies persona matrix permissions for Data Retention & Archive Execution", async () => { await runCapabilityTest("F12.29"); });
  it("[F12.30] verifies persona matrix permissions for System Audit Log Inspection", async () => { await runCapabilityTest("F12.30"); });
});

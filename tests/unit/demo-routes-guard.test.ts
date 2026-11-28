import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { GET as demoStateGet, POST as demoStatePost } from "@/app/api/demo/state/route";
import { POST as demoTotpPost } from "@/app/api/auth/demo-totp/route";
import { GET as attendanceExportGet } from "@/app/api/attendance/export/route";
import {
  assertAllowedTestOrigin,
  getAllowedTestBaseUrl,
  getAllowedTestSupabaseUrl,
  sendAllowedTestApiRequest,
} from "../helpers/auth";

describe("Section 0a: Demo Routes & Production Exclusion Guards", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("isDemoModeEnabled & /api/auth/demo-totp guard", () => {
    it("returns true when NEXT_PUBLIC_DEMO_MODE === 'true'", async () => {
      process.env.NEXT_PUBLIC_DEMO_MODE = "true";
      expect(isDemoModeEnabled()).toBe(true);

      const req = new NextRequest("http://localhost:3000/api/auth/demo-totp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" }),
      });
      const res = await demoTotpPost(req);
      expect(res.status).toBe(200);
    });

    it("returns false & HTTP 404 when NEXT_PUBLIC_DEMO_MODE is unset or 'false'", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";
      process.env.NEXT_PUBLIC_DEMO_MODE = "false";

      expect(isDemoModeEnabled()).toBe(false);

      const req = new NextRequest("http://localhost:3000/api/auth/demo-totp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" }),
      });
      const res = await demoTotpPost(req);
      expect(res.status).toBe(404);
    });

    it("returns true & HTTP 200 TOTP code ONLY when NEXT_PUBLIC_DEMO_MODE=true and NODE_ENV !== 'production'", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";
      process.env.NEXT_PUBLIC_DEMO_MODE = "true";

      expect(isDemoModeEnabled()).toBe(true);

      const req = new NextRequest("http://localhost:3000/api/auth/demo-totp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" }),
      });
      const res = await demoTotpPost(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toMatch(/^\d{6}$/);
    });
  });

  describe("/api/attendance/export authorization & spreadsheet sanitization", () => {
    function setupCaller(opts: {
      authenticated: boolean;
      role?: "employee" | "hr" | "admin";
      aal?: "aal1" | "aal2";
    }) {
      if (!opts.authenticated) {
        (createServerClient as any).mockReturnValue({
          auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Unauth") }),
          },
        });
        return;
      }

      const orgId = "00000000-0000-0000-0000-000000000001";
      const callerId = "00000000-0000-0000-0000-000000000002";

      (createServerClient as any).mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: callerId, email: "hr@remotehr.io" } },
            error: null,
          }),
          getClaims: vi.fn().mockResolvedValue({
            data: { claims: { aal: opts.aal || "aal2" } },
            error: null,
          }),
        },
      });

      (supabaseAdmin.from as any).mockImplementation((table: string) => {
        if (table === "organization_members") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                organization_id: orgId,
                role: opts.role || "hr",
                status: "active",
                organizations: { status: "active" },
              },
              error: null,
            }),
          };
        }
        if (table === "attendance_days") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "day-1",
                  work_date: "2026-11-02",
                  status: "present",
                  total_minutes: 480,
                  overtime_minutes: 0,
                  is_late: false,
                  locked: false,
                  employees: {
                    full_name: "=CMD('calc')",
                    email: "+evil@example.com",
                  },
                },
              ],
              error: null,
            }),
          };
        }
        if (table === "audit_logs") {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });
    }

    it("returns 401 when unauthenticated", async () => {
      setupCaller({ authenticated: false });
      const res = await attendanceExportGet(
        new NextRequest("http://localhost:3000/api/attendance/export?format=csv")
      );
      expect(res.status).toBe(401);
    });

    it("returns 403 for employee or aal1 HR", async () => {
      setupCaller({ authenticated: true, role: "employee", aal: "aal1" });
      expect(
        (await attendanceExportGet(new NextRequest("http://localhost:3000/api/attendance/export?format=csv"))).status
      ).toBe(403);

      setupCaller({ authenticated: true, role: "hr", aal: "aal1" });
      expect(
        (await attendanceExportGet(new NextRequest("http://localhost:3000/api/attendance/export?format=csv"))).status
      ).toBe(403);
    });

    it("exports real DB rows with CSV formula-injection escaping for aal2 HR", async () => {
      setupCaller({ authenticated: true, role: "hr", aal: "aal2" });
      const res = await attendanceExportGet(
        new NextRequest("http://localhost:3000/api/attendance/export?format=csv&month=2026-11")
      );
      expect(res.status).toBe(200);
      const csv = await res.text();
      expect(csv).toContain("'=CMD('calc')");
      expect(csv).toContain("'+evil@example.com");
      expect(csv).not.toContain("employee_id_mock");
    });
  });

  describe("Opt-in demo flag, /api/demo/state shutdown, and test origin allowlist", () => {
    it("leaves demo mode and /api/demo/state disabled in production & dev when flag is unset", async () => {
      delete process.env.NEXT_PUBLIC_DEMO_MODE;
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      expect(isDemoModeEnabled()).toBe(false);

      const getRes = await demoStateGet();
      expect(getRes.status).toBe(404);
      const postRes = await demoStatePost(
        new NextRequest("http://127.0.0.1:3000/api/demo/state", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ departments: [{ name: "Fake" }] }),
        })
      );
      expect(postRes.status).toBe(404);

      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      expect(isDemoModeEnabled()).toBe(false);
    });

    it("blocks hardcoded production origins before credentials or approval requests are sent and supports isolated local origins", async () => {
      expect(() =>
        assertAllowedTestOrigin("https://pulse.zenxea.com/api/leave/review", "approval test")
      ).toThrow(/Blocked disallowed non-test origin/);
      expect(() =>
        assertAllowedTestOrigin("https://bycyebxvxhmhelrvglvf.supabase.co", "fixture write")
      ).toThrow(/Blocked disallowed non-test origin/);

      process.env.PLAYWRIGHT_TEST_BASE_URL = "https://pulse.zenxea.com";
      expect(() => getAllowedTestBaseUrl()).toThrow(/Blocked disallowed non-test origin/);

      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bycyebxvxhmhelrvglvf.supabase.co";
      expect(() => getAllowedTestSupabaseUrl()).toThrow(/Blocked disallowed non-test origin/);

      await expect(
        sendAllowedTestApiRequest("https://pulse.zenxea.com/api/requests/review", { method: "POST" })
      ).rejects.toThrow(/Blocked disallowed non-test origin/);

      // Isolated local origin 1
      process.env.PLAYWRIGHT_TEST_BASE_URL = "http://127.0.0.1:3101";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      expect(getAllowedTestBaseUrl()).toBe("http://127.0.0.1:3101");
      expect(getAllowedTestSupabaseUrl()).toBe("http://127.0.0.1:54321");

      // Isolated local origin 2
      process.env.PLAYWRIGHT_TEST_BASE_URL = "http://localhost:3102";
      expect(getAllowedTestBaseUrl()).toBe("http://localhost:3102");
    });
  });
});


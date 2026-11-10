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
import { POST as demoTotpPost } from "@/app/api/auth/demo-totp/route";
import { GET as attendanceExportGet } from "@/app/api/attendance/export/route";

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
    it("returns false & HTTP 404 when NODE_ENV === 'production' even if NEXT_PUBLIC_DEMO_MODE === 'true'", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.NEXT_PUBLIC_DEMO_MODE = "true";

      expect(isDemoModeEnabled()).toBe(false);

      const req = new NextRequest("http://localhost:3000/api/auth/demo-totp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" }),
      });
      const res = await demoTotpPost(req);
      expect(res.status).toBe(404);
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
});


import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock server-only modules
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      admin: {
        inviteUserByEmail: vi.fn(),
        listUsers: vi.fn(),
        updateUserById: vi.fn(),
        signOut: vi.fn(),
        mfa: {
          listFactors: vi.fn(),
          deleteFactor: vi.fn(),
        },
      },
    },
  },
}));

import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { POST as inviteRoute } from "@/app/api/admin/users/invite/route";
import { POST as deactivateRoute } from "@/app/api/admin/users/deactivate/route";
import { POST as resetMfaRoute } from "@/app/api/admin/users/reset-mfa/route";
import { POST as forceSignOutRoute } from "@/app/api/admin/users/force-signout/route";
import { GET as exportAuditsRoute } from "@/app/api/admin/audits/export/route";

describe("Phase 3 Admin User & Audit API Route Guards", () => {
  const callerOrgId = "00000000-0000-0000-0000-000000000001";
  const foreignOrgId = "00000000-0000-0000-0000-000000000002";
  const targetUserId = "target-user-001";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupAuthCaller(options: {
    authenticated: boolean;
    role?: "employee" | "manager" | "hr" | "admin";
    aal?: "aal1" | "aal2";
    appMetadataAal?: "aal1" | "aal2";
    orgId?: string;
  }) {
    if (!options.authenticated) {
      (createServerClient as any).mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Not logged in") }),
        },
      });
      return;
    }

    const callerId = "caller-user-id";
    (createServerClient as any).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: callerId,
              email: "caller@remotehr.io",
              app_metadata: { aal: options.appMetadataAal ?? options.aal ?? "aal2" },
            },
          },
          error: null,
        }),
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: {
              aal: options.aal || "aal2",
            },
          },
          error: null,
        }),
        mfa: {
          getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
            data: { currentLevel: options.aal || "aal2" },
            error: null,
          }),
        },
      },
    });

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === "organization_members") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((col: string, val: string) => {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockImplementation(async () => {
                if (col === "user_id" && val === callerId) {
                  return {
                    data: {
                      organization_id: options.orgId || callerOrgId,
                      role: options.role || "admin",
                      status: "active",
                    },
                    error: null,
                  };
                }
                // Target user lookup
                if (val === targetUserId) {
                  // Belongs to callerOrgId only
                  if (options.orgId === foreignOrgId) {
                    // Foreign admin does not see target in their org
                    return { data: null, error: null };
                  }
                  return {
                    data: {
                      organization_id: callerOrgId,
                      role: "employee",
                      status: "active",
                    },
                    error: null,
                  };
                }
                return { data: null, error: null };
              }),
            };
          }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              organization_id: options.orgId || callerOrgId,
              role: options.role || "admin",
              status: "active",
            },
            error: null,
          }),
        };
      }

      if (table === "audit_logs") {
        return {
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [
              {
                id: "log-1",
                actor_id: callerId,
                action: "TEST_ACTION",
                table_name: "test",
                record_id: "rec-1",
                old_data: null,
                new_data: { ok: true },
                created_at: new Date().toISOString(),
              },
            ],
            error: null,
          }),
        };
      }

      return {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });
  }

  const routes = [
    {
      name: "deactivate",
      handler: (req: NextRequest) => deactivateRoute(req),
      method: "POST",
      url: "http://localhost:3000/api/admin/users/deactivate",
      body: { targetUserId },
    },
    {
      name: "reset-mfa",
      handler: (req: NextRequest) => resetMfaRoute(req),
      method: "POST",
      url: "http://localhost:3000/api/admin/users/reset-mfa",
      body: { targetUserId },
    },
    {
      name: "force-signout",
      handler: (req: NextRequest) => forceSignOutRoute(req),
      method: "POST",
      url: "http://localhost:3000/api/admin/users/force-signout",
      body: { targetUserId },
    },
    {
      name: "audits/export",
      handler: (req: NextRequest) => exportAuditsRoute(req),
      method: "GET",
      url: "http://localhost:3000/api/admin/audits/export?format=csv",
      body: null,
    },
  ];

  for (const route of routes) {
    describe(`Route: ${route.name}`, () => {
      it("denies unauthenticated caller with HTTP 401", async () => {
        setupAuthCaller({ authenticated: false });
        const req = new NextRequest(route.url, {
          method: route.method,
          headers: { "content-type": "application/json" },
          body: route.body ? JSON.stringify(route.body) : undefined,
        });
        const res = await route.handler(req);
        expect(res.status).toBe(401);
      });

      it("denies standard employee caller with HTTP 403", async () => {
        setupAuthCaller({ authenticated: true, role: "employee", aal: "aal1" });
        const req = new NextRequest(route.url, {
          method: route.method,
          headers: { "content-type": "application/json" },
          body: route.body ? JSON.stringify(route.body) : undefined,
        });
        const res = await route.handler(req);
        expect(res.status).toBe(403);
      });

      it("denies an aal1 admin with HTTP 403", async () => {
        setupAuthCaller({ authenticated: true, role: "admin", aal: "aal1" });
        const req = new NextRequest(route.url, {
          method: route.method,
          headers: { "content-type": "application/json" },
          body: route.body ? JSON.stringify(route.body) : undefined,
        });
        const res = await route.handler(req);
        expect(res.status).toBe(403);
      });

      it("denies admin when user.app_metadata.aal is spoofed to aal2 but verified claims/assurance is aal1", async () => {
        setupAuthCaller({
          authenticated: true,
          role: "admin",
          aal: "aal1",
          appMetadataAal: "aal2",
        });
        const req = new NextRequest(route.url, {
          method: route.method,
          headers: { "content-type": "application/json" },
          body: route.body ? JSON.stringify(route.body) : undefined,
        });
        const res = await route.handler(req);
        expect(res.status).toBe(403);
      });

      if (route.body && "targetUserId" in route.body) {
        it("denies an admin from another organization targeting this org's user (cross-tenant)", async () => {
          setupAuthCaller({ authenticated: true, role: "admin", aal: "aal2", orgId: foreignOrgId });
          const req = new NextRequest(route.url, {
            method: route.method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(route.body),
          });
          const res = await route.handler(req);
          expect([403, 404]).toContain(res.status);
        });
      }
    });
  }

  describe("Route: invite", () => {
    it("denies unauthenticated caller with HTTP 401", async () => {
      setupAuthCaller({ authenticated: false });
      const req = new NextRequest("http://localhost:3000/api/admin/users/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new@remotehr.io", fullName: "New Member" }),
      });
      const res = await inviteRoute(req);
      expect(res.status).toBe(401);
    });

    it("denies employee caller with HTTP 403", async () => {
      setupAuthCaller({ authenticated: true, role: "employee", aal: "aal1" });
      const req = new NextRequest("http://localhost:3000/api/admin/users/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new@remotehr.io", fullName: "New Member" }),
      });
      const res = await inviteRoute(req);
      expect(res.status).toBe(403);
    });

    it("denies aal1 admin caller with HTTP 403", async () => {
      setupAuthCaller({ authenticated: true, role: "admin", aal: "aal1" });
      const req = new NextRequest("http://localhost:3000/api/admin/users/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new@remotehr.io", fullName: "New Member" }),
      });
      const res = await inviteRoute(req);
      expect(res.status).toBe(403);
    });
  });
});


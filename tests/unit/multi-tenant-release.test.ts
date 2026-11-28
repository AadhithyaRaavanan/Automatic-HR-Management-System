import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockState = vi.hoisted(() => ({
  user: null as any,
  memberships: [] as any[],
  employeeRow: null as any,
  onbRow: null as any,
  aal: "aal1" as string,
  targetEmp: null as any,
  targetMember: null as any,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mockState.user }, error: null })),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({
          data: { currentLevel: mockState.aal },
        })),
      },
    },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: vi.fn(() => true),
  getAdminClient: vi.fn(() => mockAdminClient),
  supabaseAdmin: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mockState.user }, error: null })),
    },
    from: vi.fn((table: string) => buildQuery(table)),
  },
}));

const mockAdminClient = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: mockState.user }, error: null })),
  },
  from: vi.fn((table: string) => buildQuery(table)),
};

function buildQuery(table: string) {
  const filters: Record<string, any> = {};
  const q: any = {
    select: vi.fn(() => q),
    eq: vi.fn((col: string, val: any) => {
      filters[col] = val;
      return q;
    }),
    in: vi.fn(() => q),
    order: vi.fn(() => q),
    maybeSingle: vi.fn(async () => {
      if (table === "employees") {
        if (filters.id && filters.id !== mockState.user?.id) {
          return { data: mockState.targetEmp, error: null };
        }
        return { data: mockState.employeeRow, error: null };
      }
      if (table === "organization_members") {
        if (filters.user_id && filters.user_id !== mockState.user?.id) {
          return { data: mockState.targetMember, error: null };
        }
        const match = mockState.memberships.find(
          (m) =>
            (!filters.organization_id || m.organization_id === filters.organization_id) &&
            (!filters.status || "active" === filters.status)
        );
        return { data: match || null, error: null };
      }
      if (table === "onboarding_profiles") {
        return { data: mockState.onbRow, error: null };
      }
      return { data: null, error: null };
    }),
    then: (resolve: any) => {
      if (table === "organization_members") {
        return Promise.resolve({ data: mockState.memberships, error: null }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
  };
  return q;
}

import {
  resolveTenantCaller,
  verifyTargetEmployeeInOrg,
  requireCronAuthorization,
  ORG_SELECTION_COOKIE,
} from "@/features/auth/tenant-context";
import {
  createRecoveryProof,
  verifyRecoveryProof,
} from "@/features/auth/mfa-recovery-store";
import { isSmtpTransportConfigured } from "@/lib/email/resend";

describe("Per-Tenant Release Hardening Tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mockState.user = {
      id: "11111111-1111-1111-1111-111111111111",
      email: "alex@org-a.example",
      app_metadata: {},
      user_metadata: { role: "admin", organization_id: "99999999-9999-9999-9999-999999999999" },
    };
    mockState.memberships = [
      {
        organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        role: "employee",
        department_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        organizations: { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Org Alpha", status: "active", timezone: "Asia/Kolkata", require_mfa_for_privileged: true },
      },
    ];
    mockState.employeeRow = {
      id: "11111111-1111-1111-1111-111111111111",
      organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      status: "active",
      onboarding_completed: true,
      department_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      timezone: "Asia/Kolkata",
    };
    mockState.onbRow = { status: "approved" };
    mockState.aal = "aal1";
    mockState.targetEmp = null;
    mockState.targetMember = null;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("ignores user_metadata role/organization_id spoofing in resolveTenantCaller", async () => {
    const req = new NextRequest("http://localhost:3000/api/employees");
    const res = await resolveTenantCaller(req);
    expect("context" in res).toBe(true);
    if ("context" in res) {
      expect(res.context.role).toBe("employee");
      expect(res.context.organizationId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    }
  });

  it("returns 409 ORG_SELECTION_REQUIRED when multi-org caller omits selection and honors explicit cookie when present", async () => {
    mockState.memberships = [
      {
        organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        role: "employee",
        organizations: { name: "Org Alpha", status: "active" },
      },
      {
        organization_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        role: "manager",
        organizations: { name: "Org Beta", status: "active" },
      },
    ];

    const noSelectionReq = new NextRequest("http://localhost:3000/api/leave");
    const conflict = await resolveTenantCaller(noSelectionReq);
    expect("response" in conflict).toBe(true);
    if ("response" in conflict) {
      expect(conflict.response.status).toBe(409);
      const body = await conflict.response.json();
      expect(body.code).toBe("ORG_SELECTION_REQUIRED");
      expect(body.organizations).toHaveLength(2);
    }

    const betaReq = new NextRequest("http://localhost:3000/api/leave", {
      headers: { cookie: `${ORG_SELECTION_COOKIE}=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb` },
    });
    const ok = await resolveTenantCaller(betaReq);
    expect("context" in ok).toBe(true);
    if ("context" in ok) {
      expect(ok.context.organizationId).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
      expect(ok.context.role).toBe("manager");
    }
  });

  it("rejects non-member org header/cookie selection with 403", async () => {
    const req = new NextRequest("http://localhost:3000/api/leave", {
      headers: { "x-organization-id": "cccccccc-cccc-cccc-cccc-cccccccccccc" },
    });
    const res = await resolveTenantCaller(req);
    expect("response" in res).toBe(true);
    if ("response" in res) {
      expect(res.response.status).toBe(403);
    }
  });

  it("verifyTargetEmployeeInOrg fails closed for cross-tenant targets and honors manager scoping", async () => {
    const context = {
      userId: "11111111-1111-1111-1111-111111111111",
      organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      role: "hr" as const,
    };
    const denied = await verifyTargetEmployeeInOrg(context, "22222222-2222-2222-2222-222222222222");
    expect(denied.allowed).toBe(false);

    mockState.targetEmp = {
      id: "22222222-2222-2222-2222-222222222222",
      organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      manager_id: "99999999-9999-9999-9999-999999999999",
      department_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    };
    const mgrDenied = await verifyTargetEmployeeInOrg(
      { ...context, role: "manager", departmentId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" },
      "22222222-2222-2222-2222-222222222222",
      { managerScoped: true }
    );
    expect(mgrDenied.allowed).toBe(false);
  });

  it("enforces fail-closed CRON_SECRET authorization even when unset", () => {
    delete process.env.CRON_SECRET;
    const unconfigured = requireCronAuthorization(new NextRequest("http://localhost:3000/api/cron/leave-accrual"));
    expect(unconfigured?.status).toBe(503);

    process.env.CRON_SECRET = "super-secret-cron-token";
    const unauthorized = requireCronAuthorization(
      new NextRequest("http://localhost:3000/api/cron/leave-accrual", {
        headers: { authorization: "Bearer wrong" },
      })
    );
    expect(unauthorized?.status).toBe(401);

    const authorized = requireCronAuthorization(
      new NextRequest("http://localhost:3000/api/cron/leave-accrual", {
        headers: { authorization: "Bearer super-secret-cron-token" },
      })
    );
    expect(authorized).toBeNull();
  });

  it("binds MFA recovery proof strictly to its purpose", () => {
    const { proofToken } = createRecoveryProof("user-1", "123456", 60_000, "mfa_recovery");
    expect(verifyRecoveryProof("user-1", "123456", proofToken, "password_reset")).toBe(false);
    expect(verifyRecoveryProof("user-1", "123456", proofToken, "mfa_recovery")).toBe(true);
  });

  it("supports local Mailpit SMTP without credentials while rejecting unauthenticated external SMTP hosts", () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_ALLOW_UNAUTHENTICATED;

    process.env.SMTP_HOST = "smtp.hostinger.com";
    expect(isSmtpTransportConfigured()).toBe(false);

    process.env.SMTP_HOST = "127.0.0.1";
    expect(isSmtpTransportConfigured()).toBe(true);
  });
});

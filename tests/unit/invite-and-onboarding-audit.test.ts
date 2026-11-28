import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockRevalidatePath = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Invariant: static generation store missing");
  })
);

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

const mockVerifyAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/admin-guard", () => ({
  verifyAdminRouteCaller: mockVerifyAdmin,
}));

vi.mock("@/lib/supabase/admin-config", () => ({
  getSupabaseAdminConfigError: vi.fn(() => null),
}));

vi.mock("@/lib/email/resend", () => ({
  sendWelcomeCredentialsEmail: vi.fn(async () => ({ success: false })),
  sendOnboardingSubmittedEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/features/notifications/recipients", () => ({
  getHrUsers: vi.fn(async () => []),
}));

vi.mock("@/features/notifications/notify", () => ({
  notify: vi.fn(async () => {}),
}));

const mockAuthAdmin = vi.hoisted(() => ({
  generateLink: vi.fn(),
  listUsers: vi.fn(),
  updateUserById: vi.fn(),
  deleteUser: vi.fn(),
  getUser: vi.fn(),
}));

const mockDb = vi.hoisted(() => ({
  existingEmailEmployee: null as any,
  membershipsForTarget: [] as any[],
  employeeById: null as any,
  auditInserts: [] as any[],
  empUpsertRow: null as any,
}));

function buildTableMock(table: string) {
  const filters: Record<string, any> = {};
  let mode: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  let payload: any = null;

  const q: any = {
    select: vi.fn(() => q),
    eq: vi.fn((col: string, val: any) => {
      filters[col] = val;
      return q;
    }),
    ilike: vi.fn((col: string, val: any) => {
      filters[col] = val;
      return q;
    }),
    in: vi.fn(() => q),
    order: vi.fn(() => q),
    limit: vi.fn(() => q),
    insert: vi.fn((row: any) => {
      mode = "insert";
      payload = row;
      if (table === "employee_onboarding_audit") {
        mockDb.auditInserts.push(row);
      }
      return q;
    }),
    upsert: vi.fn((row: any) => {
      mode = "upsert";
      payload = row;
      if (table === "employees") {
        mockDb.empUpsertRow = row;
      }
      return q;
    }),
    update: vi.fn((row: any) => {
      mode = "update";
      payload = row;
      return q;
    }),
    delete: vi.fn(() => {
      mode = "delete";
      return q;
    }),
    maybeSingle: vi.fn(async () => {
      if (mode === "upsert" && table === "onboarding_profiles") {
        return { data: payload, error: null };
      }
      if (table === "employees") {
        if (filters.email) return { data: mockDb.existingEmailEmployee, error: null };
        return { data: mockDb.employeeById || mockDb.empUpsertRow, error: null };
      }
      if (table === "organization_members") {
        return { data: mockDb.membershipsForTarget[0] || null, error: null };
      }
      if (table === "onboarding_profiles") {
        return {
          data: {
            user_id: "user-onb-1",
            full_name: "Priya Candidate",
            dob: "1998-05-01",
            phone: "+919876543210",
            personal_email: "priya@example.com",
            current_address: "Bengaluru",
            permanent_address: "Bengaluru",
            pan_number: "ABCDE1234F",
            aadhaar_number: "123456789012",
            bank_account_holder: "Priya Candidate",
            bank_account_number: "112233445566",
            bank_ifsc: "HDFC0000123",
            bank_name: "HDFC",
            highest_qualification: "12th Standard",
            has_experience: false,
            status: "draft",
            education_details: {},
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }),
    then: (resolve: any) => {
      if (table === "organization_members" && mode === "select") {
        return Promise.resolve({ data: mockDb.membershipsForTarget, error: null }).then(resolve);
      }
      if (table === "onboarding_documents" && mode === "select") {
        return Promise.resolve({
          data: [
            { doc_type: "photo", file_name: "photo.jpg" },
            { doc_type: "resume", file_name: "resume.pdf" },
            { doc_type: "cert_12th", file_name: "12th.pdf" },
            { doc_type: "pan_card", file_name: "pan.pdf" },
            { doc_type: "aadhaar_card", file_name: "aadhaar.pdf" },
            { doc_type: "bank_proof", file_name: "bank.pdf" },
          ],
          error: null,
        }).then(resolve);
      }
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };
  return q;
}

const mockAdminClient = vi.hoisted(() => ({
  auth: {
    admin: mockAuthAdmin,
    getUser: vi.fn(async () => ({ data: { user: { id: "user-onb-1", email: "priya@example.com" } }, error: null })),
  },
  from: vi.fn((table: string) => buildTableMock(table)),
  rpc: vi.fn(async () => ({ data: { employee_number: "EMP-100" }, error: null })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(() => mockAdminClient),
  supabaseAdmin: mockAdminClient,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-onb-1", email: "priya@example.com", user_metadata: {} } },
        error: null,
      })),
    },
  })),
}));

import { inviteSingleEmployee } from "@/features/admin/invite-employee";
import { POST as invitePost } from "@/app/api/admin/users/invite/route";
import { POST as completeOnboardingPost } from "@/app/api/onboarding/complete/route";

describe("Invite security & onboarding audit org scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.existingEmailEmployee = null;
    mockDb.membershipsForTarget = [];
    mockDb.employeeById = null;
    mockDb.auditInserts = [];
    mockDb.empUpsertRow = null;
  });

  it("rejects cross-tenant invite with 409 before mutating auth user metadata or password", async () => {
    mockAuthAdmin.generateLink.mockResolvedValueOnce({
      data: null,
      error: { message: "User already registered" },
    });
    mockAuthAdmin.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: "org1-emp-id", email: "employee@remotehr.io" }] },
      error: null,
    });
    mockDb.membershipsForTarget = [{ organization_id: "org-1", role: "employee", status: "active" }];

    const res = await inviteSingleEmployee(
      {
        userId: "org2-admin",
        organizationId: "org-2",
        role: "admin",
        aal: "aal2",
      } as any,
      {
        email: "employee@remotehr.io",
        fullName: "Cross-Tenant Hijack",
      }
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
    }
    expect(mockAuthAdmin.updateUserById).not.toHaveBeenCalled();
    expect(mockAuthAdmin.generateLink).toHaveBeenCalledTimes(1);
  });

  it("returns 200 on POST /api/admin/users/invite even when revalidatePath throws outside Next runtime", async () => {
    mockVerifyAdmin.mockResolvedValueOnce({
      context: { userId: "org1-admin", organizationId: "org-1", role: "admin", aal: "aal2" },
    });
    mockAuthAdmin.generateLink.mockResolvedValueOnce({
      data: {
        user: { id: "new-user-1", email: "mary.oconnor@example.com" },
        properties: { action_link: "https://pulse.zenxea.com/auth/confirm" },
      },
      error: null,
    });
    mockAuthAdmin.updateUserById.mockResolvedValueOnce({ error: null });
    mockDb.empUpsertRow = { id: "new-user-1", organization_id: "org-1", full_name: "Mary-Jane O'Connor" };

    const req = new NextRequest("http://localhost:3000/api/admin/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "mary.oconnor@example.com",
        fullName: "Mary-Jane O'Connor",
        role: "employee",
      }),
    });

    const res = await invitePost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRevalidatePath).toHaveBeenCalled();
  });

  it("records organization_id on employee_onboarding_audit during onboarding completion using selected org and rejects ambiguous/forged orgs", async () => {
    const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    mockDb.employeeById = { id: "user-onb-1", organization_id: ORG_A, full_name: "Priya Candidate", status: "pending" };
    mockDb.membershipsForTarget = [
      { organization_id: ORG_A, role: "employee", status: "active", organizations: { id: ORG_A, name: "Org Alpha", status: "active" } },
      { organization_id: ORG_B, role: "employee", status: "invited", organizations: { id: ORG_B, name: "Org Beta", status: "active" } },
    ];

    // 1. Ambiguous multi-membership without selection must fail 409 (never pick arbitrary limit(1))
    const conflictReq = new NextRequest("http://localhost:3000/api/onboarding/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ declaration: true }),
    });
    const conflictRes = await completeOnboardingPost(conflictReq);
    expect(conflictRes.status).toBe(409);
    expect(mockDb.auditInserts).toHaveLength(0);

    // 2. Non-member org selection must fail 403
    const forgedReq = new NextRequest("http://localhost:3000/api/onboarding/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-organization-id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
      body: JSON.stringify({ declaration: true }),
    });
    const forgedRes = await completeOnboardingPost(forgedReq);
    expect(forgedRes.status).toBe(403);

    // 3. Explicit valid organization selection stamps selected org cleanly on audit record
    const okReq = new NextRequest("http://localhost:3000/api/onboarding/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-organization-id": ORG_B,
      },
      body: JSON.stringify({ declaration: true }),
    });
    const okRes = await completeOnboardingPost(okReq);
    expect(okRes.status).toBe(200);
    expect(mockDb.auditInserts).toHaveLength(1);
    expect(mockDb.auditInserts[0].organization_id).toBe(ORG_B);
    expect(mockDb.auditInserts[0].employee_id).toBe("user-onb-1");
  });
});

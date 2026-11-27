import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { sanitizeAndDedupeAssignees } from "@/features/tasks/assignees";

vi.mock("server-only", () => ({}));

const mockRequireApprovedUser = vi.fn();
const mockGetAdminClient = vi.fn();
const mockIsSupabaseAdminConfigured = vi.fn();

vi.mock("@/features/auth/require-approved-user", () => ({
  requireApprovedUser: (...args: any[]) => mockRequireApprovedUser(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => mockGetAdminClient(),
  isSupabaseAdminConfigured: () => mockIsSupabaseAdminConfigured(),
  supabaseAdmin: {},
}));

import { GET as getTaskAssignees } from "@/app/api/tasks/assignees/route";

describe("Task Assignees sanitization & /api/tasks/assignees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes seeded placeholder members and deduplicates real members + current user", () => {
    const cleaned = sanitizeAndDedupeAssignees(
      [
        { id: "00000000-0000-0000-0000-000000000003", full_name: "Alex Morgan", email: "manager@remotehr.io", manager_id: null, status: "active", role: "manager" },
        { id: "00000000-0000-0000-0000-000000000008", full_name: "Devon Lane", email: "devon.lane@remotehr.io", manager_id: null, status: "active", role: "employee" },
        { id: "00000000-0000-0000-0000-000000000007", full_name: "Eleanor Pena", email: "eleanor.pena@remotehr.io", manager_id: null, status: "active", role: "employee" },
        { id: "00000000-0000-0000-0000-000000000004", full_name: "James Sullivan", email: "employee@remotehr.io", manager_id: null, status: "active", role: "employee" },
        { id: "00000000-0000-0000-0000-000000000006", full_name: "Ken Smith", email: "ken.smith@remotehr.io", manager_id: null, status: "active", role: "employee" },
        { id: "00000000-0000-0000-0000-000000000002", full_name: "Marcus Vance", email: "hr@remotehr.io", manager_id: null, status: "active", role: "hr" },
        { id: "00000000-0000-0000-0000-000000000005", full_name: "Rachel Lee", email: "rachel.lee@remotehr.io", manager_id: null, status: "active", role: "employee" },
        { id: "00000000-0000-0000-0000-000000000001", full_name: "Sarah Connor", email: "admin@remotehr.io", manager_id: null, status: "active", role: "admin" },
        { id: "user-self", full_name: "Riya Sharma", email: "riya@zenxea.com", manager_id: null, status: "active", role: "admin" },
        { id: "user-abc-1", full_name: "abc", email: "abc@zenxea.com", manager_id: null, status: "active", role: "employee" },
        { id: "user-abc-dup-id", full_name: "abc", email: "ABC@zenxea.com", manager_id: null, status: "active", role: "employee" },
        { id: "user-inactive", full_name: "Inactive User", email: "inactive@zenxea.com", manager_id: null, status: "inactive", role: "employee" },
      ],
      { userId: "user-self", email: "riya@zenxea.com", fullName: "Riya Sharma" }
    );

    expect(cleaned.map((m) => m.email)).toEqual(["riya@zenxea.com", "abc@zenxea.com"]);
  });

  it("scopes /api/tasks/assignees to organization_id and excludes placeholder/demo accounts", async () => {
    const orgId = "org-zenxea-1";
    const callerId = "user-self";
    const eqCalls: Array<{ table: string; col: string; val: unknown }> = [];

    const makeBuilder = (table: string, rows: any[], singleRow: any = null) => {
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn((col: string, val: unknown) => {
          eqCalls.push({ table, col, val });
          return builder;
        }),
        order: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        then: (resolve: any) => resolve({ data: rows, error: null }),
      };
      return builder;
    };

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "organization_members") {
          return makeBuilder(
            table,
            [
              { user_id: callerId, role: "admin", status: "active" },
              { user_id: "emp-abc", role: "employee", status: "active" },
            ],
            { organization_id: orgId, role: "admin", status: "active" }
          );
        }
        if (table === "employees") {
          return makeBuilder(table, [
            { id: callerId, organization_id: orgId, full_name: "Riya Sharma", email: "riya@zenxea.com", manager_id: null, status: "active" },
            { id: "emp-abc", organization_id: orgId, full_name: "abc", email: "abc@zenxea.com", manager_id: null, status: "active" },
            { id: "00000000-0000-0000-0000-000000000003", organization_id: orgId, full_name: "Alex Morgan", email: "manager@remotehr.io", manager_id: null, status: "active" },
          ]);
        }
        if (table === "user_roles") {
          return makeBuilder(table, []);
        }
        return makeBuilder(table, []);
      }),
    };

    mockIsSupabaseAdminConfigured.mockReturnValue(true);
    mockGetAdminClient.mockReturnValue(mockClient);
    mockRequireApprovedUser.mockResolvedValue({
      user: {
        id: callerId,
        email: "riya@zenxea.com",
        user_metadata: { full_name: "Riya Sharma" },
      },
      role: "admin",
      userId: callerId,
      supabase: mockClient,
    });

    const req = new NextRequest("http://localhost:3000/api/tasks/assignees");
    const res = await getTaskAssignees(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.assignees.map((a: any) => a.full_name)).toEqual(["Riya Sharma", "abc"]);
    expect(eqCalls).toContainEqual({ table: "employees", col: "organization_id", val: orgId });
  });
});

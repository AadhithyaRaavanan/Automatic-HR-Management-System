import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: any[]) => mockRevalidatePath(...args),
}));

const mockVerifyAdminRouteCaller = vi.fn();
vi.mock("@/features/auth/admin-guard", () => ({
  verifyAdminRouteCaller: (...args: any[]) => mockVerifyAdminRouteCaller(...args),
}));

const mockGetSupabaseAdminConfigError = vi.fn();
vi.mock("@/lib/supabase/admin-config", () => ({
  getSupabaseAdminConfigError: () => mockGetSupabaseAdminConfigError(),
}));

const mockGetAdminClient = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => mockGetAdminClient(),
  supabaseAdmin: {},
}));

import { DELETE as deleteEmployeeRoute } from "@/app/api/employees/[id]/route";

describe("DELETE /api/employees/[id]", () => {
  const adminId = "11111111-1111-1111-1111-111111111111";
  const targetId = "22222222-2222-2222-2222-222222222222";
  const orgId = "org-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSupabaseAdminConfigError.mockReturnValue(null);
  });

  function createMockAdminDb(targetOrgId = orgId) {
    const operations: Array<{ table: string; op: string; col?: string; val?: unknown }> = [];
    const deleteUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });

    const from = vi.fn((table: string) => {
      const makeChain = (op: string) => {
        const chain: any = {
          select: vi.fn(() => makeChain("select")),
          update: vi.fn(() => makeChain("update")),
          delete: vi.fn(() => makeChain("delete")),
          insert: vi.fn(async () => {
            operations.push({ table, op: "insert" });
            return { data: null, error: null };
          }),
          eq: vi.fn((col: string, val: unknown) => {
            operations.push({ table, op, col, val });
            return chain;
          }),
          ilike: vi.fn(() => chain),
          maybeSingle: vi.fn(async () => {
            if (table === "employees") {
              return {
                data: {
                  id: targetId,
                  organization_id: targetOrgId,
                  full_name: "abc",
                  email: "abc@zenxea.com",
                },
                error: null,
              };
            }
            if (table === "organization_members") {
              return { data: { user_id: targetId, organization_id: targetOrgId }, error: null };
            }
            return { data: null, error: null };
          }),
          then: (resolve: any) => resolve({ data: null, error: null }),
        };
        return chain;
      };
      return makeChain("init");
    });

    return {
      client: { from, auth: { admin: { deleteUser } } },
      operations,
      deleteUser,
    };
  }

  it("rejects self-deletion with 400 Bad Request", async () => {
    mockVerifyAdminRouteCaller.mockResolvedValue({
      context: { userId: targetId, organizationId: orgId, role: "admin", aal: "aal2" },
    });
    const { client, deleteUser } = createMockAdminDb(orgId);
    mockGetAdminClient.mockReturnValue(client);

    const req = new NextRequest(`http://localhost:3000/api/employees/${targetId}`, { method: "DELETE" });
    const res = await deleteEmployeeRoute(req, { params: { id: targetId } });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("rejects deleting an employee from another organization with 403", async () => {
    mockVerifyAdminRouteCaller.mockResolvedValue({
      context: { userId: adminId, organizationId: orgId, role: "admin", aal: "aal2" },
    });
    const { client, deleteUser } = createMockAdminDb("org-other");
    mockGetAdminClient.mockReturnValue(client);

    const req = new NextRequest(`http://localhost:3000/api/employees/${targetId}`, { method: "DELETE" });
    const res = await deleteEmployeeRoute(req, { params: { id: targetId } });

    expect(res.status).toBe(403);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("deletes dependent records, auth user, and revalidates workspace routes on success", async () => {
    mockVerifyAdminRouteCaller.mockResolvedValue({
      context: { userId: adminId, organizationId: orgId, role: "admin", aal: "aal2" },
    });
    const { client, operations, deleteUser } = createMockAdminDb(orgId);
    mockGetAdminClient.mockReturnValue(client);

    const req = new NextRequest(`http://localhost:3000/api/employees/${targetId}`, { method: "DELETE" });
    const res = await deleteEmployeeRoute(req, { params: { id: targetId } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, deletedUserId: targetId });
    expect(deleteUser).toHaveBeenCalledWith(targetId);
    expect(operations).toContainEqual({ table: "employees", op: "delete", col: "id", val: targetId });
    expect(operations).toContainEqual({ table: "user_roles", op: "delete", col: "user_id", val: targetId });
    expect(operations).toContainEqual({ table: "organization_members", op: "delete", col: "user_id", val: targetId });
    expect(operations).toContainEqual({ table: "profiles", op: "delete", col: "id", val: targetId });
    expect(operations).toContainEqual({ table: "tasks", op: "update", col: "assignee_id", val: targetId });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/employees");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/ems/employees");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/tasks");
  });
});

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

vi.mock("@/lib/config/demo", () => ({
  isDemoModeEnabled: () => false,
}));

vi.mock("@/lib/storage/demo-store", () => ({
  getStoredTeams: () => [],
  addStoredTeam: vi.fn(),
  updateStoredTeam: vi.fn(),
  deleteStoredTeam: vi.fn(),
  getStoredUsers: () => [],
  getStoredDepartments: () => [],
}));

import { DELETE as deleteDepartment } from "@/app/api/admin/departments/route";
import { DELETE as deleteTeam } from "@/app/api/ems/teams/route";
import { DELETE as deleteJobTitle } from "@/app/api/admin/job-titles/route";

describe("EMS Hierarchy Admin DELETE endpoints", () => {
  const adminContext = {
    userId: "admin-1",
    organizationId: "org-1",
    role: "admin",
    aal: "aal2",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSupabaseAdminConfigError.mockReturnValue(null);
    mockVerifyAdminRouteCaller.mockResolvedValue({ context: adminContext });
  });

  function createMockDb(singleLookup: Record<string, any>) {
    const ops: Array<{ table: string; op: string; payload?: any; filters: Array<[string, any]> }> = [];

    const from = vi.fn((table: string) => {
      const makeChain = (op: string, payload?: any) => {
        const filters: Array<[string, any]> = [];
        const chain: any = {
          select: vi.fn(() => makeChain("select")),
          update: vi.fn((upd: any) => makeChain("update", upd)),
          delete: vi.fn(() => makeChain("delete")),
          insert: vi.fn(async (ins: any) => {
            ops.push({ table, op: "insert", payload: ins, filters: [] });
            return { data: null, error: null };
          }),
          eq: vi.fn((col: string, val: any) => {
            filters.push([col, val]);
            return chain;
          }),
          maybeSingle: vi.fn(async () => ({
            data: singleLookup[table] ?? null,
            error: null,
          })),
          then: (resolve: any) => {
            ops.push({ table, op, payload, filters });
            return resolve({ data: null, error: null });
          },
        };
        return chain;
      };
      return makeChain("init");
    });

    return { client: { from }, ops };
  }

  it("blocks deleting protected core root department", async () => {
    const { client, ops } = createMockDb({
      departments: { id: "dept-root", name: "ZEN XEA Root", code: "ROOT", organization_id: "org-1" },
    });
    mockGetAdminClient.mockReturnValue(client);

    const req = new NextRequest("http://localhost:3000/api/admin/departments?id=dept-root", {
      method: "DELETE",
    });
    const res = await deleteDepartment(req);
    expect(res.status).toBe(400);
    expect(ops.some((o) => o.op === "delete")).toBe(false);
  });

  it("unlinks department references cleanly before deleting department and revalidating", async () => {
    const { client, ops } = createMockDb({
      departments: { id: "dept-mkt", name: "Marketing", code: "MKT", organization_id: "org-1" },
    });
    mockGetAdminClient.mockReturnValue(client);

    const req = new NextRequest("http://localhost:3000/api/admin/departments?id=dept-mkt", {
      method: "DELETE",
    });
    const res = await deleteDepartment(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, deletedId: "dept-mkt" });
    expect(ops).toContainEqual({
      table: "employees",
      op: "update",
      payload: { department_id: null },
      filters: [["department_id", "dept-mkt"], ["organization_id", "org-1"]],
    });
    expect(ops).toContainEqual({
      table: "organization_members",
      op: "update",
      payload: { department_id: null },
      filters: [["department_id", "dept-mkt"], ["organization_id", "org-1"]],
    });
    expect(ops).toContainEqual({
      table: "departments",
      op: "delete",
      payload: undefined,
      filters: [["id", "dept-mkt"], ["organization_id", "org-1"]],
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/ems/departments");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/employees");
  });

  it("deletes team_members before deleting team and revalidating", async () => {
    const { client, ops } = createMockDb({
      teams: { id: "team-1", name: "Core UI", code: "UI", organization_id: "org-1" },
    });
    mockGetAdminClient.mockReturnValue(client);

    const req = new NextRequest("http://localhost:3000/api/ems/teams?id=team-1", {
      method: "DELETE",
    });
    const res = await deleteTeam(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, deletedId: "team-1" });
    const membersIdx = ops.findIndex((o) => o.table === "team_members" && o.op === "delete");
    const teamIdx = ops.findIndex((o) => o.table === "teams" && o.op === "delete");
    expect(membersIdx).toBeGreaterThanOrEqual(0);
    expect(teamIdx).toBeGreaterThan(membersIdx);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/ems/teams");
  });

  it("clears job_title_id on employees and organization_members before deleting designation", async () => {
    const { client, ops } = createMockDb({
      job_titles: { id: "jt-1", title_name: "QA Engineer", organization_id: "org-1" },
    });
    mockGetAdminClient.mockReturnValue(client);

    const req = new NextRequest("http://localhost:3000/api/admin/job-titles?id=jt-1", {
      method: "DELETE",
    });
    const res = await deleteJobTitle(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, deletedId: "jt-1" });
    const empUnlinkIdx = ops.findIndex((o) => o.table === "employees" && o.op === "update");
    const titleDelIdx = ops.findIndex((o) => o.table === "job_titles" && o.op === "delete");
    expect(empUnlinkIdx).toBeGreaterThanOrEqual(0);
    expect(titleDelIdx).toBeGreaterThan(empUnlinkIdx);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/ems/designations");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";

vi.mock("server-only", () => ({}));

const mockRequireApproved = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/require-approved-user", () => ({
  requireApprovedUser: mockRequireApproved,
}));

const mockVerifyAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/features/auth/admin-guard", () => ({
  verifyAdminRouteCaller: mockVerifyAdmin,
}));

const mockDb = vi.hoisted(() => ({
  types: [] as any[],
  deptRow: { id: "dept-1" } as any,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const q: any = {
        select: vi.fn(() => q),
        eq: vi.fn(() => q),
        order: vi.fn(() => q),
        insert: vi.fn((row: any) => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: "tt-new", ...row }, error: null })),
          })),
        })),
        maybeSingle: vi.fn(async () => ({ data: table === "departments" ? mockDb.deptRow : null, error: null })),
        then: (resolve: any) =>
          Promise.resolve({ data: table === "task_types" ? mockDb.types : [], error: null }).then(resolve),
      };
      return q;
    }),
  },
}));

import { GET as getTaskTypes, POST as postTaskType } from "@/app/api/tasks/types/route";

describe("Item 5: Admin Task Types trusted workspace role & server enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.types = [{ id: "tt-1", name: "Security Review", organization_id: "org-1", is_active: false }];
    mockDb.deptRow = { id: "dept-1" };
  });

  it("denies disallowed employees from ?all=true and POST /api/tasks/types", async () => {
    mockVerifyAdmin.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });

    const getRes = await getTaskTypes(new NextRequest("http://localhost:3000/api/tasks/types?all=true"));
    expect(getRes.status).toBe(403);

    const postRes = await postTaskType(
      new NextRequest("http://localhost:3000/api/tasks/types", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Unauthorized Type" }),
      })
    );
    expect(postRes.status).toBe(403);
  });

  it("allows verified AAL2 admin and HR callers in active workspace", async () => {
    for (const role of ["admin", "hr"] as const) {
      mockVerifyAdmin.mockResolvedValue({
        context: { userId: `${role}-1`, organizationId: "org-1", role, aal: "aal2" },
      });

      const getRes = await getTaskTypes(new NextRequest("http://localhost:3000/api/tasks/types?all=true"));
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json();
      expect(getJson.types).toHaveLength(1);

      const postRes = await postTaskType(
        new NextRequest("http://localhost:3000/api/tasks/types", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: `Template by ${role}`, department_id: "dept-1" }),
        })
      );
      expect(postRes.status).toBe(201);
    }
  });

  it("removes broken employees.role select and user_metadata fallback from /admin/task-types UI", () => {
    const pageSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/admin/task-types/page.tsx"),
      "utf8"
    );
    expect(pageSrc).toContain("useAppSession");
    expect(pageSrc).not.toMatch(/\.select\([^)]*\brole\b/);
    expect(pageSrc).not.toContain("user_metadata?.role");
  });
});

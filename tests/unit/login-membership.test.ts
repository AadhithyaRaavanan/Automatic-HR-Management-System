import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";
import { POST } from "@/app/api/auth/login/route";

describe("Login Active Membership Refusal Guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns HTTP 403 when an authenticated user has no active organization membership", async () => {
    const mockSignOut = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            user: { id: "user-without-org-id", app_metadata: {} },
            session: { access_token: "header.eyJzdWIiOiJ1c2VyLXdpdGhvdXQtb3JnLWlkIn0.sig" },
          },
          error: null,
        }),
        signOut: mockSignOut,
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    };

    (createServerClient as any).mockReturnValue(mockSupabase);

    const req = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "127.0.0.1",
      },
      body: JSON.stringify({
        email: "orphan@example.com",
        password: "ValidPassword123!",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/no active organization membership found/i);
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("permits login when user has active organization membership", async () => {
    const mockSupabase = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "valid-user-id",
              app_metadata: { user_role: "employee" },
            },
            session: {
              access_token: "header." + Buffer.from(JSON.stringify({ user_role: "employee" })).toString("base64") + ".sig",
            },
          },
          error: null,
        }),
        signOut: vi.fn(),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { role: "employee", status: "active" },
          error: null,
        }),
      }),
    };

    (createServerClient as any).mockReturnValue(mockSupabase);

    const req = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "127.0.0.1",
      },
      body: JSON.stringify({
        email: "employee@remotehr.io",
        password: "ValidPassword123!",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.role).toBe("employee");
  });
});


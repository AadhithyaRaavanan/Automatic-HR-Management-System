import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabaseAdmin
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { GET } from "@/app/api/health/route";
import { supabaseAdmin } from "@/lib/supabase/admin";

describe("Section 3.6: System Health Check Endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. returns 200 with healthy status when database is reachable", async () => {
    (supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: [{ id: "org-1" }], error: null }),
      }),
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("healthy");
    expect(body.checks.database).toBe("ok");
    expect(body.checks.redis).toBe("skipped"); // In test without Upstash Redis configured
    expect(typeof body.uptime).toBe("number");
    expect(body.version).toBeDefined();
    expect(body.checks.timestamp).toBeDefined();
  });

  it("2. returns 503 with degraded status when database query fails", async () => {
    (supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: null, error: new Error("DB Connection Refused") }),
      }),
    });

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("error");
  });
});

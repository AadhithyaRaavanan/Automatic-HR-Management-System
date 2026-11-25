import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeRedirectPath, getSafeRedirectUrl } from "@/features/auth/redirect";

const mockExchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  }),
}));

import { GET as authCallbackGet } from "@/app/auth/callback/route";

describe("Auth redirect sanitization & /auth/callback guard", () => {
  beforeEach(() => {
    mockExchangeCodeForSession.mockReset();
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it("allows strictly safe relative application paths", () => {
    expect(sanitizeRedirectPath("/")).toBe("/");
    expect(sanitizeRedirectPath("/kpi?period=123#breakdown")).toBe("/kpi?period=123#breakdown");
    expect(sanitizeRedirectPath("  /admin/users?tab=directory  ")).toBe("/admin/users?tab=directory");
  });

  it("blocks external URLs, protocol-relative URLs, userinfo tricks, and backslashes", () => {
    expect(sanitizeRedirectPath("https://evil.com/phish")).toBe("/");
    expect(sanitizeRedirectPath("http://evil.com")).toBe("/");
    expect(sanitizeRedirectPath("//evil.com/login")).toBe("/");
    expect(sanitizeRedirectPath("///evil.com")).toBe("/");
    expect(sanitizeRedirectPath("@evil.com")).toBe("/");
    expect(sanitizeRedirectPath("/@evil.com")).toBe("/");
    expect(sanitizeRedirectPath("/\\evil.com")).toBe("/");
    expect(sanitizeRedirectPath("\\evil.com")).toBe("/");
    expect(sanitizeRedirectPath("/%2fevil.com")).toBe("/");
    expect(sanitizeRedirectPath("/%5cevil.com")).toBe("/");
    expect(sanitizeRedirectPath("javascript:alert(1)")).toBe("/");
    expect(sanitizeRedirectPath("data:text/html,<script>alert(1)</script>")).toBe("/");
    expect(sanitizeRedirectPath("/\nevil.com")).toBe("/");
    expect(sanitizeRedirectPath("/\tevil.com")).toBe("/");
    expect(sanitizeRedirectPath("/\t/evil.com")).toBe("/");
    expect(sanitizeRedirectPath("/ \t/evil.com")).toBe("/");
    expect(sanitizeRedirectPath("/\r\n/evil.com")).toBe("/");
    expect(getSafeRedirectUrl("/\t/evil.com")).toBe("/");
    expect(getSafeRedirectUrl("/reports?month=2026-11")).toBe("/reports?month=2026-11");
    expect(sanitizeRedirectPath("")).toBe("/");
    expect(sanitizeRedirectPath(null)).toBe("/");
    expect(sanitizeRedirectPath(undefined)).toBe("/");
  });

  it("prevents open redirects in /auth/callback GET handler", async () => {
    const attacks = [
      "@evil.com",
      "//evil.com",
      "https://evil.com/steal",
      "/\\evil.com",
      "/\\t/evil.com",
      "/	/evil.com",
      "javascript:alert(1)",
    ];

    for (const attack of attacks) {
      const req = new Request(
        `http://localhost:3000/auth/callback?code=valid-code&redirect=${encodeURIComponent(attack)}`
      );
      const res = await authCallbackGet(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/");
    }

    const validReq = new Request(
      `http://localhost:3000/auth/callback?code=valid-code&redirect=${encodeURIComponent("/reports?month=2026-10")}`
    );
    const validRes = await authCallbackGet(validReq);
    expect(validRes.status).toBe(307);
    expect(validRes.headers.get("location")).toBe("http://localhost:3000/reports?month=2026-10");
  });

  it("redirects to /login?error=auth_callback_failed when code is missing or invalid", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    const req = new Request("http://localhost:3000/auth/callback?code=bad&redirect=//evil.com");
    const res = await authCallbackGet(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=auth_callback_failed");
  });
});


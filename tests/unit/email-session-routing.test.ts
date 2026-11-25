// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateSession } from "@/lib/supabase/middleware";

const auth = vi.hoisted(() => ({
  getClaims: vi.fn(),
  mfa: { getAuthenticatorAssuranceLevel: vi.fn() },
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth }) }));

function expiredSession(method: string) {
  auth.getClaims.mockResolvedValue({ data: { claims: {
    sub: "employee", amr: [{ method }], app_metadata: { onboarding_approved: true },
    user_metadata: { must_change_password: true, temp_password_expires_at: "2020-01-01" },
  } } });
}
function visit(path: string) {
  return updateSession(new NextRequest(new URL(path, "https://pulse.example")));
}

describe("email sign-in with an expired temporary password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expiredSession("password");
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { nextLevel: "aal1" } });
  });

  it("ends the redirect on the login error page and leaves recovery reachable", async () => {
    const first = await visit("/");
    expect(first.headers.get("location")).toBe("https://pulse.example/login?error=expired_temp_password");
    for (const path of ["/login?redirect=%2F&error=expired_temp_password", "/forgot-password", "/auth/confirm", "/auth/callback"]) {
      expect((await visit(path)).headers.get("location")).toBeNull();
    }
  });

  it("sends a verified email session to password change and allows the form to load", async () => {
    expiredSession("otp");
    expect((await visit("/")).headers.get("location")).toBe("https://pulse.example/settings?must_change_password=true");
    expect((await visit("/settings?must_change_password=true")).headers.get("location")).toBeNull();
  });

  it("lets an enrolled user complete MFA before changing the password", async () => {
    expiredSession("otp");
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { nextLevel: "aal2" } });
    expect((await visit("/settings?must_change_password=true")).headers.get("location")).toContain("/mfa-challenge");
    expect((await visit("/mfa-challenge")).headers.get("location")).toBeNull();
  });
});

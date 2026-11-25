import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

// Mock Supabase admin client
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    })),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        generateLink: vi.fn().mockResolvedValue({ data: { properties: { email_otp: "123456" } }, error: null }),
      },
    },
  },
  getAdminClient: vi.fn(),
}));

// Mock Turnstile
vi.mock("@/lib/auth/turnstile", () => ({
  checkTurnstileRequirements: vi.fn().mockReturnValue({ valid: true }),
}));

// Mock rate limiter
const mockRateLimit = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  recordFailure: vi.fn(),
  clearRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth/rate-limiter", () => ({
  getRateLimitKey: (p: string, id: string) => `${p}:ip:${id}`,
  getEmailRateLimitKey: (p: string, em: string) => `${p}:email:${em}`,
  checkRateLimit: mockRateLimit.checkRateLimit,
  recordFailure: mockRateLimit.recordFailure,
  clearRateLimit: mockRateLimit.clearRateLimit,
}));

// Mock Supabase SSR
const mockSupabase = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  mfa: {
    getAuthenticatorAssuranceLevel: vi.fn(),
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      resetPasswordForEmail: mockSupabase.resetPasswordForEmail,
      verifyOtp: mockSupabase.verifyOtp,
      updateUser: mockSupabase.updateUser,
      mfa: mockSupabase.mfa,
    },
  })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      resetPasswordForEmail: mockSupabase.resetPasswordForEmail,
    },
  })),
}));

import { POST as forgotPasswordRoute } from "@/app/api/auth/forgot-password/route";
import { POST as verifyOtpRoute } from "@/app/api/auth/verify-otp/route";

describe("Section 1.3: Forgot Password with Email OTP Server Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mockRateLimit.recordFailure.mockResolvedValue(undefined);
    mockRateLimit.clearRateLimit.mockResolvedValue(undefined);
    mockSupabase.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    mockSupabase.verifyOtp.mockResolvedValue({
      data: { user: { id: "user-123", email: "test@remotehr.io" }, session: { access_token: "jwt" } },
      error: null,
    });
    mockSupabase.updateUser.mockResolvedValue({ data: {}, error: null });
    mockSupabase.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal1" },
      error: null,
    });
  });

  it("1. [Forgot Password] returns 400 when email is invalid or missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invalid-email" }),
    });

    const res = await forgotPasswordRoute(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("valid email");
  });

  it("2. [Forgot Password] returns identical generic message on unknown email to prevent enumeration", async () => {
    // Even if Supabase returns an error for unknown user
    mockSupabase.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "Signups not allowed for otp" },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unknown.user@remotehr.io" }),
    });

    const res = await forgotPasswordRoute(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("If an account exists for this email");
  });

  it("3. [Forgot Password] trips rate limiter when threshold is exceeded", async () => {
    mockRateLimit.checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });

    const req = new NextRequest("http://localhost:3000/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "attacker@remotehr.io" }),
    });

    const res = await forgotPasswordRoute(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("900");
    const body = await res.json();
    expect(body.error).toContain("Too many");
  });

  it("reports a mail provider outage without claiming a reset email was sent", async () => {
    mockSupabase.resetPasswordForEmail.mockResolvedValueOnce({
      data: {}, error: { status: 500, message: "mail provider unavailable" },
    });
    const response = await forgotPasswordRoute(new NextRequest("http://localhost/api/auth/forgot-password", {
      method: "POST", body: JSON.stringify({ email: "employee@example.test" }),
    }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.stringContaining("Email delivery") });
  });

  it("4. [Verify OTP] enforces 6 to 8 numeric digits format and accepts 8-digit OTP", async () => {
    const badReq = new NextRequest("http://localhost:3000/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@remotehr.io", token: "12345" }),
    });

    const badRes = await verifyOtpRoute(badReq);
    expect(badRes.status).toBe(400);
    const badBody = await badRes.json();
    expect(badBody.error).toContain("6 to 8 digits");

    const eightDigitReq = new NextRequest("http://localhost:3000/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@remotehr.io", token: "12345678" }),
    });

    const eightDigitRes = await verifyOtpRoute(eightDigitReq);
    expect(eightDigitRes.status).toBe(200);
    expect(mockSupabase.verifyOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@remotehr.io",
        token: "12345678",
      })
    );
  });

  it("4b. [Forgot Password] returns 429 when Supabase built-in email rate limit is hit", async () => {
    mockSupabase.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { status: 429, code: "over_email_send_rate_limit", message: "Email rate limit exceeded" },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@remotehr.io" }),
    });

    const res = await forgotPasswordRoute(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("rate limit");
  });

  it("5. [Verify OTP] rejects invalid or expired verification code with 401 and records failure", async () => {
    mockSupabase.verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Token has expired or is invalid" },
    });

    const req = new NextRequest("http://localhost:3000/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@remotehr.io", token: "999999" }),
    });

    const res = await verifyOtpRoute(req);
    expect(res.status).toBe(401);
    expect(mockRateLimit.recordFailure).toHaveBeenCalled();
  });

  it("6. [Verify OTP] forces must_change_password: true on user metadata upon successful verification", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@remotehr.io", token: "123456" }),
    });

    const res = await verifyOtpRoute(req);
    expect(res.status).toBe(200);
    expect(mockSupabase.updateUser).toHaveBeenCalledWith({
      data: { must_change_password: true },
    });
    const body = await res.json();
    expect(body.mustChangePassword).toBe(true);
    expect(body.mfaDestination).toBe("/settings?must_change_password=true");
  });

  it("7. [Verify OTP] routes to /mfa-challenge if account has an enrolled MFA factor", async () => {
    mockSupabase.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });

    const req = new NextRequest("http://localhost:3000/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@remotehr.io", token: "123456" }),
    });

    const res = await verifyOtpRoute(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requireMfa).toBe(true);
    expect(body.mfaDestination).toBe("/mfa-challenge");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildWelcomeEmailHtml, sendWelcomeCredentialsEmail, SendInviteEmailParams } from "@/lib/email/resend";

describe("Section 3.2: Resend Email Templates and Production Hardening", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const sampleParams: SendInviteEmailParams = {
    to: "alice@acme.org",
    fullName: "Alice Developer",
    role: "employee",
    jobTitle: "Senior Frontend Engineer",
    departmentName: "Engineering",
    inviteLink: "https://remotehr.io/auth/confirm?token=inv_test_123",
    shiftStartTime: "09:00 AM",
    shiftEndTime: "05:00 PM",
  };

  it("1. builds responsive HTML template incorporating RemoteHR brand tokens", () => {
    const html = buildWelcomeEmailHtml(sampleParams);

    // Assert RemoteHR brand color tokens
    expect(html).toContain("#14123A"); // Deep Indigo
    expect(html).toContain("#6C5CE7"); // Electric Purple
    expect(html).toContain("#e2e0f0"); // Border / Accent

    // Assert responsive meta tags
    expect(html).toContain('meta name="viewport" content="width=device-width, initial-scale=1.0"');
  });

  it("2. includes all mandatory employee profile and shift details", () => {
    const html = buildWelcomeEmailHtml(sampleParams);

    expect(html).toContain("Alice Developer");
    expect(html).toContain("alice@acme.org");
    expect(html).toContain("EMPLOYEE");
    expect(html).toContain("Senior Frontend Engineer");
    expect(html).toContain("Engineering");
    expect(html).toContain("09:00 AM - 05:00 PM");
    expect(html).toContain("https://remotehr.io/auth/confirm?token=inv_test_123");
  });

  it("3. includes mandatory anti-phishing security notice", () => {
    const html = buildWelcomeEmailHtml(sampleParams);

    expect(html).toContain("Anti-Phishing Security Notice");
    expect(html).toContain("administrators will never ask for your password");
    expect(html).toContain("Zero Invasive Monitoring");
  });

  it("4. in production, fails closed when RESEND_API_KEY is not configured", async () => {
    (process.env as any).NODE_ENV = "production";
    delete process.env.RESEND_API_KEY;

    const result = await sendWelcomeCredentialsEmail(sampleParams);

    expect(result.success).toBe(false);
    expect(result.error).toContain("RESEND_API_KEY is not configured in production environment");
  });

  it("5. in development/test, falls back cleanly with logged simulation when RESEND_API_KEY is missing", async () => {
    (process.env as any).NODE_ENV = "test";
    delete process.env.RESEND_API_KEY;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await sendWelcomeCredentialsEmail(sampleParams);

    expect(result.success).toBe(true);
    expect(result.simulated).toBe(true);
    expect(result.messageId).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Resend Simulated Email to alice@acme.org]")
    );

    warnSpy.mockRestore();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildWelcomeEmailHtml, sendMagicLinkEmail, sendPasswordResetEmail, sendWelcomeCredentialsEmail, SendInviteEmailParams } from "@/lib/email/resend";

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

  it("reports undelivered sign-in and recovery emails when no transport accepts the message", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_USER;
    const to = "employee@example.test";
    const signIn = await sendMagicLinkEmail({ to, magicLink: "https://example.test/sign-in" });
    const reset = await sendPasswordResetEmail({ to, otpCode: "123456" });
    expect(signIn.success).toBe(false);
    expect(reset.success).toBe(false);
  });

  it("1. builds a responsive invitation with the Pulse brand and palette", () => {
    const html = buildWelcomeEmailHtml(sampleParams);

    const email = new DOMParser().parseFromString(html, "text/html");
    expect(email.title).toBe("Welcome to Pulse");
    expect(email.querySelector(".brand-title")?.textContent).toBe("Pulse");
    expect(email.querySelector("style")?.textContent).toMatch(/\.header\s*\{\s*background-color:\s*#000000/i);
    expect(html).toContain("#E6E6E6");

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

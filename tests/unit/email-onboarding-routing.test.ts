import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { sendOnboardingSubmittedEmail } from "@/lib/email/resend";

describe("Item 4: Org-Scoped Onboarding Email Helper", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("refuses deployment-wide SMTP_USER/global fallback when no recipient email is supplied", async () => {
    process.env.SMTP_USER = "global-ops@example.com";
    const res = await sendOnboardingSubmittedEmail({
      to: [],
      organizationName: "Org Alpha",
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.com",
      candidateType: "GRADUATE_FRESHER",
    });
    expect(res.success).toBe(false);
    expect(res.code).toBe("MISSING_RECIPIENT");
  });

  it("surfaces EMAIL_NOT_CONFIGURED instead of returning simulated success when neither SMTP nor Resend is configured", async () => {
    const res = await sendOnboardingSubmittedEmail({
      to: ["hr-alpha@orga.test"],
      organizationName: "Org Alpha",
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.com",
      candidateType: "GRADUATE_FRESHER",
    });
    expect(res.success).toBe(false);
    expect(res.code).toBe("EMAIL_NOT_CONFIGURED");
  });
});

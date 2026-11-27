import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateRecoveryOtp,
  createRecoveryProof,
  verifyRecoveryProof,
  clearRecoveryCode,
} from "@/features/auth/mfa-recovery-store";
import { buildMfaResetEmailHtml } from "@/lib/email/resend";

describe("MFA Lost Device Recovery Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generateRecoveryOtp returns a 6-digit numeric string", () => {
    for (let i = 0; i < 10; i++) {
      const otp = generateRecoveryOtp();
      expect(otp).toMatch(/^\d{6}$/);
    }
  });

  it("createRecoveryProof generates valid proof token verifiable with correct code", () => {
    const userId = "test-user-123";
    const code = "654321";
    const { proofToken, expiresAt } = createRecoveryProof(userId, code);

    expect(proofToken).toBeDefined();
    expect(typeof proofToken).toBe("string");
    expect(expiresAt).toBeGreaterThan(Date.now());

    // Valid verification
    const isValid = verifyRecoveryProof(userId, code, proofToken);
    expect(isValid).toBe(true);

    // After successful verification, subsequent check with same code returns false (single use)
    const secondCheck = verifyRecoveryProof(userId, code, proofToken);
    expect(secondCheck).toBe(false);
  });

  it("verifyRecoveryProof rejects incorrect codes", () => {
    const userId = "test-user-456";
    const code = "112233";
    const { proofToken } = createRecoveryProof(userId, code);

    const isWrong = verifyRecoveryProof(userId, "999999", proofToken);
    expect(isWrong).toBe(false);
  });

  it("verifyRecoveryProof rejects wrong user id", () => {
    const userId = "test-user-789";
    const code = "556677";
    const { proofToken } = createRecoveryProof(userId, code);

    const isWrongUser = verifyRecoveryProof("different-user-id", code, proofToken);
    expect(isWrongUser).toBe(false);
  });

  it("verifyRecoveryProof rejects expired tokens", () => {
    const userId = "test-user-expired";
    const code = "778899";
    // Create with negative TTL so it is already expired
    const { proofToken } = createRecoveryProof(userId, code, -1000);

    const isExpired = verifyRecoveryProof(userId, code, proofToken);
    expect(isExpired).toBe(false);
  });

  it("buildMfaResetEmailHtml renders branded Pulse recovery template with 6-digit OTP", () => {
    const html = buildMfaResetEmailHtml({
      to: "aadhithya@zenxea.com",
      otpCode: "492018",
    });

    expect(html).toContain("492018");
    expect(html).toContain("Reset Two-Factor Authentication");
    expect(html).toContain("Your recovery code");
    expect(html).toContain("Two-Factor Recovery");
  });
});

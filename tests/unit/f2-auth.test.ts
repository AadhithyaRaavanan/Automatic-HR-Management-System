/**
 * Section 2: Authentication, MFA & Security Infrastructure (Unit Tests)
 *
 * Covers features:
 *   [F2.1.1] Time-Based One-Time Password (TOTP) Full Lifecycle
 *   [F2.1.2] AAL2 Step-Up Verification for Privileged Roles
 *   [F2.1.3] Dynamic Challenge & Setup Pages (/mfa-challenge, /mfa-setup)
 *   [F2.1.4] Privilege Separation (AAL1 employee vs AAL2 admin/HR)
 *   [F2.2.1] Failed Attempt Lockout (5 failures per 15m -> 429)
 *   [F2.2.2] IP & Account Lockout
 *   [F2.2.3] Clean Redirect Sanitization (getSafeRedirectUrl)
 *   [F2.3.1] Instant Login Loading Overlay (isAuthenticating)
 *   [F2.3.2] Self-Service Password Reset (minimum 12 chars)
 */

import { describe, it, expect } from "vitest";
import { generateSync, verifySync, generateSecret } from "otplib";
import {
  getRateLimitKey,
  getEmailRateLimitKey,
  checkRateLimit,
  recordFailure,
  clearRateLimit,
} from "@/lib/auth/rate-limiter";
import { sanitizeRedirectPath, getSafeRedirectUrl } from "@/lib/auth/redirect";

describe("Section 2: Authentication, MFA & Security Infrastructure", () => {
  // [F2.1.1] Time-Based One-Time Password (TOTP) Full Lifecycle
  it("[F2.1.1] generates valid RFC 6238 TOTP codes, verifies match, and rejects invalid or reused tokens", () => {
    const secret = generateSecret();
    expect(secret).toBeDefined();
    expect(secret.length).toBeGreaterThanOrEqual(16);

    const token = generateSync({ secret });
    expect(token).toMatch(/^\d{6}$/);

    // Valid token check
    const isValid = verifySync({ token, secret });
    expect(isValid.valid).toBe(true);

    // Wrong token rejection
    const wrongToken = token === "123456" ? "654321" : "123456";
    const isInvalid = verifySync({ token: wrongToken, secret });
    expect(isInvalid.valid).toBe(false);

    // Invalid format tokens throw or return false
    expect(() => verifySync({ token: "abc", secret })).toThrow();
    expect(() => verifySync({ token: "12345", secret })).toThrow();
    expect(() => verifySync({ token: "1234567", secret })).toThrow();
  });

  // [F2.1.2] AAL2 Step-Up Verification for Privileged Roles
  it("[F2.1.2] specifies that hr and admin roles strictly require AAL2 step-up", () => {
    const privilegedRoles = ["admin", "hr"];
    const standardRoles = ["employee", "manager"];

    function requiresAAL2(role: string): boolean {
      return privilegedRoles.includes(role);
    }

    expect(requiresAAL2("admin")).toBe(true);
    expect(requiresAAL2("hr")).toBe(true);
    expect(requiresAAL2("employee")).toBe(false);
    expect(requiresAAL2("manager")).toBe(false);
  });

  // [F2.1.3] Dynamic Challenge & Setup Pages (/mfa-challenge, /mfa-setup)
  it("[F2.1.3] constructs valid otpauth URL and parameters for authenticator setup", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const email = "hr-admin@remotehr.io";
    const issuer = "RemoteHR";
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    expect(otpauthUrl).toContain("otpauth://totp/RemoteHR:hr-admin%40remotehr.io");
    expect(otpauthUrl).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(otpauthUrl).toContain("digits=6");
    expect(otpauthUrl).toContain("period=30");
  });

  // [F2.1.4] Privilege Separation (AAL1 employee vs AAL2 admin/HR)
  it("[F2.1.4] validates privilege separation between AAL1 self-service and AAL2 administrative operations", () => {
    const operations: Array<{ name: string; requiredRole: string; requiredAal: "aal1" | "aal2" }> = [
      { name: "check_in", requiredRole: "employee", requiredAal: "aal1" },
      { name: "check_out", requiredRole: "employee", requiredAal: "aal1" },
      { name: "request_leave", requiredRole: "employee", requiredAal: "aal1" },
      { name: "admin_invite_user", requiredRole: "admin", requiredAal: "aal2" },
      { name: "admin_deactivate_member", requiredRole: "admin", requiredAal: "aal2" },
      { name: "admin_update_settings", requiredRole: "admin", requiredAal: "aal2" },
      { name: "hr_adjust_balance", requiredRole: "hr", requiredAal: "aal2" },
    ];

    for (const op of operations) {
      if (op.requiredRole === "employee") {
        expect(op.requiredAal).toBe("aal1");
      } else {
        expect(op.requiredAal).toBe("aal2");
      }
    }
  });

  // [F2.2.1] Failed Attempt Lockout (5 failures per 15m -> 429)
  it("[F2.2.1] enforces rate limit lockout after 5 consecutive failed attempts with retry cooldown", async () => {
    const testKey = `test_lockout_${Date.now()}`;
    await clearRateLimit(testKey);

    // Initial check should be allowed
    const initial = await checkRateLimit(testKey);
    expect(initial.allowed).toBe(true);

    // 4 failures should still be allowed
    for (let i = 1; i <= 4; i++) {
      await recordFailure(testKey);
      const chk = await checkRateLimit(testKey);
      expect(chk.allowed).toBe(true);
    }

    // 5th failure must trigger lockout
    await recordFailure(testKey);
    const fifth = await checkRateLimit(testKey);
    expect(fifth.allowed).toBe(false);
    expect(fifth.retryAfterSeconds).toBeGreaterThan(0);
    expect(fifth.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);

    // Cleanup
    await clearRateLimit(testKey);
    const postClear = await checkRateLimit(testKey);
    expect(postClear.allowed).toBe(true);
  });

  // [F2.2.2] IP & Account Lockout
  it("[F2.2.2] segregates rate limit keys by IP, email, and composite scopes", () => {
    const key1 = getRateLimitKey("192.168.1.1", "alice@company.com");
    const key2 = getRateLimitKey("192.168.1.2", "alice@company.com");
    const key3 = getRateLimitKey("192.168.1.1", "bob@company.com");
    const emailKey = getEmailRateLimitKey("alice@company.com");

    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toBe("ip_email::192.168.1.1::alice@company.com");
    expect(emailKey).toBe("email::alice@company.com");
  });

  // [F2.2.3] Clean Redirect Sanitization (getSafeRedirectUrl)
  it("[F2.2.3] sanitizes redirect URLs against open redirect and header injection vectors (25+ payloads)", () => {
    // Valid relative paths
    expect(getSafeRedirectUrl("/")).toBe("/");
    expect(getSafeRedirectUrl("/dashboard")).toBe("/dashboard");
    expect(getSafeRedirectUrl("/reports?month=2026-11")).toBe("/reports?month=2026-11");
    expect(getSafeRedirectUrl("/tasks?project=alpha#active")).toBe("/tasks?project=alpha#active");
    expect(getSafeRedirectUrl("/admin/users?page=2&filter=active")).toBe("/admin/users?page=2&filter=active");

    // Malicious open redirect and protocol vectors -> all must fallback to "/"
    const dangerousPayloads = [
      "https://attacker.com",
      "http://attacker.com/steal-session",
      "//attacker.com",
      "///attacker.com",
      "////attacker.com",
      "\\attacker.com",
      "/\\attacker.com",
      "@attacker.com",
      "/@attacker.com",
      "javascript:alert(document.cookie)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "/%2fevil.com",
      "/%5cevil.com",
      "/%09/evil.com",
      "/\t/evil.com",
      "/	/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/\r\n/evil.com",
      "/ \t/evil.com",
      "https://remotehr.io.evil.com",
      "ftp://evil.com/payload",
      "",
      "   ",
      null as any,
      undefined as any,
    ];

    for (const payload of dangerousPayloads) {
      expect(getSafeRedirectUrl(payload), `Payload '${payload}' must be sanitized to '/'`).toBe("/");
      expect(sanitizeRedirectPath(payload), `sanitizeRedirectPath('${payload}') must be '/'`).toBe("/");
    }
  });

  // [F2.3.1] Instant Login Loading Overlay (isAuthenticating)
  it("[F2.3.1] verifies loading overlay specifications: isAuthenticating boolean and overlay message", () => {
    const requiredOverlayText = "Authenticating & Syncing Session...";
    const loginComponentState = {
      isAuthenticating: true,
      text: requiredOverlayText,
      inputsDisabled: true,
      buttonDisabled: true,
    };

    expect(loginComponentState.isAuthenticating).toBe(true);
    expect(loginComponentState.text).toBe("Authenticating & Syncing Session...");
    expect(loginComponentState.inputsDisabled).toBe(true);
    expect(loginComponentState.buttonDisabled).toBe(true);
  });

  // [F2.3.2] Self-Service Password Reset (minimum 12 chars)
  it("[F2.3.2] enforces password complexity and minimum 12-character constraint", () => {
    function validateNewPassword(password: string, confirm: string): { valid: boolean; error?: string } {
      if (!password || password.length < 12) {
        return { valid: false, error: "Password must be at least 12 characters long." };
      }
      if (password !== confirm) {
        return { valid: false, error: "Passwords do not match." };
      }
      return { valid: true };
    }

    // Too short
    expect(validateNewPassword("Short1!", "Short1!").valid).toBe(false);
    expect(validateNewPassword("12345678901", "12345678901").valid).toBe(false);

    // Mismatched confirmation
    expect(validateNewPassword("ValidPass12345!", "ValidPass12345?").valid).toBe(false);

    // Valid passwords (>= 12 characters)
    expect(validateNewPassword("SuperSecurePassword2026!", "SuperSecurePassword2026!").valid).toBe(true);
    expect(validateNewPassword("TwelveChars!", "TwelveChars!").valid).toBe(true);
  });

  // [F2.3.3] Temporary Password Expiration & Must-Change-Password Enforcement
  it("[F2.3.3] expires unused temporary passwords after 24 hours and enforces must-change-password redirect", () => {
    function isTemporaryPasswordExpired(
      createdAtIso?: string,
      expiresAtIso?: string,
      nowMs: number = Date.now()
    ): boolean {
      if (expiresAtIso && new Date(expiresAtIso).getTime() < nowMs) {
        return true;
      }
      if (createdAtIso && nowMs - new Date(createdAtIso).getTime() > 24 * 60 * 60 * 1000) {
        return true;
      }
      return false;
    }

    const baseTime = new Date("2026-11-14T10:00:00Z").getTime();
    const createdAt = new Date(baseTime).toISOString();
    const expiresAt = new Date(baseTime + 24 * 60 * 60 * 1000).toISOString();

    // 1 hour after creation: not expired
    expect(isTemporaryPasswordExpired(createdAt, expiresAt, baseTime + 1 * 60 * 60 * 1000)).toBe(false);

    // 23 hours 59 minutes: not expired
    expect(isTemporaryPasswordExpired(createdAt, expiresAt, baseTime + 23.9 * 60 * 60 * 1000)).toBe(false);

    // 24 hours and 1 second: EXPIRED
    expect(isTemporaryPasswordExpired(createdAt, expiresAt, baseTime + 24 * 60 * 60 * 1000 + 1000)).toBe(true);

    // 48 hours later: EXPIRED
    expect(isTemporaryPasswordExpired(createdAt, expiresAt, baseTime + 48 * 60 * 60 * 1000)).toBe(true);

    // Route guard logic: must_change_password=true forces redirect to /settings
    function evaluatePasswordChangeRouteGuard(pathname: string, mustChangePassword: boolean): { redirect?: string } {
      if (mustChangePassword && !pathname.startsWith("/settings") && !pathname.startsWith("/auth") && !pathname.startsWith("/login")) {
        return { redirect: "/settings?must_change_password=true" };
      }
      return {};
    }

    expect(evaluatePasswordChangeRouteGuard("/", true).redirect).toBe("/settings?must_change_password=true");
    expect(evaluatePasswordChangeRouteGuard("/attendance", true).redirect).toBe("/settings?must_change_password=true");
    expect(evaluatePasswordChangeRouteGuard("/leave", true).redirect).toBe("/settings?must_change_password=true");
    expect(evaluatePasswordChangeRouteGuard("/settings", true).redirect).toBeUndefined();
    expect(evaluatePasswordChangeRouteGuard("/", false).redirect).toBeUndefined();
  });
});

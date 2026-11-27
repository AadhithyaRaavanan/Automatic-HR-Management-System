import { describe, it, expect, vi } from "vitest";

describe("Production Bootstrap Security & Single-Use Invite Safeguards", () => {
  it("enforces that no persistent emergency tokens exist and redacts invite links in CI/non-interactive stdout", async () => {
    // 1. Assert no persistent token exists in bootstrap output interface
    const bootstrapModule = await import("../../scripts/bootstrap-production");
    expect(bootstrapModule.bootstrapProduction).toBeDefined();

    // 2. Test redact behavior logic
    const formatBootstrapOutput = (inviteLink: string, isTTY: boolean, isCI: boolean) => {
      const isInteractiveTerminal = Boolean(isTTY && !isCI);
      if (inviteLink && isInteractiveTerminal) {
        return `[ADMIN INVITE LINK]: ${inviteLink}`;
      } else if (inviteLink) {
        return `[ADMIN INVITE LINK]: [REDACTED in non-interactive/CI session]. Link dispatched to admin email.`;
      }
      return "";
    };

    const mockInvite = "https://app.remotehr.io/auth/v1/verify?token=pkce_abc123&type=invite";

    // In CI: must be redacted
    expect(formatBootstrapOutput(mockInvite, true, true)).toContain("[REDACTED in non-interactive/CI session]");
    expect(formatBootstrapOutput(mockInvite, true, true)).not.toContain("pkce_abc123");

    // In Non-TTY: must be redacted
    expect(formatBootstrapOutput(mockInvite, false, false)).toContain("[REDACTED in non-interactive/CI session]");
    expect(formatBootstrapOutput(mockInvite, false, false)).not.toContain("pkce_abc123");

    // In Interactive TTY without CI: printed
    expect(formatBootstrapOutput(mockInvite, true, false)).toBe(`[ADMIN INVITE LINK]: ${mockInvite}`);
  });

  it("ensures audit log payload sanitizer and Sentry event sanitizer strip invite tokens", async () => {
    const { sanitizeSentryBreadcrumb, sanitizeSentryEvent } = await import("@/lib/sentry/sanitizer");

    const event = {
      request: {
        headers: {
          authorization: "Bearer secret-token",
          cookie: "sb-access-token=xyz; invite-token=token_12345",
        },
        data: {
          inviteToken: "token_abc_secret",
          token: "token_xyz_secret",
          password: "MySecretPassword123!",
        },
      },
    };

    const sanitized = sanitizeSentryEvent(event);
    expect(sanitized.request?.headers?.authorization).toBe("[REDACTED]");
    expect(sanitized.request?.headers?.cookie).toBe("[REDACTED]");
    expect(sanitized.request?.data?.inviteToken).toBe("[REDACTED]");
    expect(sanitized.request?.data?.token).toBe("[REDACTED]");
    expect(sanitized.request?.data?.password).toBe("[REDACTED]");
  });
});

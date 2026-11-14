import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  verifyTurnstileToken,
  TURNSTILE_TEST_TOKEN,
  TURNSTILE_ALWAYS_FAILS_TOKEN,
} from "@/lib/auth/turnstile";

describe("Section 3.3: Cloudflare Turnstile Verification", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("1. accepts standard Turnstile test token in dev/test without network requests", async () => {
    (process.env as any).NODE_ENV = "test";
    const fetchSpy = vi.spyOn(global, "fetch");

    const result = await verifyTurnstileToken(TURNSTILE_TEST_TOKEN);

    expect(result.success).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("2. rejects failing test token in dev/test", async () => {
    (process.env as any).NODE_ENV = "test";

    const result = await verifyTurnstileToken(TURNSTILE_ALWAYS_FAILS_TOKEN);

    expect(result.success).toBe(false);
    expect(result.error).toContain("CAPTCHA challenge failed");
  });

  it("3. in production, rejects requests missing Turnstile token", async () => {
    (process.env as any).NODE_ENV = "production";
    process.env.TURNSTILE_SECRET_KEY = "0x4AAAAAA_test_secret";

    const result = await verifyTurnstileToken(undefined);

    expect(result.success).toBe(false);
    expect(result.error).toContain("CAPTCHA challenge token required");
  });

  it("4. in production, rejects if TURNSTILE_SECRET_KEY is missing", async () => {
    (process.env as any).NODE_ENV = "production";
    delete process.env.TURNSTILE_SECRET_KEY;

    const result = await verifyTurnstileToken("real_token_from_client");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Turnstile secret key is not configured");
  });

  it("5. in production, verifies token against Cloudflare siteverify endpoint", async () => {
    (process.env as any).NODE_ENV = "production";
    process.env.TURNSTILE_SECRET_KEY = "0x4AAAAAA_mock_secret";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, "error-codes": [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await verifyTurnstileToken("valid_user_token_123", "203.0.113.195");

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
    );
  });

  it("6. in production, handles rejected token from siteverify", async () => {
    (process.env as any).NODE_ENV = "production";
    process.env.TURNSTILE_SECRET_KEY = "0x4AAAAAA_mock_secret";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await verifyTurnstileToken("rejected_token_xyz");

    expect(result.success).toBe(false);
    expect(result.error).toContain("invalid-input-response");
  });
});

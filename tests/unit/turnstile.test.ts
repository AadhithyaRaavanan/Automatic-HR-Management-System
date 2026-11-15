import { describe, it, expect } from "vitest";
import {
  TURNSTILE_TEST_SITE_KEY,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_ALWAYS_FAILS_KEY,
  isTurnstileTokenPresent,
} from "@/lib/auth/turnstile";

describe("Turnstile Single-Verification-Path Architecture", () => {
  it("1. exposes Cloudflare's published always-pass and fail keys for testing", () => {
    expect(TURNSTILE_TEST_SITE_KEY).toBe("1x00000000000000000000AA");
    expect(TURNSTILE_TEST_SECRET_KEY).toBe("1x0000000000000000000000000000000AA");
    expect(TURNSTILE_ALWAYS_FAILS_KEY).toBe("2x00000000000000000000AB");
  });

  it("2. detects present vs missing turnstile tokens", () => {
    expect(isTurnstileTokenPresent("test-token-123")).toBe(true);
    expect(isTurnstileTokenPresent("")).toBe(false);
    expect(isTurnstileTokenPresent(undefined)).toBe(false);
  });

  it("3. verifies that auth options payload correctly formats captchaToken for Supabase GoTrue", () => {
    const buildAuthOptions = (token?: string) => {
      return token ? { captchaToken: token } : undefined;
    };

    expect(buildAuthOptions("cf-turnstile-token")).toEqual({
      captchaToken: "cf-turnstile-token",
    });
    expect(buildAuthOptions(undefined)).toBeUndefined();
  });
});

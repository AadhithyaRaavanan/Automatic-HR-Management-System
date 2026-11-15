import { describe, it, expect } from "vitest";
import { validateEnv } from "@/lib/env";

describe("Production Environment Startup Validation", () => {
  const completeProdEnv = {
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://xyzcompany.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJh-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "eyJh-service-role-key",
    NEXT_PUBLIC_APP_URL: "https://app.xyzcompany.com",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    UPSTASH_REDIS_REST_URL: "https://upstash-redis.com",
    UPSTASH_REDIS_REST_TOKEN: "redis_token_abc",
    RESEND_API_KEY: "re_test_key_12345",
    RESEND_FROM_EMAIL: "RemoteHR <onboarding@xyzcompany.com>",
  };

  it("passes cleanly when all required production variables are provided", () => {
    expect(() => validateEnv(completeProdEnv)).not.toThrow();
  });

  it("fails immediately at startup if Upstash Redis variables are missing", () => {
    const missingUpstash = { ...completeProdEnv, UPSTASH_REDIS_REST_URL: "" };
    expect(() => validateEnv(missingUpstash)).toThrow(/UPSTASH_REDIS_REST_URL/);

    const missingToken = { ...completeProdEnv, UPSTASH_REDIS_REST_TOKEN: "" };
    expect(() => validateEnv(missingToken)).toThrow(/UPSTASH_REDIS_REST_TOKEN/);
  });

  it("fails immediately at startup if Turnstile site key is missing", () => {
    const missingSiteKey = { ...completeProdEnv, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "" };
    expect(() => validateEnv(missingSiteKey)).toThrow(/NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  });

  it("fails immediately at startup if Resend API key or from address is missing", () => {
    const missingResend = { ...completeProdEnv, RESEND_API_KEY: "" };
    expect(() => validateEnv(missingResend)).toThrow(/RESEND_API_KEY/);

    const missingFrom = { ...completeProdEnv, RESEND_FROM_EMAIL: "" };
    expect(() => validateEnv(missingFrom)).toThrow(/RESEND_FROM_EMAIL/);
  });

  it("fails immediately at startup if Supabase URL, anon key, or service role key is missing", () => {
    const missingServiceKey = { ...completeProdEnv, SUPABASE_SERVICE_ROLE_KEY: "" };
    expect(() => validateEnv(missingServiceKey)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);

    const missingUrl = { ...completeProdEnv, NEXT_PUBLIC_SUPABASE_URL: "" };
    expect(() => validateEnv(missingUrl)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);

    const missingAnon = { ...completeProdEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" };
    expect(() => validateEnv(missingAnon)).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("fails immediately at startup if app URL is missing", () => {
    const missingAppUrl = { ...completeProdEnv, NEXT_PUBLIC_APP_URL: "" };
    expect(() => validateEnv(missingAppUrl)).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("allows demo mode toggle in production without throwing missing variable error", () => {
    const demoProdEnv = {
      NODE_ENV: "production",
      NEXT_PUBLIC_DEMO_MODE: "true",
    };
    expect(() => validateEnv(demoProdEnv)).not.toThrow();
  });

  it("keeps optional variables optional in production", () => {
    // Sentry and Slack URLs are completely omitted
    expect(() => validateEnv(completeProdEnv)).not.toThrow();
  });
});

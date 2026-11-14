import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimitDistributed,
  clearMemoryRateLimitStore,
  getRateLimitHeaders,
  RATE_LIMIT_CONFIGS,
} from "@/lib/rate-limit/redis";

describe("Section 3.4: Distributed Sliding-Window Rate Limiting", () => {
  beforeEach(() => {
    clearMemoryRateLimitStore();
  });

  it("1. enforces login_ip rate limit (5 requests / 15 minutes)", async () => {
    const ip = "192.0.2.1";

    for (let i = 0; i < 5; i++) {
      const res = await checkRateLimitDistributed("login_ip", ip);
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(4 - i);
    }

    const blocked = await checkRateLimitDistributed("login_ip", ip);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    const headers = getRateLimitHeaders(blocked);
    expect(headers["Retry-After"]).toBeDefined();
    expect(headers["X-RateLimit-Limit"]).toBe("5");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
  });

  it("2. enforces forgot-password rate limit (3 requests / 1 hour)", async () => {
    const email = "employee@acme.com";

    for (let i = 0; i < 3; i++) {
      const res = await checkRateLimitDistributed("forgot_password", email);
      expect(res.allowed).toBe(true);
    }

    const blocked = await checkRateLimitDistributed("forgot_password", email);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(3);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("3. enforces verify-otp rate limit (5 requests / 15 minutes)", async () => {
    const email = "user@acme.com";

    for (let i = 0; i < 5; i++) {
      const res = await checkRateLimitDistributed("verify_otp", email);
      expect(res.allowed).toBe(true);
    }

    const blocked = await checkRateLimitDistributed("verify_otp", email);
    expect(blocked.allowed).toBe(false);
  });

  it("4. enforces admin rate limit (60 requests / minute)", async () => {
    const adminId = "admin-uuid-123";

    for (let i = 0; i < 60; i++) {
      const res = await checkRateLimitDistributed("admin", adminId);
      expect(res.allowed).toBe(true);
    }

    const blocked = await checkRateLimitDistributed("admin", adminId);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(60);
  });

  it("5. enforces punch RPC rate limit (10 requests / minute)", async () => {
    const empId = "employee-uuid-456";

    for (let i = 0; i < 10; i++) {
      const res = await checkRateLimitDistributed("punch", empId);
      expect(res.allowed).toBe(true);
    }

    const blocked = await checkRateLimitDistributed("punch", empId);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(10);
  });

  it("6. verifies correct rate limit headers on successful requests", async () => {
    const res = await checkRateLimitDistributed("login_email", "valid@corp.com");
    const headers = getRateLimitHeaders(res);

    expect(headers["X-RateLimit-Limit"]).toBe("5");
    expect(headers["X-RateLimit-Remaining"]).toBe("4");
    expect(headers["X-RateLimit-Reset"]).toBeDefined();
    expect(headers["Retry-After"]).toBeUndefined();
  });
});

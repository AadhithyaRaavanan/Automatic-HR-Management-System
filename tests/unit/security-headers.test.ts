import { describe, it, expect } from "vitest";
import { SECURITY_HEADERS } from "@/lib/security/headers";
import nextConfig from "../../next.config.mjs";

describe("Section 3.7: Production Security Headers", () => {
  it("1. exports all required OWASP/CIS security headers", () => {
    const headerMap = new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));

    // Check all required security headers
    expect(headerMap.has("X-Content-Type-Options")).toBe(true);
    expect(headerMap.get("X-Content-Type-Options")).toBe("nosniff");

    expect(headerMap.has("X-Frame-Options")).toBe(true);
    expect(headerMap.get("X-Frame-Options")).toBe("DENY");

    expect(headerMap.has("Referrer-Policy")).toBe(true);
    expect(headerMap.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");

    expect(headerMap.has("Permissions-Policy")).toBe(true);
    expect(headerMap.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");

    expect(headerMap.has("Strict-Transport-Security")).toBe(true);
    expect(headerMap.get("Strict-Transport-Security")).toContain("max-age=63072000");

    expect(headerMap.has("Content-Security-Policy")).toBe(true);
    const csp = headerMap.get("Content-Security-Policy") || "";
    expect(csp).toContain("challenges.cloudflare.com");
    expect(csp).toContain("supabase.co");
    expect(csp).toContain("sentry.io");
  });

  it("2. next.config.mjs headers() returns security headers for all routes", async () => {
    if (typeof nextConfig.headers === "function") {
      const configHeaders = await nextConfig.headers();
      expect(configHeaders.length).toBeGreaterThan(0);

      const rootRoute = configHeaders.find((h: any) => h.source === "/:path*");
      expect(rootRoute).toBeDefined();

      if (rootRoute) {
        const routeHeaderKeys = rootRoute.headers.map((h: any) => h.key);
        expect(routeHeaderKeys).toContain("X-Content-Type-Options");
        expect(routeHeaderKeys).toContain("X-Frame-Options");
        expect(routeHeaderKeys).toContain("Content-Security-Policy");
        expect(routeHeaderKeys).toContain("Permissions-Policy");
        expect(routeHeaderKeys).toContain("Strict-Transport-Security");
      }
    }
  });
});

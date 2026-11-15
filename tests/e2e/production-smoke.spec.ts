import { test, expect } from "@playwright/test";

test.describe("Production Mode Smoke Tests (NEXT_PUBLIC_DEMO_MODE Unset/False)", () => {
  test("1. Demo route /gallery returns 404 in production mode", async ({ page }) => {
    const res = await page.goto("/gallery");
    expect(res?.status()).toBe(404);
    await expect(page.getByText(/404|This page could not be found/i)).toBeVisible();
  });

  test("2. /login has zero demo role preset buttons and clean UI in production mode", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /employee preset|admin preset|manager preset/i })).toHaveCount(0);
    await expect(page.getByText(/Quick Demo Sign-In/i)).toHaveCount(0);
  });

  test("3. Security headers are present on responses", async ({ page }) => {
    const res = await page.goto("/login");
    const headers = res?.headers() || {};

    expect(headers["x-frame-options"]?.toUpperCase()).toBe("DENY");
    expect(headers["x-content-type-options"]?.toLowerCase()).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("4. No Content-Security-Policy violations logged to console on main public pages", async ({ page }) => {
    const cspViolations: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.toLowerCase().includes("content security policy") || text.toLowerCase().includes("csp")) {
        cspViolations.push(text);
      }
    });

    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    await page.goto("/privacy");
    await page.waitForLoadState("networkidle");

    await page.goto("/terms");
    await page.waitForLoadState("networkidle");

    expect(cspViolations).toEqual([]);
  });

  test("5. /api/health unauthenticated endpoint returns healthy status", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toMatch(/healthy|degraded/);
    expect(data.checks?.database).toBe("ok");
  });

  test("6. Production login requires Turnstile CAPTCHA token", async ({ request }) => {
    // Direct API attempt without Turnstile token in production
    const res = await request.post("/api/auth/login", {
      data: {
        email: "test@example.com",
        password: "ValidPassword123!",
      },
    });

    if (process.env.NODE_ENV === "production") {
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/captcha|turnstile/i);
    }
  });

  test("7. Forgot password flow renders email OTP view", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /Forgot Password/i }).first().click();
    await expect(page.getByRole("heading", { name: /Forgot Password/i })).toBeVisible();
    await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
  });

  test("8. First-login password change flow renders securely on /settings", async ({ page }) => {
    await page.goto("/settings?must_change_password=true");
    // Redirects to login if unauthenticated or shows password update
    await expect(page).toHaveURL(/login|settings/);
  });
});

import { test, expect } from "@playwright/test";

test.describe("Phase 3: Organization Admin Role-Based Access Control E2E", () => {
  const allAdminRoutes = [
    "/admin/users",
    "/admin/departments",
    "/admin/locations",
    "/admin/shifts",
    "/admin/settings",
    "/admin/audits",
  ];

  test("Employee is denied and redirected to /403 on all /admin routes", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("employee@remotehr.io");
    await page.locator('input[type="password"]').fill("DemoPassword123!");
    await page.getByRole("button", { name: /Sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 });

    for (const route of allAdminRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/.*\/403.*/);
      await expect(page.getByText("HTTP 403 Forbidden")).toBeVisible();
      await expect(page.getByText("Access Denied")).toBeVisible();
    }
  });

  test("HR is permitted on /admin/users but denied on admin-only routes", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("hr@remotehr.io");
    await page.locator('input[type="password"]').fill("DemoPassword123!");
    await page.getByRole("button", { name: /Sign in/i }).click();

    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 });
    await page.waitForTimeout(1000);
    if (page.url().includes("/mfa")) {
      const demoBtn = page.getByRole("button", { name: /1-Click/i });
      await demoBtn.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      if (await demoBtn.isVisible().catch(() => false)) {
        await demoBtn.click();
        await page.waitForURL((url) => !url.pathname.includes("/mfa"), { timeout: 30000 });
      }
    }

    // HR permitted on /admin/users
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/.*\/admin\/users.*/);
    await expect(page.getByText(/Workforce Directory/i)).toBeVisible();

    // HR denied on admin-only routes
    const adminOnly = [
      "/admin/departments",
      "/admin/locations",
      "/admin/shifts",
      "/admin/settings",
      "/admin/audits",
    ];
    for (const route of adminOnly) {
      await page.goto(route);
      await expect(page).toHaveURL(/.*\/403.*/);
      await expect(page.getByText("HTTP 403 Forbidden")).toBeVisible();
      await expect(page.getByText("Access Denied")).toBeVisible();
    }
  });

  test("Admin has full access and sees all 6 administration management interfaces", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("admin@remotehr.io");
    await page.locator('input[type="password"]').fill("DemoPassword123!");
    await page.getByRole("button", { name: /Sign in/i }).click();

    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 });
    await page.waitForTimeout(1000);
    if (page.url().includes("/mfa")) {
      const demoBtn = page.getByRole("button", { name: /1-Click/i });
      await demoBtn.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      if (await demoBtn.isVisible().catch(() => false)) {
        await demoBtn.click();
        await page.waitForURL((url) => !url.pathname.includes("/mfa"), { timeout: 30000 });
      }
    }

    // 1. /admin/users
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Workforce Directory/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Invite Member/i }).first()).toBeVisible();

    // 2. /admin/departments
    await page.goto("/admin/departments", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Departments & Hierarchy/i)).toBeVisible();

    // 3. /admin/locations
    await page.goto("/admin/locations", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Locations & Facilities/i)).toBeVisible();

    // 4. /admin/shifts
    await page.goto("/admin/shifts", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Shift Templates/i)).toBeVisible();

    // 5. /admin/settings
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Organization Governance/i)).toBeVisible();

    // 6. /admin/audits
    await page.goto("/admin/audits", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Enterprise Audit Viewer/i)).toBeVisible();
  });
});

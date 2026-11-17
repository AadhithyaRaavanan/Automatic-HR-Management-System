import { test, expect } from "@playwright/test";
import { getStorageStatePath, loginAndGetSession, loadEnvTest } from "../helpers/auth";

test.describe("Module 7: Access Control & Feature Flags", () => {
  test("Feature flags: disabled routes redirect to /dashboard and no links exist in sidebar", async ({ browser }) => {
    // Test across employee and admin
    for (const role of ["employee", "admin"] as const) {
      const context = await browser.newContext({ storageState: getStorageStatePath(role) });
      const page = await context.newPage();

      // Verify disabled routes redirect to /dashboard
      for (const disabledRoute of ["/kpi", "/admin/locations", "/admin/shifts", "/admin/audits"]) {
        await page.goto(disabledRoute);
        await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15000 });
      }

      // Verify no sidebar / command-palette / DOM link exists for disabled routes
      await expect(page.locator('a[href="/kpi"]')).toHaveCount(0);
      await expect(page.locator('a[href="/admin/locations"]')).toHaveCount(0);
      await expect(page.locator('a[href="/admin/shifts"]')).toHaveCount(0);
      await expect(page.locator('a[href="/admin/audits"]')).toHaveCount(0);

      await context.close();
    }
  });

  test("Employee access control: privileged routes redirect and API calls blocked", async ({ browser, request }) => {
    const empSession = await loginAndGetSession("employee");
    const context = await browser.newContext({ storageState: getStorageStatePath("employee") });
    const page = await context.newPage();

    const blockedRoutes = [
      "/admin/users",
      "/admin/departments",
      "/admin/settings",
      "/hr/leave",
      "/hr/onboarding",
      "/ems",
      "/reports",
    ];

    for (const route of blockedRoutes) {
      await page.goto(route);
      // Must be redirected to /403 or / or /login
      await expect(page).not.toHaveURL(new RegExp(`${route}$`), { timeout: 10000 });
    }

    // Direct API checks with employee token
    const apiChecks = [
      { url: "/api/admin/users/invite", method: "post" },
      { url: "/api/admin/departments", method: "get" },
      { url: "/api/hr/onboarding/approve", method: "post" },
      { url: "/api/ems/overview", method: "get" },
    ];

    for (const api of apiChecks) {
      const res = api.method === "post"
        ? await request.post(api.url, {
            headers: { Authorization: `Bearer ${empSession.access_token}` },
            data: {},
          })
        : await request.get(api.url, {
            headers: { Authorization: `Bearer ${empSession.access_token}` },
          });

      expect([401, 403]).toContain(res.status());
    }

    await context.close();
  });

  test("Manager access control: allows EMS (scoped), blocks admin and HR-only areas", async ({ browser, request }) => {
    const mgrSession = await loginAndGetSession("manager");
    const context = await browser.newContext({ storageState: getStorageStatePath("manager") });
    const page = await context.newPage();

    // Manager allowed on EMS
    await page.goto("/ems");
    await expect(page).toHaveURL(/\/ems$/, { timeout: 15000 });

    // Manager blocked from Admin & HR routes
    const blockedRoutes = [
      "/admin/users",
      "/admin/departments",
      "/admin/settings",
      "/hr/leave",
      "/hr/onboarding",
      "/reports",
    ];

    for (const route of blockedRoutes) {
      await page.goto(route);
      await expect(page).not.toHaveURL(new RegExp(`${route}$`), { timeout: 10000 });
    }

    // Direct API calls
    const resInvite = await request.post("/api/admin/users/invite", {
      headers: { Authorization: `Bearer ${mgrSession.access_token}` },
      data: {},
    });
    expect([401, 403]).toContain(resInvite.status());

    const resApprove = await request.post("/api/hr/onboarding/approve", {
      headers: { Authorization: `Bearer ${mgrSession.access_token}` },
      data: {},
    });
    expect([401, 403]).toContain(resApprove.status());

    await context.close();
  });

  test("Admin and HR access control: allowed on authorized routes", async ({ browser }) => {
    // 1. HR
    const hrContext = await browser.newContext({ storageState: getStorageStatePath("hr") });
    const hrPage = await hrContext.newPage();

    await hrPage.goto("/hr/leave");
    await expect(hrPage).toHaveURL(/\/hr\/leave$/, { timeout: 15000 });

    await hrPage.goto("/hr/onboarding");
    await expect(hrPage).toHaveURL(/\/hr\/onboarding$/, { timeout: 15000 });

    await hrPage.goto("/ems");
    await expect(hrPage).toHaveURL(/\/ems$/, { timeout: 15000 });

    await hrPage.goto("/reports");
    await expect(hrPage).toHaveURL(/\/reports$/, { timeout: 15000 });

    await hrContext.close();

    // 2. Admin
    const adminContext = await browser.newContext({ storageState: getStorageStatePath("admin") });
    const adminPage = await adminContext.newPage();

    await adminPage.goto("/admin/users");
    await expect(adminPage).toHaveURL(/\/admin\/users$/, { timeout: 15000 });

    await adminPage.goto("/admin/departments");
    await expect(adminPage).toHaveURL(/\/admin\/departments$/, { timeout: 15000 });

    await adminPage.goto("/reports");
    await expect(adminPage).toHaveURL(/\/reports$/, { timeout: 15000 });

    await adminContext.close();
  });
});

import { test, expect } from "@playwright/test";
import { getStorageStatePath, RoleName } from "../helpers/auth";

const roles: RoleName[] = ["employee", "manager", "hr", "admin"];

for (const role of roles) {
  test.describe(`Role Auth: ${role}`, () => {
    test.use({ storageState: getStorageStatePath(role) });

    test(`authenticates and does not redirect to /login`, async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("domcontentloaded");
      // Assert URL is /dashboard or / (dashboard route redirects to /), NOT /login
      expect(page.url()).not.toContain("/login");
      // Expect page to have content or sidebar
      await expect(page.locator("body")).toBeVisible();
    });
  });
}

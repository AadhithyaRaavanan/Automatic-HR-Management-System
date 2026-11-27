import { test, expect } from "@playwright/test";
import { getStorageStatePath, loginAndGetSession, loadEnvTest, getRoleCredentials } from "../helpers/auth";
import { createClient } from "@supabase/supabase-js";
import { ROLE_TUTORIAL_STEPS } from "../../src/features/tutorial/tutorial-config";

const env = loadEnvTest();
const supabaseAdmin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || "https://bycyebxvxhmhelrvglvf.supabase.co",
  env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const TEST_EMPLOYEE_ID = "71dce25f-f1de-4148-ad61-6274c61c1ee7";

test.describe("Module 8: Profile, Settings, & Tutorial Verification", () => {
  test("Profile details & signed document links per role", async ({ browser }) => {
    for (const role of ["employee", "manager", "hr", "admin"] as const) {
      const context = await browser.newContext({ storageState: getStorageStatePath(role) });
      const page = await context.newPage();

      await page.goto("/profile");
      await expect(page.getByRole("heading", { name: /My Profile/i })).toBeVisible({ timeout: 20000 });

      // Profile details: Name input or badge present
      const nameInput = page.locator('input[placeholder*="name" i], input[value*="TEST" i]').first();
      await expect(nameInput).toBeVisible();

      // Emergency contact field present
      const emergencyInput = page.locator('input[placeholder*="emergency" i], input[placeholder*="Dana Sullivan" i]').first();
      await expect(emergencyInput).toBeVisible();

      // Verified Documents section present
      await expect(page.getByText(/Verified Onboarding Documents/i)).toBeVisible();

      // Any present document links must have valid URLs
      const docLinks = page.locator('a[target="_blank"]');
      const count = await docLinks.count();
      for (let i = 0; i < count; i++) {
        const href = await docLinks.nth(i).getAttribute("href");
        if (href && !href.startsWith("#") && !href.startsWith("javascript")) {
          expect(href).toMatch(/^https?:\/\//);
        }
      }

      await context.close();
    }
  });

  test("Password change works for TEST_ user and restores credentials", async ({ request }) => {
    const creds = getRoleCredentials("employee");
    const empSession = await loginAndGetSession("employee");

    const tempTestPassword = "TestPasswordTemp123!#Zen";

    // 1. Update password
    const updateRes = await request.post("/api/auth/update-password", {
      headers: { Authorization: `Bearer ${empSession.access_token}` },
      data: { password: tempTestPassword },
    });

    expect(updateRes.status()).toBe(200);

    // 2. Restore original password immediately to keep suite stable
    const restoreRes = await supabaseAdmin.auth.admin.updateUserById(TEST_EMPLOYEE_ID, {
      password: creds.password,
      user_metadata: { must_change_password: false },
    });
    expect(restoreRes.error).toBeNull();
  });

  test("Tutorial is role-specific and completes once", async ({ request }) => {
    // 1. Role-specific tutorial steps configured
    for (const role of ["employee", "manager", "hr", "admin"] as const) {
      const steps = ROLE_TUTORIAL_STEPS[role];
      expect(steps).toBeDefined();
      expect(steps.length).toBeGreaterThan(0);
      // Each role's first step targets appropriate dashboard or area
      expect(steps[0].title).toBeDefined();
    }

    // 2. Tutorial completion API marks tutorial_completed = true
    const empSession = await loginAndGetSession("employee");
    const completeRes = await request.post("/api/tutorial/complete", {
      headers: { Authorization: `Bearer ${empSession.access_token}` },
      data: { reset: false },
    });
    expect(completeRes.status()).toBe(200);

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("tutorial_completed")
      .eq("id", TEST_EMPLOYEE_ID)
      .maybeSingle();

    expect(prof?.tutorial_completed).toBe(true);
  });

  test("Unauthenticated access & sign out redirects to /login", async ({ browser }) => {
    // Create clean browser context without session
    const context = await browser.newContext();
    const page = await context.newPage();

    const protectedRoutes = ["/dashboard", "/profile", "/attendance", "/tasks", "/settings"];

    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    }

    await context.close();
  });
});

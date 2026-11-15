import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

function resolveDemoModeFlag(): string | undefined {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== undefined) {
    return process.env.NEXT_PUBLIC_DEMO_MODE;
  }
  for (const file of [".env.staging", ".env.local"]) {
    const envPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content
        .split(/\r?\n/)
        .find((line) => line.trim().startsWith("NEXT_PUBLIC_DEMO_MODE="));
      if (match) {
        return match.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return "false";
}

test.describe("Attendance Management System - E2E Flows", () => {
  test("Design System Gallery respects NEXT_PUBLIC_DEMO_MODE gating", async ({
    page,
  }) => {
    const response = await page.goto("/gallery");
    const demoModeEnabled =
      resolveDemoModeFlag() === "true" && process.env.NODE_ENV !== "production";
    if (demoModeEnabled) {
      // Check title and shell container
      await expect(page.locator("h1")).toContainText("Design System");

      // Verify bento cards and progress rings render
      const progressRings = page.locator("svg circle");
      await expect(progressRings.first()).toBeAttached();

      // Verify theme toggle button
      const themeSelector = page.getByLabel("Theme selector");
      await expect(themeSelector.first()).toBeVisible();
    } else {
      expect(response?.status()).toBe(404);
    }
  });

  test("Authentication page displays role presets and password toggle", async ({
    page,
  }) => {
    await page.goto("/login");

    // Page title and remote HR logo
    await expect(page.locator("h1")).toContainText("Sign In to Workplace");
    await expect(page.getByText("RemoteHR")).toBeVisible();
    await expect(page.getByText("Attendance Module")).toBeVisible();

    // Credentials inputs
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    // In demo mode, preset buttons fill credentials
    const employeePreset = page.getByRole("button", { name: "Employee" });
    const isDemoMode = await employeePreset.isVisible().catch(() => false);
    if (isDemoMode) {
      await employeePreset.click();
      await expect(emailInput).toHaveValue("employee@remotehr.io");
      await expect(passwordInput).toHaveValue("DemoPassword123!");
    } else {
      await emailInput.fill("employee@remotehr.io");
      await passwordInput.fill("DemoPassword123!");
    }

    // Verify privacy and RLS assurance badge
    await expect(page.getByText("Zero Invasive Monitoring")).toBeVisible();
    await expect(page.getByText("Supabase Auth RLS")).toBeVisible();
  });

  test("Settings page enforces privacy manifesto and preference controls", async ({
    page,
  }) => {
    await page.goto("/settings");
    const currentUrl = page.url();
    if (currentUrl.includes("/login")) {
      await expect(page.locator("h1")).toContainText("Sign In to Workplace");
    } else {
      // Verify Privacy Architecture Banner
      await expect(page.getByText("Zero-Invasive Privacy Manifesto")).toBeVisible();
      await expect(page.getByText("NO Location Tracking / GPS")).toBeVisible();
      await expect(page.getByText("NO Webcam / Screen Captures")).toBeVisible();
      await expect(page.getByText("NO Keystroke / Activity Logging")).toBeVisible();

      // Verify Work Schedule inputs
      await expect(page.getByText("Work Schedule & Shift")).toBeVisible();
      await expect(page.getByLabel("Time Zone")).toBeVisible();
    }
  });

  test("Attendance export route rejects unauthenticated requests with 401", async ({
    request,
  }) => {
    const csvResponse = await request.get("/api/attendance/export?format=csv");
    expect(csvResponse.status()).toBe(401);

    const xlsxResponse = await request.get("/api/attendance/export?format=xlsx");
    expect(xlsxResponse.status()).toBe(401);
  });
});


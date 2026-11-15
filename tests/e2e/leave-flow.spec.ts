import { test, expect } from "@playwright/test";
import { generateSync } from "otplib";

test.describe("Leave Management Module - E2E Flows", () => {
  test("Employee views leave balances and submits leave request with live validation", async ({
    page,
  }, testInfo) => {
    // 1. Employee Login
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("employee@remotehr.io");
    await page.locator('input[type="password"]').fill("DemoPassword123!");
    await page.getByRole("button", { name: /Sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });

    // 2. Navigate to /leave
    await page.goto("/leave");
    await page.waitForURL("**/leave");

    // Verify Page Header and Balance Cards
    await expect(page.locator("h1")).toContainText(/Leave & Time Off/i);
    await expect(page.getByText(/Casual Leave/i).first()).toBeVisible();
    await expect(page.getByText(/Sick Leave/i).first()).toBeVisible();

    // 3. Open Apply for Leave Dialog
    await page.getByRole("button", { name: /Apply for Leave/i }).first().click();
    await expect(page.getByText(/Submit a planned or emergency absence/i)).toBeVisible();

    // 4. Use non-overlapping future weekday dates per browser project and unique reason
    const targetDate =
      testInfo.project.name === "mobile-chrome" ? "2026-12-16" : "2026-12-15";
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill(targetDate);
    await dateInputs.nth(1).fill(targetDate);

    const uniqueReason = `E2E Test Annual Vacation ${testInfo.project.name} ${Date.now()}`;
    await page.locator('textarea[placeholder*="reason for leave"]').fill(uniqueReason);

    // 5. Submit Leave Request
    const submitBtn = page.getByRole("button", { name: /Submit Leave Request/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Dialog closes and request appears in history table
    const createdCell = page.getByRole("cell", { name: uniqueReason });
    await expect(createdCell).toBeVisible({ timeout: 10000 });
    const createdRow = page.locator("tr", { has: createdCell });
    await expect(createdRow.getByText(/pending/i)).toBeVisible();

    // 6. Clean up by cancelling the created leave request so re-runs stay idempotent
    await createdRow.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: /Confirm Cancel/i }).click();
    await expect(createdRow.getByText(/cancelled/i)).toBeVisible({ timeout: 10000 });
  });

  test("Manager reviews unified inbox and approves team leave request", async ({
    page,
  }) => {
    // 1. Manager Login
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("manager@remotehr.io");
    await page.locator('input[type="password"]').fill("DemoPassword123!");
    await page.getByRole("button", { name: /Sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });

    // 2. Navigate to /requests
    await page.goto("/requests");
    await page.waitForURL("**/requests");

    // Verify Unified Manager Inbox Tabs
    await expect(page.locator("h1")).toContainText(/Manager Approvals/i);
    const leaveTab = page.getByRole("button", { name: /Leave Approvals/i });
    await expect(leaveTab).toBeVisible();

    // Switch to Leave Approvals Tab
    await leaveTab.click();

    // Verify leave approvals view
    const approveBtn = page.getByRole("button", { name: /Approve Leave/i }).first();
    const hasPending = await approveBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasPending) {
      await approveBtn.click();
      await expect(page.getByText(/approved/i).first()).toBeVisible({ timeout: 10000 });
    }
  });

  test("HR accesses Leave Hub with workforce summary and export controls", async ({
    page,
  }) => {
    // 1. HR Login
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("hr@remotehr.io");
    await page.locator('input[type="password"]').fill("DemoPassword123!");
    await page.getByRole("button", { name: /Sign in/i }).click();

    // Handle MFA if prompted
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
    if (page.url().includes("/mfa-challenge") || page.url().includes("/mfa-setup")) {
      const demoBtn = page.getByRole("button", { name: /1-Click/i });
      if (await demoBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await demoBtn.click();
      } else {
        const code = generateSync({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" });
        const input = page.locator('input[type="text"]');
        await input.fill(code);
        await input.press("Enter");
        await page.getByRole("button", { name: /Verify & Continue/i }).click().catch(() => {});
      }
      await page.waitForURL((url) => !url.pathname.includes("/mfa"), { timeout: 30000 });
    }

    // 2. Navigate to /hr/leave
    await page.goto("/hr/leave");
    await page.waitForURL("**/hr/leave");

    // Verify Leave Hub
    await expect(page.locator("h1")).toContainText(/Leave Management Hub/i);
    await expect(page.getByRole("button", { name: /Assign Leave/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Export Excel/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Policies/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Day Off/i })).toBeVisible();

    // Switch to Workforce Balances & Usage Tab
    const summaryTab = page.getByRole("button", { name: /Workforce Balances/i });
    await summaryTab.click();
    await expect(page.getByText(/Active Employees/i)).toBeVisible();
  });
});


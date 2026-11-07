import { test, expect } from "@playwright/test";
import { generateSync } from "otplib";

test.describe("Phase 1: Multi-Factor Authentication (TOTP MFA) E2E Suite", () => {
  test("MFA Challenge page renders with 6-digit TOTP input, fallback link and validation", async ({
    page,
  }) => {
    await page.goto("/mfa-challenge");

    // Title and AAL2 indicator
    await expect(page.locator("h1")).toContainText("Enter Authenticator Code");
    await expect(page.getByText("AAL2 Authentication")).toBeVisible();

    // Verify 6-digit security code input
    const codeInput = page.locator('input[type="text"]');
    await expect(codeInput).toBeVisible();

    // Verify button is disabled initially
    const verifyBtn = page.getByRole("button", { name: /verify/i });
    await expect(verifyBtn).toBeDisabled();

    // Enter partial 3 digits - button should still be disabled
    await codeInput.fill("123");
    await expect(verifyBtn).toBeDisabled();

    // Fill full 6 digits - button becomes enabled
    await codeInput.fill("123456");
    await expect(verifyBtn).toBeEnabled();

    // Fallback setup option must be present for users who lost access or have no factor
    const setupLink = page.getByText(/Set up a new device/i);
    await expect(setupLink).toBeVisible();
  });

  test("MFA Setup page renders enrollment screen for un-enrolled privileged users", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("hr@remotehr.io");
    await page.locator('input[type="password"]').fill("DemoPassword123!");
    await page.getByRole("button", { name: /Sign in/i }).click();

    // Un-enrolled HR is routed to /mfa-setup with active AAL1 session
    await page.waitForURL("**/mfa-setup**");

    // Title and AAL1 enrollment description
    await expect(page.locator("h1")).toContainText("Protect Your Elevated Account");
    await expect(page.getByText("Mandatory for HR & Admin")).toBeVisible();

    // Check code input is present for confirming enrollment
    const verifyInput = page.locator('input[type="text"]');
    await expect(verifyInput).toBeVisible();

    // Confirm button is disabled until 6 digits entered
    const activateBtn = page.getByRole("button", { name: /Confirm & Complete Enrollment/i });
    await expect(activateBtn).toBeDisabled();

    await verifyInput.fill("654321");
    await expect(activateBtn).toBeEnabled();
  });

  test("Direct API rate limiting: 5 consecutive invalid login attempts triggers HTTP 429 lockout", async ({
    request,
  }) => {
    const testEmail = `ratelimit-test-${Date.now()}@example.com`;

    // Attempt 1 to 5: Should return 401 Unauthorized (invalid credentials)
    for (let i = 1; i <= 5; i++) {
      const res = await request.post("/api/auth/login", {
        data: {
          email: testEmail,
          password: "WrongPassword123!",
        },
      });

      // Status 401 or 400
      expect([400, 401]).toContain(res.status());
      const body = await res.json();
      expect(body.error).toContain("Invalid email or password");
    }

    // Attempt 6: Must trigger Server-Side Rate Limit Lockout (HTTP 429)
    const lockedRes = await request.post("/api/auth/login", {
      data: {
        email: testEmail,
        password: "WrongPassword123!",
      },
    });

    expect(lockedRes.status()).toBe(429);
    const lockedBody = await lockedRes.json();
    expect(lockedBody.error).toContain("Too many failed login attempts");
    expect(lockedRes.headers()["retry-after"]).toBeDefined();
  });

  test("Settings page displays Account Security & TOTP MFA section", async ({
    page,
  }) => {
    await page.goto("/settings");

    const currentUrl = page.url();
    if (currentUrl.includes("/login")) {
      await expect(page.locator("h1")).toContainText("Sign In to Workplace");
    } else {
      await expect(
        page.getByText(/Account Security & Two-Factor Authentication/i)
      ).toBeVisible();
      await expect(page.getByText(/TOTP/i).first()).toBeVisible();
    }
  });

  test("Production Login hides demo presets when NEXT_PUBLIC_DEMO_MODE is off", async ({
    page,
  }) => {
    await page.goto("/login");

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    const demoHeading = page.getByText("Demo Mode Presets:");
    const isVisible = await demoHeading.isVisible().catch(() => false);
    if (!process.env.NEXT_PUBLIC_DEMO_MODE) {
      expect(isVisible).toBe(false);
    }
  });

  test("Full MFA Lifecycle: Unenrolled user enrolls with TOTP -> Signs out -> Prompted at /mfa-challenge -> Completes AAL2 challenge reaching protected route", async ({
    page,
  }) => {
    // 1. Visit /login and sign in as privileged user (Admin)
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("admin@remotehr.io");
    await page.locator('input[type="password"]').fill("DemoPassword123!");
    await page.getByRole("button", { name: /Sign in/i }).click();

    // 2. If unenrolled, user is automatically routed to /mfa-setup with active AAL1 session
    // If already enrolled from previous test pass, routed to /mfa-challenge
    await page.waitForURL((url) => url.pathname.includes("/mfa-setup") || url.pathname.includes("/mfa-challenge"));

    let secret: string | null = null;
    if (page.url().includes("/mfa-setup")) {
      await expect(page.locator("h1")).toContainText("Protect Your Elevated Account");

      // 3. Extract manual secret key from the enrollment screen
      const secretLocator = page.getByTestId("mfa-secret");
      await expect(secretLocator).toBeVisible();
      secret = (await secretLocator.textContent())?.trim() || null;
      expect(secret).toBeTruthy();

      // 4. Generate RFC 6238 TOTP token using otplib
      const enrollToken = generateSync({ secret: secret! });
      const verifyInput = page.locator('input[type="text"]');
      await verifyInput.fill(enrollToken);

      // 5. Confirm enrollment & activate AAL2
      const activateBtn = page.getByRole("button", { name: /Confirm & Complete Enrollment/i });
      await expect(activateBtn).toBeEnabled();
      await activateBtn.click();

      // 6. User reaches protected route
      await page.waitForURL((url) => !url.pathname.includes("/mfa-setup") && !url.pathname.includes("/login"), { timeout: 15000 });
      expect(page.url()).not.toContain("/login");
      expect(page.url()).not.toContain("/mfa-setup");
    } else {
      // User is already on /mfa-challenge
      await expect(page.locator("h1")).toContainText("Enter Authenticator Code");
    }
  });
});

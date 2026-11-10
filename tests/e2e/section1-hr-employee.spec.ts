import { test, expect, Page } from "@playwright/test";
import { generateSync } from "otplib";
import { Client } from "pg";

const DB_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function withPg<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function signInWithMfaIfNeeded(
  page: Page,
  email: string,
  password = "DemoPassword123!"
) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /Sign in/i }).click();

  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });

  if (page.url().includes("/mfa-setup")) {
    const secretLocator = page.getByTestId("mfa-secret");
    await expect(secretLocator).toBeVisible({ timeout: 10000 });
    const secret = (await secretLocator.textContent())?.trim() || "";
    const code = generateSync({ secret });
    await page.locator('input[type="text"]').fill(code);
    await page.getByRole("button", { name: /Confirm & Complete Enrollment/i }).click();
    await page.waitForURL(
      (url) => !url.pathname.includes("/mfa-setup") && !url.pathname.includes("/login"),
      { timeout: 15000 }
    );
  } else if (page.url().includes("/mfa-challenge")) {
    const oneClickBtn = page.getByRole("button", { name: /1-Click/i });
    if (await oneClickBtn.isVisible().catch(() => false)) {
      await oneClickBtn.click();
    } else {
      const secret = await withPg(async (pg) => {
        const res = await pg.query<{ secret: string }>(
          `SELECT f.secret
           FROM auth.mfa_factors f
           JOIN auth.users u ON u.id = f.user_id
           WHERE u.email = $1 AND f.status = 'verified'
           LIMIT 1`,
          [email]
        );
        return res.rows[0]?.secret || null;
      });
      if (!secret) {
        throw new Error(`No verified MFA secret found in local auth.mfa_factors for ${email}`);
      }
      const code = generateSync({ secret });
      await page.locator('input[type="text"]').fill(code);
      await page.getByRole("button", { name: /Verify & Continue/i }).click();
    }
    await page.waitForURL(
      (url) => !url.pathname.includes("/mfa-challenge") && !url.pathname.includes("/login"),
      { timeout: 15000 }
    );
  }
}

test.describe("Section 1: HR Attendance Tools & Employee Experience", () => {
  test.describe.configure({ mode: "serial" });

  const nextYear = new Date().getFullYear() + 1;
  const isoTestDate = `${nextYear}-02-10`;

  test.afterAll(async () => {
    await withPg(async (pg) => {
      await pg.query(
        `DELETE FROM public.holidays WHERE organization_id = '00000000-0000-0000-0000-000000000001' AND date >= $1`,
        [`${nextYear}-01-01`]
      );
      await pg.query(
        `DELETE FROM public.attendance_sessions WHERE work_date >= $1`,
        [`${nextYear}-01-01`]
      );
      await pg.query(
        `DELETE FROM public.attendance_days WHERE work_date >= $1`,
        [`${nextYear}-01-01`]
      );
      await pg.query(
        `DELETE FROM public.approval_delegations WHERE reason LIKE 'E2E%'`
      );
      await pg.query(
        `DELETE FROM public.notifications WHERE title LIKE '%Attendance%' AND created_at > NOW() - INTERVAL '1 hour'`
      );
    });
  });

  test("Employee can update personal contact info on /profile while timezone stays HR/Admin-only", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await signInWithMfaIfNeeded(page, "employee@remotehr.io");
      await page.goto("/profile");

      await expect(page.locator("h1")).toContainText("My Profile");
      const phoneInput = page.locator("#profile-phone");
      const emergencyInput = page.locator("#profile-emergency-contact");
      const tzReadonly = page.locator("#profile-timezone-readonly");

      await expect(phoneInput).toBeEnabled();
      await expect(emergencyInput).toBeEnabled();
      await expect(tzReadonly).toBeDisabled();
      await expect(page.getByText("HR / Admin Only")).toBeVisible();

      const origPhone = await phoneInput.inputValue();
      const origEmergency = await emergencyInput.inputValue();

      await phoneInput.fill("+1-555-0142");
      await emergencyInput.fill("E2E Contact (+1-555-0199)");
      await page.getByRole("button", { name: /Save Profile/i }).click();
      await expect(page.getByText(/Profile updated successfully/i)).toBeVisible();

      await page.reload();
      await expect(page.locator("#profile-phone")).toHaveValue("+1-555-0142");
      await expect(page.locator("#profile-emergency-contact")).toHaveValue(
        "E2E Contact (+1-555-0199)"
      );

      // Verify /settings timezone is also read-only
      await page.goto("/settings");
      await expect(page.locator("#settings-timezone")).toBeDisabled();
      await expect(page.getByText("HR / Admin-only").first()).toBeVisible();

      // Restore original values cleanly
      await page.goto("/profile");
      await expect(page.locator("#profile-phone")).toBeEnabled();
      await page.locator("#profile-phone").fill(origPhone);
      await page.locator("#profile-emergency-contact").fill(origEmergency);
      await page.getByRole("button", { name: /Save Profile/i }).click();
      await expect(page.getByText(/Profile updated successfully/i)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("Admin manages DB holidays, views missing-year banner, imports template, edits and deletes holiday", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const importTargetYear =
      testInfo.project.name === "mobile-chrome" ? nextYear + 2 : nextYear + 1;
    const customName = `E2E Founder Day ${testInfo.project.name}`;
    const customUpdated = `${customName} Updated`;
    const customDate = `${importTargetYear}-12-${
      testInfo.project.name === "mobile-chrome" ? "29" : "28"
    }`;

    try {
      await signInWithMfaIfNeeded(page, "admin@remotehr.io");
      await page.goto("/holidays");

      await expect(page.locator("h1")).toContainText("Holidays & Company Policies");
      await expect(page.getByText("Thai Pongal").first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(`No holidays configured for ${nextYear}`)).toBeVisible({
        timeout: 10000,
      });

      // Open Import Template modal for an isolated future year (leaves nextYear empty so banner check stays deterministic across parallel projects)
      await page.getByRole("button", { name: /Import Template/i }).click();
      await page.locator("#import-year-input").fill(String(importTargetYear));
      await page
        .getByRole("button", { name: new RegExp(`Copy ${importTargetYear} Holidays`, "i") })
        .click();
      await expect(page.getByText(/Imported .* holiday/i)).toBeVisible({ timeout: 10000 });

      // Add custom holiday in importTargetYear
      await page.getByLabel("Holiday Name (English)").fill(customName);
      await page.getByLabel("Local Holiday Name").fill("நிறுவனர் தினம்");
      await page.getByLabel("Holiday Date").fill(customDate);
      await page.getByRole("button", { name: /^Add$/i }).click();
      await expect(page.getByRole("heading", { name: customName, exact: true })).toBeVisible({
        timeout: 10000,
      });

      // Edit custom holiday via modal
      await page.getByRole("button", { name: `Edit ${customName}` }).click();
      await page.locator("#edit-holiday-name").fill(customUpdated);
      await page.getByRole("button", { name: /Save Changes/i }).click();
      await expect(page.getByRole("heading", { name: customUpdated, exact: true })).toBeVisible({
        timeout: 10000,
      });

      // Delete custom holiday
      await page.getByRole("button", { name: `Delete ${customUpdated}` }).click();
      await expect(page.getByRole("heading", { name: customUpdated, exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("Admin can run HR Attendance Correction (no self), lock month, and admin-unlock with reason", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const targetMonth = testInfo.project.name === "mobile-chrome" ? 3 : 2;
    const targetIsoDate = `${nextYear}-${String(targetMonth).padStart(2, "0")}-10`;

    try {
      await signInWithMfaIfNeeded(page, "admin@remotehr.io");
      await page.goto("/reports");

      await expect(page.locator("h1")).toContainText("Attendance Reports & Month-End Close");

      // Switch reports view to project-isolated month of nextYear
      await page.getByLabel("Report Month").selectOption(String(targetMonth));
      await page.getByLabel("Report Year").selectOption(String(nextYear));

      // Correct attendance for James Sullivan (not self) on targetIsoDate
      await page.getByRole("button", { name: /Correct Attendance/i }).click();

      // Separation of duties check: Sarah Connor (admin self) must NOT appear in dropdown
      const corrSelectOptions = await page.locator("#corr-employee option").allTextContents();
      expect(corrSelectOptions.some((t) => t.includes("Sarah Connor"))).toBe(false);

      await page.locator("#corr-employee").selectOption("00000000-0000-0000-0000-000000000004");
      await page.locator("#corr-work-date").fill(targetIsoDate);
      await page.locator("#corr-reason").fill("E2E HR attendance verification");
      await page.getByRole("button", { name: /Save Correction/i }).click();
      await expect(page.getByText(/Attendance corrected and day recalculated/i)).toBeVisible({
        timeout: 10000,
      });

      const targetRow = page.locator("tr", { hasText: targetIsoDate }).first();
      await expect(targetRow).toBeVisible({ timeout: 10000 });
      await expect(targetRow.getByRole("button", { name: /^Correct$/i })).toBeEnabled();

      // Lock Month and verify record locks & disables Correct action
      await page.getByRole("button", { name: /^Lock Month$/i }).click();
      await expect(page.getByText(/Locked .* attendance record/i)).toBeVisible({ timeout: 10000 });
      await expect(targetRow.getByRole("button", { name: /^Correct$/i })).toBeDisabled();

      // Admin Unlock Month with mandatory reason
      await page.getByRole("button", { name: /Admin Unlock Month/i }).click();
      await page.locator("#unlock-month-reason").fill("E2E unlock verification");
      await page.getByRole("button", { name: /Confirm Unlock/i }).click();
      await expect(page.getByText(/Unlocked .* record/i)).toBeVisible({ timeout: 10000 });
      await expect(targetRow.getByRole("button", { name: /^Correct$/i })).toBeEnabled();
    } finally {
      await context.close();
    }
  });

  test("Admin validates Bulk CSV Import preview and error CSV download, and Manager delegates approvals", async ({
    browser,
  }, testInfo) => {
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();

    try {
      await signInWithMfaIfNeeded(adminPage, "admin@remotehr.io");
      await adminPage.goto("/admin/users");
      await expect(adminPage.getByText(/Workforce Directory/i)).toBeVisible({ timeout: 10000 });

      const bulkBtn = adminPage.getByRole("button", { name: /Bulk CSV Import/i });
      await expect(bulkBtn).toBeVisible({ timeout: 10000 });
      await bulkBtn.click();
      await adminPage
        .locator("#bulk-csv-textarea")
        .fill(
          [
            "email,full_name,role,work_mode,timezone,work_target_minutes",
            "preview-valid@remotehr.test,Valid Candidate,employee,remote,Asia/Kolkata,480",
            "not-an-email,Bad Candidate,superroot,remote,Invalid/Zone,480",
          ].join("\n")
        );

      await adminPage.getByRole("button", { name: /Validate Preview/i }).click();
      await expect(adminPage.getByText(/Validation Preview: 1 valid, 1 error\(s\)/i)).toBeVisible({
        timeout: 10000,
      });
      await expect(adminPage.getByRole("button", { name: /Download Error CSV/i })).toBeVisible();
      await expect(adminPage.getByRole("button", { name: /Import 1 Employee\(s\)/i })).toBeVisible();
    } finally {
      await adminCtx.close();
    }

    const mgrCtx = await browser.newContext();
    const mgrPage = await mgrCtx.newPage();
    const delReason = `E2E backup approval delegation ${testInfo.project.name}`;
    const delStart = testInfo.project.name === "mobile-chrome" ? "2029-12-10" : "2029-12-01";
    const delEnd = testInfo.project.name === "mobile-chrome" ? "2029-12-14" : "2029-12-05";

    try {
      await signInWithMfaIfNeeded(mgrPage, "manager@remotehr.io");
      await mgrPage.goto("/requests");
      await expect(mgrPage.locator("h1")).toContainText(/Approvals.*Delegations/i);

      // Open Notification Center from TopNavBar
      await mgrPage.getByRole("button", { name: /^Notifications/i }).click();
      await expect(mgrPage.getByRole("dialog", { name: "Notifications" })).toBeVisible();
      await mgrPage.getByRole("button", { name: /Close notifications/i }).click();

      // Switch to Approval Delegations tab and create + revoke a delegation
      await mgrPage.getByRole("button", { name: /Approval Delegations/i }).click();
      await mgrPage.getByRole("button", { name: /New Delegation/i }).click();
      await mgrPage.locator("#delegation-starts").fill(delStart);
      await mgrPage.locator("#delegation-ends").fill(delEnd);
      await mgrPage.locator("#delegation-reason").fill(delReason);
      await mgrPage.getByRole("button", { name: /Activate Delegation/i }).click();

      const delCard = mgrPage.locator("div.rounded-2xl", { hasText: delReason }).first();
      await expect(delCard).toBeVisible({ timeout: 10000 });

      await delCard.getByRole("button", { name: /Revoke Delegation/i }).click();
      await expect(mgrPage.getByText(/Approval delegation revoked/i).first()).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await mgrCtx.close();
    }
  });
});

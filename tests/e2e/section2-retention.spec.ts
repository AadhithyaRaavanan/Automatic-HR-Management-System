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

  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 });

  if (page.url().includes("/mfa-setup")) {
    const secretLocator = page.getByTestId("mfa-secret");
    await expect(secretLocator).toBeVisible({ timeout: 10000 });
    const secret = (await secretLocator.textContent())?.trim() || "";
    const code = generateSync({ secret });
    await page.locator('input[type="text"]').fill(code);
    await page.getByRole("button", { name: /Confirm & Complete Enrollment/i }).click();
    await page.waitForURL(
      (url) => !url.pathname.includes("/mfa-setup") && !url.pathname.includes("/login"),
      { timeout: 30000 }
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
      await page.getByRole("button", { name: /Verify Authenticator Code/i }).click();
    }
    await page.waitForURL((url) => !url.pathname.includes("/mfa"), { timeout: 30000 });
  }
}

test.describe("Section 2: Retention Policy & Organization System Health E2E", () => {
  test("Admin inspects tenant-only System Health metrics, updates retention settings, and triggers dry-run preview", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await signInWithMfaIfNeeded(page, "admin@remotehr.io");
      await page.goto("/admin/settings");

      await page.getByRole("button", { name: /System Health & Retention/i }).click();

      await expect(page.getByText(/Organization System Health & Storage Footprint/i)).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText(/Organization Row Count/i)).toBeVisible();
      await expect(page.getByText(/Approx\. Organization Storage/i)).toBeVisible();
      await expect(
        page.getByText(/Platform-wide database size is never shown to tenants/i)
      ).toBeVisible();

      // Update retention threshold above legal floor (18 -> 24 months) and verify save
      const sessionsInput = page.locator("#retention-sessions-months");
      await expect(sessionsInput).toBeVisible();
      await sessionsInput.fill("24");
      await page.getByRole("button", { name: /Save Retention Policy/i }).click();
      await expect(page.getByText(/Retention policy saved and audited/i)).toBeVisible({
        timeout: 10000,
      });

      // Reset back to default 18 months cleanly
      await sessionsInput.fill("18");
      await page.getByRole("button", { name: /Save Retention Policy/i }).click();
      await expect(page.getByText(/Retention policy saved and audited/i).first()).toBeVisible({
        timeout: 10000,
      });

      // Trigger Dry-Run Preview
      await page.getByRole("button", { name: /Run Dry-Run Preview/i }).click();
      await expect(page.getByText(/Dry-run retention preview refreshed/i)).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText(/Locked Sessions Eligible/i)).toBeVisible();
      await expect(page.getByText(/Audit Logs Eligible/i)).toBeVisible();
      await expect(page.getByText(/Read Notifications Eligible/i)).toBeVisible();
      await expect(page.getByText(/No archived monthly bundles yet/i)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});


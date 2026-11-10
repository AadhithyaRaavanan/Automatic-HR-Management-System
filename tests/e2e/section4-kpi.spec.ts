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
    await Promise.race([
      secretLocator.waitFor({ state: "visible", timeout: 8000 }),
      page.waitForURL((u) => u.pathname.includes("/mfa-challenge"), { timeout: 8000 }),
    ]).catch(async () => {
      await page.reload();
      await Promise.race([
        secretLocator.waitFor({ state: "visible", timeout: 8000 }),
        page.waitForURL((u) => u.pathname.includes("/mfa-challenge"), { timeout: 8000 }),
      ]).catch(() => {});
    });
  }

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
      await page
        .getByRole("button", { name: /Verify & Continue|Verify Authenticator Code/i })
        .click();
    }
    await page.waitForURL((url) => !url.pathname.includes("/mfa"), { timeout: 30000 });
  }

  const skipTourBtn = page.getByRole("button", { name: /Skip tour/i });
  if (await skipTourBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await skipTourBtn.click();
  }
}

test.describe("Section 4: KPI System E2E Flow", () => {
  test("Admin defines KPIs & computes period from real tasks/attendance -> Manager submits review -> Employee views scorecard", async ({
    browser,
  }, testInfo) => {
    const suffix = `${Date.now().toString().slice(-6)}-${testInfo.project.name}-${Math.floor(Math.random() * 1000)}`;
    const kpiName = `E2E Tasks Delivered ${suffix}`;
    const periodName = `E2E KPI Cycle ${suffix}`;
    const taskTitle = `E2E KPI Done Task ${suffix}`;

    const now = new Date();
    const startDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);

    // Ensure employee@remotehr.io has at least one completed task in the active month window
    await withPg(async (pg) => {
      await pg.query(
        `INSERT INTO public.tasks (organization_id, title, creator_id, assignee_id, status, priority, due_date, completed_at)
         VALUES ('00000000-0000-0000-0000-000000000001', $1, '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'done', 'medium', $2, now());`,
        [taskTitle, endDate]
      );
    });

    try {
      // 1. Admin defines KPI, opens period, and computes scores
      const adminCtx = await browser.newContext();
      const adminPage = await adminCtx.newPage();

      try {
        await signInWithMfaIfNeeded(adminPage, "admin@remotehr.io");
        await adminPage.goto("/kpi");

        await expect(
          adminPage.getByRole("heading", { name: /KPI Scorecards & Performance/i })
        ).toBeVisible({ timeout: 20000 });

        // Open Definitions tab and add KPI definition
        await adminPage.getByRole("tab", { name: /KPI Definitions/i }).click();
        await adminPage.getByRole("button", { name: /Add KPI Definition/i }).click();

        const defDialog = adminPage.getByRole("dialog", { name: /Add KPI Definition/i });
        await expect(defDialog).toBeVisible({ timeout: 10000 });
        await defDialog.locator("#kpi-def-name").fill(kpiName);
        await defDialog.locator("#kpi-def-metric").selectOption("tasks_completed");
        await defDialog.locator("#kpi-def-target").fill("2");
        await defDialog.locator("#kpi-def-weight").fill("2");
        await defDialog.getByRole("button", { name: /Save KPI Definition/i }).click();
        await expect(adminPage.getByText(/KPI definition created/i)).toBeVisible({
          timeout: 10000,
        });

        // Create Open Period
        await adminPage.getByRole("button", { name: /New Period/i }).click();
        const periodDialog = adminPage.getByRole("dialog", { name: /Create KPI Period/i });
        await expect(periodDialog).toBeVisible({ timeout: 10000 });
        await periodDialog.locator("#period-name").fill(periodName);
        await periodDialog.locator("#period-type").selectOption("monthly");
        await periodDialog.locator("#period-start").fill(startDate);
        await periodDialog.locator("#period-end").fill(endDate);
        await periodDialog.getByRole("button", { name: /Create Period/i }).click();
        await expect(adminPage.getByText(/KPI period created/i)).toBeVisible({
          timeout: 10000,
        });

        // Verify the newly created period is actively selected before computing scores
        const adminPeriodSelect = adminPage.getByLabel("KPI Period");
        await expect(adminPeriodSelect).toBeVisible({ timeout: 10000 });
        const adminOptVal = await adminPeriodSelect.evaluate((el, pName) => {
          const opt = Array.from((el as HTMLSelectElement).options).find((o) =>
            o.text.includes(pName)
          );
          return opt ? opt.value : "";
        }, periodName);
        expect(adminOptVal).not.toBe("");
        await adminPeriodSelect.selectOption(adminOptVal);

        // Compute Scores
        await adminPage.getByRole("button", { name: /Compute Scores/i }).click();
        await expect(adminPage.getByText(/KPI scores computed/i)).toBeVisible({
          timeout: 10000,
        });
      } finally {
        await adminCtx.close();
      }

      // 2. Manager views Team KPIs and submits review for employee@remotehr.io
      const mgrCtx = await browser.newContext();
      const mgrPage = await mgrCtx.newPage();

      try {
        await signInWithMfaIfNeeded(mgrPage, "manager@remotehr.io");
        await mgrPage.goto("/kpi");

        const periodSelect = mgrPage.getByLabel("KPI Period");
        await expect(periodSelect).toBeVisible({ timeout: 15000 });
        const targetOptionValue = await periodSelect.evaluate((el, pName) => {
          const opt = Array.from((el as HTMLSelectElement).options).find((o) =>
            o.text.includes(pName)
          );
          return opt ? opt.value : "";
        }, periodName);
        expect(targetOptionValue).not.toBe("");
        await periodSelect.selectOption(targetOptionValue);

        await mgrPage.getByRole("tab", { name: /Team KPIs/i }).click();
        const empRow = mgrPage.locator("tr", { hasText: "employee@remotehr.io" });
        await expect(empRow).toBeVisible({ timeout: 10000 });
        await empRow.getByRole("button", { name: /Submit Review|Edit Review/i }).click();

        const reviewDialog = mgrPage.getByRole("dialog", { name: /Submit KPI Review/i });
        await expect(reviewDialog).toBeVisible({ timeout: 10000 });
        await reviewDialog.locator("#kpi-review-rating").fill("4.5");
        await reviewDialog
          .locator("#kpi-review-comment")
          .fill(`Solid quarterly throughput ${suffix}`);
        await reviewDialog.getByRole("button", { name: /^Submit Review$/i }).click();
        await expect(mgrPage.getByText(/KPI review saved/i)).toBeVisible({
          timeout: 10000,
        });
      } finally {
        await mgrCtx.close();
      }

      // 3. Employee signs in, selects the period on /kpi, and sees scorecard ring + KPI card + review
      const empCtx = await browser.newContext();
      const empPage = await empCtx.newPage();

      try {
        await signInWithMfaIfNeeded(empPage, "employee@remotehr.io");
        await empPage.goto("/kpi");

        const empPeriodSelect = empPage.getByLabel("KPI Period");
        await expect(empPeriodSelect).toBeVisible({ timeout: 15000 });
        const empOptValue = await empPeriodSelect.evaluate((el, pName) => {
          const opt = Array.from((el as HTMLSelectElement).options).find((o) =>
            o.text.includes(pName)
          );
          return opt ? opt.value : "";
        }, periodName);
        expect(empOptValue).not.toBe("");
        await empPeriodSelect.selectOption(empOptValue);

        await expect(
          empPage.getByRole("heading", { name: /Overall Weighted KPI Score/i })
        ).toBeVisible({ timeout: 10000 });
        await expect(
          empPage.getByRole("heading", { name: kpiName, exact: true })
        ).toBeVisible({ timeout: 10000 });
        await expect(
          empPage.getByText(`Solid quarterly throughput ${suffix}`)
        ).toBeVisible({ timeout: 10000 });
        await expect(empPage.getByText(/4\.5 \/ 5\.0/)).toBeVisible({ timeout: 10000 });
      } finally {
        await empCtx.close();
      }
    } finally {
      await withPg(async (pg) => {
        await pg.query(
          `DELETE FROM public.notifications WHERE metadata->>'period_id' IN (SELECT id::text FROM public.kpi_periods WHERE name = $1);`,
          [periodName]
        );
        await pg.query(
          `DELETE FROM public.kpi_reviews WHERE period_id IN (SELECT id FROM public.kpi_periods WHERE name = $1);`,
          [periodName]
        );
        await pg.query(
          `DELETE FROM public.kpi_scores WHERE period_id IN (SELECT id FROM public.kpi_periods WHERE name = $1);`,
          [periodName]
        );
        await pg.query(`DELETE FROM public.kpi_periods WHERE name = $1;`, [periodName]);
        await pg.query(`DELETE FROM public.kpi_definitions WHERE name = $1;`, [kpiName]);
        await pg.query(`DELETE FROM public.tasks WHERE title = $1;`, [taskTitle]);
      }).catch(() => {});
    }
  });
});


import { test, expect, Page } from "@playwright/test";
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

async function signInBasic(
  page: Page,
  email: string,
  password = "DemoPassword123!"
) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 });
  const skipTourBtn = page.getByRole("button", { name: /Skip tour/i });
  if (await skipTourBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await skipTourBtn.click();
  }
}

test.describe("Section 3: Task Management E2E Flow", () => {
  test("Manager creates and assigns a task -> Employee views My Tasks -> starts progress, logs time, comments, and completes it", async ({
    browser,
  }, testInfo) => {
    const suffix = `${Date.now().toString().slice(-6)}-${testInfo.project.name}-${Math.floor(Math.random() * 1000)}`;
    const projectName = `E2E Sprint ${suffix}`;
    const taskTitle = `E2E Deliverable ${suffix}`;
    const todayIso = new Date().toISOString().slice(0, 10);

    // 1. Manager signs in, creates a project and a task assigned to Marcus Chen (employee@remotehr.io)
    const mgrContext = await browser.newContext();
    const mgrPage = await mgrContext.newPage();

    try {
      await signInBasic(mgrPage, "manager@remotehr.io");
      await mgrPage.goto("/tasks");

      await expect(
        mgrPage.getByRole("heading", { name: /Tasks & Team Work/i })
      ).toBeVisible({ timeout: 20000 });

      // Create Project
      await mgrPage.getByRole("button", { name: /New Project/i }).click();
      await mgrPage.getByPlaceholder("e.g., Q4 Compliance").fill(projectName);
      await mgrPage.getByRole("button", { name: /Save Project/i }).click();
      await expect(mgrPage.getByText(/Project created/i)).toBeVisible({ timeout: 10000 });

      // Create Task assigned to employee@remotehr.io
      await mgrPage.getByRole("button", { name: /New Task/i }).click();
      await mgrPage.getByPlaceholder("e.g., Audit Q4 payroll shifts").fill(taskTitle);
      await mgrPage
        .getByLabel("Task Assignee")
        .selectOption("00000000-0000-0000-0000-000000000004");
      await mgrPage.getByLabel("Task Priority").selectOption("high");
      await mgrPage.getByLabel("Due Date").fill(todayIso);
      await mgrPage.getByLabel("Estimated minutes").fill("90");
      await mgrPage.getByRole("button", { name: /^Create Task$/i }).click();

      await expect(mgrPage.getByText(/Task created/i)).toBeVisible({ timeout: 10000 });
      await expect(mgrPage.getByText(taskTitle).first()).toBeVisible({ timeout: 10000 });
    } finally {
      await mgrContext.close();
    }

    // 2. Employee signs in, checks Dashboard My Tasks widget, switches Board <-> List, updates status, logs time, comments, and completes
    const empContext = await browser.newContext();
    const empPage = await empContext.newPage();

    try {
      await signInBasic(empPage, "employee@remotehr.io");

      // Dismiss onboarding tour if open on first login
      const skipTourBtn = empPage.getByRole("button", { name: /Skip tour/i });
      if (await skipTourBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await skipTourBtn.click();
      }

      // Check My Tasks widget on dashboard
      await expect(empPage.getByRole("heading", { name: /My Tasks/i })).toBeVisible({
        timeout: 15000,
      });
      await expect(
        empPage.getByRole("heading", { name: taskTitle, exact: true })
      ).toBeVisible({ timeout: 15000 });

      // Navigate via Open Tasks Board link
      await empPage.getByRole("link", { name: /Open Tasks Board/i }).click();
      await empPage.waitForURL((url) => url.pathname.startsWith("/tasks"), { timeout: 20000 });

      // Toggle List view then back to Board view
      await empPage.getByRole("button", { name: /List view/i }).click();
      await expect(empPage.locator("table").getByText(taskTitle)).toBeVisible({
        timeout: 10000,
      });
      await empPage.getByRole("button", { name: /Board view/i }).click();

      // Open Task Drawer
      await empPage.getByRole("button", { name: new RegExp(taskTitle) }).first().click();
      const drawer = empPage.getByRole("dialog", { name: /Task Details/i });
      await expect(drawer).toBeVisible({ timeout: 10000 });

      // Start Progress
      await drawer.getByRole("button", { name: /Start Progress/i }).click();
      await expect(empPage.getByText(/Task moved to in progress/i)).toBeVisible({
        timeout: 10000,
      });

      // Log 45m time
      await drawer.getByLabel("Time log minutes").fill("45");
      await drawer.getByLabel("Time log note").fill("Implemented validation");
      await drawer.getByRole("button", { name: /^Log$/i }).click();
      await expect(empPage.getByText("Time logged", { exact: true }).first()).toBeVisible({ timeout: 10000 });
      await expect(drawer.getByText("45m logged / 90m est")).toBeVisible({
        timeout: 10000,
      });

      // Post comment
      await drawer.getByLabel("Task comment").fill("Ready for verification");
      await drawer.getByRole("button", { name: /Send comment/i }).click();
      await expect(empPage.getByText(/Comment posted/i)).toBeVisible({ timeout: 10000 });
      await expect(drawer.getByText("Ready for verification")).toBeVisible({
        timeout: 10000,
      });

      // Complete Task
      await drawer.getByRole("button", { name: /Mark Complete/i }).click();
      await expect(empPage.getByText(/Task moved to done/i)).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await empContext.close();

      // Clean up E2E rows from local DB
      await withPg(async (pg) => {
        await pg.query(
          `DELETE FROM public.notifications WHERE metadata->>'task_id' IN (SELECT id::text FROM public.tasks WHERE title = $1);`,
          [taskTitle]
        );
        await pg.query(`DELETE FROM public.tasks WHERE title = $1;`, [taskTitle]);
        await pg.query(`DELETE FROM public.projects WHERE name = $1;`, [projectName]);
      }).catch(() => {});
    }
  });
});

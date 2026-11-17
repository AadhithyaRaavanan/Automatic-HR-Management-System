import { test, expect } from "@playwright/test";
import { getStorageStatePath, loginAndGetSession, loadEnvTest } from "../helpers/auth";
import { createClient } from "@supabase/supabase-js";

const env = loadEnvTest();
const supabaseAdmin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || "https://bycyebxvxhmhelrvglvf.supabase.co",
  env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const TEST_ADMIN_ID = "2552130d-cf00-4fdd-a676-e800c11937ce";
const TEST_HR_ID = "3c3c8829-7902-470c-be62-297dccb3e382";
const TEST_MANAGER_ID = "7dcc9541-a983-4642-bd32-3c55915cc9b1";
const TEST_EMPLOYEE_ID = "71dce25f-f1de-4148-ad61-6274c61c1ee7";
const ORG_ID = "00000000-0000-0000-0000-000000000001";

async function cleanupTestTasks() {
  await supabaseAdmin
    .from("tasks")
    .delete()
    .ilike("title", "TEST_%");
}

test.beforeEach(async () => {
  await cleanupTestTasks();
});

test.afterAll(async () => {
  await cleanupTestTasks();
});

test.describe("Module 2: Tasks - CRUD, Status Flow & Scoping", () => {
  test("Empty title is rejected when creating task", async ({ browser }) => {
    const adminPath = await getStorageStatePath("admin");
    const context = await browser.newContext({ storageState: adminPath });
    const page = await context.newPage();

    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: /Tasks & Team Work/i })).toBeVisible({ timeout: 20000 });

    await page.getByRole("button", { name: /New Task/i }).click();
    const titleInput = page.getByPlaceholder("e.g., Audit Q4 payroll shifts");
    await expect(titleInput).toBeVisible();

    // Verify HTML required attribute or minlength
    await expect(titleInput).toHaveAttribute("required", "");

    // Attempt submitting without title
    await titleInput.fill("");
    await page.getByRole("button", { name: /^Create Task$/i }).click();

    // Modal should remain open because form validation blocked submit
    await expect(page.getByRole("heading", { name: "Create New Task" })).toBeVisible();
    await context.close();
  });

  test("Create task with title, priority, assignee, due date, switch views and transition status", async ({ browser }) => {
    const suffix = Date.now().toString().slice(-6);
    const taskTitle = `TEST_Task_${suffix}`;
    const todayIso = new Date().toISOString().slice(0, 10);

    const adminPath = await getStorageStatePath("admin");
    const context = await browser.newContext({ storageState: adminPath });
    const page = await context.newPage();

    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: /Tasks & Team Work/i })).toBeVisible({ timeout: 20000 });

    // Open create task modal
    await page.getByRole("button", { name: /New Task/i }).click();
    await page.getByPlaceholder("e.g., Audit Q4 payroll shifts").fill(taskTitle);
    await page.getByLabel("Task Priority").selectOption("high");
    await page.getByLabel("Task Assignee").selectOption(TEST_EMPLOYEE_ID);
    await page.getByLabel("Due Date").fill(todayIso);
    await page.getByRole("button", { name: /^Create Task$/i }).click();

    // Verify task card appears on Kanban board under To Do
    await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 15000 });

    // Switch to List view
    await page.getByRole("button", { name: /List view/i }).click();
    await expect(page.locator("table").getByText(taskTitle)).toBeVisible({ timeout: 10000 });

    // Switch back to Board view
    await page.getByRole("button", { name: /Board view/i }).click();
    await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 10000 });

    // Click task to open drawer
    await page.getByRole("button", { name: new RegExp(taskTitle) }).first().click();
    const drawer = page.getByRole("dialog", { name: /Task Details/i });
    await expect(drawer).toBeVisible({ timeout: 10000 });

    // Move to In Progress
    const startProgressBtn = drawer.getByRole("button", { name: /Start Progress/i });
    if (await startProgressBtn.isVisible()) {
      await startProgressBtn.click();
      await expect(page.getByText(/Task moved to in progress/i)).toBeVisible({ timeout: 10000 });
    }

    // Move to Complete / Done
    const completeBtn = drawer.getByRole("button", { name: /Mark Complete/i });
    await expect(completeBtn).toBeVisible({ timeout: 10000 });
    await completeBtn.click();
    await expect(page.getByText(/Task moved to done/i)).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test("Visibility scoping: employee sees own/assigned only, manager sees team, admin/hr see all", async ({ browser }) => {
    const suffix = Date.now().toString().slice(-6);
    const empTaskTitle = `TEST_EmpTask_${suffix}`;
    const hrPrivateTitle = `TEST_HrPrivate_${suffix}`;

    // Seed tasks via supabaseAdmin
    const todayIso = new Date().toISOString().slice(0, 10);
    await supabaseAdmin.from("tasks").insert([
      {
        organization_id: ORG_ID,
        creator_id: TEST_MANAGER_ID,
        assignee_id: TEST_EMPLOYEE_ID,
        title: empTaskTitle,
        status: "todo",
        priority: "medium",
        due_date: todayIso,
      },
      {
        organization_id: ORG_ID,
        creator_id: TEST_HR_ID,
        assignee_id: TEST_HR_ID,
        title: hrPrivateTitle,
        status: "todo",
        priority: "low",
        due_date: todayIso,
      },
    ]);

    // 1. Employee checks: sees empTaskTitle, does NOT see hrPrivateTitle
    const empPath = await getStorageStatePath("employee");
    const empContext = await browser.newContext({ storageState: empPath });
    const empPage = await empContext.newPage();
    await empPage.goto("/tasks");
    await expect(empPage.getByRole("heading", { name: /Tasks & Team Work/i })).toBeVisible({ timeout: 20000 });
    await expect(empPage.getByText(empTaskTitle).first()).toBeVisible({ timeout: 15000 });
    await expect(empPage.getByText(hrPrivateTitle)).not.toBeVisible();
    await empContext.close();

    // 2. Manager checks: sees empTaskTitle (since employee is in manager's department/team)
    const mgrPath = await getStorageStatePath("manager");
    const mgrContext = await browser.newContext({ storageState: mgrPath });
    const mgrPage = await mgrContext.newPage();
    await mgrPage.goto("/tasks");
    await expect(mgrPage.getByRole("heading", { name: /Tasks & Team Work/i })).toBeVisible({ timeout: 20000 });
    // Switch to Team Tasks scope if needed
    const teamBtn = mgrPage.getByRole("button", { name: /Team Tasks/i });
    await expect(teamBtn).toBeVisible({ timeout: 15000 });
    await teamBtn.click();
    await expect(mgrPage.getByText(empTaskTitle).first()).toBeVisible({ timeout: 15000 });
    await mgrContext.close();

    // 3. Admin checks: sees all tasks
    const adminPath = await getStorageStatePath("admin");
    const adminContext = await browser.newContext({ storageState: adminPath });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/tasks");
    await expect(adminPage.getByRole("heading", { name: /Tasks & Team Work/i })).toBeVisible({ timeout: 20000 });
    const allOrgBtn = adminPage.getByRole("button", { name: /All Org Tasks/i });
    await expect(allOrgBtn).toBeVisible({ timeout: 15000 });
    await allOrgBtn.click();
    await expect(adminPage.getByText(empTaskTitle).first()).toBeVisible({ timeout: 15000 });
    await expect(adminPage.getByText(hrPrivateTitle).first()).toBeVisible({ timeout: 15000 });
    await adminContext.close();
  });

  test("Employee cannot edit or update status of others' tasks via API", async () => {
    const empSession = await loginAndGetSession("employee");
    const suffix = Date.now().toString().slice(-6);
    const hrTaskTitle = `TEST_HrOnly_${suffix}`;

    // Insert task assigned to HR
    const { data: insertedTask } = await supabaseAdmin
      .from("tasks")
      .insert({
        organization_id: ORG_ID,
        creator_id: TEST_HR_ID,
        assignee_id: TEST_HR_ID,
        title: hrTaskTitle,
        status: "todo",
        priority: "medium",
      })
      .select("id")
      .single();

    expect(insertedTask).toBeTruthy();

    // Attempt to update task status using employee's client token
    const empClient = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL || "https://bycyebxvxhmhelrvglvf.supabase.co",
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      {
        global: {
          headers: {
            Authorization: `Bearer ${empSession.access_token}`,
          },
        },
      }
    );

    const { error } = await empClient.rpc("update_task_status", {
      p_task_id: insertedTask?.id,
      p_new_status: "in_progress",
    });

    // Should fail with 42501 (Forbidden / not found in scope)
    expect(error).toBeTruthy();
  });
});

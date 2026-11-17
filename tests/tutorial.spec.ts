import { test, expect } from "@playwright/test";
import { getStorageStatePath, ensureStorageState, RoleName, loadEnvTest } from "./helpers/auth";
import { createClient } from "@supabase/supabase-js";
import { ROLE_TUTORIAL_STEPS } from "../lib/tutorial/tutorial-config";

const env = loadEnvTest();
const supabaseAdmin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || "https://bycyebxvxhmhelrvglvf.supabase.co",
  env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const TEST_USERS: Record<RoleName, string> = {
  admin: "2552130d-cf00-4fdd-a676-e800c11937ce",
  hr: "3c3c8829-7902-470c-be62-297dccb3e382",
  manager: "7dcc9541-a983-4642-bd32-3c55915cc9b1",
  employee: "71dce25f-f1de-4148-ad61-6274c61c1ee7",
};

test.describe("Walkthrough Tour Verification per Role", () => {
  const guidedRoles: RoleName[] = ["employee", "manager", "hr"];

  for (const role of guidedRoles) {
    test(`Role: ${role} - tour auto-starts once, progresses through all steps, and completes`, async ({ browser }) => {
      const userId = TEST_USERS[role];

      // Set tutorial_completed = false for this TEST_ user only
      await supabaseAdmin.from("profiles").upsert(
        {
          id: userId,
          user_id: userId,
          tutorial_completed: false,
          onboarding_completed: true,
        },
        { onConflict: "id" }
      );

      await supabaseAdmin
        .from("employees")
        .update({
          tutorial_completed: false,
          onboarding_completed: true,
        })
        .eq("id", userId);

      const storagePath = await ensureStorageState(role, true);
      const context = await browser.newContext({ storageState: storagePath });
      const page = await context.newPage();

      try {
        await page.goto("/");
        await page.waitForLoadState("domcontentloaded");

        // Assert tour dialog starts
        const tourDialog = page.locator('div[role="dialog"]');
        await expect(tourDialog).toBeVisible({ timeout: 15000 });

        const steps = ROLE_TUTORIAL_STEPS[role] || [];
        expect(steps.length).toBeGreaterThan(0);

        // Click Next through every step
        for (let i = 0; i < steps.length; i++) {
          const isLast = i === steps.length - 1;
          const nextOrFinishBtn = page.getByRole("button", { name: isLast ? /finish/i : /next/i });
          await expect(nextOrFinishBtn).toBeVisible({ timeout: 5000 });
          await nextOrFinishBtn.click();
          if (!isLast) {
            await page.waitForTimeout(300);
          }
        }

        // Tour dialog should disappear
        await expect(tourDialog).not.toBeVisible({ timeout: 5000 });

        // Reload page and assert it does NOT start again
        await page.reload();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(1000);
        await expect(tourDialog).not.toBeVisible();

        // Verify DB flag is true
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("tutorial_completed")
          .eq("id", userId)
          .single();
        expect(prof?.tutorial_completed).toBe(true);
      } finally {
        await context.close();
      }
    });
  }

  test("Role: admin - tour never starts and replay button is hidden", async ({ browser }) => {
    const adminId = TEST_USERS["admin"];
    await supabaseAdmin.from("profiles").upsert(
      {
        id: adminId,
        user_id: adminId,
        tutorial_completed: false,
        onboarding_completed: true,
      },
      { onConflict: "id" }
    );

    const storagePath = await ensureStorageState("admin", true);
    const context = await browser.newContext({ storageState: storagePath });
    const page = await context.newPage();

    try {
      await page.goto("/dashboard");
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2000);

      // Assert tour never starts
      const tourDialog = page.locator('div[role="dialog"]');
      await expect(tourDialog).not.toBeVisible();

      // Visit /profile and assert Replay button is hidden
      await page.goto("/profile");
      await page.waitForLoadState("domcontentloaded");
      const replayBtn = page.getByRole("button", { name: /replay workplace tutorial/i });
      await expect(replayBtn).not.toBeVisible();
    } finally {
      await context.close();
    }
  });
});

import { test, expect } from "@playwright/test";
import { getStorageStatePath, loginAndGetSession, loadEnvTest } from "../helpers/auth";
import { createClient } from "@supabase/supabase-js";

const env = loadEnvTest();
const supabaseAdmin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || "https://bycyebxvxhmhelrvglvf.supabase.co",
  env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const TEST_USER_IDS = [
  "2552130d-cf00-4fdd-a676-e800c11937ce", // admin
  "3c3c8829-7902-470c-be62-297dccb3e382", // hr
  "7dcc9541-a983-4642-bd32-3c55915cc9b1", // manager
  "71dce25f-f1de-4148-ad61-6274c61c1ee7", // employee
];

const EMPLOYEE_ID = "71dce25f-f1de-4148-ad61-6274c61c1ee7";
const ORG_ID = "00000000-0000-0000-0000-000000000001";

function getTodayKolkata(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

async function cleanupTestAttendance() {
  await supabaseAdmin
    .from("attendance_sessions")
    .delete()
    .in("employee_id", TEST_USER_IDS);
}

test.beforeEach(async () => {
  await cleanupTestAttendance();
});

test.afterAll(async () => {
  await cleanupTestAttendance();
});

test.describe("Module 1: Attendance - API Enforcement & Edge Cases", () => {
  test("Check-out without active session is rejected with 400", async ({ request }) => {
    const session = await loginAndGetSession("employee");
    const res = await request.post("/api/attendance/checkout", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("NO_ACTIVE_SESSION");
  });

  test("Early check-out API returns 409 EARLY_CHECKOUT without confirm_early", async ({ request }) => {
    const session = await loginAndGetSession("employee");

    // Ensure shift ends in future (overnight 17:00 to 01:00) so early checkout is triggered regardless of test run time
    await supabaseAdmin
      .from("employees")
      .update({ shift_start_time: "17:00:00", shift_end_time: "01:00:00" })
      .eq("id", EMPLOYEE_ID);

    try {
      // Create an active session for employee today
      const todayStr = getTodayKolkata();
      const { data: inserted, error } = await supabaseAdmin.from("attendance_sessions").insert({
        employee_id: EMPLOYEE_ID,
        organization_id: ORG_ID,
        work_date: todayStr,
        check_in_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        source: "web",
        note: "TEST_ Session",
      }).select().single();

      expect(error).toBeNull();
      expect(inserted).toBeDefined();

      // Call checkout without confirm_early
      const res = await request.post("/api/attendance/checkout", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        data: {},
      });

      expect(res.status()).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("EARLY_CHECKOUT");
      expect(body.shift_end_time).toBe("01:00");
      expect(body.minutes_early).toBeGreaterThan(0);
      expect(body.message).toContain("early. Check out anyway?");

      // Session remains active
      const { data: checkActive } = await supabaseAdmin
        .from("attendance_sessions")
        .select("check_out_at")
        .eq("id", inserted.id)
        .single();
      expect(checkActive?.check_out_at).toBeNull();

      // Call checkout WITH confirm_early: true
      const confirmRes = await request.post("/api/attendance/checkout", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        data: { confirm_early: true, reason: "Doctor appointment" },
      });

      expect(confirmRes.status()).toBe(200);
      const confirmBody = await confirmRes.json();
      expect(confirmBody.success).toBe(true);
      expect(confirmBody.early_checkout).toBe(true);

      // Verify session was closed and note contains reason
      const { data: closedSession } = await supabaseAdmin
        .from("attendance_sessions")
        .select("check_out_at, note")
        .eq("id", inserted.id)
        .single();
      expect(closedSession?.check_out_at).not.toBeNull();
      expect(closedSession?.note).toContain("Doctor appointment");
    } finally {
      await supabaseAdmin
        .from("employees")
        .update({ shift_start_time: "09:00:00", shift_end_time: "17:00:00" })
        .eq("id", EMPLOYEE_ID);
    }
  });

  test("Night shift crossing midnight calculates shift end on next calendar day", async ({ request }) => {
    const session = await loginAndGetSession("employee");

    // Update employee shift to overnight 17:00 to 01:00
    await supabaseAdmin
      .from("employees")
      .update({ shift_start_time: "17:00:00", shift_end_time: "01:00:00" })
      .eq("id", EMPLOYEE_ID);

    try {
      const todayStr = getTodayKolkata();
      const { data: inserted } = await supabaseAdmin.from("attendance_sessions").insert({
        employee_id: EMPLOYEE_ID,
        organization_id: ORG_ID,
        work_date: todayStr,
        check_in_at: new Date().toISOString(),
        source: "web",
        note: "TEST_ Night Shift Session",
      }).select().single();

      const res = await request.post("/api/attendance/checkout", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        data: {},
      });

      // Shift ends at 01:00, checkout should return 409 with shift_end_time 01:00
      expect(res.status()).toBe(409);
      const body = await res.json();
      expect(body.shift_end_time).toBe("01:00");
    } finally {
      // Restore standard shift
      await supabaseAdmin
        .from("employees")
        .update({ shift_start_time: "09:00:00", shift_end_time: "17:00:00" })
        .eq("id", EMPLOYEE_ID);
    }
  });
});

test.describe("Module 1: Attendance - UI Punch & Confirmation Dialog", () => {
  test.use({ storageState: getStorageStatePath("employee") });

  test("Hero card check-out shows early dialog, cancel leaves session open, confirm checks out", async ({ page }) => {
    // Set shift to overnight 17:00 to 01:00 so early checkout is guaranteed
    await supabaseAdmin
      .from("employees")
      .update({ shift_start_time: "17:00:00", shift_end_time: "01:00:00" })
      .eq("id", EMPLOYEE_ID);

    try {
      // 1. Create active session for employee so UI loads in checked-in state
      const todayStr = getTodayKolkata();
      const { data: inserted } = await supabaseAdmin.from("attendance_sessions").insert({
        employee_id: EMPLOYEE_ID,
        organization_id: ORG_ID,
        work_date: todayStr,
        check_in_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        source: "web",
        note: "TEST_ UI Session",
      }).select().single();

      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      // Assert session is active
      await expect(page.getByText("Active Session").first()).toBeVisible({ timeout: 10000 });
      const checkOutBtn = page.getByRole("button", { name: /check out now/i }).first();
      await expect(checkOutBtn).toBeVisible();

      // Click Check Out Now -> Early Check-Out modal should appear
      await checkOutBtn.click();

      const dialogTitle = page.getByText("Early Check-Out Confirmation");
      await expect(dialogTitle).toBeVisible({ timeout: 5000 });

      // Assert message contains shift ends at 01:00
      await expect(page.getByText(/Your shift ends at 01:00/).first()).toBeVisible();

      // Click Cancel -> dialog closes, session remains active
      const cancelBtn = page.getByRole("button", { name: "Cancel" });
      await cancelBtn.click();
      await expect(dialogTitle).not.toBeVisible();

      // Verify session still active in DB
      const { data: sessionStillActive } = await supabaseAdmin
        .from("attendance_sessions")
        .select("check_out_at")
        .eq("id", inserted.id)
        .single();
      expect(sessionStillActive?.check_out_at).toBeNull();

      // Click Check Out Now again -> Confirm check-out
      await checkOutBtn.click();
      await expect(dialogTitle).toBeVisible();

      const reasonInput = page.locator("#early-checkout-reason");
      await reasonInput.fill("TEST_ Early checkout for doctor");

      const confirmBtn = page.getByRole("button", { name: "Yes, check out" });
      await confirmBtn.click();

      // Modal closes and toast or checked out state appears
      await expect(dialogTitle).not.toBeVisible({ timeout: 10000 });
      await expect(page.getByText("Checked out successfully!").first()).toBeVisible({ timeout: 10000 });

      // Verify session closed in DB
      const { data: sessionClosed } = await supabaseAdmin
        .from("attendance_sessions")
        .select("check_out_at")
        .eq("id", inserted.id)
        .single();
      expect(sessionClosed?.check_out_at).not.toBeNull();
    } finally {
      await supabaseAdmin
        .from("employees")
        .update({ shift_start_time: "09:00:00", shift_end_time: "17:00:00" })
        .eq("id", EMPLOYEE_ID);
    }
  });
});

test.describe("Module 1: Attendance - Role Scoping & Visibility", () => {
  for (const role of ["employee", "manager", "hr", "admin"] as const) {
    test.describe(`Attendance page for ${role}`, () => {
      test.use({ storageState: getStorageStatePath(role) });

      test(`${role} loads attendance history without error`, async ({ page }) => {
        await page.goto("/attendance");
        await page.waitForLoadState("domcontentloaded");
        expect(page.url()).toContain("/attendance");
        await expect(page.locator("body")).toBeVisible();
      });
    });
  }
});

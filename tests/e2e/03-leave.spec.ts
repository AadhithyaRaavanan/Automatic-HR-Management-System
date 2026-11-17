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
const CASUAL_LEAVE_TYPE_ID = "00000000-0000-0000-0000-000000000001";

async function cleanupTestLeave() {
  await supabaseAdmin
    .from("leave_requests")
    .delete()
    .ilike("reason", "TEST_%");
  await supabaseAdmin
    .from("leave_balances")
    .delete()
    .in("employee_id", [TEST_ADMIN_ID, TEST_HR_ID, TEST_MANAGER_ID, TEST_EMPLOYEE_ID]);
}

test.beforeEach(async () => {
  await cleanupTestLeave();
});

test.afterAll(async () => {
  await cleanupTestLeave();
});

test.describe("Module 3: Leave Management & Authorization", () => {
  test("Apply leave validation: end date before start, over-balance, and overlap are rejected", async () => {
    const empSession = await loginAndGetSession("employee");
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

    // Seed 2 days of leave balance
    await supabaseAdmin.from("leave_balances").upsert({
      organization_id: ORG_ID,
      employee_id: TEST_EMPLOYEE_ID,
      leave_type_id: CASUAL_LEAVE_TYPE_ID,
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      allocated: 2,
      used: 0,
      carried_forward: 0,
      adjusted: 0,
    });

    // 1. End date before start date rejected
    const { error: invalidRangeErr } = await empClient.rpc("request_leave", {
      p_leave_type_id: CASUAL_LEAVE_TYPE_ID,
      p_start_date: "2026-12-10",
      p_end_date: "2026-12-05",
      p_day_part: "full",
      p_reason: "TEST_InvalidRange",
    });
    expect(invalidRangeErr).toBeTruthy();

    // 2. Over-balance rejected (requesting 5 working days when only 2 available)
    const { error: overBalErr } = await empClient.rpc("request_leave", {
      p_leave_type_id: CASUAL_LEAVE_TYPE_ID,
      p_start_date: "2026-12-07", // Mon
      p_end_date: "2026-12-11",   // Fri = 5 days
      p_day_part: "full",
      p_reason: "TEST_OverBalance",
    });
    expect(overBalErr).toBeTruthy();
    expect(overBalErr?.message).toMatch(/Insufficient leave balance/i);

    // 3. Valid application succeeds (1 day)
    const { error: validErr, data: validReq } = await empClient.rpc("request_leave", {
      p_leave_type_id: CASUAL_LEAVE_TYPE_ID,
      p_start_date: "2026-12-08",
      p_end_date: "2026-12-08",
      p_day_part: "full",
      p_reason: "TEST_ValidLeave",
    });
    expect(validErr).toBeNull();
    expect(validReq).toBeTruthy();

    // 4. Overlapping request on same date is rejected by exclusion constraint
    const { error: overlapErr } = await empClient.rpc("request_leave", {
      p_leave_type_id: CASUAL_LEAVE_TYPE_ID,
      p_start_date: "2026-12-08",
      p_end_date: "2026-12-08",
      p_day_part: "full",
      p_reason: "TEST_OverlappingLeave",
    });
    expect(overlapErr).toBeTruthy();
  });

  test("Review API: note min 5 chars required, rejection preserves balance, approval deducts balance", async () => {
    const hrSession = await loginAndGetSession("hr");

    // Seed 10 days balance
    await supabaseAdmin.from("leave_balances").upsert({
      organization_id: ORG_ID,
      employee_id: TEST_EMPLOYEE_ID,
      leave_type_id: CASUAL_LEAVE_TYPE_ID,
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      allocated: 10,
      used: 0,
      carried_forward: 0,
      adjusted: 0,
    });

    // Create a pending leave request for test_employee
    const { data: createdReq } = await supabaseAdmin
      .from("leave_requests")
      .insert({
        organization_id: ORG_ID,
        employee_id: TEST_EMPLOYEE_ID,
        leave_type_id: CASUAL_LEAVE_TYPE_ID,
        start_date: "2026-12-15",
        end_date: "2026-12-16",
        total_days: 2,
        day_part: "full",
        reason: "TEST_PendingReq",
        status: "pending",
      })
      .select("id")
      .single();

    expect(createdReq).toBeTruthy();

    // 1. Review without note or short note (< 5 chars) is rejected with 400
    const resNoNote = await fetch("https://pulse.zenxea.com/api/leave/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hrSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: createdReq?.id,
        action: "approve",
        reviewNote: "ok", // only 2 chars
      }),
    });
    expect(resNoNote.status).toBe(400);

    // 2. Reject request with valid note (min 5 chars) -> balance used remains 0
    const resReject = await fetch("https://pulse.zenxea.com/api/leave/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hrSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: createdReq?.id,
        action: "reject",
        reviewNote: "Rejected due to critical milestone",
      }),
    });
    expect(resReject.status).toBe(200);

    // Verify balance is unchanged on rejection
    const { data: balAfterReject } = await supabaseAdmin
      .from("leave_balances")
      .select("used")
      .eq("employee_id", TEST_EMPLOYEE_ID)
      .eq("leave_type_id", CASUAL_LEAVE_TYPE_ID)
      .single();
    expect(balAfterReject?.used).toBe(0);

    // Create a new pending request for approval
    const { data: createdReq2 } = await supabaseAdmin
      .from("leave_requests")
      .insert({
        organization_id: ORG_ID,
        employee_id: TEST_EMPLOYEE_ID,
        leave_type_id: CASUAL_LEAVE_TYPE_ID,
        start_date: "2026-12-22",
        end_date: "2026-12-23",
        total_days: 2,
        day_part: "full",
        reason: "TEST_PendingReq2",
        status: "pending",
      })
      .select("id")
      .single();

    // 3. Approve request with valid note -> balance used is deducted (+2)
    const resApprove = await fetch("https://pulse.zenxea.com/api/leave/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hrSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: createdReq2?.id,
        action: "approve",
        reviewNote: "Approved for personal time off",
      }),
    });
    expect(resApprove.status).toBe(200);

    // Verify balance used is now 2
    const { data: balAfterApprove } = await supabaseAdmin
      .from("leave_balances")
      .select("used")
      .eq("employee_id", TEST_EMPLOYEE_ID)
      .eq("leave_type_id", CASUAL_LEAVE_TYPE_ID)
      .single();
    expect(balAfterApprove?.used).toBe(2);

    // Verify applicant sees reviewer note on request
    const { data: updatedReq } = await supabaseAdmin
      .from("leave_requests")
      .select("review_note, status")
      .eq("id", createdReq2?.id)
      .single();
    expect(updatedReq?.status).toBe("approved");
    expect(updatedReq?.review_note).toBe("Approved for personal time off");
  });

  test("Who may review whom: employee cannot review, manager reviews own team only, self-approval blocked", async () => {
    const empSession = await loginAndGetSession("employee");
    const mgrSession = await loginAndGetSession("manager");
    const adminSession = await loginAndGetSession("admin");

    // Create request for employee (in manager's team)
    const { data: empReq } = await supabaseAdmin
      .from("leave_requests")
      .insert({
        organization_id: ORG_ID,
        employee_id: TEST_EMPLOYEE_ID,
        leave_type_id: CASUAL_LEAVE_TYPE_ID,
        start_date: "2026-12-28",
        end_date: "2026-12-28",
        total_days: 1,
        day_part: "full",
        reason: "TEST_EmpTeamReq",
        status: "pending",
      })
      .select("id")
      .single();

    // Create request for HR (NOT in manager's team)
    const { data: hrReq } = await supabaseAdmin
      .from("leave_requests")
      .insert({
        organization_id: ORG_ID,
        employee_id: TEST_HR_ID,
        leave_type_id: CASUAL_LEAVE_TYPE_ID,
        start_date: "2026-12-29",
        end_date: "2026-12-29",
        total_days: 1,
        day_part: "full",
        reason: "TEST_HrReq",
        status: "pending",
      })
      .select("id")
      .single();

    // 1. Employee cannot review anyone's leave request (403)
    const resEmpReview = await fetch("https://pulse.zenxea.com/api/leave/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${empSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: empReq?.id,
        action: "approve",
        reviewNote: "Trying to self-approve or review",
      }),
    });
    expect(resEmpReview.status).toBe(403);

    // 2. Manager cannot review non-team member (HR user) (403)
    const resMgrNonTeam = await fetch("https://pulse.zenxea.com/api/leave/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mgrSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: hrReq?.id,
        action: "approve",
        reviewNote: "Manager approving non team member",
      }),
    });
    expect(resMgrNonTeam.status).toBe(403);

    // 3. Manager CAN review own team member (employee) (200)
    const resMgrTeam = await fetch("https://pulse.zenxea.com/api/leave/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mgrSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: empReq?.id,
        action: "approve",
        reviewNote: "Manager approving direct report",
      }),
    });
    expect(resMgrTeam.status).toBe(200);

    // 4. Admin cannot self-approve own leave request (403)
    const { data: adminReq } = await supabaseAdmin
      .from("leave_requests")
      .insert({
        organization_id: ORG_ID,
        employee_id: TEST_ADMIN_ID,
        leave_type_id: CASUAL_LEAVE_TYPE_ID,
        start_date: "2026-12-30",
        end_date: "2026-12-30",
        total_days: 1,
        day_part: "full",
        reason: "TEST_AdminSelfReq",
        status: "pending",
      })
      .select("id")
      .single();

    const resAdminSelf = await fetch("https://pulse.zenxea.com/api/leave/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: adminReq?.id,
        action: "approve",
        reviewNote: "Admin attempting self-approval",
      }),
    });
    expect(resAdminSelf.status).toBe(403);
  });

  test("Employee is denied access to /hr/leave and redirected to /403 or /", async ({ browser }) => {
    const empPath = await getStorageStatePath("employee");
    const context = await browser.newContext({ storageState: empPath });
    const page = await context.newPage();

    await page.goto("/hr/leave");
    // Should be redirected away from /hr/leave (to /403 or /)
    await expect(page).not.toHaveURL(/\/hr\/leave$/);
    await context.close();
  });

  test("Review dialog in UI enforces minimum 5 characters before enabling submit", async ({ browser }) => {
    // Seed pending leave request for test_employee
    const { data: req } = await supabaseAdmin
      .from("leave_requests")
      .insert({
        organization_id: ORG_ID,
        employee_id: TEST_EMPLOYEE_ID,
        leave_type_id: CASUAL_LEAVE_TYPE_ID,
        start_date: "2026-12-24",
        end_date: "2026-12-24",
        total_days: 1,
        day_part: "full",
        reason: "TEST_UIDialogCheck",
        status: "pending",
      })
      .select("id")
      .single();

    const hrPath = await getStorageStatePath("hr");
    const context = await browser.newContext({ storageState: hrPath });
    const page = await context.newPage();

    await page.goto("/hr/leave");
    await expect(page.getByRole("heading", { name: /Leave Management & Approvals/i })).toBeVisible({ timeout: 20000 });

    // Find and click approve button for this request
    const approveBtn = page.getByRole("button", { name: /Approve leave/i }).first();
    await expect(approveBtn).toBeVisible({ timeout: 15000 });
    await approveBtn.click();

    // Verify modal appears
    await expect(page.getByRole("heading", { name: /Approve Leave Request/i })).toBeVisible();

    const noteTextarea = page.getByPlaceholder(/Provide mandatory reason or feedback/i);
    const confirmBtn = page.getByRole("button", { name: /Confirm Approval/i });

    // Submit is initially disabled when note is empty
    await expect(confirmBtn).toBeDisabled();

    // Submit remains disabled with 3 characters
    await noteTextarea.fill("abc");
    await expect(confirmBtn).toBeDisabled();

    // Submit is enabled with 5+ characters
    await noteTextarea.fill("Approved by HR for testing");
    await expect(confirmBtn).toBeEnabled();

    await context.close();
  });
});

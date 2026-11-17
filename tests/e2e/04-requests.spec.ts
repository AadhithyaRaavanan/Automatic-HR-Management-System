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

async function cleanupTestRequests() {
  await supabaseAdmin
    .from("regularization_requests")
    .delete()
    .ilike("reason", "TEST_%");
  await supabaseAdmin
    .from("attendance_days")
    .delete()
    .in("employee_id", [TEST_ADMIN_ID, TEST_HR_ID, TEST_MANAGER_ID, TEST_EMPLOYEE_ID]);
}

test.beforeEach(async () => {
  await cleanupTestRequests();
});

test.afterAll(async () => {
  await cleanupTestRequests();
});

test.describe("Module 4: Regularization Requests & Authorization", () => {
  test("Submission validation: future date and duplicate date are rejected", async ({ browser }) => {
    const empPath = await getStorageStatePath("employee");
    const context = await browser.newContext({ storageState: empPath });
    const page = await context.newPage();

    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: /Approvals, Requests & Delegations|Manager Approvals/i })).toBeVisible({ timeout: 20000 });

    // Open correction modal
    await page.getByRole("button", { name: /Apply Correction/i }).first().click();
    await expect(page.getByRole("heading", { name: /Request Attendance Correction/i })).toBeVisible();

    // 1. Future date validation
    const futureDate = "2029-12-31";
    const dateInput = page.locator('input[type="date"]').first();
    await dateInput.fill(futureDate);
    await page.locator('textarea[name="reason"]').fill("TEST_FutureDateReasonWithMin10Chars");
    await page.getByRole("button", { name: /Submit for Approval/i }).click();

    // Should display validation error and stay open
    await expect(page.getByText(/cannot be requested for a future date/i)).toBeVisible({ timeout: 10000 });

    // 2. Insert an existing pending request for yesterday
    const yesterday = "2026-11-16";
    await supabaseAdmin.from("regularization_requests").insert({
      organization_id: ORG_ID,
      employee_id: TEST_EMPLOYEE_ID,
      work_date: yesterday,
      requested_in: `${yesterday}T09:00:00Z`,
      requested_out: `${yesterday}T17:30:00Z`,
      reason: "TEST_DuplicateBase",
      status: "pending",
    });

    // Attempt submitting for duplicate date
    await dateInput.fill(yesterday);
    await page.getByRole("button", { name: /Submit for Approval/i }).click();
    await expect(page.getByText(/already exists for this date/i)).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test("Review API: note min 5 chars required, rejection does not update attendance, approval updates attendance", async () => {
    const hrSession = await loginAndGetSession("hr");
    const testDate = "2026-11-15";

    // Seed attendance_days record as absent
    await supabaseAdmin.from("attendance_days").upsert({
      organization_id: ORG_ID,
      employee_id: TEST_EMPLOYEE_ID,
      work_date: testDate,
      total_minutes: 0,
      status: "absent",
    });

    // Create a pending regularization request
    const { data: regReq } = await supabaseAdmin
      .from("regularization_requests")
      .insert({
        organization_id: ORG_ID,
        employee_id: TEST_EMPLOYEE_ID,
        work_date: testDate,
        requested_in: `${testDate}T09:00:00Z`,
        requested_out: `${testDate}T17:00:00Z`,
        reason: "TEST_CorrectionReasonForAttendance",
        status: "pending",
      })
      .select("id")
      .single();

    expect(regReq).toBeTruthy();

    // 1. Review without note or short note (< 5 chars) returns 400
    const resNoNote = await fetch("https://pulse.zenxea.com/api/requests/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hrSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: regReq?.id,
        action: "approve",
        reviewNote: "nope",
      }),
    });
    expect(resNoNote.status).toBe(400);

    // 2. Reject request with valid note (min 5 chars) -> attendance_days remains 'absent'
    const resReject = await fetch("https://pulse.zenxea.com/api/requests/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hrSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: regReq?.id,
        action: "reject",
        reviewNote: "Rejected due to missing verification proof",
      }),
    });
    expect(resReject.status).toBe(200);

    const { data: dayAfterReject } = await supabaseAdmin
      .from("attendance_days")
      .select("status")
      .eq("employee_id", TEST_EMPLOYEE_ID)
      .eq("work_date", testDate)
      .single();
    expect(dayAfterReject?.status).toBe("absent");

    // 3. Create second request for approval
    const testDate2 = "2026-11-14";
    await supabaseAdmin.from("attendance_days").upsert({
      organization_id: ORG_ID,
      employee_id: TEST_EMPLOYEE_ID,
      work_date: testDate2,
      total_minutes: 0,
      status: "absent",
    });

    const { data: regReq2 } = await supabaseAdmin
      .from("regularization_requests")
      .insert({
        organization_id: ORG_ID,
        employee_id: TEST_EMPLOYEE_ID,
        work_date: testDate2,
        requested_in: `${testDate2}T09:00:00Z`,
        requested_out: `${testDate2}T17:00:00Z`,
        reason: "TEST_CorrectionReasonForApproval",
        status: "pending",
      })
      .select("id")
      .single();

    // Approve request with valid note -> attendance_days status updates to 'present'
    const resApprove = await fetch("https://pulse.zenxea.com/api/requests/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hrSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: regReq2?.id,
        action: "approve",
        reviewNote: "Approved biometric failure regularization",
      }),
    });
    expect(resApprove.status).toBe(200);

    const { data: dayAfterApprove } = await supabaseAdmin
      .from("attendance_days")
      .select("status")
      .eq("employee_id", TEST_EMPLOYEE_ID)
      .eq("work_date", testDate2)
      .single();
    expect(dayAfterApprove?.status).toBe("present");

    // Verify applicant sees reviewer note on request
    const { data: updatedReq } = await supabaseAdmin
      .from("regularization_requests")
      .select("review_note, status")
      .eq("id", regReq2?.id)
      .single();
    expect(updatedReq?.status).toBe("approved");
    expect(updatedReq?.review_note).toBe("Approved biometric failure regularization");
  });

  test("Who may review whom: employee cannot review, manager reviews own team only, self-approval blocked", async () => {
    const empSession = await loginAndGetSession("employee");
    const mgrSession = await loginAndGetSession("manager");
    const adminSession = await loginAndGetSession("admin");

    // Request for employee (in manager's team)
    const { data: empReq } = await supabaseAdmin
      .from("regularization_requests")
      .insert({
        organization_id: ORG_ID,
        employee_id: TEST_EMPLOYEE_ID,
        work_date: "2026-11-13",
        requested_in: "2026-11-13T09:00:00Z",
        requested_out: "2026-11-13T17:00:00Z",
        reason: "TEST_EmpTeamReq",
        status: "pending",
      })
      .select("id")
      .single();

    // Request for HR (NOT in manager's team)
    const { data: hrReq } = await supabaseAdmin
      .from("regularization_requests")
      .insert({
        organization_id: ORG_ID,
        employee_id: TEST_HR_ID,
        work_date: "2026-11-12",
        requested_in: "2026-11-12T09:00:00Z",
        requested_out: "2026-11-12T17:00:00Z",
        reason: "TEST_HrReq",
        status: "pending",
      })
      .select("id")
      .single();

    // 1. Employee cannot review anyone's regularization request (403)
    const resEmpReview = await fetch("https://pulse.zenxea.com/api/requests/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${empSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: empReq?.id,
        action: "approve",
        reviewNote: "Employee attempting unauthorized review",
      }),
    });
    expect(resEmpReview.status).toBe(403);

    // 2. Manager cannot review non-team member (403)
    const resMgrNonTeam = await fetch("https://pulse.zenxea.com/api/requests/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mgrSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: hrReq?.id,
        action: "approve",
        reviewNote: "Manager approving non team report",
      }),
    });
    expect(resMgrNonTeam.status).toBe(403);

    // 3. Manager CAN review direct report (200)
    const resMgrTeam = await fetch("https://pulse.zenxea.com/api/requests/review", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mgrSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: empReq?.id,
        action: "approve",
        reviewNote: "Manager approving direct report punch",
      }),
    });
    expect(resMgrTeam.status).toBe(200);

    // 4. Admin cannot self-approve own request (403)
    const { data: adminReq } = await supabaseAdmin
      .from("regularization_requests")
      .insert({
        organization_id: ORG_ID,
        employee_id: TEST_ADMIN_ID,
        work_date: "2026-11-11",
        requested_in: "2026-11-11T09:00:00Z",
        requested_out: "2026-11-11T17:00:00Z",
        reason: "TEST_AdminSelfReq",
        status: "pending",
      })
      .select("id")
      .single();

    const resAdminSelf = await fetch("https://pulse.zenxea.com/api/requests/review", {
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
});

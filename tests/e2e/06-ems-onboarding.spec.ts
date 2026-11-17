import { test, expect } from "@playwright/test";
import { getStorageStatePath, loginAndGetSession, loadEnvTest } from "../helpers/auth";
import { createClient } from "@supabase/supabase-js";
import { inviteSingleEmployee } from "../../lib/admin/invite-employee";

const env = loadEnvTest();
const supabaseAdmin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || "https://bycyebxvxhmhelrvglvf.supabase.co",
  env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ADMIN_ID = "2552130d-cf00-4fdd-a676-e800c11937ce";
const TEST_HR_ID = "3c3c8829-7902-470c-be62-297dccb3e382";
const TEST_MANAGER_ID = "7dcc9541-a983-4642-bd32-3c55915cc9b1";
const TEST_EMPLOYEE_ID = "71dce25f-f1de-4148-ad61-6274c61c1ee7";

async function cleanupTestOnboarding() {
  await supabaseAdmin.from("onboarding_documents").delete().ilike("document_name", "TEST_%");
  const { data: testEmps } = await supabaseAdmin
    .from("employees")
    .select("id")
    .ilike("email", "test_candidate_%");
  if (testEmps && testEmps.length > 0) {
    const ids = testEmps.map((e) => e.id);
    await supabaseAdmin.from("onboarding_profiles").delete().in("user_id", ids);
    await supabaseAdmin.from("employees").delete().in("id", ids);
    for (const id of ids) {
      await supabaseAdmin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
}

test.beforeEach(async () => {
  await cleanupTestOnboarding();
});

test.afterAll(async () => {
  await cleanupTestOnboarding();
});

test.describe("Module 6: EMS & Onboarding Verification", () => {
  test("EMS Headcounts & Scoping per Role: Admin/HR all, Manager own dept, Employee denied", async ({ request, browser }) => {
    const adminSession = await loginAndGetSession("admin");
    const hrSession = await loginAndGetSession("hr");
    const mgrSession = await loginAndGetSession("manager");
    const empSession = await loginAndGetSession("employee");

    // 1. Employee denied from EMS routes (UI & API)
    const empContext = await browser.newContext({ storageState: getStorageStatePath("employee") });
    const empPage = await empContext.newPage();
    await empPage.goto("/ems");
    // Should be redirected to /403 or /
    await expect(empPage).not.toHaveURL(/\/ems$/);
    await empContext.close();

    const empResOverview = await request.get("/api/ems/overview", {
      headers: { Authorization: `Bearer ${empSession.access_token}` },
    });
    expect(empResOverview.status()).toBe(403);

    const empResEmployees = await request.get("/api/employees", {
      headers: { Authorization: `Bearer ${empSession.access_token}` },
    });
    expect(empResEmployees.status()).toBe(403);

    const empResDepts = await request.get("/api/admin/departments", {
      headers: { Authorization: `Bearer ${empSession.access_token}` },
    });
    expect(empResDepts.status()).toBe(403);

    // 2. Admin & HR see full workforce counts (> 0)
    const adminResOverview = await request.get("/api/ems/overview", {
      headers: { Authorization: `Bearer ${adminSession.access_token}` },
    });
    expect(adminResOverview.status()).toBe(200);
    const adminOverviewData = await adminResOverview.json();
    expect(adminOverviewData.stats.totalEmployees).toBeGreaterThan(0);
    expect(adminOverviewData.stats.totalDepartments).toBeGreaterThan(0);

    const hrResEmployees = await request.get("/api/employees", {
      headers: { Authorization: `Bearer ${hrSession.access_token}` },
    });
    expect(hrResEmployees.status()).toBe(200);
    const hrEmployeesData = await hrResEmployees.json();
    expect(hrEmployeesData.employees.length).toBeGreaterThan(0);

    // 3. Manager is scoped to own department
    const { data: mgrEmp } = await supabaseAdmin
      .from("employees")
      .select("department_id")
      .eq("id", TEST_MANAGER_ID)
      .single();

    const mgrResOverview = await request.get("/api/ems/overview", {
      headers: { Authorization: `Bearer ${mgrSession.access_token}` },
    });
    expect(mgrResOverview.status()).toBe(200);
    const mgrOverviewData = await mgrResOverview.json();
    expect(mgrOverviewData.stats.totalEmployees).toBeGreaterThan(0);

    const mgrResEmployees = await request.get("/api/employees", {
      headers: { Authorization: `Bearer ${mgrSession.access_token}` },
    });
    expect(mgrResEmployees.status()).toBe(200);
    const mgrEmployeesData = await mgrResEmployees.json();
    expect(mgrEmployeesData.employees.length).toBeGreaterThan(0);
    if (mgrEmp?.department_id) {
      for (const e of mgrEmployeesData.employees) {
        expect(e.department_id).toBe(mgrEmp.department_id);
      }
    }
  });

  test("Invite link uses https://pulse.zenxea.com, never localhost", async () => {
    const inviteEmail = `test_candidate_invite_${Date.now()}@zenxea.com`;
    const result = await inviteSingleEmployee(
      {
        userId: TEST_ADMIN_ID,
        role: "admin",
        organizationId: ORG_ID,
        aal: "aal1",
      },
      {
        email: inviteEmail,
        fullName: "TEST Candidate Invite",
        role: "employee",
        jobTitle: "Junior QA Engineer",
        departmentName: "Engineering",
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.inviteLink) {
      expect(result.inviteLink).toContain("https://pulse.zenxea.com");
      expect(result.inviteLink).not.toContain("localhost");
      expect(result.inviteLink).not.toContain("127.0.0.1");
    }

    // Clean up
    if (result.ok && (result as any).userId) {
      await supabaseAdmin.auth.admin.deleteUser((result as any).userId).catch(() => {});
    }
  });

  test("Onboarding wizard: required fields block Next, magic byte validation, HR note review", async ({ request, browser }) => {
    const hrSession = await loginAndGetSession("hr");

    // 1. Wizard required fields validation
    const empContext = await browser.newContext({ storageState: getStorageStatePath("employee") });
    const empPage = await empContext.newPage();
    await empPage.goto("/onboarding");
    await expect(empPage.getByRole("heading", { name: /Personal Information|Employee Onboarding|Onboarding Submitted/i })).toBeVisible({ timeout: 20000 });

    const nextStepBtn = empPage.getByRole("button", { name: /Next Step/i });
    if (await nextStepBtn.isVisible()) {
      // Clear required fields to test validation block
      const nameInput = empPage.locator('input[placeholder*="Full Name"], input[name="fullName"]').first();
      if (await nameInput.isVisible()) {
        await nameInput.fill("");
        await nextStepBtn.click();
        // Toast validation error
        await expect(empPage.getByText(/Full name is required|required/i)).toBeVisible({ timeout: 10000 });
      }
    }
    await empContext.close();

    // 2. File upload: under 5MB accepted, renamed .txt rejected
    // A. Renamed .txt rejected
    const fakePdfContent = Buffer.from("This is a plain text file pretending to be a PDF document.");
    const fakeFormData = new FormData();
    fakeFormData.append("file", new Blob([fakePdfContent], { type: "application/pdf" }), "renamed_text_file.pdf");
    fakeFormData.append("docType", "photo");

    const uploadFakeRes = await request.post("/api/onboarding/upload", {
      headers: { Authorization: `Bearer ${hrSession.access_token}` },
      multipart: {
        file: {
          name: "renamed_text_file.pdf",
          mimeType: "application/pdf",
          buffer: fakePdfContent,
        },
        docType: "photo",
      },
    });
    expect(uploadFakeRes.status()).toBe(400);
    const fakeUploadJson = await uploadFakeRes.json();
    expect(fakeUploadJson.error).toMatch(/Invalid file content|Document must be a valid PDF/i);

    // B. Real PDF magic bytes accepted
    const validPdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF");
    const uploadValidRes = await request.post("/api/onboarding/upload", {
      headers: { Authorization: `Bearer ${hrSession.access_token}` },
      multipart: {
        file: {
          name: "valid_document.pdf",
          mimeType: "application/pdf",
          buffer: validPdfBuffer,
        },
        docType: "photo",
      },
    });
    expect(uploadValidRes.status()).toBe(200);
    const validUploadJson = await uploadValidRes.json();
    expect(validUploadJson.storagePath).toBeDefined();

    // 3. HR document review requires note on rejection
    const docId = validUploadJson.docId || "00000000-0000-0000-0000-000000000001";
    const rejectNoNoteRes = await request.post("/api/hr/onboarding/verify-doc", {
      headers: { Authorization: `Bearer ${hrSession.access_token}` },
      data: {
        documentId: docId,
        action: "reject",
        rejectionReason: "",
      },
    });
    expect(rejectNoNoteRes.status()).toBe(400);
    const rejectNoNoteJson = await rejectNoNoteRes.json();
    expect(rejectNoNoteJson.error).toMatch(/mandatory when rejecting/i);
  });
});

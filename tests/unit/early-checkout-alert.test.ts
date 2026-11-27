import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockRequireApprovedUser = vi.fn();
vi.mock("@/features/auth/require-approved-user", () => ({
  requireApprovedUser: (...args: any[]) => mockRequireApprovedUser(...args),
}));

const mockCheckIdempotency = vi.fn().mockResolvedValue(null);
const mockRecordIdempotency = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api/idempotency", () => ({
  checkIdempotency: (...args: any[]) => mockCheckIdempotency(...args),
  recordIdempotency: (...args: any[]) => mockRecordIdempotency(...args),
}));

const mockGetAdminClient = vi.fn();
const mockIsSupabaseAdminConfigured = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => mockGetAdminClient(),
  isSupabaseAdminConfigured: () => mockIsSupabaseAdminConfigured(),
  supabaseAdmin: {},
}));

import {
  buildEarlyCheckoutEmailHtml,
  sendEarlyCheckoutEmail,
} from "@/lib/email/resend";
import {
  formatShortfallSummary,
  notifyAdminsOfEarlyCheckout,
} from "@/features/attendance/early-checkout-alert";
import { POST as checkoutPost } from "@/app/api/attendance/checkout/route";

describe("Early sign-out detection, admin notifications, and email alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats worked vs target duration summary and builds detailed email HTML", async () => {
    const summary = formatShortfallSummary(380, 480);
    expect(summary.workedFormatted).toBe("6h 20m");
    expect(summary.targetFormatted).toBe("8h 00m");
    expect(summary.shortfallFormatted).toBe("1h 40m");
    expect(summary.summaryText).toBe("Worked 6h 20m of 8h 00m target");

    const html = buildEarlyCheckoutEmailHtml({
      to: "admin@zenxea.com",
      adminName: "Aadhithya Raavanan",
      employeeId: "emp-abc",
      employeeNumber: "ZX-EMP-012",
      employeeName: "abc",
      employeeEmail: "abc@zenxea.com",
      departmentName: "Engineering",
      timezone: "Asia/Kolkata",
      checkInAtFormatted: "27 Nov 2026, 09:00 AM",
      checkOutAtFormatted: "27 Nov 2026, 03:20 PM",
      workedFormatted: "6h 20m",
      targetFormatted: "8h 00m",
      shortfallFormatted: "1h 40m",
      reason: "Doctor appointment",
    });

    expect(html).toContain("Early Sign-Out Alert");
    expect(html).toContain("abc (abc@zenxea.com)");
    expect(html).toContain("ZX-EMP-012");
    expect(html).toContain("Engineering");
    expect(html).toContain("Asia/Kolkata");
    expect(html).toContain("Worked 6h 20m of 8h 00m target");
    expect(html).toContain("/attendance");
    expect(html).toContain("/employees/emp-abc");

    const prevResend = process.env.RESEND_API_KEY;
    const prevSmtpUser = process.env.SMTP_USER;
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_USER;
    try {
      const sendRes = await sendEarlyCheckoutEmail({
        to: "admin@zenxea.com",
        employeeId: "emp-abc",
        employeeName: "abc",
        employeeEmail: "abc@zenxea.com",
        timezone: "Asia/Kolkata",
        checkInAtFormatted: "27 Nov 2026, 09:00 AM",
        checkOutAtFormatted: "27 Nov 2026, 03:20 PM",
        workedFormatted: "6h 20m",
        targetFormatted: "8h 00m",
        shortfallFormatted: "1h 40m",
      });
      expect(sendRes.success).toBe(true);
      expect(sendRes.simulated).toBe(true);
    } finally {
      if (prevResend !== undefined) process.env.RESEND_API_KEY = prevResend;
      if (prevSmtpUser !== undefined) process.env.SMTP_USER = prevSmtpUser;
    }
  });

  it("notifies all org admins excluding the checking-out user and creates unread notifications", async () => {
    const insertedNotifs: any[] = [];
    const mockDb = {
      from: vi.fn((table: string) => {
        const filters: Array<[string, any]> = [];
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn((col: string, val: any) => {
            filters.push([col, val]);
            return chain;
          }),
          in: vi.fn(() => chain),
          insert: vi.fn(async (row: any) => {
            if (table === "notifications") insertedNotifs.push(row);
            return { data: row, error: null };
          }),
          then: (resolve: any) => {
            if (table === "organization_members") {
              return resolve({
                data: [
                  { user_id: "admin-1", role: "admin", status: "active" },
                  { user_id: "admin-self", role: "admin", status: "active" },
                ],
                error: null,
              });
            }
            if (table === "employees") {
              return resolve({
                data: [
                  { id: "admin-1", full_name: "Aadhithya Raavanan", email: "admin@zenxea.com" },
                ],
                error: null,
              });
            }
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      }),
    };

    const prevResend = process.env.RESEND_API_KEY;
    const prevSmtpUser = process.env.SMTP_USER;
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_USER;
    try {
      const res = await notifyAdminsOfEarlyCheckout({
        adminClient: mockDb,
        organizationId: "org-1",
        sessionId: "sess-1",
        employee: {
          id: "admin-self",
          fullName: "abc",
          email: "abc@zenxea.com",
          departmentName: "Engineering",
          timezone: "Asia/Kolkata",
        },
        checkInAtIso: "2026-11-27T03:30:00.000Z",
        checkOutAtIso: "2026-11-27T09:50:00.000Z",
        workedMinutes: 380,
        targetMinutes: 480,
        shortfallMinutes: 100,
        reason: "Personal errand",
      });

      expect(res).toEqual({ notifiedAdminCount: 1, emailedAdminCount: 1 });
      expect(insertedNotifs).toHaveLength(1);
      expect(insertedNotifs[0]).toMatchObject({
        user_id: "admin-1",
        organization_id: "org-1",
        read_at: null,
        link: "/employees/admin-self",
      });
      expect(insertedNotifs[0].title).toContain("Early Sign-Out Alert: abc checked out early (6h 20m / 8h 00m)");
      expect(insertedNotifs[0].body).toContain("Worked 6h 20m of 8h 00m target");
    } finally {
      if (prevResend !== undefined) process.env.RESEND_API_KEY = prevResend;
      if (prevSmtpUser !== undefined) process.env.SMTP_USER = prevSmtpUser;
    }
  });

  it("POST /api/attendance/checkout triggers 409 without confirm_early and notifies admins when confirmed", async () => {
    const empId = "emp-abc";
    const orgId = "org-1";
    const sessionId = "sess-active-1";
    const checkInIso = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago (< 8h target)
    const insertedNotifs: any[] = [];

    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: vi.fn((table: string) => {
        const makeChain = (op: string) => {
          const chain: any = {
            select: vi.fn(() => makeChain("select")),
            update: vi.fn(() => makeChain("update")),
            insert: vi.fn(async (row: any) => {
              if (table === "notifications") insertedNotifs.push(row);
              return { data: row, error: null };
            }),
            eq: vi.fn(() => chain),
            in: vi.fn(() => chain),
            is: vi.fn(() => chain),
            order: vi.fn(() => chain),
            limit: vi.fn(() => chain),
            maybeSingle: vi.fn(async () => {
              if (table === "attendance_sessions") {
                return {
                  data: {
                    id: sessionId,
                    employee_id: empId,
                    check_in_at: checkInIso,
                    work_date: "2026-11-27",
                    organization_id: orgId,
                    note: null,
                  },
                  error: null,
                };
              }
              if (table === "employees") {
                return {
                  data: {
                    id: empId,
                    full_name: "abc",
                    email: "abc@zenxea.com",
                    employee_number: "ZX-EMP-012",
                    department_id: "dept-eng",
                    organization_id: orgId,
                    work_target_minutes: 480,
                    shift_start_time: "09:00:00",
                    shift_end_time: "17:00:00",
                    timezone: "Asia/Kolkata",
                    departments: { name: "Engineering" },
                  },
                  error: null,
                };
              }
              if (table === "organization_members") {
                return {
                  data: {
                    organization_id: orgId,
                    shift_start_time: "09:00:00",
                    shift_end_time: "17:00:00",
                  },
                  error: null,
                };
              }
              return { data: null, error: null };
            }),
            then: (resolve: any) => {
              if (op === "update") return resolve({ data: null, error: null });
              if (table === "attendance_sessions") {
                return resolve({
                  data: [{ id: sessionId, check_in_at: checkInIso, check_out_at: null }],
                  error: null,
                });
              }
              if (table === "organization_members") {
                return resolve({
                  data: [{ user_id: "admin-1", role: "admin", status: "active" }],
                  error: null,
                });
              }
              if (table === "employees") {
                return resolve({
                  data: [{ id: "admin-1", full_name: "Aadhithya Raavanan", email: "admin@zenxea.com" }],
                  error: null,
                });
              }
              return resolve({ data: [], error: null });
            },
          };
          return chain;
        };
        return makeChain("init");
      }),
    };

    mockIsSupabaseAdminConfigured.mockReturnValue(true);
    mockGetAdminClient.mockReturnValue(mockClient);
    mockRequireApprovedUser.mockResolvedValue({
      user: { id: empId, email: "abc@zenxea.com", user_metadata: { full_name: "abc" } },
      role: "employee",
      userId: empId,
      supabase: mockClient,
    });

    // 1. Without confirm_early -> 409 EARLY_CHECKOUT
    const req409 = new NextRequest("http://localhost:3000/api/attendance/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res409 = await checkoutPost(req409);
    const json409 = await res409.json();
    expect(res409.status).toBe(409);
    expect(json409.code).toBe("EARLY_CHECKOUT");
    expect(insertedNotifs).toHaveLength(0);

    // 2. With confirm_early: true -> 200 and notifies Admin
    const req200 = new NextRequest("http://localhost:3000/api/attendance/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm_early: true, reason: "Medical visit" }),
    });
    const res200 = await checkoutPost(req200);
    const json200 = await res200.json();

    expect(res200.status).toBe(200);
    expect(json200.success).toBe(true);
    expect(json200.isEarlyCheckout).toBe(true);
    expect(json200.early_checkout).toBe(true);
    expect(json200.worked_minutes).toBeLessThan(480);
    expect(json200.target_minutes).toBe(480);
    expect(json200.early_summary).toContain("of 8h 00m target");
    expect(json200.admin_alerts).toEqual({ notifiedAdminCount: 1, emailedAdminCount: 1 });
    expect(insertedNotifs).toHaveLength(1);
    expect(insertedNotifs[0].user_id).toBe("admin-1");
  });
});

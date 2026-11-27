import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockRequireApprovedUser = vi.fn();
vi.mock("@/features/auth/require-approved-user", () => ({
  requireApprovedUser: (...args: any[]) => mockRequireApprovedUser(...args),
}));

const mockGetAdminClient = vi.fn();
const mockIsSupabaseAdminConfigured = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => mockGetAdminClient(),
  isSupabaseAdminConfigured: () => mockIsSupabaseAdminConfigured(),
  supabaseAdmin: {},
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}));

import {
  buildBreakTimeoutEmailHtml,
  sendBreakTimeoutEmail,
} from "@/lib/email/resend";
import { enforceBreakTimeouts } from "@/features/attendance/break-timeout";
import { checkAndTriggerBreakTimeoutClient } from "@/features/attendance/break-timeout-client";
import { parseNoteBreaks } from "@/features/attendance/break-note";
import { POST as checkBreakTimeoutPost } from "@/app/api/attendance/check-break-timeout/route";

interface MockSessionRow {
  id: string;
  employee_id: string;
  work_date: string;
  check_in_at: string;
  check_out_at: string | null;
  note: string | null;
  auto_logged_out?: boolean;
  break_timeout_notified?: boolean;
  auto_logout_reason?: string | null;
}

function createFakeAdminClient(opts: {
  sessions: MockSessionRow[];
  maxBreakMinutes?: number;
  missingTimeoutColumns?: boolean;
  strictNotificationTypeCheck?: boolean;
}) {
  const insertedNotifications: any[] = [];
  const insertedAuditLogs: any[] = [];
  const rpcCalls: Array<{ fn: string; params: any }> = [];
  const sessionUpdates: any[] = [];

  const client: any = {
    rpc: vi.fn(async (fn: string, params: any) => {
      rpcCalls.push({ fn, params });
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === "attendance_policies") {
        return {
          select: () => {
            const state: any = { eqs: {} };
            const chain: any = {
              eq: (col: string, val: any) => {
                state.eqs[col] = val;
                return chain;
              },
              order: () => chain,
              limit: () => chain,
              maybeSingle: async () => ({
                data:
                  opts.maxBreakMinutes !== undefined
                    ? { max_break_minutes: opts.maxBreakMinutes }
                    : { max_break_minutes: 60 },
                error: null,
              }),
            };
            return chain;
          },
        };
      }

      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { max_break_minutes: opts.maxBreakMinutes ?? 60 },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "employees") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => ({
                data: {
                  id,
                  organization_id: "org-1",
                  full_name: id === "emp-1" ? "Aarav Kumar" : "Priya Sharma",
                  email: id === "emp-1" ? "aarav@zenxea.com" : "priya@zenxea.com",
                  timezone: "Asia/Kolkata",
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "attendance_sessions") {
        return {
          select: (cols: string) => {
            const filters: any = {};
            const chain: any = {
              is: (col: string, val: any) => {
                filters[col] = val;
                return chain;
              },
              eq: (col: string, val: any) => {
                filters[col] = val;
                return chain;
              },
              then: (resolve: any) => {
                if (opts.missingTimeoutColumns && cols.includes("auto_logged_out")) {
                  return resolve({
                    data: null,
                    error: {
                      code: "42703",
                      message: "column attendance_sessions.auto_logged_out does not exist",
                    },
                  });
                }
                const rows = opts.sessions.filter((s) => {
                  if (filters.check_out_at === null && s.check_out_at !== null) return false;
                  if (filters.employee_id && s.employee_id !== filters.employee_id) return false;
                  return true;
                });
                return resolve({ data: rows, error: null });
              },
            };
            return chain;
          },
          update: (payload: any) => {
            const filters: any = {};
            const chain: any = {
              eq: (col: string, val: any) => {
                filters[col] = val;
                return chain;
              },
              is: (col: string, val: any) => {
                filters[col] = val;
                return chain;
              },
              select: async () => {
                if (opts.missingTimeoutColumns && "auto_logged_out" in payload) {
                  return {
                    data: null,
                    error: {
                      code: "PGRST204",
                      message: "Could not find the 'auto_logged_out' column in schema cache",
                    },
                  };
                }
                const idx = opts.sessions.findIndex(
                  (s) =>
                    s.id === filters.id &&
                    (filters.check_out_at !== null || s.check_out_at === null)
                );
                if (idx === -1) return { data: [], error: null };
                opts.sessions[idx] = { ...opts.sessions[idx], ...payload };
                sessionUpdates.push(payload);
                return { data: [{ id: filters.id }], error: null };
              },
            };
            return chain;
          },
        };
      }

      if (table === "notifications") {
        return {
          insert: async (row: any) => {
            if (opts.strictNotificationTypeCheck && row.type === "break_timeout") {
              return {
                data: null,
                error: {
                  code: "23514",
                  message: 'new row violates check constraint "notifications_type_check"',
                },
              };
            }
            insertedNotifications.push(row);
            return { data: row, error: null };
          },
        };
      }

      if (table === "audit_logs") {
        return {
          insert: async (row: any) => {
            insertedAuditLogs.push(row);
            return { data: row, error: null };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    client,
    insertedNotifications,
    insertedAuditLogs,
    rpcCalls,
    sessionUpdates,
  };
}

describe("Break timeout auto-checkout and logout workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BREAK_TIMEOUT_MINUTES;
    delete process.env.CRON_SECRET;
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    mockIsSupabaseAdminConfigured.mockReturnValue(true);
  });

  it("checks out session, closes break, notifies employee only once, and renders email HTML cleanly", async () => {
    const now = new Date("2026-11-27T12:00:00.000Z");
    const breakStarted = new Date(now.getTime() - 65 * 60_000).toISOString();

    const sessions: MockSessionRow[] = [
      {
        id: "sess-over",
        employee_id: "emp-1",
        work_date: "2026-11-27",
        check_in_at: "2026-11-27T04:00:00.000Z",
        check_out_at: null,
        auto_logged_out: false,
        break_timeout_notified: false,
        note: JSON.stringify({
          originalNote: "",
          breaks: [
            {
              id: "brk-1",
              type: "lunch_break",
              startTime: breakStarted,
              endTime: null,
              durationMinutes: 0,
              status: "active",
            },
          ],
        }),
      },
      {
        id: "sess-within",
        employee_id: "emp-2",
        work_date: "2026-11-27",
        check_in_at: "2026-11-27T04:00:00.000Z",
        check_out_at: null,
        auto_logged_out: false,
        break_timeout_notified: false,
        note: JSON.stringify({
          originalNote: "",
          breaks: [
            {
              id: "brk-2",
              type: "lunch_break",
              startTime: new Date(now.getTime() - 60 * 60_000).toISOString(), // exact limit, not strictly >
              endTime: null,
              durationMinutes: 0,
              status: "active",
            },
          ],
        }),
      },
    ];

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { client, insertedNotifications, insertedAuditLogs, rpcCalls } =
      createFakeAdminClient({
        sessions,
        maxBreakMinutes: 60,
      });

    const firstRun = await enforceBreakTimeouts({ adminClient: client, now });
    expect(firstRun.timedOutCount).toBe(1);
    expect(firstRun.timedOutSessions[0]).toMatchObject({
      sessionId: "sess-over",
      employeeId: "emp-1",
      employeeName: "Aarav Kumar",
      employeeEmail: "aarav@zenxea.com",
      allowedBreakMinutes: 60,
      elapsedBreakMinutes: 65,
      notificationInserted: true,
      emailSent: true,
    });

    // Session 1 closed with flags and completed break; Session 2 left untouched
    expect(sessions[0].check_out_at).toBe(now.toISOString());
    expect(sessions[0].auto_logged_out).toBe(true);
    expect(sessions[0].break_timeout_notified).toBe(true);
    const parsedNote = parseNoteBreaks(sessions[0].note);
    expect(parsedNote.breaks[0].status).toBe("completed");
    expect(parsedNote.breaks[0].endTime).toBe(now.toISOString());
    expect(parsedNote.breakTimeoutNotified).toBe(true);
    expect(sessions[1].check_out_at).toBeNull();

    // Unread notification strictly for emp-1
    expect(insertedNotifications).toHaveLength(1);
    expect(insertedNotifications[0]).toMatchObject({
      user_id: "emp-1",
      read_at: null,
      title: "Auto Logged Out: Break Time Exceeded",
    });
    expect(insertedNotifications[0].body).toContain("60m limit");
    expect(insertedNotifications[0].body).toContain("log out properly next time");

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("recalculate_day");
    expect(insertedAuditLogs[0].action).toBe("AUTO_CHECKOUT_BREAK_TIMEOUT");
    expect(infoSpy).toHaveBeenCalledTimes(1);

    // Second sweep on same data + already notified open session must be idempotent (no duplicate alerts)
    const alreadyNotifiedOpenSession: MockSessionRow = {
      id: "sess-flag",
      employee_id: "emp-1",
      work_date: "2026-11-27",
      check_in_at: "2026-11-27T04:00:00.000Z",
      check_out_at: null,
      auto_logged_out: false,
      break_timeout_notified: true,
      note: JSON.stringify({
        originalNote: "",
        breaks: [
          {
            id: "brk-3",
            type: "short_break",
            startTime: breakStarted,
            endTime: null,
            durationMinutes: 0,
            status: "active",
          },
        ],
      }),
    };
    sessions.push(alreadyNotifiedOpenSession);

    const secondRun = await enforceBreakTimeouts({ adminClient: client, now });
    expect(secondRun.timedOutCount).toBe(0);
    expect(insertedNotifications).toHaveLength(1);
    infoSpy.mockRestore();

    // Verify reminder email template contents directly
    const html = buildBreakTimeoutEmailHtml({
      to: "aarav@zenxea.com",
      employeeName: "Aarav Kumar",
      workDate: "2026-11-27",
      breakTypeLabel: "Lunch Break",
      breakStartFormatted: "27 Nov 2026, 4:25 pm",
      autoCheckoutFormatted: "27 Nov 2026, 5:30 pm",
      timezone: "Asia/Kolkata",
      allowedLimitMinutes: 60,
      elapsedBreakFormatted: "1h 05m",
    });
    expect(html).toContain("Aarav Kumar");
    expect(html).toContain("2026-11-27");
    expect(html).toContain("4:25 pm");
    expect(html).toContain("5:30 pm");
    expect(html).toContain("60m limit / 1h 05m elapsed");
    expect(html).toContain("log out properly next time");

    const simResult = await sendBreakTimeoutEmail({
      to: "aarav@zenxea.com",
      employeeName: "Aarav Kumar",
      workDate: "2026-11-27",
      breakTypeLabel: "Lunch Break",
      breakStartFormatted: "4:25 pm",
      autoCheckoutFormatted: "5:30 pm",
      timezone: "Asia/Kolkata",
      allowedLimitMinutes: 60,
      elapsedBreakFormatted: "1h 05m",
    });
    expect(simResult.success).toBe(true);
    expect(simResult.simulated).toBe(true);
  });

  it("handles unmigrated DB columns & strict notification CHECK constraints gracefully", async () => {
    const now = new Date("2026-11-27T12:00:00.000Z");
    const sessions: MockSessionRow[] = [
      {
        id: "sess-unmigrated",
        employee_id: "emp-1",
        work_date: "2026-11-27",
        check_in_at: "2026-11-27T04:00:00.000Z",
        check_out_at: null,
        note: JSON.stringify({
          originalNote: "",
          breaks: [
            {
              id: "brk-1",
              type: "short_break",
              startTime: new Date(now.getTime() - 20 * 60_000).toISOString(),
              endTime: null,
              durationMinutes: 0,
              status: "active",
            },
          ],
        }),
      },
    ];

    const { client, insertedNotifications } = createFakeAdminClient({
      sessions,
      maxBreakMinutes: 15,
      missingTimeoutColumns: true,
      strictNotificationTypeCheck: true,
    });

    const result = await enforceBreakTimeouts({ adminClient: client, now });
    expect(result.timedOutCount).toBe(1);
    expect(sessions[0].check_out_at).toBe(now.toISOString());
    expect(parseNoteBreaks(sessions[0].note).autoLoggedOut).toBe(true);
    expect(parseNoteBreaks(sessions[0].note).breakTimeoutNotified).toBe(true);
    expect(insertedNotifications[0].type).toBe("missed_checkout");
  });

  it("supports cron secret sweeps and authenticated employee requests on /api/attendance/check-break-timeout", async () => {
    process.env.CRON_SECRET = "cron-secret-123";
    const { client } = createFakeAdminClient({
      sessions: [
        {
          id: "sess-api-1",
          employee_id: "emp-1",
          work_date: "2026-11-27",
          check_in_at: "2026-11-27T04:00:00.000Z",
          check_out_at: null,
          note: JSON.stringify({
            originalNote: "",
            breaks: [
              {
                id: "brk-1",
                type: "lunch_break",
                startTime: new Date(Date.now() - 90 * 60_000).toISOString(),
                endTime: null,
                durationMinutes: 0,
                status: "active",
              },
            ],
          }),
        },
      ],
    });
    mockGetAdminClient.mockReturnValue(client);

    const cronReq = new NextRequest("http://localhost:3000/api/attendance/check-break-timeout", {
      method: "POST",
      headers: { Authorization: "Bearer cron-secret-123" },
    });
    const cronRes = await checkBreakTimeoutPost(cronReq);
    const cronJson = await cronRes.json();

    expect(cronRes.status).toBe(200);
    expect(cronJson.mode).toBe("cron");
    expect(cronJson.timedOut).toBe(true);
    expect(cronJson.reason).toBe("break_timeout");
    expect(cronJson.timedOutCount).toBe(1);

    // Without cron secret, falls back to requireApprovedUser
    mockRequireApprovedUser.mockResolvedValueOnce({
      user: { id: "emp-1" },
    });
    const userReq = new NextRequest("http://localhost:3000/api/attendance/check-break-timeout", {
      method: "POST",
    });
    const userRes = await checkBreakTimeoutPost(userReq);
    const userJson = await userRes.json();
    expect(userRes.status).toBe(200);
    expect(userJson.mode).toBe("user");
    expect(userJson.timedOut).toBe(false);
  });

  it("triggers API check, auth signOut, and /login?reason=break_timeout redirect on client when break limit exceeded", async () => {
    const nowMs = new Date("2026-11-27T12:00:00.000Z").getTime();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ timedOut: true, reason: "break_timeout" }),
    });
    const signOutMock = vi.fn().mockResolvedValue({ error: null });
    const redirectMock = vi.fn();

    // Within 60m -> no-op
    const underLimit = await checkAndTriggerBreakTimeoutClient({
      activeBreakStartTime: new Date(nowMs - 45 * 60_000).toISOString(),
      maxBreakMinutes: 60,
      nowMs,
      fetchImpl: fetchMock as any,
      signOutImpl: signOutMock,
      redirectImpl: redirectMock,
    });
    expect(underLimit).toEqual({ exceeded: false, timedOut: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();

    // Exceeded (61m > 60m) -> API + signOut + redirect
    const overLimit = await checkAndTriggerBreakTimeoutClient({
      activeBreakStartTime: new Date(nowMs - 61 * 60_000).toISOString(),
      maxBreakMinutes: 60,
      nowMs,
      fetchImpl: fetchMock as any,
      signOutImpl: signOutMock,
      redirectImpl: redirectMock,
    });
    expect(overLimit).toEqual({ exceeded: true, timedOut: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/attendance/check-break-timeout",
      expect.objectContaining({ method: "POST" })
    );
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/login?reason=break_timeout");
  });
});

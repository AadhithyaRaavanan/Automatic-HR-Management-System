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

import {
  buildInactivityAutoLogoutEmailHtml,
  sendInactivityAutoLogoutEmail,
} from "@/lib/email/resend";
import {
  AUTO_LOGOUT_CHECKOUT_REASON,
  processSessionTimeouts,
} from "@/features/attendance/session-timeout";
import { parseNoteBreaks } from "@/features/attendance/break-note";
import { POST as processTimeoutsPost } from "@/app/api/attendance/process-timeouts/route";
import { POST as heartbeatPost } from "@/app/api/attendance/heartbeat/route";

interface MockSessionRow {
  id: string;
  employee_id: string;
  organization_id: string | null;
  work_date: string;
  check_in_at: string;
  check_out_at: string | null;
  last_seen_at?: string | null;
  break_started_at?: string | null;
  break_duration_minutes?: number;
  status?: string;
  checkout_reason?: string | null;
  auto_logged_out?: boolean;
  auto_logout_notified?: boolean;
  break_timeout_notified?: boolean;
  note: string | null;
}

function createFakeAdminClient(opts: {
  sessions: MockSessionRow[];
  maxBreakMinutes?: number;
  missingNewColumns?: boolean;
}) {
  const insertedNotifications: any[] = [];
  const insertedAuditLogs: any[] = [];
  const rpcCalls: any[] = [];
  const employeeUpdates: any[] = [];

  const client: any = {
    rpc: vi.fn(async (fn: string, params: any) => {
      rpcCalls.push({ fn, params });
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === "attendance_policies") {
        return {
          select: () => {
            const chain: any = {
              eq: () => chain,
              order: () => chain,
              limit: () => chain,
              maybeSingle: async () => ({
                data: { max_break_minutes: opts.maxBreakMinutes ?? 60 },
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
          select: (cols: string) => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => {
                if (opts.missingNewColumns && cols.includes("last_seen_at")) {
                  return {
                    data: null,
                    error: { code: "42703", message: "column employees.last_seen_at does not exist" },
                  };
                }
                return {
                  data: {
                    id,
                    organization_id: "org-1",
                    full_name: id === "emp-1" ? "Aarav Kumar" : "Priya Sharma",
                    email: id === "emp-1" ? "aarav@zenxea.com" : "priya@zenxea.com",
                    timezone: "Asia/Kolkata",
                    last_seen_at: null,
                  },
                  error: null,
                };
              },
            }),
          }),
          update: (payload: any) => ({
            eq: async (_col: string, id: string) => {
              if (opts.missingNewColumns && "last_seen_at" in payload) {
                return {
                  error: { code: "PGRST204", message: "Could not find last_seen_at" },
                };
              }
              employeeUpdates.push({ id, ...payload });
              return { error: null };
            },
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
              order: () => chain,
              limit: () => chain,
              maybeSingle: async () => {
                const rows = opts.sessions.filter((s) => {
                  if (filters.check_out_at === null && s.check_out_at !== null) return false;
                  if (filters.employee_id && s.employee_id !== filters.employee_id) return false;
                  return true;
                });
                return { data: rows[0] || null, error: null };
              },
              then: (resolve: any) => {
                if (opts.missingNewColumns && cols.includes("last_seen_at")) {
                  return resolve({
                    data: null,
                    error: {
                      code: "42703",
                      message: "column attendance_sessions.last_seen_at does not exist",
                    },
                  });
                }
                const rows = opts.sessions.filter((s) => {
                  if (filters.check_out_at === null && s.check_out_at !== null) return false;
                  if (filters.employee_id && s.employee_id !== filters.employee_id) return false;
                  if (filters.organization_id && s.organization_id !== filters.organization_id)
                    return false;
                  return true;
                });
                return resolve({ data: rows, error: null });
              },
            };
            return chain;
          },
          update: (payload: any) => {
            const filters: any = {};
            const applyUpdate = () => {
              if (
                opts.missingNewColumns &&
                ("last_seen_at" in payload || "auto_logout_notified" in payload)
              ) {
                return {
                  data: null,
                  error: {
                    code: "PGRST204",
                    message: "Could not find column in schema cache",
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
              return { data: [{ id: filters.id }], error: null };
            };
            const chain: any = {
              eq: (col: string, val: any) => {
                filters[col] = val;
                return chain;
              },
              is: (col: string, val: any) => {
                filters[col] = val;
                return chain;
              },
              select: async () => applyUpdate(),
              then: (resolve: any) => resolve(applyUpdate()),
            };
            return chain;
          },
        };
      }

      if (table === "notifications") {
        return {
          insert: async (row: any) => {
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
    employeeUpdates,
  };
}

describe("Inactivity (20m) and break-overstay automatic sign-out workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.INACTIVITY_TIMEOUT_MINUTES;
    delete process.env.BREAK_OVERSTAY_GRACE_MINUTES;
    delete process.env.CRON_SECRET;
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;
    mockIsSupabaseAdminConfigured.mockReturnValue(true);
  });

  it("closes sessions inactive >= 20m using last_seen_at, keeps active breaks within grace open, and prevents duplicates", async () => {
    const now = new Date("2026-11-27T12:00:00.000Z");
    const lastSeen25mAgo = new Date(now.getTime() - 25 * 60_000).toISOString();
    const lastSeen10mAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    const lunchBreakStarted45mAgo = new Date(now.getTime() - 45 * 60_000).toISOString();

    const sessions: MockSessionRow[] = [
      {
        id: "sess-offline-25m",
        employee_id: "emp-1",
        organization_id: "org-1",
        work_date: "2026-11-27",
        check_in_at: "2026-11-27T04:00:00.000Z",
        check_out_at: null,
        last_seen_at: lastSeen25mAgo,
        auto_logged_out: false,
        auto_logout_notified: false,
        note: JSON.stringify({ originalNote: "", breaks: [], lastSeenAt: lastSeen25mAgo }),
      },
      {
        id: "sess-online-10m",
        employee_id: "emp-2",
        organization_id: "org-1",
        work_date: "2026-11-27",
        check_in_at: "2026-11-27T04:00:00.000Z",
        check_out_at: null,
        last_seen_at: lastSeen10mAgo,
        auto_logged_out: false,
        auto_logout_notified: false,
        note: JSON.stringify({ originalNote: "", breaks: [], lastSeenAt: lastSeen10mAgo }),
      },
      {
        id: "sess-on-lunch-45m",
        employee_id: "emp-3",
        organization_id: "org-1",
        work_date: "2026-11-27",
        check_in_at: "2026-11-27T04:00:00.000Z",
        check_out_at: null,
        last_seen_at: lunchBreakStarted45mAgo, // laptop idle while on 60m lunch!
        break_started_at: lunchBreakStarted45mAgo,
        auto_logged_out: false,
        auto_logout_notified: false,
        note: JSON.stringify({
          originalNote: "",
          breaks: [
            {
              id: "brk-lunch",
              type: "lunch_break",
              startTime: lunchBreakStarted45mAgo,
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
      createFakeAdminClient({ sessions, maxBreakMinutes: 60 });

    const firstSweep = await processSessionTimeouts({
      adminClient: client,
      organizationId: "org-1",
      now,
    });

    expect(firstSweep.timedOutCount).toBe(1);
    expect(firstSweep.timedOutSessions[0]).toMatchObject({
      sessionId: "sess-offline-25m",
      employeeId: "emp-1",
      timeoutType: "inactivity",
      checkoutAtIso: lastSeen25mAgo, // non-inflated checkout timestamp
      checkoutReason: AUTO_LOGOUT_CHECKOUT_REASON,
      notificationInserted: true,
      emailSent: true,
    });

    // Offline session closed with exact fields; active 10m & valid 45m lunch stay open
    expect(sessions[0].check_out_at).toBe(lastSeen25mAgo);
    expect(sessions[0].status).toBe("checked_out");
    expect(sessions[0].auto_logged_out).toBe(true);
    expect(sessions[0].auto_logout_notified).toBe(true);
    expect(sessions[0].checkout_reason).toBe(AUTO_LOGOUT_CHECKOUT_REASON);
    expect(sessions[1].check_out_at).toBeNull();
    expect(sessions[2].check_out_at).toBeNull();

    // Unread notification scoped to employee & organization
    expect(insertedNotifications).toHaveLength(1);
    expect(insertedNotifications[0]).toMatchObject({
      user_id: "emp-1",
      organization_id: "org-1",
      read_at: null,
      title: "Automatic Sign-Out Notice",
    });
    expect(insertedNotifications[0].body).toContain("20 minutes");
    expect(insertedNotifications[0].body).toContain("check out properly next time");

    expect(rpcCalls).toHaveLength(1);
    expect(insertedAuditLogs[0].action).toBe("AUTO_CHECKOUT_INACTIVITY_TIMEOUT");
    expect(infoSpy).toHaveBeenCalledTimes(1);

    // Repeat sweep must not emit duplicate notifications/emails even if open row has auto_logout_notified=true
    sessions.push({
      ...sessions[0],
      id: "sess-already-notified",
      check_out_at: null,
      auto_logout_notified: true,
    });
    const secondSweep = await processSessionTimeouts({
      adminClient: client,
      organizationId: "org-1",
      now,
    });
    expect(secondSweep.timedOutCount).toBe(0);
    expect(insertedNotifications).toHaveLength(1);
    infoSpy.mockRestore();

    // Email HTML inspection
    const html = buildInactivityAutoLogoutEmailHtml({
      to: "aarav@zenxea.com",
      employeeName: "Aarav Kumar",
      workDate: "2026-11-27",
      checkInFormatted: "27 Nov 2026, 9:30 am",
      autoCheckoutFormatted: "27 Nov 2026, 5:05 pm",
      timezone: "Asia/Kolkata",
      reasonText: "you remained offline or inactive for 20 minutes",
    });
    expect(html).toContain("Automatic Sign-Out Notice");
    expect(html).toContain("Aarav Kumar");
    expect(html).toContain("27 Nov 2026, 9:30 am");
    expect(html).toContain("27 Nov 2026, 5:05 pm");
    expect(html).toContain("Asia/Kolkata");
    expect(html).toContain("check out properly before going offline or taking extended breaks");

    const sim = await sendInactivityAutoLogoutEmail({
      to: "aarav@zenxea.com",
      employeeName: "Aarav Kumar",
      workDate: "2026-11-27",
      checkInFormatted: "9:30 am",
      autoCheckoutFormatted: "5:05 pm",
      timezone: "Asia/Kolkata",
      reasonText: "offline for 20 minutes",
    });
    expect(sim.success).toBe(true);
    expect(sim.simulated).toBe(true);
  });

  it("closes active breaks exceeding allowed duration + 15 minutes at expiry timestamp", async () => {
    const now = new Date("2026-11-27T12:00:00.000Z");
    const shortBreakStarted35mAgo = new Date(now.getTime() - 35 * 60_000).toISOString(); // 15m allowed + 15m grace = 30m limit!

    const sessions: MockSessionRow[] = [
      {
        id: "sess-short-break-overstay",
        employee_id: "emp-1",
        organization_id: "org-1",
        work_date: "2026-11-27",
        check_in_at: "2026-11-27T04:00:00.000Z",
        check_out_at: null,
        last_seen_at: shortBreakStarted35mAgo,
        break_started_at: shortBreakStarted35mAgo,
        note: JSON.stringify({
          originalNote: "",
          breaks: [
            {
              id: "brk-short",
              type: "short_break",
              startTime: shortBreakStarted35mAgo,
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
      maxBreakMinutes: 60,
    });

    const result = await processSessionTimeouts({ adminClient: client, now });
    expect(result.timedOutCount).toBe(1);
    expect(result.timedOutSessions[0].timeoutType).toBe("break_timeout");

    const expectedExpiryIso = new Date(
      new Date(shortBreakStarted35mAgo).getTime() + 30 * 60_000
    ).toISOString();
    expect(sessions[0].check_out_at).toBe(expectedExpiryIso);
    expect(sessions[0].break_started_at).toBeNull();
    expect(parseNoteBreaks(sessions[0].note).breaks[0].status).toBe("completed");
    expect(insertedNotifications[0].title).toBe("Automatic Sign-Out Notice");
  });

  it("heartbeat refreshes active session last_seen_at and closes stale sessions before reviving them", async () => {
    const activeTime = new Date(Date.now() - 3 * 60_000).toISOString();
    const sessions: MockSessionRow[] = [
      {
        id: "sess-active",
        employee_id: "emp-1",
        organization_id: "org-1",
        work_date: "2026-11-27",
        check_in_at: new Date(Date.now() - 60 * 60_000).toISOString(),
        check_out_at: null,
        last_seen_at: activeTime,
        note: JSON.stringify({ originalNote: "", breaks: [], lastSeenAt: activeTime }),
      },
    ];
    const { client, employeeUpdates } = createFakeAdminClient({ sessions });
    mockGetAdminClient.mockReturnValue(client);
    mockRequireApprovedUser.mockResolvedValue({ user: { id: "emp-1" } });

    const hbRes = await heartbeatPost(
      new NextRequest("http://localhost:3000/api/attendance/heartbeat", { method: "POST" })
    );
    const hbJson = await hbRes.json();
    expect(hbRes.status).toBe(200);
    expect(hbJson.timedOut).toBe(false);
    expect(hbJson.hasActiveSession).toBe(true);
    expect(employeeUpdates.length).toBe(1);
    expect(sessions[0].check_out_at).toBeNull();

    // Now simulate session that was offline 25m and receives late heartbeat -> must timeout instead of reviving
    sessions[0].last_seen_at = new Date(Date.now() - 25 * 60_000).toISOString();
    const staleHbRes = await heartbeatPost(
      new NextRequest("http://localhost:3000/api/attendance/heartbeat", { method: "POST" })
    );
    const staleHbJson = await staleHbRes.json();
    expect(staleHbRes.status).toBe(200);
    expect(staleHbJson.timedOut).toBe(true);
    expect(sessions[0].check_out_at).not.toBeNull();
  });

  it("supports authenticated dashboard reload & cron sweeps via /api/attendance/process-timeouts", async () => {
    process.env.CRON_SECRET = "secret-xyz";
    const stale22mAgo = new Date(Date.now() - 22 * 60_000).toISOString();
    const sessions: MockSessionRow[] = [
      {
        id: "sess-org-stale",
        employee_id: "emp-2",
        organization_id: "org-1",
        work_date: "2026-11-27",
        check_in_at: new Date(Date.now() - 120 * 60_000).toISOString(),
        check_out_at: null,
        last_seen_at: stale22mAgo,
        note: null,
      },
    ];
    const { client } = createFakeAdminClient({ sessions, missingNewColumns: true });
    mockGetAdminClient.mockReturnValue(client);
    mockRequireApprovedUser.mockResolvedValue({ user: { id: "emp-1" } });

    // Authenticated dashboard load by emp-1 processes org-1 stale session for emp-2 cleanly
    const orgReq = new NextRequest("http://localhost:3000/api/attendance/process-timeouts", {
      method: "POST",
    });
    const orgRes = await processTimeoutsPost(orgReq);
    const orgJson = await orgRes.json();
    expect(orgRes.status).toBe(200);
    expect(orgJson.mode).toBe("organization");
    expect(orgJson.timedOut).toBe(false); // emp-1 was not timed out
    expect(orgJson.anyTimedOut).toBe(true);
    expect(orgJson.timedOutCount).toBe(1);
    expect(sessions[0].check_out_at).not.toBeNull();
    expect(parseNoteBreaks(sessions[0].note).autoLogoutNotified).toBe(true);
  });
});

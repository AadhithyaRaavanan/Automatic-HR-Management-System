import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const USER_1 = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_2 = "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_1 = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeUuid(index: number): string {
  const hex = index.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

const { mockState, fakeAdminClient } = vi.hoisted(() => {
  const state = {
    notifications: [] as any[],
    employees: [] as Array<{ id: string; organization_id: string; status: string; email?: string; full_name?: string }>,
    memberships: [] as Array<{ user_id: string; organization_id: string; role: string; status: string; organizations?: any }>,
    preferences: [] as any[],
    deleteCalled: false,
    lastInsertError: null as any,
    caller: null as any,
    adminCaller: null as any,
  };

  function makeNotifUuid(index: number): string {
    const hex = index.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
  }

  function createNotifsBuilder() {
    const filters: Array<(row: any) => boolean> = [];
    let orderBys: Array<{ col: string; asc: boolean }> = [];
    let limitVal: number | null = null;
    let op: "select" | "update" | "upsert" | "insert" | "delete" = "select";
    let updatePayload: any = null;
    let writeRows: any[] = [];
    let countMode = false;
    let headMode = false;

    const execute = async () => {
      if (op === "delete") {
        state.deleteCalled = true;
        return { data: [], error: null };
      }
      if (op === "upsert" || op === "insert") {
        if (state.lastInsertError) {
          return { data: null, error: state.lastInsertError };
        }
        const inserted = writeRows.map((r, i) => ({
          id: r.id || makeNotifUuid(900 + state.notifications.length + i),
          created_at: r.created_at || new Date().toISOString(),
          read_at: null,
          ...r,
        }));
        state.notifications.push(...inserted);
        return { data: inserted, error: null };
      }

      let rows = state.notifications.filter((r) => filters.every((fn) => fn(r)));

      if (op === "update" && updatePayload) {
        rows.forEach((r) => Object.assign(r, updatePayload));
        return { data: rows.map((r) => ({ id: r.id })), error: null };
      }

      if (orderBys.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const o of orderBys) {
            const av = String(a[o.col] ?? "");
            const bv = String(b[o.col] ?? "");
            if (av !== bv) {
              return o.asc ? av.localeCompare(bv) : bv.localeCompare(av);
            }
          }
          return 0;
        });
      }

      const totalCount = rows.length;
      if (limitVal !== null) {
        rows = rows.slice(0, limitVal);
      }

      return {
        data: headMode ? null : rows,
        count: countMode ? totalCount : undefined,
        error: null,
      };
    };

    const builder: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count === "exact") countMode = true;
        if (opts?.head) headMode = true;
        return builder;
      },
      update(payload: any) {
        op = "update";
        updatePayload = payload;
        return builder;
      },
      upsert(rows: any[]) {
        op = "upsert";
        writeRows = rows;
        return builder;
      },
      insert(rows: any[]) {
        op = "insert";
        writeRows = Array.isArray(rows) ? rows : [rows];
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      eq(col: string, val: any) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      in(col: string, vals: any[]) {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      is(col: string, val: any) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      lt(col: string, val: any) {
        filters.push((r) => String(r[col] ?? "") < String(val));
        return builder;
      },
      or(expr: string) {
        const match = expr.match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)$/);
        if (match) {
          const [, ts1, ts2, id2] = match;
          filters.push(
            (r) =>
              r.created_at < ts1 ||
              (r.created_at === ts2 && r.id < id2)
          );
        }
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBys.push({ col, asc: Boolean(opts?.ascending) });
        return builder;
      },
      limit(n: number) {
        limitVal = n;
        return builder;
      },
      then(onFulfilled: any, onRejected: any) {
        return execute().then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  const client = {
    from(table: string) {
      if (table === "notifications") return createNotifsBuilder();
      if (table === "organization_members") {
        let rows = [...state.memberships];
        const q: any = {
          select() { return q; },
          eq(col: string, val: any) { rows = rows.filter((r: any) => r[col] === val); return q; },
          in(col: string, vals: any[]) { rows = rows.filter((r: any) => vals.includes(r[col])); return q; },
          then(res: any, rej: any) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
        };
        return q;
      }
      if (table === "notification_preferences") {
        let rows = [...state.preferences];
        const q: any = {
          select() { return q; },
          eq(col: string, val: any) { rows = rows.filter((r: any) => r[col] === val); return q; },
          in(col: string, vals: any[]) { rows = rows.filter((r: any) => vals.includes(r[col])); return q; },
          then(res: any, rej: any) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
        };
        return q;
      }
      if (table === "employees") {
        let rows = [...state.employees];
        const q: any = {
          select() { return q; },
          eq(col: string, val: any) { rows = rows.filter((r: any) => r[col] === val); return q; },
          in(col: string, vals: any[]) { rows = rows.filter((r: any) => vals.includes(r[col])); return q; },
          then(res: any, rej: any) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
        };
        return q;
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  return { mockState: state, fakeAdminClient: client };
});

vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => true,
  supabaseAdmin: fakeAdminClient,
}));

vi.mock("@/features/notifications/auth", () => ({
  getNotificationAuth: vi.fn(async (req: NextRequest) => {
    if (mockState.caller) {
      if (typeof mockState.caller === "function") return mockState.caller(req);
      return mockState.caller;
    }
    return {
      user: null,
      supabase: fakeAdminClient,
      organizationId: null,
    };
  }),
  getNotificationCaller: vi.fn(async () => mockState.caller?.user || null),
}));

vi.mock("@/features/auth/admin-guard", () => ({
  verifyAdminRouteCaller: vi.fn(async () => mockState.adminCaller),
}));

vi.mock("@/lib/email/resend", () => ({
  sendNotificationEmail: vi.fn(async () => ({ success: true })),
}));

import { GET as listNotifications } from "@/app/api/notifications/route";
import { GET as getUnreadCount } from "@/app/api/notifications/unread-count/route";
import { POST as markNotificationsRead } from "@/app/api/notifications/read/route";
import { POST as notifyHolidays } from "@/app/api/holidays/notify/route";

describe("Item 6 — Notifications pagination, workspace isolation, and holiday delivery", () => {
  beforeEach(() => {
    mockState.notifications = [];
    mockState.employees = [];
    mockState.memberships = [];
    mockState.preferences = [];
    mockState.deleteCalled = false;
    mockState.lastInsertError = null;
    mockState.caller = null;
    mockState.adminCaller = null;
  });

  it("paginates 25 notifications in pages of 10 with same-timestamp ties and zero dropped items (#11, #22 present)", async () => {
    // Mix distinct timestamps and identical timestamps (e.g. batch notifications #8..#14)
    for (let i = 1; i <= 25; i++) {
      const sameBatchTs = "2026-11-28T10:15:00.000Z";
      const createdAt =
        i >= 8 && i <= 14
          ? sameBatchTs
          : new Date(Date.UTC(2026, 10, 28, 10, i >= 15 ? 25 - i : 35 - i, 0)).toISOString();
      mockState.notifications.push({
        id: makeUuid(100 - i), // Descending order on tie matches index progression
        user_id: USER_1,
        organization_id: ORG_A,
        type: "task_assigned",
        title: `Notification #${i}`,
        body: i === 11 || i === 22 ? `Example Notification #${i} body` : `Body for #${i}`,
        link: "/tasks",
        read_at: null,
        created_at: createdAt,
      });
    }

    mockState.caller = { user: { id: USER_1 }, supabase: fakeAdminClient, organizationId: ORG_A };

    const seenIds: string[] = [];
    let cursor: string | null = null;
    const pages: number[] = [];

    for (let p = 0; p < 5; p++) {
      const url = cursor
        ? `http://localhost/api/notifications?limit=10&cursor=${encodeURIComponent(cursor)}`
        : "http://localhost/api/notifications?limit=10";
      const res = await listNotifications(new NextRequest(url));
      expect(res.status).toBe(200);
      const json = await res.json();
      pages.push(json.notifications.length);
      seenIds.push(...json.notifications.map((n: any) => n.id));
      cursor = json.nextCursor;
      if (!cursor) break;
    }

    expect(pages).toEqual([10, 10, 5]);
    expect(seenIds).toHaveLength(25);
    expect(new Set(seenIds).size).toBe(25);
    // Verify Example Notification items were neither filtered out nor deleted on read
    expect(mockState.deleteCalled).toBe(false);
    expect(
      mockState.notifications.every((n) => seenIds.includes(n.id))
    ).toBe(true);
  });

  it("isolates notification lists, unread counts, and mark-all-read across workspaces", async () => {
    mockState.notifications.push(
      {
        id: makeUuid(1),
        user_id: USER_1,
        organization_id: ORG_A,
        type: "leave_approved",
        title: "Org A leave approved",
        body: "Alpha workspace",
        link: "/leave",
        read_at: null,
        created_at: "2026-11-28T11:00:00.000Z",
      },
      {
        id: makeUuid(2),
        user_id: USER_1,
        organization_id: ORG_B,
        type: "task_assigned",
        title: "Org B task assigned",
        body: "Beta workspace",
        link: "/tasks",
        read_at: null,
        created_at: "2026-11-28T11:01:00.000Z",
      }
    );

    mockState.caller = (req: NextRequest) => {
      const org = req.headers.get("x-organization-id");
      if (!org) {
        return {
          user: null,
          supabase: fakeAdminClient,
          organizationId: null,
          errorResponse: new Response(JSON.stringify({ code: "ORG_SELECTION_REQUIRED" }), { status: 409 }),
        };
      }
      return { user: { id: USER_1 }, supabase: fakeAdminClient, organizationId: org };
    };

    // Reading Org A sees only Org A
    const listA = await listNotifications(
      new NextRequest("http://localhost/api/notifications", { headers: { "x-organization-id": ORG_A } })
    );
    const listAJson = await listA.json();
    expect(listA.status).toBe(200);
    expect(listAJson.notifications).toHaveLength(1);
    expect(listAJson.notifications[0].organization_id).toBe(ORG_A);

    // Unread count in Org B is 1
    const countB1 = await getUnreadCount(
      new NextRequest("http://localhost/api/notifications/unread-count", {
        headers: { "x-organization-id": ORG_B },
      })
    );
    expect((await countB1.json()).unreadCount).toBe(1);

    // Mark all read in Org A leaves Org B unread
    const markA = await markNotificationsRead(
      new NextRequest("http://localhost/api/notifications/read", {
        method: "POST",
        headers: { "x-organization-id": ORG_A, "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      })
    );
    expect(markA.status).toBe(200);
    expect((await markA.json()).count).toBe(1);

    const countA2 = await getUnreadCount(
      new NextRequest("http://localhost/api/notifications/unread-count", {
        headers: { "x-organization-id": ORG_A },
      })
    );
    const countB2 = await getUnreadCount(
      new NextRequest("http://localhost/api/notifications/unread-count", {
        headers: { "x-organization-id": ORG_B },
      })
    );
    expect((await countA2.json()).unreadCount).toBe(0);
    expect((await countB2.json()).unreadCount).toBe(1);

    // Unauthenticated unread-count fails soft with 0
    mockState.caller = null;
    const unauthCount = await getUnreadCount(new NextRequest("http://localhost/api/notifications/unread-count"));
    expect(unauthCount.status).toBe(200);
    expect((await unauthCount.json()).unreadCount).toBe(0);
  });

  it("delivers holiday_scheduled announcements preserving type/organization_id and reports real delivery failures", async () => {
    mockState.adminCaller = {
      context: { userId: ADMIN_1, organizationId: ORG_A, role: "admin" },
    };
    mockState.employees = [
      { id: ADMIN_1, organization_id: ORG_A, status: "active", email: "admin@orga.test" },
      { id: USER_1, organization_id: ORG_A, status: "active", email: "u1@orga.test" },
      { id: USER_2, organization_id: ORG_A, status: "active", email: "u2@orga.test" },
    ];
    mockState.memberships = [
      { user_id: USER_1, organization_id: ORG_A, role: "employee", status: "active" },
      { user_id: USER_2, organization_id: ORG_A, role: "employee", status: "active" },
    ];

    const resOk = await notifyHolidays(
      new NextRequest("http://localhost/api/holidays/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          holidayName: "Founder Day",
          holidayDate: "2026-12-15",
        }),
      })
    );
    expect(resOk.status).toBe(200);
    const jsonOk = await resOk.json();
    expect(jsonOk.success).toBe(true);
    expect(jsonOk.inAppCount).toBe(2);
    expect(mockState.notifications).toHaveLength(2);
    expect(mockState.notifications.every((n) => n.type === "holiday_scheduled")).toBe(true);
    expect(mockState.notifications.every((n) => n.organization_id === ORG_A)).toBe(true);

    // Simulate DB insert/constraint failure: notifyHolidays must report 500 instead of false count
    mockState.lastInsertError = { message: "notifications_type_check violated" };
    const resFail = await notifyHolidays(
      new NextRequest("http://localhost/api/holidays/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import",
          count: 10,
        }),
      })
    );
    expect(resFail.status).toBe(500);
    const jsonFail = await resFail.json();
    expect(jsonFail.success).toBe(false);
    expect(jsonFail.inAppCount).toBe(0);
  });
});

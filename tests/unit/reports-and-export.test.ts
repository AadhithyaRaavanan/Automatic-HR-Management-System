import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import {
  canLockPayrollMonth,
  getPendingChecklistBlockers,
  paginateReportRows,
  type MonthCloseChecklistState,
} from "@/features/reports/helpers";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ADMIN_A = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const { mockStore, fakeAdmin } = vi.hoisted(() => {
  const store = {
    rows: [] as any[],
    auditLogs: [] as any[],
    failOnOffset: null as number | null,
  };

  function makeAttendanceDaysQuery() {
    const eqs: Array<{ col: string; val: any }> = [];
    let gteVal: string | null = null;
    let lteVal: string | null = null;
    const orders: Array<{ col: string; asc: boolean }> = [];

    const run = async (rangeFrom?: number, rangeTo?: number) => {
      if (store.failOnOffset !== null && rangeFrom === store.failOnOffset) {
        return { data: null, error: { message: "Simulated chunk failure" } };
      }

      let filtered = store.rows.filter((r) => {
        for (const e of eqs) {
          if (r[e.col] !== e.val) return false;
        }
        if (gteVal && r.work_date < gteVal) return false;
        if (lteVal && r.work_date > lteVal) return false;
        return true;
      });

      if (orders.length > 0) {
        filtered = [...filtered].sort((a, b) => {
          for (const o of orders) {
            const av = String(a[o.col] ?? "");
            const bv = String(b[o.col] ?? "");
            if (av !== bv) return o.asc ? av.localeCompare(bv) : bv.localeCompare(av);
          }
          return 0;
        });
      }

      if (typeof rangeFrom === "number" && typeof rangeTo === "number") {
        // Respect simulated PostgREST cap by slicing to exact range
        return { data: filtered.slice(rangeFrom, rangeTo + 1), error: null };
      }
      return { data: filtered.slice(0, 1000), error: null };
    };

    const q: any = {
      select() { return q; },
      eq(col: string, val: any) { eqs.push({ col, val }); return q; },
      gte(_col: string, val: string) { gteVal = val; return q; },
      lte(_col: string, val: string) { lteVal = val; return q; },
      order(col: string, opts?: { ascending?: boolean }) {
        orders.push({ col, asc: Boolean(opts?.ascending) });
        return q;
      },
      range(from: number, to: number) {
        return run(from, to);
      },
      then(res: any, rej: any) {
        return run().then(res, rej);
      },
    };
    return q;
  }

  const client = {
    from(table: string) {
      if (table === "attendance_days") return makeAttendanceDaysQuery();
      if (table === "audit_logs") {
        return {
          insert: vi.fn(async (payload: any) => {
            store.auditLogs.push(payload);
            return { data: null, error: null };
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { mockStore: store, fakeAdmin: client };
});

vi.mock("@/features/auth/admin-guard", () => ({
  verifyAdminRouteCaller: vi.fn(async () => ({
    context: {
      userId: ADMIN_A,
      organizationId: ORG_A,
      role: "hr",
      aal: "aal2",
    },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => true,
  supabaseAdmin: fakeAdmin,
}));

import { GET as exportAttendance } from "@/app/api/attendance/export/route";

describe("Item 7 — Reports payroll close helpers and paginated CSV/XLSX exports", () => {
  beforeEach(() => {
    mockStore.rows = [];
    mockStore.auditLogs = [];
    mockStore.failOnOffset = null;
  });

  it("gates Lock Month strictly on readiness, report readiness, and fresh checklist state", () => {
    const blockedChecklist: MonthCloseChecklistState = {
      year: 2026,
      month: 11,
      period_start: "2026-11-01",
      period_end: "2026-11-30",
      open_sessions_count: 2,
      pending_regularizations_count: 1,
      pending_leaves_count: 3,
      locked_days_count: 0,
      unlocked_days_count: 20,
      total_days_count: 20,
      is_month_locked: false,
      ready_to_lock: false,
    };

    expect(getPendingChecklistBlockers(blockedChecklist)).toEqual([
      "2 open shift sessions",
      "1 pending attendance correction",
      "3 pending leave requests",
    ]);

    expect(
      canLockPayrollMonth({
        checklist: blockedChecklist,
        checklistLoading: false,
        checklistError: null,
        reportsLoading: false,
        reportsError: null,
        lockingMonth: false,
      })
    ).toBe(false);

    const readyChecklist: MonthCloseChecklistState = {
      ...blockedChecklist,
      open_sessions_count: 0,
      pending_regularizations_count: 0,
      pending_leaves_count: 0,
      ready_to_lock: true,
    };

    // Must remain disabled if checklistError or reportsError or loading is active
    expect(
      canLockPayrollMonth({
        checklist: readyChecklist,
        checklistLoading: false,
        checklistError: "Transient RPC failure",
        reportsLoading: false,
        reportsError: null,
        lockingMonth: false,
      })
    ).toBe(false);

    expect(
      canLockPayrollMonth({
        checklist: readyChecklist,
        checklistLoading: false,
        checklistError: null,
        reportsLoading: false,
        reportsError: "Report load error",
        lockingMonth: false,
      })
    ).toBe(false);

    expect(
      canLockPayrollMonth({
        checklist: readyChecklist,
        checklistLoading: false,
        checklistError: null,
        reportsLoading: false,
        reportsError: null,
        lockingMonth: false,
      })
    ).toBe(true);
  });

  it("paginates report table rows deterministically across pages", () => {
    const items = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));
    const p1 = paginateReportRows(items, 1, 50);
    const p3 = paginateReportRows(items, 3, 50);
    expect(p1.totalPages).toBe(3);
    expect(p1.items).toHaveLength(50);
    expect(p1.startDisplay).toBe(1);
    expect(p1.endDisplay).toBe(50);

    expect(p3.items).toHaveLength(20);
    expect(p3.startDisplay).toBe(101);
    expect(p3.endDisplay).toBe(120);
  });

  it("exports filtered CSV and XLSX beyond the 1,000-row API cap matching table population", async () => {
    // Seed 1,250 total rows (including 50 Engineering rows & pre-hire anomaly rows)
    for (let i = 1; i <= 1250; i++) {
      const empId = `emp-${String(i).padStart(4, "0")}`;
      const isEng = i % 25 === 0; // 50 Engineering rows across the full range
      mockStore.rows.push({
        organization_id: ORG_A,
        employee_id: empId,
        work_date: `2026-11-${String(((i - 1) % 28) + 1).padStart(2, "0")}`,
        status: "present",
        total_minutes: 480,
        is_late: false,
        locked: false,
        employees: {
          full_name: isEng ? `Eng Member ${i}` : `Ops Member ${i}`,
          email: `emp${i}@orga.test`,
          joined_on: "2026-01-01",
          departments: { name: isEng ? "Engineering" : "Operations" },
        },
      });
    }
    // Add a pre-hire absent anomaly that must be excluded from both table & export
    mockStore.rows.push({
      organization_id: ORG_A,
      employee_id: "emp-prehire",
      work_date: "2026-11-05",
      status: "absent",
      total_minutes: 0,
      is_late: false,
      locked: false,
      employees: {
        full_name: "New Hire PreHire",
        email: "newhire@orga.test",
        joined_on: "2026-11-28",
        departments: { name: "Engineering" },
      },
    });

    // Unfiltered CSV contains all 1,250 eligible rows (beyond 1,000 cap!)
    const csvAllRes = await exportAttendance(
      new NextRequest("http://localhost/api/attendance/export?format=csv&month=2026-11")
    );
    expect(csvAllRes.status).toBe(200);
    const csvAllLines = (await csvAllRes.text()).trim().split("\n");
    expect(csvAllLines).toHaveLength(1251); // header + 1,250 rows

    // Filtered Engineering XLSX contains exact 50 rows (excludes pre-hire anomaly & Operations)
    const xlsxFilteredRes = await exportAttendance(
      new NextRequest("http://localhost/api/attendance/export?format=xlsx&month=2026-11&department=Engineering")
    );
    expect(xlsxFilteredRes.status).toBe(200);
    const buf = Buffer.from(await xlsxFilteredRes.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.getWorksheet("Monthly Attendance")!;
    expect(sheet.rowCount).toBe(51); // header + 50 Engineering rows

    // Chunk failure must return 500 instead of truncating export silently
    mockStore.failOnOffset = 500;
    const failRes = await exportAttendance(
      new NextRequest("http://localhost/api/attendance/export?format=csv&month=2026-11")
    );
    expect(failRes.status).toBe(500);
  });
});

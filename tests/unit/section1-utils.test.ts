import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  buildBulkImportErrorCsv,
  isValidIanaTimezone,
  parseCsvText,
  validateBulkEmployeeRows,
} from "@/lib/csv/parse-csv";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BYTES,
  computeScaledDimensions,
  validateAvatarFile,
} from "@/lib/media/avatar-compress";

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      admin: {
        inviteUserByEmail: vi.fn(),
        listUsers: vi.fn(),
      },
    },
  },
}));

import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { POST as bulkImportRoute } from "@/app/api/admin/users/bulk-import/route";

describe("Section 1 Utilities: Bulk CSV Parser, Validator & Sanitized Error Report", () => {
  it("parses RFC 4180 CSV with UTF-8 BOM, quoted commas, and header normalization", () => {
    const csv = `\uFEFFEmail,Full Name,Role,Work Mode,Timezone,Department Code,Work Target Minutes\r\n"jane.doe@acme.test","Doe, Jane",manager,hybrid,America/New_York,ENG,480\r\n"bob@acme.test","Bob Smith",employee,remote,Asia/Kolkata,OPS,450\r\n`;
    const parsed = parseCsvText(csv);

    expect(parsed.headers).toEqual([
      "email",
      "full_name",
      "role",
      "work_mode",
      "timezone",
      "department_code",
      "work_target_minutes",
    ]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].email).toBe("jane.doe@acme.test");
    expect(parsed.rows[0].full_name).toBe("Doe, Jane");
    expect(parsed.rows[1].department_code).toBe("OPS");
  });

  it("validates IANA timezones accurately", () => {
    expect(isValidIanaTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidIanaTimezone("America/New_York")).toBe(true);
    expect(isValidIanaTimezone("UTC")).toBe(true);
    expect(isValidIanaTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidIanaTimezone("")).toBe(false);
  });

  it("detects invalid emails, CSV duplicates, existing/other-org conflicts, invalid roles/modes/timezones, and missing departments", () => {
    const departmentsByCode = new Map([["eng", "dept-eng-uuid"]]);
    const departmentsByName = new Map([["engineering", "dept-eng-uuid"]]);
    const existingOrgEmails = new Set(["already@org1.test"]);
    const otherOrgEmails = new Set(["hijack@org2.test"]);

    const validated = validateBulkEmployeeRows(
      [
        {
          email: "valid.user@org1.test",
          full_name: "Valid User",
          role: "employee",
          work_mode: "remote",
          timezone: "Asia/Kolkata",
          department: "ENG",
          work_target_minutes: "480",
        },
        {
          email: "valid.user@org1.test",
          full_name: "Duplicate User",
          role: "employee",
          work_mode: "remote",
          timezone: "Asia/Kolkata",
          department: "Engineering",
          work_target_minutes: "480",
        },
        {
          email: "hijack@org2.test",
          full_name: "Cross Tenant User",
          role: "superadmin",
          work_mode: "spaceship",
          timezone: "Invalid/Zone",
          department: "NOPE",
          work_target_minutes: "15",
        },
        {
          email: "already@org1.test",
          full_name: "X",
          role: "hr",
          work_mode: "office",
          timezone: "UTC",
          department: "",
          work_target_minutes: "480",
        },
      ],
      {
        departmentsByCode,
        departmentsByName,
        existingOrgEmails,
        otherOrgEmails,
      }
    );

    expect(validated[0].valid).toBe(true);
    expect(validated[0].departmentId).toBe("dept-eng-uuid");

    expect(validated[1].valid).toBe(false);
    expect(validated[1].errors).toContain("Duplicate email in CSV file");

    expect(validated[2].valid).toBe(false);
    expect(validated[2].errors).toEqual(
      expect.arrayContaining([
        "Email already belongs to another organization",
        expect.stringContaining("Invalid role"),
        expect.stringContaining("Invalid work_mode"),
        expect.stringContaining("Invalid IANA timezone"),
        expect.stringContaining("work_target_minutes"),
        expect.stringContaining("not found in your organization"),
      ])
    );

    expect(validated[3].valid).toBe(false);
    expect(validated[3].errors).toEqual(
      expect.arrayContaining([
        "Employee email already exists in this organization",
        "Full name must be at least 2 characters",
      ])
    );
  });

  it("sanitizes dangerous formula characters in bulk import error CSV exports (CWE-1236)", () => {
    const errorCsv = buildBulkImportErrorCsv([
      {
        rowNumber: 2,
        email: "=cmd|' /C calc'!A0@evil.test",
        fullName: "+Malicious Name",
        role: "employee",
        workMode: "remote",
        timezone: "UTC",
        departmentCode: "@SUM(1+1)",
        departmentId: null,
        workTargetMinutes: 480,
        valid: false,
        errors: ["-2+3*cmd"],
      },
    ]);

    const lines = errorCsv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("'=cmd|' /C calc'!A0@evil.test");
    expect(lines[1]).toContain("'+Malicious Name");
    expect(lines[1]).toContain("'@SUM(1+1)");
    expect(lines[1]).toContain("'-2+3*cmd");
  });
});

describe("Section 1 Utilities: Avatar Client Compression & Validation", () => {
  it("enforces exact 200 KB bucket limit constant and safe MIME allowlist", () => {
    expect(AVATAR_MAX_BYTES).toBe(204800);
    expect(AVATAR_ALLOWED_MIME_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);

    expect(validateAvatarFile({ type: "image/jpeg", size: 50000 }).valid).toBe(true);
    expect(validateAvatarFile({ type: "image/png", size: 50000 }).valid).toBe(true);
    expect(validateAvatarFile({ type: "image/webp", size: 50000 }).valid).toBe(true);

    expect(validateAvatarFile({ type: "image/svg+xml", size: 1024 }).valid).toBe(false);
    expect(validateAvatarFile({ type: "image/gif", size: 1024 }).valid).toBe(false);
    expect(validateAvatarFile({ type: "application/pdf", size: 1024 }).valid).toBe(false);
    expect(validateAvatarFile({ type: "image/png", size: 0 }).valid).toBe(false);
    expect(validateAvatarFile({ type: "image/png", size: 11 * 1024 * 1024 }).valid).toBe(false);
  });

  it("computes aspect-preserving scaled dimensions within max bounds", () => {
    expect(computeScaledDimensions(1024, 512, 256)).toEqual({ width: 256, height: 128 });
    expect(computeScaledDimensions(400, 800, 256)).toEqual({ width: 128, height: 256 });
    expect(computeScaledDimensions(200, 150, 256)).toEqual({ width: 200, height: 150 });
  });
});

describe("Section 1 API Guard: /api/admin/users/bulk-import", () => {
  const callerOrgId = "00000000-0000-0000-0000-000000000001";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupMockAuth(opts: { authenticated: boolean; role?: string; aal?: string }) {
    if (!opts.authenticated) {
      (createServerClient as any).mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Unauth") }),
        },
      });
      return;
    }

    (createServerClient as any).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "caller-id",
              email: "admin@remotehr.io",
              app_metadata: { aal: "aal2" },
            },
          },
          error: null,
        }),
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { aal: opts.aal || "aal1" } },
          error: null,
        }),
        mfa: {
          getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
            data: { currentLevel: opts.aal || "aal1" },
            error: null,
          }),
        },
      },
    });

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === "organization_members") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              organization_id: callerOrgId,
              role: opts.role || "admin",
              status: "active",
            },
            error: null,
          }),
        };
      }
      if (table === "departments") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: "dept-1", code: "ENG", name: "Engineering" }],
            error: null,
          }),
        };
      }
      if (table === "employees") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ email: "existing@remotehr.io" }],
            error: null,
          }),
          neq: vi.fn().mockResolvedValue({
            data: [{ email: "foreign@org2.test" }],
            error: null,
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    });
  }

  it("denies unauthenticated, non-admin, and AAL1 callers", async () => {
    const csvBody = { csvText: "email,full_name\na@b.test,Alice", dryRun: true };

    setupMockAuth({ authenticated: false });
    const r401 = await bulkImportRoute(
      new NextRequest("http://localhost:3000/api/admin/users/bulk-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(csvBody),
      })
    );
    expect(r401.status).toBe(401);

    setupMockAuth({ authenticated: true, role: "hr", aal: "aal2" });
    const rHr = await bulkImportRoute(
      new NextRequest("http://localhost:3000/api/admin/users/bulk-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(csvBody),
      })
    );
    expect(rHr.status).toBe(403);

    setupMockAuth({ authenticated: true, role: "admin", aal: "aal1" });
    const rAal1 = await bulkImportRoute(
      new NextRequest("http://localhost:3000/api/admin/users/bulk-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(csvBody),
      })
    );
    expect(rAal1.status).toBe(403);
  });

  it("returns validated dry-run preview and sanitized errorCsv for an AAL2 admin", async () => {
    setupMockAuth({ authenticated: true, role: "admin", aal: "aal2" });
    const req = new NextRequest("http://localhost:3000/api/admin/users/bulk-import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dryRun: true,
        csvText: [
          "email,full_name,role,work_mode,timezone,department",
          "new.hire@remotehr.io,New Hire,employee,remote,Asia/Kolkata,ENG",
          "foreign@org2.test,=EVIL,employee,remote,UTC,ENG",
        ].join("\n"),
      }),
    });

    const res = await bulkImportRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dryRun).toBe(true);
    expect(json.totalRows).toBe(2);
    expect(json.validCount).toBe(1);
    expect(json.invalidCount).toBe(1);
    expect(json.errorCsv).toContain("'=EVIL");
  });
});


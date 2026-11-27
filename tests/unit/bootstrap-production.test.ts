import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Mock Supabase Admin
const mockFrom = vi.fn();
const mockGenerateLink = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => mockFrom(table),
    auth: {
      admin: {
        generateLink: (...args: any[]) => mockGenerateLink(...args),
      },
    },
  },
}));

import { bootstrapProduction, STANDARD_LEAVE_TYPES, DEFAULT_ATTENDANCE_POLICY } from "../../scripts/bootstrap-production";

describe("Section 2.1 & 2.2: Production Bootstrap & Demo Hygiene Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies seed.sql is strictly isolated and NEVER referenced by bootstrap-production.ts", () => {
    const bootstrapScriptPath = path.join(process.cwd(), "scripts", "bootstrap-production.ts");
    const content = fs.readFileSync(bootstrapScriptPath, "utf-8");

    expect(content.toLowerCase()).not.toContain("seed.sql");
    expect(content).not.toContain("admin@remotehr.io");
    expect(content).not.toContain("employee@remotehr.io");
  });

  it("executes non-destructive dry-run mode without committing any mutations", async () => {
    const result = await bootstrapProduction({
      orgName: "Production Org",
      slug: "prod-org",
      domain: "prodorg.com",
      timezone: "UTC",
      currency: "USD",
      workMode: "remote",
      adminEmail: "founder@prodorg.com",
      adminName: "Founder Admin",
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.createdEntities?.leaveTypesCount).toBe(6);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it("fails safe idempotently when organization with same slug or domain already exists", async () => {
    const selectMock = vi.fn().mockReturnValue({
      or: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: "existing-org-uuid", slug: "prod-org", domain: "prodorg.com" },
        }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "organizations") {
        return { select: selectMock };
      }
      return {};
    });

    const result = await bootstrapProduction({
      orgName: "Production Org",
      slug: "prod-org",
      domain: "prodorg.com",
      timezone: "UTC",
      currency: "USD",
      workMode: "remote",
      adminEmail: "founder@prodorg.com",
      adminName: "Founder Admin",
      dryRun: false,
    });

    expect(result.success).toBe(false);
    expect(result.orgId).toBe("existing-org-uuid");
    expect(result.message).toContain("already exists");
  });

  it("executes exact provisioning sequence for a new real organization and passwordless admin invite", async () => {
    const insertedTables: string[] = [];

    mockFrom.mockImplementation((table: string) => {
      insertedTables.push(table);
      if (table === "organizations") {
        return {
          select: vi.fn().mockReturnValue({
            or: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: "new-org-123" }, error: null }),
            }),
          }),
        };
      }
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    mockGenerateLink.mockResolvedValue({
      data: {
        user: { id: "new-admin-user-uuid" },
        properties: { action_link: "https://auth.remotehr.io/verify?token=secure-invite-token" },
      },
      error: null,
    });

    const result = await bootstrapProduction({
      orgName: "New Enterprise",
      slug: "new-enterprise",
      domain: "newenterprise.io",
      timezone: "Europe/London",
      currency: "GBP",
      workMode: "hybrid",
      adminEmail: "admin@newenterprise.io",
      adminName: "Chief Admin",
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.orgId).toBe("new-org-123");
    expect(result.adminUserId).toBe("new-admin-user-uuid");
    expect(result.inviteLink).toBe("https://auth.remotehr.io/verify?token=secure-invite-token");

    // Verify entities sequence
    expect(insertedTables).toContain("organizations");
    expect(insertedTables).toContain("leave_types");
    expect(insertedTables).toContain("attendance_policies");
    expect(insertedTables).toContain("holidays");
    expect(insertedTables).toContain("organization_members");
    expect(insertedTables).toContain("employees");
  });
});

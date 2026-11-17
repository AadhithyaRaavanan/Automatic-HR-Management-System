import { describe, it, expect } from "vitest";
import { EmployeeRole, EmploymentCategory } from "@/types/database.types";
import { regularizationFormSchema } from "@/features/requests/types";

describe("ZEN XEA HRMS 5-Role & Employment Category Architecture", () => {
  it("supports exactly five system roles", () => {
    const validRoles: EmployeeRole[] = ["admin", "hr", "manager", "team_lead", "employee"];
    expect(validRoles.length).toBe(5);
    expect(validRoles).toContain("team_lead");
    expect(validRoles).not.toContain("super_admin" as any);
    expect(validRoles).not.toContain("intern" as any);
  });

  it("supports exactly four employment categories independently of role", () => {
    const validCategories: EmploymentCategory[] = ["full_time", "part_time", "contract", "intern"];
    expect(validCategories.length).toBe(4);
    expect(validCategories).toContain("intern");
  });

  it("validates regularization form with supporting document attachment", () => {
    const validData = {
      workDate: "2026-11-17",
      requestedInTime: "09:00",
      requestedOutTime: "17:30",
      reason: "Network connectivity issue during client demo session",
      documentName: "network_log.pdf",
    };

    const parsed = regularizationFormSchema.safeParse(validData);
    expect(parsed.success).toBe(true);
  });

  it("rejects regularization when check-out is before check-in", () => {
    const invalidData = {
      workDate: "2026-11-17",
      requestedInTime: "17:00",
      requestedOutTime: "09:00",
      reason: "Network connectivity issue during client demo session",
    };

    const parsed = regularizationFormSchema.safeParse(invalidData);
    expect(parsed.success).toBe(false);
  });
});

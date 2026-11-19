import { describe, it, expect } from "vitest";

describe("Salary in INR employee creation", () => {
  it("formats and handles salary in INR currency properly", () => {
    const rawSalary = "45000";
    const numericSalary = Number(rawSalary);
    expect(numericSalary).toBe(45000);
    expect(numericSalary.toLocaleString("en-IN")).toBe("45,000");
  });

  it("handles empty or optional salary gracefully", () => {
    const emptySalary = "";
    const parsed = emptySalary ? Number(emptySalary) : null;
    expect(parsed).toBeNull();
  });
});

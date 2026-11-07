import { describe, it, expect } from "vitest";
import { sanitizeCsvCell } from "@/lib/utils";

describe("Formula Injection Sanitizer (sanitizeCsvCell)", () => {
  it("leaves standard alphanumeric text and safe strings untouched", () => {
    expect(sanitizeCsvCell("John Doe")).toBe("John Doe");
    expect(sanitizeCsvCell("Engineering")).toBe("Engineering");
    expect(sanitizeCsvCell("12345")).toBe("12345");
  });

  it("neutralizes formula injection characters (=, +, -, @, \\t, \\r)", () => {
    expect(sanitizeCsvCell("=SUM(A1:B10)")).toBe("'=SUM(A1:B10)");
    expect(sanitizeCsvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(sanitizeCsvCell("-2+3*cmd|' /C calc'!A0")).toBe("'-2+3*cmd|' /C calc'!A0");
    expect(sanitizeCsvCell("@SUM(1+1)")).toBe("'@SUM(1+1)");
    expect(sanitizeCsvCell("\tmalicious")).toBe("'\tmalicious");
  });

  it("correctly quotes strings containing commas, quotes, and newlines", () => {
    expect(sanitizeCsvCell("Doe, John")).toBe('"Doe, John"');
    expect(sanitizeCsvCell('Said "Hello"')).toBe('"Said ""Hello"""');
    expect(sanitizeCsvCell("=1+1,2+2")).toBe("\"'=1+1,2+2\"");
  });

  it("handles null and undefined gracefully", () => {
    expect(sanitizeCsvCell(null)).toBe("");
    expect(sanitizeCsvCell(undefined)).toBe("");
  });
});

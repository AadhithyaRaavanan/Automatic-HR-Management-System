import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("Section 4.2: Documentation Truth Verification Suite", () => {
  it("validates that all documented API routes, routines, tables, and env vars match codebase truth", () => {
    const result = execSync("node scripts/verify-docs.mjs", {
      encoding: "utf8",
    });

    expect(result).toContain("Documentation truth verified");
  });
});

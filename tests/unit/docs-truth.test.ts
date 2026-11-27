import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("Section 4.2: Documentation Truth Verification Suite", () => {
  it("checks project navigation links, documented API routes and redirect paths", () => {
    const result = execSync("node scripts/verify-docs.mjs", {
      encoding: "utf8",
    });

    expect(result).toContain("Documentation truth verified");
  });
});

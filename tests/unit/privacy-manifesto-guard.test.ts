import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

function getAllSourceFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== "node_modules" && file !== ".next" && file !== ".git") {
        getAllSourceFiles(filePath, fileList);
      }
    } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

describe("Section 2.3: Privacy Manifesto & Invasive Tracking Static Analysis Guard", () => {
  const rootDir = process.cwd();
  const targetDirs = [
    path.join(rootDir, "app"),
    path.join(rootDir, "components"),
    path.join(rootDir, "features"),
  ];

  const sourceFiles = targetDirs.flatMap((d) => getAllSourceFiles(d));

  it("verifies client source files were discovered for static analysis", () => {
    expect(sourceFiles.length).toBeGreaterThan(10);
  });

  it("proves zero invocations of navigator.geolocation or geolocation watch APIs", () => {
    const forbiddenPatterns = [
      /navigator\.geolocation/i,
      /geolocation\.getCurrentPosition/i,
      /geolocation\.watchPosition/i,
    ];

    const violations: { file: string; match: string }[] = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, "utf-8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push({ file: path.relative(rootDir, file), match: pattern.toString() });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("proves zero invocations of getUserMedia, getDisplayMedia, or video capture", () => {
    const forbiddenPatterns = [
      /navigator\.mediaDevices\.getUserMedia/i,
      /mediaDevices\.getDisplayMedia/i,
      /\.getUserMedia\s*\(/i,
    ];

    const violations: { file: string; match: string }[] = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, "utf-8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push({ file: path.relative(rootDir, file), match: pattern.toString() });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("proves zero invocations of device motion or ambient sensory capture", () => {
    const forbiddenPatterns = [
      /DeviceOrientationEvent/i,
      /DeviceMotionEvent/i,
      /window\.addEventListener\s*\(\s*["']devicemotion/i,
      /window\.addEventListener\s*\(\s*["']deviceorientation/i,
    ];

    const violations: { file: string; match: string }[] = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, "utf-8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push({ file: path.relative(rootDir, file), match: pattern.toString() });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

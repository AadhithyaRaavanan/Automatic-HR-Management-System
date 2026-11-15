#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const logsDir = path.resolve(rootDir, "release-logs");

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const steps = [
  {
    name: "Documentation Truth",
    command: process.platform === "win32" ? "node" : "node",
    args: ["scripts/verify-docs.mjs"],
    logFile: "verify-docs.log",
  },
  {
    name: "TypeScript Compilation",
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["tsc", "--noEmit"],
    logFile: "type-check.log",
  },
  {
    name: "Vitest Unit Test Suite",
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "test"],
    logFile: "unit-tests.log",
  },
  {
    name: "Database & RLS Integration",
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "test:db"],
    logFile: "database-tests.log",
  },
  {
    name: "Playwright E2E Suite",
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["playwright", "test"],
    logFile: "playwright-tests.log",
  },
  {
    name: "Next.js Production Build",
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "build"],
    logFile: "production-build.log",
  },
  {
    name: "Secret Leak Scan",
    command: process.platform === "win32" ? "node" : "node",
    args: ["scripts/scan-secrets.mjs"],
    logFile: "secret-scan.log",
  },
];

const summaryResults = [];

function runStep(step) {
  return new Promise((resolve) => {
    console.log(`\n▶ Starting [${step.name}]...`);

    // Clean stale .next cache before Playwright launches Next dev server on Windows
    if (step.name === "Playwright E2E Suite" || step.name === "Next.js Production Build") {
      try {
        const nextDir = path.resolve(rootDir, ".next");
        if (fs.existsSync(nextDir)) {
          fs.rmSync(nextDir, { recursive: true, force: true });
        }
      } catch {}
    }

    const startTime = Date.now();
    const logFilePath = path.join(logsDir, step.logFile);
    const logStream = fs.createWriteStream(logFilePath, { flags: "w" });

    const proc = spawn(step.command, step.args, {
      cwd: rootDir,
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "test" },
      shell: true,
    });

    proc.stdout.pipe(logStream);
    proc.stderr.pipe(logStream);

    proc.on("close", (code) => {
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
      const passed = code === 0;

      if (passed) {
        console.log(`✔ [${step.name}] PASSED in ${durationSec}s`);
      } else {
        console.error(`✖ [${step.name}] FAILED with exit code ${code} in ${durationSec}s. See ${path.relative(rootDir, logFilePath)}`);
      }

      summaryResults.push({
        step: step.name,
        status: passed ? "PASS" : "FAIL",
        duration: `${durationSec}s`,
        log: path.relative(rootDir, logFilePath),
      });

      resolve(passed);
    });

    proc.on("error", (err) => {
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`✖ [${step.name}] ERROR: ${err.message}`);
      summaryResults.push({
        step: step.name,
        status: "FAIL",
        duration: `${durationSec}s`,
        log: path.relative(rootDir, logFilePath),
      });
      resolve(false);
    });
  });
}

async function main() {
  console.log("================================================================================");
  console.log("🚀 RemoteHR Release Verification Pipeline (`npm run verify:release`)");
  console.log("================================================================================");

  let allPassed = true;

  for (const step of steps) {
    const passed = await runStep(step);
    if (!passed) {
      allPassed = false;
      break;
    }
  }

  console.log("\n================================================================================");
  console.log("📊 Verification Pipeline Summary");
  console.log("================================================================================");
  console.table(summaryResults);

  if (!allPassed) {
    console.error("\n🚨 Release verification FAILED. Please resolve errors before publishing.");
    process.exit(1);
  } else {
    console.log("\n🎉 All release verification gates PASSED successfully!");
    process.exit(0);
  }
}

main();

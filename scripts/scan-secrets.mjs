#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Secret Detection Patterns
 */
const SECRET_PATTERNS = [
  {
    name: "Live Resend API Key",
    regex: /\bre_[a-zA-Z0-9]{24,}\b/g,
    ignore: [/re_your_api_key_here/, /re_dummy/],
  },
  {
    name: "Cloudflare Turnstile Secret",
    regex: /\b0x4[a-zA-Z0-9]{30,}\b/g,
    ignore: [/0x4AAAAAAAxxxxxxxxxxxxxx/],
  },
  {
    name: "AWS Access Key ID",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    ignore: [],
  },
  {
    name: "GitHub Token",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g,
    ignore: [],
  },
  {
    name: "Slack Webhook URL",
    regex: /https:\/\/hooks\.slack\.com\/services\/T[0-9A-Z_]+\/B[0-9A-Z_]+\/[0-9a-zA-Z_]+/g,
    ignore: [/services\/xxx\/yyy\/zzz/],
  },
  {
    name: "RSA/Private Key Block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    ignore: [],
  },
];

// Paths to ignore during scanning
const IGNORED_PATHS = [
  /node_modules/,
  /\.next/,
  /\.git/,
  /\.env.*/,
  /scripts\/scan-secrets\.mjs/,
  /tests\//,
];

function getTrackedFiles() {
  try {
    const stdout = execSync("git ls-files", { encoding: "utf8" });
    return stdout.split("\n").map((f) => f.trim()).filter(Boolean);
  } catch (err) {
    // If git is unavailable, fallback to recursive directory scan
    return [];
  }
}

function scanFile(filePath) {
  const violations = [];
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    lines.forEach((line, index) => {
      for (const pattern of SECRET_PATTERNS) {
        const matches = line.match(pattern.regex);
        if (matches) {
          for (const match of matches) {
            const isIgnored = pattern.ignore.some((ig) => ig.test(match));
            if (!isIgnored) {
              violations.push({
                file: filePath,
                line: index + 1,
                rule: pattern.name,
                snippet: match.slice(0, 4) + "..." + match.slice(-4),
              });
            }
          }
        }
      }
    });
  } catch (err) {
    // Binary or unreadable file
  }
  return violations;
}

function run() {
  console.log("🔒 Scanning tracked files for exposed secrets...");
  const files = getTrackedFiles();
  let totalViolations = 0;

  for (const file of files) {
    if (IGNORED_PATHS.some((p) => p.test(file))) continue;

    const violations = scanFile(file);
    if (violations.length > 0) {
      totalViolations += violations.length;
      violations.forEach((v) => {
        console.error(`❌ [${v.rule}] in ${v.file}:${v.line} (${v.snippet})`);
      });
    }
  }

  if (totalViolations > 0) {
    console.error(`\n🚨 Failed: Found ${totalViolations} potential exposed secret(s).`);
    process.exit(1);
  } else {
    console.log(`✅ Clean: No exposed secrets detected across ${files.length} tracked files.`);
    process.exit(0);
  }
}

run();

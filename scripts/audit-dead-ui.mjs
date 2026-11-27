import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const scanDirs = ["src/app", "src/components", "src/features"];

const knownRoutes = new Set([
  "/",
  "/login",
  "/forgot-password",
  "/attendance",
  "/tasks",
  "/kpi",
  "/leave",
  "/team",
  "/requests",
  "/reports",
  "/holidays",
  "/profile",
  "/settings",
  "/hr/leave",
  "/admin/users",
  "/admin/departments",
  "/admin/locations",
  "/admin/shifts",
  "/admin/settings",
  "/admin/audits",
  "/gallery",
  "/terms",
  "/privacy",
  "/403",
  "/mfa-setup",
  "/mfa-challenge",
]);

let issues = [];

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, "/");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // Check empty onClick
    if (/onClick=\{?\s*\(\)\s*=>\s*(\{\s*\}|console\.log\([^)]*\))\s*\}?/.test(line)) {
      issues.push({ file: relPath, line: lineNum, issue: "Empty or console.log onClick handler", snippet: line.trim() });
    }

    // Check "Coming soon", "Go premium", "Add new board"
    if (/(coming soon|under construction|go premium|add new board)/i.test(line)) {
      issues.push({ file: relPath, line: lineNum, issue: "Decorative placeholder text found", snippet: line.trim() });
    }

    // Check broken Link href
    const hrefMatches = line.matchAll(/href=["'](\/[^"']*)["']/g);
    for (const match of hrefMatches) {
      const rawHref = match[1];
      const baseRoute = rawHref.split("?")[0].split("#")[0];
      if (
        baseRoute.startsWith("/") &&
        !baseRoute.startsWith("/api") &&
        !baseRoute.startsWith("/_next") &&
        !knownRoutes.has(baseRoute) &&
        !knownRoutes.has(baseRoute.replace(/\/$/, ""))
      ) {
        issues.push({ file: relPath, line: lineNum, issue: `Broken href target: ${baseRoute}`, snippet: line.trim() });
      }
    }
  });
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") {
        walkDir(fullPath);
      }
    } else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      scanFile(fullPath);
    }
  }
}

for (const dir of scanDirs) {
  walkDir(path.join(rootDir, dir));
}

console.log(`[audit-dead-ui] Scanned UI files across: ${scanDirs.join(", ")}`);
if (issues.length === 0) {
  console.log(`[audit-dead-ui] PASS: 0 dead UI issues found.`);
  process.exit(0);
} else {
  console.log(`[audit-dead-ui] Found ${issues.length} issue(s):`);
  issues.slice(0, 20).forEach((iss) => {
    console.log(`  ${iss.file}:${iss.line} - [${iss.issue}] -> ${iss.snippet.slice(0, 80)}`);
  });
  if (issues.length > 20) {
    console.log(`  ... and ${issues.length - 20} more`);
  }
  process.exit(1);
}

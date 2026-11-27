#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

// Resolve links in the short guides that direct contributors into the repository.
const navigationDocs = new Set([
  "AGENTS.md",
  "README.md",
  "docs/INDEX.md",
  "docs/MODULES.md",
  "docs/STATUS.md",
]);

const DOC_FILES = [
  ...navigationDocs,
  "docs/FEATURES.md",
  "docs/MANUAL_TESTING_GUIDE.md",
  "docs/ARCHITECTURE.md",
  "docs/PRODUCTION_RUNBOOK.md",
  "docs/ADMIN_RECOVERY.md",
  "docs/OPERATIONS.md",
  "docs/ROADMAP.md",
  "docs/GO_LIVE_CHECKLIST.md",
].map((f) => path.resolve(rootDir, f));

const apiDir = path.resolve(rootDir, "src/app/api");
const existingApiRoutes = new Set();

function scanApiRoutes(dir, routePrefix = "/api") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      scanApiRoutes(path.join(dir, entry.name), `${routePrefix}/${entry.name}`);
    } else if (entry.name === "route.ts" || entry.name === "route.js") {
      existingApiRoutes.add(routePrefix);
    }
  }
}
scanApiRoutes(apiDir);

// Gather all Application routes (pages & route handlers) from src/app/
const allAppRoutes = new Set(existingApiRoutes);

function scanPageRoutes(dir, currentPath = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const segment = entry.name;
      // Skip Next.js route groups like (auth) in the public URL path
      const nextSegment = segment.startsWith("(") && segment.endsWith(")") ? "" : `/${segment}`;
      scanPageRoutes(path.join(dir, entry.name), `${currentPath}${nextSegment}`);
    } else if (entry.name === "page.tsx" || entry.name === "page.jsx" || entry.name === "page.js") {
      const pagePath = currentPath === "" ? "/" : currentPath;
      allAppRoutes.add(pagePath);
    } else if (entry.name === "route.ts" || entry.name === "route.js") {
      const routePath = currentPath === "" ? "/" : currentPath;
      allAppRoutes.add(routePath);
    }
  }
}
scanPageRoutes(path.resolve(rootDir, "src/app"));

console.log("📚 Verifying documentation truth against codebase implementation...");

let errors = 0;

for (const docFile of DOC_FILES) {
  const relativeName = path.relative(rootDir, docFile).split(path.sep).join("/");
  const content = fs.readFileSync(docFile, "utf8");

  if (navigationDocs.has(relativeName)) {
    for (const [, link] of content.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(link)) continue;
      const target = decodeURIComponent(link.split("#")[0]);
      if (!fs.existsSync(path.resolve(path.dirname(docFile), target))) {
        console.error(`[${relativeName}] Missing link target ${target}`);
        errors++;
      }
    }
  }

  // Check API Routes (exclude file paths that start with src/app/api/)
  const routeRegex = /(?<!app)\/api\/[a-zA-Z0-9_\-\/*]+/g;
  const foundRoutes = content.match(routeRegex) || [];
  for (let route of foundRoutes) {
    // If it's a wildcard prefix like /api/admin/*
    if (route.endsWith("/*") || route.endsWith("*")) {
      const prefix = route.replace(/\/\*$/, "").replace(/\*$/, "");
      const matchesAny = Array.from(existingApiRoutes).some((r) => r.startsWith(prefix));
      if (!matchesAny) {
        console.error(`❌ [${relativeName}] API route prefix "${route}" has no matching routes under src/app/api/`);
        errors++;
      }
      continue;
    }

    const cleanRoute = route.replace(/\/$/, "");
    if (cleanRoute.endsWith(".ts") || cleanRoute.endsWith(".js")) continue;

    if (!existingApiRoutes.has(cleanRoute)) {
      console.error(`❌ [${relativeName}] API route "${cleanRoute}" mentioned in doc does not exist under src/app/api/`);
      errors++;
    }
  }

  // Check Redirect URLs in GO_LIVE_CHECKLIST.md
  if (relativeName.includes("GO_LIVE_CHECKLIST.md")) {
    const redirectSectionMatch = content.match(/Redirect URLs[\s\S]*?(?=\n\n|\n-|$)/i);
    if (redirectSectionMatch) {
      const redirectUrls = redirectSectionMatch[0].match(/https?:\/\/[a-zA-Z0-9.\-]+(\/[a-zA-Z0-9_\-\/]+)/g) || [];
      for (const url of redirectUrls) {
        const urlObj = new URL(url);
        const redirectPath = urlObj.pathname.replace(/\/$/, "");
        if (!allAppRoutes.has(redirectPath)) {
          console.error(`❌ [${relativeName}] Documented redirect URL path "${redirectPath}" does not exist as an application route under src/app/`);
          errors++;
        }
      }
    }
  }
}

if (errors > 0) {
  console.error(`\n🚨 Documentation verification failed with ${errors} discrepancy/discrepancies.`);
  process.exit(1);
} else {
  console.log(`✅ Documentation truth verified: navigation links, documented API route references, and checklist redirect paths resolve.`);
  process.exit(0);
}

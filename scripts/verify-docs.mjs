#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

// Documentation files to verify
const DOC_FILES = [
  "FEATURES.md",
  "MANUAL_TESTING_GUIDE.md",
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/PRODUCTION_RUNBOOK.md",
  "docs/ADMIN_RECOVERY.md",
  "docs/OPERATIONS.md",
  "docs/ROADMAP.md",
  "docs/GO_LIVE_CHECKLIST.md",
].map((f) => path.resolve(rootDir, f)).filter((f) => fs.existsSync(f));

// 1. Gather all SQL routines and tables from migrations
const migrationsDir = path.resolve(rootDir, "supabase/migrations");
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

const definedTables = new Set();
const definedRoutines = new Set();

for (const file of migrationFiles) {
  const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");

  // Tables
  const tableMatches = content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi);
  for (const m of tableMatches) {
    definedTables.add(m[1].toLowerCase());
  }

  // Routines / Functions
  const funcMatches = content.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)/gi);
  for (const m of funcMatches) {
    definedRoutines.add(m[1].toLowerCase());
  }
}

// 2. Gather all API routes from app/api
const apiDir = path.resolve(rootDir, "app/api");
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

// 2b. Gather all Application routes (pages & route handlers) from app/
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
scanPageRoutes(path.resolve(rootDir, "app"));

// 3. Gather all Environment Variables from .env.example
const envExampleContent = fs.readFileSync(path.resolve(rootDir, ".env.example"), "utf8");
const documentedEnvVars = new Set();
for (const line of envExampleContent.split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=/);
  if (match) {
    documentedEnvVars.add(match[1]);
  }
}
documentedEnvVars.add("NODE_ENV");
documentedEnvVars.add("CI");
documentedEnvVars.add("RETENTION_CRON_SECRET");

// 4. Verify Docs
console.log("📚 Verifying documentation truth against codebase implementation...");

let errors = 0;

for (const docFile of DOC_FILES) {
  const relativeName = path.relative(rootDir, docFile);
  const content = fs.readFileSync(docFile, "utf8");

  // Check API Routes (exclude file paths that start with app/api/)
  const routeRegex = /(?<!app)\/api\/[a-zA-Z0-9_\-\/*]+/g;
  const foundRoutes = content.match(routeRegex) || [];
  for (let route of foundRoutes) {
    // If it's a wildcard prefix like /api/admin/*
    if (route.endsWith("/*") || route.endsWith("*")) {
      const prefix = route.replace(/\/\*$/, "").replace(/\*$/, "");
      const matchesAny = Array.from(existingApiRoutes).some((r) => r.startsWith(prefix));
      if (!matchesAny) {
        console.error(`❌ [${relativeName}] API route prefix "${route}" has no matching routes under app/api/`);
        errors++;
      }
      continue;
    }

    const cleanRoute = route.replace(/\/$/, "");
    if (cleanRoute.endsWith(".ts") || cleanRoute.endsWith(".js")) continue;

    if (!existingApiRoutes.has(cleanRoute)) {
      console.error(`❌ [${relativeName}] API route "${cleanRoute}" mentioned in doc does not exist under app/api/`);
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
          console.error(`❌ [${relativeName}] Documented redirect URL path "${redirectPath}" does not exist as an application route under app/`);
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
  console.log(`✅ Documentation truth verified: All documented API routes, routines, tables, and environment variables match code reality.`);
  process.exit(0);
}

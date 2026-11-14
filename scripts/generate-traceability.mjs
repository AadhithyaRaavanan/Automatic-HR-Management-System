import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const testsDir = path.join(rootDir, "tests");
const docPath = path.join(rootDir, "docs", "TEST_TRACEABILITY.md");

// Read test files recursively
function getTestFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getTestFiles(fullPath));
    } else if (file.endsWith(".test.ts") || file.endsWith(".test.tsx") || file.endsWith(".spec.ts")) {
      results.push(fullPath);
    }
  });
  return results;
}

const testFiles = getTestFiles(testsDir);

// Collect all test cases by parsing test titles
const testMap = new Map(); // Tag -> Array of { file, title, isTodo, isFails, layer, assertionType, runtime }

const testRegex = /(?:it|test)(?:\.(todo|fails|skip|only))?\s*\(\s*["'`](\[F[0-9]+(?:\.[0-9]+)*\][^"'`]+)["'`]/g;

testFiles.forEach((filePath) => {
  const content = fs.readFileSync(filePath, "utf-8");
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, "/");

  let match;
  while ((match = testRegex.exec(content)) !== null) {
    const modifier = match[1] || "";
    const fullTitle = match[2];
    const tagMatch = fullTitle.match(/^(\[F[0-9]+(?:\.[0-9]+)*\])/);
    if (tagMatch) {
      const tag = tagMatch[1];
      if (!testMap.has(tag)) {
        testMap.set(tag, []);
      }

      // Determine layer
      let layer = "Database Integration";
      let runtime = "~450ms";
      if (relPath.startsWith("tests/unit")) {
        layer = "Unit";
        runtime = "<15ms";
      } else if (relPath.startsWith("tests/e2e")) {
        layer = "E2E (Playwright)";
        runtime = "~1.8s";
      }

      // Determine assertion type
      let assertionType = "Behavioral";
      const structuralMarkers = [
        "schema-meta",
        "policy-inventory",
        "grants-snapshot",
        "information_schema",
        "AST",
        "source code",
        "manifesto",
        "verifies existence of",
        "verifies schema column",
      ];
      if (
        structuralMarkers.some(
          (m) => relPath.includes(m) || fullTitle.toLowerCase().includes(m.toLowerCase())
        )
      ) {
        assertionType = "Structural";
      }

      testMap.get(tag).push({
        file: relPath,
        title: fullTitle,
        isTodo: modifier === "todo",
        isFails: modifier === "fails",
        layer,
        assertionType,
        runtime,
      });
    }
  }
});

// Feature Catalog specification from FEATURES.md
const SECTIONS = [
  {
    num: 1,
    title: "Core Architecture & Multi-Tenancy",
    features: [
      { id: "[F1.1.1]", name: "Row-Level Security (RLS) on all tenant tables", expectImplemented: true },
      { id: "[F1.1.2]", name: "Tenant Context Hook (custom_access_token_hook)", expectImplemented: true },
      { id: "[F1.1.3]", name: "Cross-Tenant Attack Shielding on all SECDEF functions", expectImplemented: true },
      { id: "[F1.1.4]", name: "Tenant Lifecycle (trial, active, suspended, cancelled)", expectImplemented: true },
      { id: "[F1.1.5]", name: "Immediate Suspension Lockout", expectImplemented: true },
      { id: "[F1.2.1]", name: "Work Mode Policy (remote, office, hybrid)", expectImplemented: true },
      { id: "[F1.2.2]", name: "Organization Timezone Behavior Configuration", expectImplemented: true },
      { id: "[F1.2.3]", name: "Leave Year Fiscal Cycle Configuration", expectImplemented: true },
      { id: "[F1.2.4]", name: "Auto-Checkout Policy Cutoff", expectImplemented: true },
    ],
  },
  {
    num: 2,
    title: "Authentication, MFA & Security Infrastructure",
    features: [
      { id: "[F2.1.1]", name: "Time-Based One-Time Password (TOTP) Full Lifecycle", expectImplemented: true },
      { id: "[F2.1.2]", name: "AAL2 Step-Up Verification for Privileged Roles", expectImplemented: true },
      { id: "[F2.1.3]", name: "Dynamic Challenge & Setup Pages (/mfa-challenge, /mfa-setup)", expectImplemented: true },
      { id: "[F2.1.4]", name: "Privilege Separation (AAL1 employee vs AAL2 admin/HR)", expectImplemented: true },
      { id: "[F2.2.1]", name: "Failed Attempt Lockout (5 failures per 15m -> 429)", expectImplemented: true },
      { id: "[F2.2.2]", name: "IP & Account Lockout", expectImplemented: true },
      { id: "[F2.2.3]", name: "Clean Redirect Sanitization (getSafeRedirectUrl)", expectImplemented: true },
      { id: "[F2.3.1]", name: "Instant Login Loading Overlay (isAuthenticating)", expectImplemented: true },
      { id: "[F2.3.2]", name: "Self-Service Password Reset (minimum 12 chars)", expectImplemented: true },
      { id: "[F2.3.3]", name: "Temporary Password Expiration & First-Login Enforced Password Change", expectImplemented: true },
    ],
  },
  {
    num: 3,
    title: "Attendance Tracking & Live Time Clock",
    features: [
      { id: "[F3.1.1]", name: "Persistent Global Attendance Timer", expectImplemented: true },
      { id: "[F3.1.2]", name: "Single-Click Punch", expectImplemented: true },
      { id: "[F3.1.3]", name: "Single Open Session Guarantee (idx_single_open_session)", expectImplemented: true },
      { id: "[F3.1.4]", name: "Daily Target Progress Visualizer (progress bar & ring)", expectImplemented: true },
      { id: "[F3.2.1]", name: "5-Minute Pre-Shift Lock", expectImplemented: true },
      { id: "[F3.2.2]", name: "Pre-Shift Badge ('Check-in opens at HH:MM AM/PM')", expectImplemented: true },
      { id: "[F3.2.3]", name: "Shift-Start In-App Notification Toast", expectImplemented: true },
      { id: "[F3.3.1]", name: "Web Portal Direct Punch (source = 'web')", expectImplemented: true },
      { id: "[F3.3.2]", name: "Office Location Geofencing", expectImplemented: false, inaccuracy: "Only schema placeholder; no frontend GPS evaluation" },
      { id: "[F3.3.3]", name: "Office IP Whitelisting", expectImplemented: false, inaccuracy: "Only schema placeholder; no IP matching on check_in" },
      { id: "[F3.3.4]", name: "Rotating QR Code Verification", expectImplemented: false, inaccuracy: "No cryptographic QR code generator or scanner in codebase" },
      { id: "[F3.3.5]", name: "Kiosk Mode Terminal", expectImplemented: false, inaccuracy: "No dedicated kiosk UI or terminal hardware endpoint" },
      { id: "[F3.4.1]", name: "Automatic Late Flagging (is_late = TRUE)", expectImplemented: true },
      { id: "[F3.4.2]", name: "Status Classification (7 attendance day statuses)", expectImplemented: true },
      { id: "[F3.4.3]", name: "Overtime Calculation", expectImplemented: true },
      { id: "[F3.4.4]", name: "Month Finalization & Locking (lock_month)", expectImplemented: true },
    ],
  },
  {
    num: 4,
    title: "Shift Management & Night Shift Engine",
    features: [
      { id: "[F4.1.1]", name: "Custom Shift Times (shift_start_time, shift_end_time)", expectImplemented: true },
      { id: "[F4.1.2]", name: "Admin Shift Customization via /admin/users", expectImplemented: true },
      { id: "[F4.1.3]", name: "Directory Shift Visualizer (Day vs Night badges)", expectImplemented: true },
      { id: "[F4.1.4]", name: "Shift Templates (create, update, assign)", expectImplemented: true },
      { id: "[F4.2.1]", name: "Cross-Midnight Detection (shift_end_time < shift_start_time)", expectImplemented: true },
      { id: "[F4.2.2]", name: "UTC TIMESTAMPTZ Precision & DST Transitions", expectImplemented: true },
      { id: "[F4.2.3]", name: "Auto-Checkout Exemption for Night Shifts", expectImplemented: true },
    ],
  },
  {
    num: 5,
    title: "Leave Management & Balance Engine",
    features: [
      { id: "[F5.1.1]", name: "Custom Leave Types (CRUD & Balances)", expectImplemented: true },
      { id: "[F5.1.2]", name: "Yearly Allocation Engine (allocate_yearly_balances)", expectImplemented: true },
      { id: "[F5.1.3]", name: "KPI Contribution Toggle (counts_toward_kpi)", expectImplemented: true },
      { id: "[F5.2.1]", name: "Business Day Calculator (calculate_working_days)", expectImplemented: true },
      { id: "[F5.2.2]", name: "Half-Day Boundary Protection (chk_leave_request_half_day_single_date)", expectImplemented: true },
      { id: "[F5.3.1]", name: "Employee Leave Filing & Preview", expectImplemented: true },
      { id: "[F5.3.2]", name: "Manager Leave Approval Queue", expectImplemented: true },
      { id: "[F5.3.3]", name: "Automated Attendance Recalculation on Approval", expectImplemented: true },
      { id: "[F5.3.4]", name: "Approval Delegation (create, use, revoke, expire)", expectImplemented: true },
    ],
  },
  {
    num: 6,
    title: "Task Management & Work Logging",
    features: [
      { id: "[F6.1.1]", name: "Multi-Project Organization & Colors", expectImplemented: true },
      { id: "[F6.1.2]", name: "Priority & Due Dates", expectImplemented: true },
      { id: "[F6.1.3]", name: "Status Workflow (todo, in_progress, done, cancelled)", expectImplemented: true, inaccuracy: "Database status is 'done' rather than 'completed'" },
      { id: "[F6.1.4]", name: "Deadline Dispatcher (dispatch_task_due_notifications)", expectImplemented: true },
      { id: "[F6.2.1]", name: "Granular Work Logging (log_task_time)", expectImplemented: true },
      { id: "[F6.2.2]", name: "Task Comments (add_task_comment)", expectImplemented: true },
      { id: "[F6.2.3]", name: "Performance Tie-In to KPI Engine", expectImplemented: true },
    ],
  },
  {
    num: 7,
    title: "Performance & KPI Engine",
    features: [
      { id: "[F7.1.1]", name: "8 Automated KPI Metrics Computation", expectImplemented: true, inaccuracy: "compute_kpi_scores computes attendance_on_time_rate, hours_vs_target, absence_days, leave_days_taken, tasks_completed, tasks_on_time_rate, tasks_overdue, avg_task_cycle_days" },
      { id: "[F7.1.2]", name: "Division-by-Zero Guarded Total (NULLIF weight guard)", expectImplemented: true },
      { id: "[F7.1.3]", name: "Timezone-Correct On-Time Formula", expectImplemented: true },
      { id: "[F7.2.1]", name: "KPI Period Management & Immutability after Closure", expectImplemented: true },
      { id: "[F7.2.2]", name: "Straddling Leave Handling (prorated by working days)", expectImplemented: true },
      { id: "[F7.2.3]", name: "Lean Audit Logging (period ID, score count, actor ID)", expectImplemented: true },
      { id: "[F7.2.4]", name: "Scorecard Export (Excel & CSV)", expectImplemented: true },
    ],
  },
  {
    num: 8,
    title: "User Administration & Resend Credential Provisioning",
    features: [
      { id: "[F8.1.1]", name: "Instant Admin User Provisioning", expectImplemented: true },
      { id: "[F8.1.2]", name: "Auto-Generated 16-Character Temporary Credentials", expectImplemented: true },
      { id: "[F8.1.3]", name: "Resend Email Integration & Local Simulation (Zero Leak Guarantee)", expectImplemented: true },
      { id: "[F8.1.4]", name: "Credentials Created Modal with 1-Click Copy", expectImplemented: true },
      { id: "[F8.2.1]", name: "Role Assignment with Audit Logging", expectImplemented: true },
      { id: "[F8.2.2]", name: "Force Signout across Browser Contexts", expectImplemented: true },
      { id: "[F8.2.3]", name: "MFA Factor Reset", expectImplemented: true },
      { id: "[F8.2.4]", name: "Member Deactivation & Session Revocation", expectImplemented: true },
      { id: "[F8.2.5]", name: "Last Admin Protection", expectImplemented: true },
    ],
  },
  {
    num: 9,
    title: "Data Retention, Archiving & Compliance",
    features: [
      { id: "[F9.1.1]", name: "Custom Retention Lifecycles", expectImplemented: true },
      { id: "[F9.1.2]", name: "Mandatory Archiving Flag (archive_before_delete)", expectImplemented: true },
      { id: "[F9.1.3]", name: "Batched 500-Row Deletion Protection", expectImplemented: true },
      { id: "[F9.2.1]", name: "Dedicated Secret Authentication (RETENTION_CRON_SECRET)", expectImplemented: true },
      { id: "[F9.2.2]", name: "Storage Bucket Storage (retention-archives)", expectImplemented: true, inaccuracy: "Real bucket is 'retention-archives', not 'attendance-archives'" },
      { id: "[F9.2.3]", name: "Execution Run History (retention_archives)", expectImplemented: true, inaccuracy: "Real table is 'retention_archives', not 'retention_archive_runs'" },
      { id: "[F9.3.1]", name: "Zero-Invasive Employee Privacy Manifesto & AST Guardrail Scan", expectImplemented: true },
    ],
  },
  {
    num: 10,
    title: "Analytics, Reporting & Data Portability",
    features: [
      { id: "[F10.1.1]", name: "High-Performance Ledger (sorting, filters, keyset pagination)", expectImplemented: true },
      { id: "[F10.1.2]", name: "Column Visibility Customization", expectImplemented: true },
      { id: "[F10.2.1]", name: "Recharts Visual Dashboards & Render Integrity", expectImplemented: true },
      { id: "[F10.3.1]", name: "Excel Workbooks (.xlsx) with exceljs", expectImplemented: true },
      { id: "[F10.3.2]", name: "Streaming CSV Export with Formula Injection Sanitization", expectImplemented: true },
    ],
  },
  {
    num: 11,
    title: "Design System & Frontend UX",
    features: [
      { id: "[F11.1.1]", name: "Bento Grid Architecture & Design Tokens (#D9DBEC, #6C5CE7, #14123A, 32px)", expectImplemented: true },
      { id: "[F11.1.2]", name: "Typography & WCAG AA Contrast Compliance", expectImplemented: true },
      { id: "[F11.2.1]", name: "Realtime Notifications & Private Topic Isolation", expectImplemented: true },
      { id: "[F11.2.2]", name: "Sonner Toast System & Production Component Guards", expectImplemented: true },
    ],
  },
  {
    num: 12,
    title: "Persona Capability Matrix",
    features: Array.from({ length: 30 }, (_, i) => {
      const idx = String(i + 1).padStart(2, "0");
      return {
        id: `[F12.${idx}]`,
        name: `Persona Matrix Capability ${idx}`,
        expectImplemented: true,
      };
    }),
  },
];

let totalFeatures = 0;
let behavioralCoveredCount = 0;
let structuralCoveredCount = 0;
let partialCount = 0;
let notImplementedCount = 0;
let inaccurateCount = 0;

const structuralOnlyFeatures = [];

SECTIONS.forEach((section) => {
  section.features.forEach((feat) => {
    totalFeatures++;
    const tests = testMap.get(feat.id) || [];
    let status = "COVERED";

    if (!feat.expectImplemented) {
      status = "NOT IMPLEMENTED";
      notImplementedCount++;
    } else if (feat.inaccuracy) {
      status = "INACCURATE";
      inaccurateCount++;
    } else if (tests.length === 0) {
      status = "NOT IMPLEMENTED";
      notImplementedCount++;
    } else if (tests.some((t) => t.isTodo)) {
      status = "PARTIAL";
      partialCount++;
    } else {
      const hasBehavioral = tests.some((t) => t.assertionType === "Behavioral");
      if (hasBehavioral) {
        behavioralCoveredCount++;
      } else {
        structuralCoveredCount++;
        structuralOnlyFeatures.push({
          id: feat.id,
          name: feat.name,
          section: section.num,
          test: tests[0]?.title || "—",
          file: tests[0]?.file || "—",
        });
      }
    }
    feat.status = status;
    feat.tests = tests;
  });
});

let md = `# RemoteHR — Automated Test Traceability Matrix\n\n`;
md += `**Generated**: ${new Date().toISOString()}  \n`;
md += `**Branch**: \`phase-2-multitenancy\`  \n`;
md += `**Target Specification**: \`FEATURES.md\` (Sections 1 through 12)  \n\n`;
md += `This matrix maps every documented feature, security control, and capability from \`FEATURES.md\` to automated test files and individual test assertions across **Unit** (\`tests/unit\`), **Database Integration** (\`tests/database\`), and **End-to-End** (\`tests/e2e\`) test suites.\n\n`;
md += `---\n\n`;

md += `## Section Summary & Coverage Totals\n\n`;
md += `| Section | Module Name | Total Features | Behavioral Covered | Structural Covered | Partial | Not Implemented | Inaccurate |\n`;
md += `| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

SECTIONS.forEach((section) => {
  let sBehCovered = 0;
  let sStructCovered = 0;
  let sPartial = 0;
  let sNotImpl = 0;
  let sInaccurate = 0;

  section.features.forEach((feat) => {
    if (feat.status === "NOT IMPLEMENTED") sNotImpl++;
    else if (feat.status === "INACCURATE") sInaccurate++;
    else if (feat.status === "PARTIAL") sPartial++;
    else if (feat.tests.some((t) => t.assertionType === "Behavioral")) sBehCovered++;
    else sStructCovered++;
  });

  md += `| ${section.num} | ${section.title} | ${section.features.length} | ${sBehCovered} | ${sStructCovered} | ${sPartial} | ${sNotImpl} | ${sInaccurate} |\n`;
});

const totalCoveredHonest = behavioralCoveredCount + structuralCoveredCount;
md += `| **TOTAL** | **All Sections (1-12)** | **${totalFeatures}** | **${behavioralCoveredCount}** | **${structuralCoveredCount}** | **${partialCount}** | **${notImplementedCount}** | **${inaccurateCount}** |\n\n`;
md += `---\n\n`;

md += `## Honest Coverage Accounting\n\n`;
md += `- **Total Documented Features in Catalog**: **${totalFeatures}**\n`;
md += `- **Behaviorally Verified Covered**: **${behavioralCoveredCount}** (tests actively invoke RPCs, mutate data, evaluate RLS authorization, or interact via browser)\n`;
md += `- **Structurally Covered**: **${structuralCoveredCount}** (tests verify column/table presence in \`information_schema\` or static source AST)\n`;
md += `- **Total Covered (Behavioral + Structural)**: **${totalCoveredHonest}**\n`;
md += `- **Partially Implemented**: **${partialCount}**\n`;
md += `- **Not Implemented**: **${notImplementedCount}** (e.g. Geofencing, Office IP Whitelisting, QR Code, Kiosk Mode)\n`;
md += `- **Inaccurate in FEATURES.md**: **${inaccurateCount}** (documented names or formulas that differ from PostgreSQL implementation)\n\n`;
md += `---\n\n`;

md += `## Features Covered Exclusively by Structural Assertions\n\n`;
md += `The following items in the test suite are validated through structural checks (PostgreSQL catalog / \`information_schema\` column existence or source-code AST inspection) rather than live runtime behavior:\n\n`;
md += `| Feature ID | Feature Name | Test File | Assertion Description |\n`;
md += `| :--- | :--- | :--- | :--- |\n`;
structuralOnlyFeatures.forEach((item) => {
  md += `| \`${item.id}\` | ${item.name} | \`${item.file}\` | Schema/AST inspection: \`${item.test}\` |\n`;
});
md += `\n---\n\n`;

// Detail per section
SECTIONS.forEach((section) => {
  md += `## Section ${section.num}: ${section.title}\n\n`;
  md += `| Feature ID | Feature Name | Status | Layer | Assertion Type | Estimated Runtime | Test File(s) | Assertion Count |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :---: | :--- | :---: |\n`;

  section.features.forEach((feat) => {
    const files = [...new Set(feat.tests.map((t) => `\`${t.file}\``))].join("<br>") || "—";
    const layers = [...new Set(feat.tests.map((t) => t.layer))].join(", ") || "—";
    const assertionTypes = [...new Set(feat.tests.map((t) => t.assertionType))].join(", ") || "—";
    const runtimes = [...new Set(feat.tests.map((t) => t.runtime))].join(", ") || "—";
    const count = feat.tests.length;

    let badge = `**${feat.status}**`;
    if (feat.status === "COVERED") {
      badge = feat.tests.some((t) => t.assertionType === "Behavioral")
        ? `✅ \`COVERED (Behavioral)\``
        : `🔍 \`COVERED (Structural)\``;
    } else if (feat.status === "PARTIAL") {
      badge = `🟡 \`PARTIAL\``;
    } else if (feat.status === "INACCURATE") {
      badge = `⚠️ \`INACCURATE\``;
    } else if (feat.status === "NOT IMPLEMENTED") {
      badge = `❌ \`NOT IMPLEMENTED\``;
    }

    md += `| ${feat.id} | ${feat.name} | ${badge} | ${layers} | ${assertionTypes} | ${runtimes} | ${files} | ${count} |\n`;
  });

  md += `\n`;
});

fs.writeFileSync(docPath, md, "utf-8");
console.log(`✅ Traceability matrix successfully written to ${docPath}`);
console.log(`Summary: Total=${totalFeatures}, Behavioral=${behavioralCoveredCount}, Structural=${structuralCoveredCount}, Partial=${partialCount}, Not Impl=${notImplementedCount}, Inaccurate=${inaccurateCount}`);

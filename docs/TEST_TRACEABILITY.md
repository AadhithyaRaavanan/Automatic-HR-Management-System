# RemoteHR — Automated Test Traceability Matrix

**Generated**: 2026-11-14T16:20:08.858Z  
**Branch**: `phase-2-multitenancy`  
**Target Specification**: `FEATURES.md` (Sections 1 through 12)  

This matrix maps every documented feature, security control, and capability from `FEATURES.md` to automated test files and individual test assertions across **Unit** (`tests/unit`), **Database Integration** (`tests/database`), and **End-to-End** (`tests/e2e`) test suites.

---

## Section Summary & Coverage Totals

| Section | Module Name | Total Features | Covered | Partial | Not Implemented | Inaccurate |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| 1 | Core Architecture & Multi-Tenancy | 9 | 9 | 0 | 0 | 0 |
| 2 | Authentication, MFA & Security Infrastructure | 9 | 0 | 0 | 9 | 0 |
| 3 | Attendance Tracking & Live Time Clock | 16 | 0 | 0 | 16 | 0 |
| 4 | Shift Management & Night Shift Engine | 7 | 0 | 0 | 7 | 0 |
| 5 | Leave Management & Balance Engine | 9 | 0 | 0 | 9 | 0 |
| 6 | Task Management & Work Logging | 7 | 0 | 0 | 6 | 1 |
| 7 | Performance & KPI Engine | 7 | 0 | 0 | 6 | 1 |
| 8 | User Administration & Resend Credential Provisioning | 9 | 0 | 0 | 9 | 0 |
| 9 | Data Retention, Archiving & Compliance | 7 | 0 | 0 | 5 | 2 |
| 10 | Analytics, Reporting & Data Portability | 5 | 0 | 0 | 5 | 0 |
| 11 | Design System & Frontend UX | 4 | 0 | 0 | 4 | 0 |
| 12 | Persona Capability Matrix | 30 | 0 | 0 | 30 | 0 |
| **TOTAL** | **All Sections (1-12)** | **119** | **9** | **0** | **106** | **4** |

---

## Section 1: Core Architecture & Multi-Tenancy

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F1.1.1] | Row-Level Security (RLS) on all tenant tables | ✅ `COVERED` | `tests/database/f1-multitenancy.test.ts` | 1 |
| [F1.1.2] | Tenant Context Hook (custom_access_token_hook) | ✅ `COVERED` | `tests/database/f1-multitenancy.test.ts` | 1 |
| [F1.1.3] | Cross-Tenant Attack Shielding on all SECDEF functions | ✅ `COVERED` | `tests/database/f1-multitenancy.test.ts` | 1 |
| [F1.1.4] | Tenant Lifecycle (trial, active, suspended, cancelled) | ✅ `COVERED` | `tests/database/f1-multitenancy.test.ts` | 1 |
| [F1.1.5] | Immediate Suspension Lockout | ✅ `COVERED` | `tests/database/f1-multitenancy.test.ts` | 1 |
| [F1.2.1] | Work Mode Policy (remote, office, hybrid) | ✅ `COVERED` | `tests/database/f1-multitenancy.test.ts` | 1 |
| [F1.2.2] | Organization Timezone Behavior Configuration | ✅ `COVERED` | `tests/database/f1-multitenancy.test.ts` | 1 |
| [F1.2.3] | Leave Year Fiscal Cycle Configuration | ✅ `COVERED` | `tests/database/f1-multitenancy.test.ts` | 1 |
| [F1.2.4] | Auto-Checkout Policy Cutoff | ✅ `COVERED` | `tests/database/f1-multitenancy.test.ts` | 1 |

## Section 2: Authentication, MFA & Security Infrastructure

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F2.1.1] | Time-Based One-Time Password (TOTP) Full Lifecycle | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F2.1.2] | AAL2 Step-Up Verification for Privileged Roles | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F2.1.3] | Dynamic Challenge & Setup Pages (/mfa-challenge, /mfa-setup) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F2.1.4] | Privilege Separation (AAL1 employee vs AAL2 admin/HR) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F2.2.1] | Failed Attempt Lockout (5 failures per 15m -> 429) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F2.2.2] | IP & Account Lockout | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F2.2.3] | Clean Redirect Sanitization (getSafeRedirectUrl) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F2.3.1] | Instant Login Loading Overlay (isAuthenticating) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F2.3.2] | Self-Service Password Reset (minimum 12 chars) | ❌ `NOT IMPLEMENTED` | — | 0 |

## Section 3: Attendance Tracking & Live Time Clock

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F3.1.1] | Persistent Global Attendance Timer | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.1.2] | Single-Click Punch | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.1.3] | Single Open Session Guarantee (idx_single_open_session) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.1.4] | Daily Target Progress Visualizer (progress bar & ring) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.2.1] | 5-Minute Pre-Shift Lock | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.2.2] | Pre-Shift Badge ('Check-in opens at HH:MM AM/PM') | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.2.3] | Shift-Start In-App Notification Toast | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.3.1] | Web Portal Direct Punch (source = 'web') | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.3.2] | Office Location Geofencing | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.3.3] | Office IP Whitelisting | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.3.4] | Rotating QR Code Verification | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.3.5] | Kiosk Mode Terminal | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.4.1] | Automatic Late Flagging (is_late = TRUE) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.4.2] | Status Classification (7 attendance day statuses) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.4.3] | Overtime Calculation | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F3.4.4] | Month Finalization & Locking (lock_month) | ❌ `NOT IMPLEMENTED` | — | 0 |

## Section 4: Shift Management & Night Shift Engine

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F4.1.1] | Custom Shift Times (shift_start_time, shift_end_time) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F4.1.2] | Admin Shift Customization via /admin/users | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F4.1.3] | Directory Shift Visualizer (Day vs Night badges) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F4.1.4] | Shift Templates (create, update, assign) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F4.2.1] | Cross-Midnight Detection (shift_end_time < shift_start_time) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F4.2.2] | UTC TIMESTAMPTZ Precision & DST Transitions | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F4.2.3] | Auto-Checkout Exemption for Night Shifts | ❌ `NOT IMPLEMENTED` | — | 0 |

## Section 5: Leave Management & Balance Engine

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F5.1.1] | Custom Leave Types (CRUD & Balances) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F5.1.2] | Yearly Allocation Engine (allocate_yearly_balances) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F5.1.3] | KPI Contribution Toggle (counts_toward_kpi) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F5.2.1] | Business Day Calculator (calculate_working_days) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F5.2.2] | Half-Day Boundary Protection (chk_leave_request_half_day_single_date) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F5.3.1] | Employee Leave Filing & Preview | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F5.3.2] | Manager Leave Approval Queue | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F5.3.3] | Automated Attendance Recalculation on Approval | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F5.3.4] | Approval Delegation (create, use, revoke, expire) | ❌ `NOT IMPLEMENTED` | — | 0 |

## Section 6: Task Management & Work Logging

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F6.1.1] | Multi-Project Organization & Colors | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F6.1.2] | Priority & Due Dates | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F6.1.3] | Status Workflow (todo, in_progress, done, cancelled) | ⚠️ `INACCURATE` | — | 0 |
| [F6.1.4] | Deadline Dispatcher (dispatch_task_due_notifications) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F6.2.1] | Granular Work Logging (log_task_time) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F6.2.2] | Task Comments (add_task_comment) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F6.2.3] | Performance Tie-In to KPI Engine | ❌ `NOT IMPLEMENTED` | — | 0 |

## Section 7: Performance & KPI Engine

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F7.1.1] | 8 Automated KPI Metrics Computation | ⚠️ `INACCURATE` | — | 0 |
| [F7.1.2] | Division-by-Zero Guarded Total (NULLIF weight guard) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F7.1.3] | Timezone-Correct On-Time Formula | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F7.2.1] | KPI Period Management & Immutability after Closure | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F7.2.2] | Straddling Leave Handling (prorated by working days) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F7.2.3] | Lean Audit Logging (period ID, score count, actor ID) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F7.2.4] | Scorecard Export (Excel & CSV) | ❌ `NOT IMPLEMENTED` | — | 0 |

## Section 8: User Administration & Resend Credential Provisioning

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F8.1.1] | Instant Admin User Provisioning | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F8.1.2] | Auto-Generated 16-Character Temporary Credentials | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F8.1.3] | Resend Email Integration & Local Simulation | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F8.1.4] | Credentials Created Modal with 1-Click Copy | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F8.2.1] | Role Assignment with Audit Logging | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F8.2.2] | Force Signout across Browser Contexts | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F8.2.3] | MFA Factor Reset | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F8.2.4] | Member Deactivation & Session Revocation | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F8.2.5] | Last Admin Protection | ❌ `NOT IMPLEMENTED` | — | 0 |

## Section 9: Data Retention, Archiving & Compliance

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F9.1.1] | Custom Retention Lifecycles | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F9.1.2] | Mandatory Archiving Flag (archive_before_delete) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F9.1.3] | Batched 500-Row Deletion Protection | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F9.2.1] | Dedicated Secret Authentication (RETENTION_CRON_SECRET) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F9.2.2] | Storage Bucket Storage (retention-archives) | ⚠️ `INACCURATE` | — | 0 |
| [F9.2.3] | Execution Run History (retention_archives) | ⚠️ `INACCURATE` | — | 0 |
| [F9.3.1] | Zero-Invasive Employee Privacy Manifesto & AST Guardrail Scan | ❌ `NOT IMPLEMENTED` | — | 0 |

## Section 10: Analytics, Reporting & Data Portability

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F10.1.1] | High-Performance Ledger (sorting, filters, keyset pagination) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F10.1.2] | Column Visibility Customization | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F10.2.1] | Recharts Visual Dashboards & Render Integrity | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F10.3.1] | Excel Workbooks (.xlsx) with exceljs | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F10.3.2] | Streaming CSV Export with Formula Injection Sanitization | ❌ `NOT IMPLEMENTED` | — | 0 |

## Section 11: Design System & Frontend UX

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F11.1.1] | Bento Grid Architecture & Design Tokens (#D9DBEC, #6C5CE7, #14123A, 32px) | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F11.1.2] | Typography & WCAG AA Contrast Compliance | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F11.2.1] | Realtime Notifications & Private Topic Isolation | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F11.2.2] | Sonner Toast System & Production Component Guards | ❌ `NOT IMPLEMENTED` | — | 0 |

## Section 12: Persona Capability Matrix

| Feature ID | Feature Name | Status | Test File(s) | Test Assertion Count |
| :--- | :--- | :---: | :--- | :---: |
| [F12.01] | Persona Matrix Capability 01 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.02] | Persona Matrix Capability 02 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.03] | Persona Matrix Capability 03 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.04] | Persona Matrix Capability 04 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.05] | Persona Matrix Capability 05 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.06] | Persona Matrix Capability 06 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.07] | Persona Matrix Capability 07 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.08] | Persona Matrix Capability 08 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.09] | Persona Matrix Capability 09 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.10] | Persona Matrix Capability 10 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.11] | Persona Matrix Capability 11 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.12] | Persona Matrix Capability 12 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.13] | Persona Matrix Capability 13 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.14] | Persona Matrix Capability 14 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.15] | Persona Matrix Capability 15 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.16] | Persona Matrix Capability 16 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.17] | Persona Matrix Capability 17 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.18] | Persona Matrix Capability 18 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.19] | Persona Matrix Capability 19 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.20] | Persona Matrix Capability 20 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.21] | Persona Matrix Capability 21 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.22] | Persona Matrix Capability 22 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.23] | Persona Matrix Capability 23 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.24] | Persona Matrix Capability 24 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.25] | Persona Matrix Capability 25 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.26] | Persona Matrix Capability 26 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.27] | Persona Matrix Capability 27 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.28] | Persona Matrix Capability 28 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.29] | Persona Matrix Capability 29 | ❌ `NOT IMPLEMENTED` | — | 0 |
| [F12.30] | Persona Matrix Capability 30 | ❌ `NOT IMPLEMENTED` | — | 0 |


# ZenXea HRMS (Pulse) - End-to-End Verification & Safety Test Report

**Target Base URL**: `https://pulse.zenxea.com`  
**Execution Environment**: Playwright Chromium (Headless, 1 Worker, 0 Retries)  
**TypeScript Verification**: `npx tsc --noEmit` passed with 0 errors  
**Execution Date**: 2026-11-18  

---

## 1. Executive Summary Table

| Module | Total Tests | Passed | Failed | Unresolved | Status |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **1. Attendance & Early Check-out** | 8 | 8 | 0 | 0 | **PASS** |
| **2. Tasks & Workflow** | 4 | 4 | 0 | 0 | **PASS** |
| **3. Leave Management & Approval** | 5 | 5 | 0 | 0 | **PASS** |
| **4. Requests (Regularization)** | 3 | 3 | 0 | 0 | **PASS** |
| **5. Holidays Management** | 3 | 3 | 0 | 0 | **PASS** |
| **6. EMS & Onboarding Verification** | 3 | 3 | 0 | 0 | **PASS** |
| **7. Access Control & Feature Flags** | 4 | 4 | 0 | 0 | **PASS** |
| **8. Profile, Settings, & Tutorial** | 4 | 4 | 0 | 0 | **PASS** |
| **Total** | **34** | **34** | **0** | **0** | **100% PASS** |

---

## 2. Module Breakdown

### Module 1: Attendance & Early Check-out (`tests/e2e/01-attendance.spec.ts`)
- **What was tested**:
  - Direct check-out API without active session returns `400 (NO_ACTIVE_SESSION)`.
  - Server-side early check-out enforcement returns `409 (EARLY_CHECKOUT)` with shift end time when `confirm_early` is omitted.
  - Direct check-out API with `confirm_early: true` succeeds and records `early_checkout: true`.
  - Overnight shift calculation (e.g. 17:00 to 01:00) correctly computes shift end date on the next calendar day in `Asia/Kolkata`.
  - UI Early Check-Out confirmation dialog: Cancel keeps the punch session open; Confirm closes session with `early_checkout: true`.
  - Role scoping: `employee`, `manager`, `hr`, and `admin` load attendance history records according to their role permissions.
- **Bugs Found & Fixed**:
  - *Bug*: UI test checked `toISOString().slice(0, 10)` (UTC date) rather than `Asia/Kolkata` date, causing punch state mismatch when running between 00:00 and 05:30 IST.
  - *Fix*: Normalized `work_date` queries to `Asia/Kolkata` date string (`en-CA` locale).
- **Status**: 8/8 Passed.

### Module 2: Tasks & Workflow (`tests/e2e/02-tasks.spec.ts`)
- **What was tested**:
  - Validation: Empty task title rejected with `400`.
  - CRUD & status flow: Creation with title, priority, assignee, due date; progression through `TODO` -> `IN_PROGRESS` -> `IN_REVIEW` -> `DONE` in Kanban and list views; task deletion.
  - Role scoping: Employee sees assigned/owned tasks only; Manager sees department/team; Admin and HR see workspace-wide tasks.
  - Permission enforcement: Employees cannot edit, status-update, or delete tasks assigned to or owned by others (returns `403` or `404`).
- **Status**: 4/4 Passed.

### Module 3: Leave Management & Approval (`tests/e2e/03-leave.spec.ts`)
- **What was tested**:
  - Validation: End date before start date rejected; over-balance requests rejected; overlapping date ranges rejected.
  - Review note enforcement: Review API rejects decisions without a minimum 5-character note (`400 (NOTE_REQUIRED)`).
  - Balance deduction: Rejection preserves leave balance; Approval correctly deducts balance. Applicant sees reviewer notes.
  - Review scoping: Employee cannot review leaves (`403`); Manager can only review team members in their department; Admin/HR review all. Self-approval is strictly blocked (`CANNOT_APPROVE_OWN_LEAVE`).
  - Route access: Employee visiting `/hr/leave` redirected to `/403` or `/`.
  - UI note validation: Approval/rejection buttons disabled in dialog until a note of at least 5 characters is typed.
- **Status**: 5/5 Passed.

### Module 4: Requests / Regularization (`tests/e2e/04-requests.spec.ts`)
- **What was tested**:
  - Validation: Future date regularization and duplicate date requests are rejected (`400`).
  - Review note enforcement: Review API requires minimum 5-character note (`400`).
  - Attendance update on approval: Approved regularization updates or inserts `attendance_days` record; rejected request leaves attendance untouched.
  - Review scoping: Employee cannot review requests (`403`); Manager can only review direct reports; Admin/HR review all. Self-approval blocked (`CANNOT_APPROVE_OWN_REQUEST`).
- **Status**: 3/3 Passed.

### Module 5: Holidays Management (`tests/e2e/05-holidays.spec.ts`)
- **What was tested**:
  - Scoping: All 4 roles (`employee`, `manager`, `hr`, `admin`) can view holidays. Employee and manager cannot add or edit holidays (UI controls hidden, API returns `403`).
  - Holiday CRUD: Admin and HR can create, update, and delete holidays.
  - Actual behavior for leave spanning holidays: Leave calculation deducts only working days (e.g. 5 weekdays spanning 1 holiday deducts 4 days).
- **Status**: 3/3 Passed.

### Module 6: EMS & Onboarding Verification (`tests/e2e/06-ems-onboarding.spec.ts`)
- **What was tested**:
  - EMS Headcount & Scoping: Admin/HR see organization headcounts; Manager sees department-scoped headcount; Employee is denied (`403`).
  - Invite links: Generated invite URLs use `https://pulse.zenxea.com` (never `localhost`).
  - Onboarding wizard: Required personal and emergency contact fields block progression; file magic-byte validation enforces authentic PDF/JPEG/PNG files and rejects renamed `.txt` files; file uploads capped at 5MB; HR review workflow requires approval note.
- **Bugs Found & Fixed**:
  - *Bug 1*: `provision_invited_employee` Postgres RPC does not take `p_employment_category` (PGRST202). Removed obsolete parameter from payload.
  - *Bug 2*: Postgres `employees` table does not have `employment_category` or `employee_number` columns (SQL error 42703). Removed from `.select()` queries in `/api/ems/overview` and `/api/employees`.
  - *Bug 3*: Fake `.pdf` files (renamed `.txt`) returned 500 instead of 400. Updated upload API error handler to catch magic-byte validation errors and return HTTP 400.
- **Status**: 3/3 Passed.

### Module 7: Access Control & Feature Flags (`tests/e2e/07-access-control.spec.ts`)
- **What was tested**:
  - Feature flags: `/kpi`, `/admin/locations`, `/admin/shifts`, `/admin/audits` redirect to `/dashboard` when disabled; sidebar nav items and command palette links are removed.
  - Role-based routing:
    - Employee redirected when accessing `/admin/users`, `/admin/departments`, `/hr/leave`, `/hr/onboarding`, `/ems`, `/reports`, `/admin/settings`. Direct privileged API calls blocked with 403.
    - Manager permitted on scoped EMS; blocked on Admin/HR-only routes.
    - Admin and HR permitted on workspace governance routes.
  - Sidebar rendering strictly matches each role's permissions.
- **Status**: 4/4 Passed.

### Module 8: Profile, Settings, & Tutorial (`tests/e2e/08-profile-tutorial.spec.ts`)
- **What was tested**:
  - Profile & documents: Profile displays full name, emergency contact details, and working signed document links for authorized records.
  - Password change: Temporary password change flow succeeds for test user and restores credentials safely.
  - Tutorial: Driver.js tutorial is role-tailored and tracks `tutorial_completed` flag so it does not loop on repeated logins.
  - Unauthenticated security: Sign out terminates session, and unauthenticated page visits redirect to `/login`.
- **Status**: 4/4 Passed.

---

## 3. Key Edge Cases Verified

1. **Server-Side Early Check-out Enforcement**:
   - Calling `/api/attendance/checkout` before shift end returns HTTP `409` with code `EARLY_CHECKOUT` and the shift end time.
   - Bypassing the confirmation dialog via direct API call without `confirm_early: true` is strictly rejected by the server.
2. **Overnight Shift End Calculation**:
   - For a shift starting at 17:00 and ending at 01:00, the shift end time is calculated on the subsequent calendar day in `Asia/Kolkata`.
3. **Review Note Enforcement (Leave & Regularization)**:
   - Both approve and reject actions mandate a note with at least 5 non-whitespace characters.
   - UI submit buttons remain disabled until the threshold is met; backend APIs return HTTP 400 if bypassed.
4. **Holiday-Aware Leave Deduction**:
   - Spanning leaves over official holidays deducts only net working days (verified 5 calendar weekdays spanning 1 holiday = 4 days deducted).
5. **Magic Byte Document Integrity**:
   - File uploads in onboarding inspect initial buffer header bytes (`%PDF`, JPEG marker `0xFF 0xD8 0xFF`, PNG marker `0x89 0x50 0x4E 0x47`). Renamed text or binary files are rejected with HTTP 400.

---

## 4. Unresolved Issues

**None - 100% resolved.** All 34 tests across all 8 modules pass against the live production deployment.

---

## 5. Production Safety Confirmation

- **No Real Employee Data Touched**:
  - Production users (`jamesaathithyandev@gmail.com`, `aadhithya.raavanan@gmail.com`, etc.) were never modified, deactivated, or targeted.
  - All test records were created with `TEST_` prefixes and isolated to designated test user UUIDs.
  - All temporary test attendance sessions, tasks, holidays, leaves, and regularization records were cleanly deleted via Supabase service role admin in test teardowns and post-run cleanup scripts.

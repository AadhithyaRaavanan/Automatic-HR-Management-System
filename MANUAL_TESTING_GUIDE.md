# RemoteHR — Comprehensive Manual Testing Guide & QA Playbook

**Document Version**: 3.0.0  
**Target Environments**:
- Local Development Stack (`http://localhost:3000`)
- Vercel Preview / Production Staging (`https://<project-preview>.vercel.app`)
**Backend**: Supabase Local Docker Stack (`http://127.0.0.1:54321`) / Supabase Managed Cloud  
**Studio UI (Local)**: `http://127.0.0.1:54323`  
**Mailpit UI (Local)**: `http://127.0.0.1:54324`  
**Application Branch**: `production-readiness`  

---

## Table of Contents
1. [Test Environment & Architecture](#1-test-environment--architecture)
2. [Testing Personas & Access Matrix](#2-testing-personas--access-matrix)
3. [Pre-Flight Verification Checklist](#3-pre-flight-verification-checklist)
4. [Test Suite 1: Authentication, MFA & Session Lifecycle](#4-test-suite-1-authentication-mfa--session-lifecycle)
5. [Test Suite 2: Attendance Tracking & Shift Operations](#5-test-suite-2-attendance-tracking--shift-operations)
6. [Test Suite 3: Leave Management & Policy Rules](#6-test-suite-3-leave-management--policy-rules)
7. [Test Suite 4: Management Approvals & Delegation](#7-test-suite-4-management-approvals--delegation)
8. [Test Suite 5: Tasks & Performance (KPI Engine)](#8-test-suite-5-tasks--performance-kpi-engine)
9. [Test Suite 6: Multi-Tenant Data Isolation & RLS](#9-test-suite-6-multi-tenant-data-isolation--rls)
10. [Test Suite 7: System Administration & Custom Roles](#10-test-suite-7-system-administration--custom-roles)
11. [Test Suite 8: Shifts, Continuous Timer, Password Management & Resend Delivery](#11-test-suite-8-shifts-continuous-timer-password-management--resend-delivery)
12. [Dedicated Go-Live Smoke Test for Vercel Preview](#12-dedicated-go-live-smoke-test-for-vercel-preview)
13. [Supabase Studio SQL Verification Cheat Sheet](#13-supabase-studio-sql-verification-cheat-sheet)
14. [Troubleshooting & Common Error Reference](#14-troubleshooting--common-error-reference)

---

## 1. Test Environment & Architecture

The application is deployed across integrated services:

```
┌────────────────────────────────────────────────────────────────────────┐
│ BROWSER CLIENT (http://localhost:3000 or Vercel Preview)               │
│ Next.js 14 App Router, Tailwind CSS, Lucide, Recharts, Sonner Toaster │
└───────────────────────────┬────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌───────────────────────────┐ ┌──────────────────────────────────────────┐
│ NEXT.JS BACKEND RUNTIME   │ │ SUPABASE STACK (Local Docker or Cloud)   │
│ • Server Actions          │ │ • Kong API Gateway (:54321)              │
│ • /api/auth/login         │ │ • PostgreSQL Database (:54322)           │
│ • /api/health             │ │ • Supabase Studio Dashboard (:54323)     │
│ • Rate Limiting (Upstash) │ │ • Mailpit Local Mail Server (:54324)     │
└───────────────────────────┘ └──────────────────────────────────────────┘
```

### Local URLs & Service Endpoints
| Component | Local URL / Port | Purpose |
| :--- | :--- | :--- |
| **Web UI** | `http://localhost:3000` | Frontend application interface |
| **Supabase Studio** | `http://127.0.0.1:54323` | Database inspection, SQL editor, Auth user tables |
| **Mailpit (InBucket)** | `http://127.0.0.1:54324` | Local mail inbox for Magic Links, invites, and OTPs |
| **Supabase API** | `http://127.0.0.1:54321` | Auth, PostgREST (`/rest/v1`), Storage |
| **PostgreSQL** | `127.0.0.1:54322` | Direct DB connection (`postgres:postgres`) |

> **Note on Punch Channels & Out-of-Scope Features**:
> Physical geofence radius checks, office-IP subnets, rotating QR codes, and kiosk punch modes are strictly out of scope. Attendance punches occur directly through authenticated web sessions (`web` source).

---

## 2. Testing Personas & Access Matrix

### Organization 1: Acme Corp (`org-1-uuid`)
| Persona | Email | Default Password (Dev/Seed) | Role | MFA Enforced | Primary Work Mode |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Employee** | `employee@remotehr.io` | `DemoPassword123!` | `employee` | Opt-in | Hybrid |
| **Manager** | `manager@remotehr.io` | `DemoPassword123!` | `manager` | Opt-in | Office |
| **HR Admin** | `hr@remotehr.io` | `DemoPassword123!` | `hr` | **Yes (AAL2)** | Remote |
| **System Admin** | `admin@remotehr.io` | `DemoPassword123!` | `admin` | **Yes (AAL2)** | Office |

### Organization 2: Beta Ltd (`org-2-uuid` — Cross-Tenant Verification)
| Persona | Email | Default Password | Role | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Org 2 Admin** | `admin@tenant2.io` | `DemoPassword123!` | `admin` | Verify Org 1 records are 100% invisible |
| **Org 2 Employee**| `employee@tenant2.io` | `DemoPassword123!` | `employee` | Cross-tenant RPC denial testing |

### Role-Based Access Control (RBAC) Page Matrix
| Page Route | Description | Employee | Manager | HR Admin | System Admin |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `/` | Dashboard & Clock In/Out | ✅ | ✅ | ✅ | ✅ |
| `/attendance` | Personal Attendance History | ✅ | ✅ | ✅ | ✅ |
| `/leave` | Personal Leave Requests | ✅ | ✅ | ✅ | ✅ |
| `/tasks` | Task Assignment & Tracking | ✅ | ✅ | ✅ | ✅ |
| `/profile` | Profile & Security Settings | ✅ | ✅ | ✅ | ✅ |
| `/settings` | Password & 2FA Configuration | ✅ | ✅ | ✅ | ✅ |
| `/team` | Manager Team Overview | ❌ (403) | ✅ | ✅ | ✅ |
| `/requests` | Leave & Punch Approvals | ❌ (403) | ✅ | ✅ | ✅ |
| `/reports` | Analytics & Export | ❌ (403) | ❌ (403) | ✅ | ✅ |
| `/hr/leave` | Leave Policy Allocation | ❌ (403) | ❌ (403) | ✅ | ✅ |
| `/kpi` | KPI Scorecard & Governance | ✅ (View) | ✅ (Team) | ✅ (Full) | ✅ (Full) |
| `/admin/*` | System Settings & Users | ❌ (403) | ❌ (403) | ❌ (403) | ✅ (Full) |
| `/gallery` | UI Gallery (Dev Demo only) | ✅ (Dev only)| ✅ (Dev only)| ✅ (Dev only)| ✅ (Dev only)|

---

## 3. Pre-Flight Verification Checklist

Before starting manual tests, verify that local services are operating normally:
1. **Verify Web Application**: Open [http://localhost:3000](http://localhost:3000) in your browser. It should redirect automatically to `/login`.
2. **Verify Demo Presets (Dev Mode)**: In local development (`NEXT_PUBLIC_DEMO_MODE=true`), verify the 4 "Demo Mode Presets" buttons appear at the bottom: `Employee`, `Manager`, `HR Admin`, `System Admin`. (In production mode, presets are hidden).
3. **Verify Supabase Studio**: Open [http://127.0.0.1:54323](http://127.0.0.1:54323). Navigate to **Table Editor** to confirm tables exist (`attendance_sessions`, `attendance_days`, `employees`, `organization_members`, `job_titles`, `leave_requests`, `organizations`).
4. **Verify Mailpit**: Open [http://127.0.0.1:54324](http://127.0.0.1:54324). Confirm the Mailpit inbox loads with zero connection errors.

---

## 4. Test Suite 1: Authentication, MFA & Session Lifecycle

### TC-AUTH-01: Standard Employee Sign-In (Single Factor)
- **Goal**: Verify normal employee login without mandatory MFA gating.
- **Steps**:
  1. Navigate to `http://localhost:3000/login`.
  2. In dev mode, click the **Employee** preset button or enter `employee@remotehr.io` with password `DemoPassword123!`.
  3. Click **Sign In**.
- **Expected Result**:
  - Toast: `"Signed in successfully!"`.
  - Browser redirects to dashboard (`/`).
  - Header displays user avatar, employee name, and role badge.
  - Sidebar shows Employee navigation items (no `/admin` or `/reports` links).

---

### TC-AUTH-02: Privileged Role Login with MFA Enforcement (Admin / HR)
- **Goal**: Verify privileged roles are gated by AAL2 TOTP Multi-Factor Authentication when `require_mfa_for_privileged` is enabled.
- **Steps**:
  1. Navigate to `http://localhost:3000/login`.
  2. Sign in as `admin@remotehr.io` or `hr@remotehr.io`.
- **Expected Result**:
  - System detects privileged role requirement (`mfa_required_for_caller()`).
  - If factor enrolled: browser redirects to `/mfa-challenge`. Direct access to `/admin` without `aal2` returns 403 or redirects back to `/mfa-challenge`.
  - If no factor enrolled: browser redirects to `/mfa-setup` to enforce initial enrollment.

---

### TC-AUTH-03: 2FA Setup Key Only Enrollment (No QR Code Image)
- **Goal**: Verify TOTP factor enrollment using the manual Base32 setup key.
- **Steps**:
  1. On `/mfa-setup` (or `/settings` > Setup 2FA), view the displayed Base32 secret key (e.g. `JBSW Y3DP EHPK 3PXP`).
  2. Note that no QR code image canvas is rendered.
  3. Click the **Copy Setup Key** button and verify toast confirmation `"Setup key copied to clipboard"`.
  4. Paste into an authenticator app (or local TOTP helper).
  5. Enter the 6-digit TOTP verification code and submit.
- **Expected Result**:
  - Verification succeeds with toast confirmation.
  - Session is promoted from `aal1` to `aal2`.
  - Browser transitions to the requested destination (`/admin` or `/`).

---

### TC-AUTH-04: Forgot Password with Email OTP Login
- **Goal**: Verify password reset flow using single-use email OTP without passwords.
- **Steps**:
  1. On `/login`, click the **"Forgot Password?"** link.
  2. Enter registered email `employee@remotehr.io` and click **Send OTP**.
  3. Open Mailpit (`http://127.0.0.1:54324`) or your email inbox to receive the 6-digit code.
  4. Enter the 6-digit OTP code on the verification step and click **Verify & Login**.
- **Expected Result**:
  - System verifies token via `supabase.auth.verifyOtp({ email, token, type: 'email' })`.
  - User session is established immediately.
  - Browser redirects to `/settings` (or `/profile`) with toast: `"Logged in successfully. Please set your new password."`.

---

### TC-AUTH-05: Brute-Force Rate Limiting (Account & IP Lockout)
- **Goal**: Verify that 5 consecutive failed login attempts trigger a 15-minute lockout.
- **Steps**:
  1. On `/login`, enter `employee@remotehr.io` with an incorrect password.
  2. Click **Sign In** 5 consecutive times.
- **Expected Result**:
  - Attempts 1–4 return error toast: `"Invalid email or password. Please verify your credentials and try again."`.
  - On attempt 5, the endpoint returns HTTP 429.
  - Alert displays: `"Too many failed attempts. Login locked for 15 minutes."`.
  - Subsequent sign-in attempts are blocked before hitting the database.

---

### TC-AUTH-06: Safe Redirect Protection (Open Redirect & CRLF Rejection)
- **Goal**: Ensure attackers cannot abuse the `?redirect=` parameter.
- **Steps**:
  1. Navigate to `http://localhost:3000/login?redirect=https://evil-phishing-site.com`.
  2. Sign in as `employee@remotehr.io`.
  3. Test newline bypass: `http://localhost:3000/login?redirect=%2F%0Aevil.com`.
- **Expected Result**:
  - In all cases, `sanitizeRedirectPath` rejects the external URL.
  - Browser redirects safely to root path `/` or fallback internal route.

---

## 5. Test Suite 2: Attendance Tracking & Shift Operations

### TC-ATT-01: Live Real-Time Check-In
- **Goal**: Verify employee clock-in with stopwatch initiation.
- **Steps**:
  1. Log in as `employee@remotehr.io` and view the dashboard (`/`).
  2. Locate the **Hero Check-In Card**.
  3. Click the primary **Check In** button.
- **Expected Result**:
  - Button state flips to active clocked-in status.
  - Live stopwatch initiates counting up seconds and minutes.
  - Status pill displays **Present** in green.
  - Daily hours card updates dynamically.

---

### TC-ATT-02: Real-Time Check-Out & Working Duration
- **Goal**: Complete an attendance session and calculate total minutes.
- **Steps**:
  1. With an active session running, click **Check Out**.
  2. Provide optional check-out notes in the prompt modal.
  3. Confirm check-out.
- **Expected Result**:
  - Live timer stops.
  - Check-out timestamp is saved to `attendance_sessions.check_out_at`.
  - `attendance_days.total_minutes` recalculates elapsed work duration.
  - The record is appended to the **Recent Activity** list.

---

### TC-ATT-03: Attendance Regularization Request (Missed Punch)
- **Goal**: Submit a time correction request for manager approval.
- **Steps**:
  1. Navigate to `/attendance`.
  2. Click **Request Regularization**.
  3. Select date, enter requested punch times and reason.
  4. Click **Submit Request**.
- **Expected Result**:
  - Toast: `"Regularization request submitted successfully"`.
  - A pending request appears in `regularization_requests` with status `pending`.

---

## 6. Test Suite 3: Leave Management & Policy Rules

### TC-LV-01: View Leave Balance Quotas
- **Goal**: Verify quota breakdown by leave category.
- **Steps**:
  1. Navigate to `/leave` as `employee@remotehr.io`.
- **Expected Result**:
  - Quota cards display available balances for:
    - **Earned / Annual Leave**
    - **Casual Leave**
    - **Sick Leave**
  - Displays Allocated days, Used days, and Remaining days.

---

### TC-LV-02: Apply for Single-Day Full Leave
- **Goal**: Submit a standard 1-day absence request.
- **Steps**:
  1. On `/leave`, click **Apply for Leave**.
  2. Select Leave Type: `Casual Leave`.
  3. Select same start and end date. Day Part: `Full Day`.
  4. Click **Submit Request**.
- **Expected Result**:
  - Toast confirmation: `"Leave request submitted"`.
  - Estimated working days calculates to `1.0`.
  - Request appears in `leave_requests` with status `pending`.

---

### TC-LV-03: Multi-Day Range with Weekend Exclusion
- **Goal**: Verify non-working days (Saturdays & Sundays) do not consume leave balance.
- **Steps**:
  1. Click **Apply for Leave**.
  2. Select Start Date: **Friday**. End Date: **Tuesday** of following week.
  3. Submit.
- **Expected Result**:
  - System automatically calculates working days as `3.0 Days` (Friday, Monday, Tuesday), correctly skipping Saturday and Sunday.

---

### TC-LV-04: Half-Day on Multi-Day Range Negative Test
- **Goal**: Verify database check constraint `chk_leave_request_half_day_single_date`.
- **Steps**:
  1. Attempt to submit a leave request where `startDate != endDate` while selecting `first_half`.
- **Expected Result**:
  - UI validation blocks submission.
  - Direct database insert is rejected by check constraint `chk_leave_request_half_day_single_date`.

---

## 7. Test Suite 4: Management Approvals & Delegation

### TC-APP-01: Manager Review of Leave Request
- **Goal**: Approve or reject subordinate leave requests.
- **Steps**:
  1. Sign in as `manager@remotehr.io`.
  2. Navigate to `/requests` or `/team`.
  3. Locate the pending leave request and click **Approve**.
- **Expected Result**:
  - Status updates to `approved`.
  - Subordinate's used balance in `leave_balances.used` increments by approved days.

---

### TC-APP-02: Separation of Duties (Anti-Self-Approval)
- **Goal**: Verify managers cannot approve their own requests.
- **Steps**:
  1. As `manager@remotehr.io`, submit a personal leave request.
  2. Navigate to `/requests`.
- **Expected Result**:
  - The manager's own request does NOT display an "Approve" button.
  - If approval RPC is invoked directly, PostgreSQL returns error: `"Forbidden: Users cannot approve their own requests"`.

---

## 8. Test Suite 5: Tasks & Performance (KPI Engine)

### TC-KPI-01: Task Creation and Lifecycle
- **Goal**: Create and track work tasks that feed into the KPI engine.
- **Steps**:
  1. Log in as `employee@remotehr.io` and navigate to `/tasks`.
  2. Create a task, mark it `In Progress`, then `Completed`.
- **Expected Result**:
  - Task status transitions smoothly.
  - `completed_at` timestamp is recorded.

---

### TC-KPI-02: View Employee KPI Scorecard (8 Metrics)
- **Goal**: Verify all 8 core performance indicators render accurately.
- **Steps**:
  1. Navigate to `/kpi`.
  2. Verify 8 metrics: Attendance Rate, Punctuality Score, Task Completion Rate, On-Time Delivery Rate, Work Quality Rating, Overtime Compliance, Leave Utilization, Training Completion.
- **Expected Result**:
  - Each metric card displays Current Value, Target, Weight %, and Performance Band.

---

### TC-KPI-03: Periodic Score Calculation & Lean Audit Logging
- **Goal**: Execute `compute_kpi_scores` and verify clean, non-bloated audit logs.
- **Steps**:
  1. As Admin or HR, trigger score evaluation via UI or SQL.
  2. Open Supabase Studio > `audit_logs` table.
- **Expected Result**:
  - Scores written to `kpi_scores`.
  - `audit_logs` row contains a lean payload: `{ "period_id": "...", "scores_written": N, "actor_id": "..." }`.

---

## 9. Test Suite 6: Multi-Tenant Data Isolation & RLS

### TC-TEN-01: Cross-Tenant Data Invisibility
- **Goal**: Verify complete cryptographic data segregation between Organization 1 and Organization 2.
- **Steps**:
  1. In Window A, log in as Org 1 Admin (`admin@remotehr.io`).
  2. In Window B (Incognito), log in as Org 2 Admin (`admin@tenant2.io`).
- **Expected Result**:
  - Org 2 Admin sees only Org 2 employees and records.
  - Org 1 records are 100% invisible.

---

### TC-TEN-02: Suspended Employee Policy Denial
- **Goal**: Ensure deactivated or suspended staff are instantly cut off from data.
- **Steps**:
  1. In Supabase Studio, update employee status:
     ```sql
     UPDATE organization_members SET status = 'suspended' WHERE user_id = '<employee-id>';
     ```
  2. As that employee, refresh the dashboard or attempt to clock in.
- **Expected Result**:
  - RLS policies instantly block access.
  - Queries return 0 rows or redirect to `/403`.
  - Check-in button returns error toast: `"Account is suspended. Contact HR."`.

---

## 10. Test Suite 7: System Administration & Custom Roles

### TC-ADM-01: Custom Job Titles Management
- **Goal**: Add, edit, and delete custom company job titles.
- **Steps**:
  1. Log in as System Admin (`admin@remotehr.io`) with AAL2 session.
  2. Navigate to `/admin/users` and click the **"Manage Job Titles"** tab/modal.
  3. Click **Add Job Title**:
     - Title: `Senior Full Stack Engineer`
     - Description: `Lead developer on Next.js and Supabase architecture`
  4. Click **Save**.
- **Expected Result**:
  - Job title is inserted into `job_titles` table.
  - Title appears in the list with options to Edit or Delete.
  - Title is available in the user invite / edit dropdown.

---

### TC-ADM-02: Invite User with Job Title & Department Assignment
- **Goal**: Invite a team member with custom job title and department.
- **Steps**:
  1. In `/admin/users`, click **Add Employee / Invite User**.
  2. Fill in:
     - Email: `engineer@remotehr.io`
     - Full Name: `Jane Doe`
     - Role: `Employee`
     - Job Title: `Senior Full Stack Engineer`
     - Shift: `09:00 - 17:00`
  3. Click **Send Invitation**.
- **Expected Result**:
  - Single-use invite link is generated via Supabase Auth Admin.
  - Welcome email dispatched with link.
  - User record created in `employees` and `organization_members` with foreign keys to `job_title_id`.

---

### TC-ADM-03: Organization 2FA Policy Toggle
- **Goal**: Verify privileged MFA enforcement toggle and warning banner.
- **Steps**:
  1. Log in as Admin (`admin@remotehr.io`) at AAL2.
  2. Navigate to `/admin/settings`.
  3. Locate the **"Privileged Account 2FA Enforcement"** setting (`require_mfa_for_privileged`).
  4. Toggle setting to **Disabled (False)**.
- **Expected Result**:
  - Setting updates in `organizations.require_mfa_for_privileged`.
  - A persistent warning banner appears at the top of privileged screens:
    `"⚠️ Warning: Mandatory Two-Factor Authentication is currently disabled for this organization."`
  - Action is logged in `audit_logs` with old and new values.
  - Toggle setting back to **Enabled (True)**; warning banner disappears.

---

### TC-ADM-04: Retention Archiving Run (Dedicated Secret)
- **Goal**: Verify automated retention archiver endpoint.
- **Steps**:
  1. As Admin, navigate to `/admin/settings` > **Data Retention**.
  2. Click **Run Archival Preview (Dry Run)**.
  3. Test via curl with the dedicated retention secret header:
     ```bash
     curl -X POST http://127.0.0.1:54321/functions/v1/retention-archiver \
       -H "Content-Type: application/json" \
       -H "x-retention-secret: super-secret-retention-token-12345"
     ```
- **Expected Result**:
  - Valid POST creates zipped archives in `attendance-archives` storage bucket and logs row in `retention_archive_runs`.
  - Missing or invalid secret returns 401/503.

---

## 11. Test Suite 8: Shifts, Continuous Timer, Password Management & Resend Delivery

### TC-NEW-01: Persistent Live Attendance Timer Across Navigation
- **Goal**: Verify active attendance timer persists continuously across route changes.
- **Steps**:
  1. Sign in as `employee@remotehr.io`.
  2. On `/`, click **Check In**. Observe stopwatch start (e.g. `00:00:15`).
  3. Navigate in the sidebar to `/leave`. Wait 10 seconds.
  4. Navigate back to `/` (Dashboard).
- **Expected Result**:
  - Live attendance timer does NOT reset to `00:00:00`.
  - Elapsed seconds reflect total duration since check-in (`00:00:25+`).

---

### TC-NEW-02: 5-Minute Pre-Check-In Lock & Badge
- **Goal**: Verify employees cannot clock in prematurely before the allowed 5-minute pre-shift window.
- **Steps**:
  1. As Admin, set employee's Shift Start Time to 30 minutes in future.
  2. Sign out and sign in as that employee.
  3. Inspect Check-In Card on `/`.
- **Expected Result**:
  - The **Check In** button is disabled with lock opacity.
  - Pill badge displays: `"Check-in opens at [HH:MM AM/PM]"` (5 minutes before shift start).

---

### TC-NEW-03: Automatic Late Flagging (`is_late = TRUE`)
- **Goal**: Verify check-in records are automatically flagged late if punch occurs after `shift_start_time + 15 mins`.
- **Steps**:
  1. Configure employee's shift to start at `09:00:00`.
  2. Punch check-in at `09:16:00` or later.
  3. Check `attendance_days` record:
     ```sql
     SELECT employee_id, work_date, is_late, total_minutes 
     FROM attendance_days 
     WHERE employee_id = '<employee-uuid>' 
     ORDER BY work_date DESC LIMIT 1;
     ```
- **Expected Result**:
  - `is_late` is set to `TRUE`.
  - Attendance history table renders red `"Late"` badge.

---

### TC-NEW-04: Night Shift & Midnight Crossover (17:00 to 01:00) with Auto-Checkout Skip
- **Goal**: Verify shifts that cross midnight are exempted from 23:59 auto-checkout.
- **Steps**:
  1. Set employee shift in `/admin/users` to `17:00:00` to `01:00:00`.
  2. Verify Directory table displays `🌙 17:00 - 01:00 (Night)` badge.
  3. Employee checks in at `18:00:00`.
  4. At `23:59:00`, the scheduled pg_cron auto-checkout runs (`SELECT cron_auto_checkout();`).
- **Expected Result**:
  - System recognizes `shift_end_time < shift_start_time` (Night Shift).
  - Active session is NOT checked out at 23:59.
  - Session remains active until post-midnight shift end (`01:00 + grace buffer`).

---

## 12. Dedicated Go-Live Smoke Test for Vercel Preview

This section documents the step-by-step smoke test suite to run against a live deployed Vercel Preview environment prior to production cutover.

### Step 1: Health Check Endpoint
- **Request**:
  ```bash
  curl -i https://<preview-app-url>/api/health
  ```
- **Expected Output**:
  - HTTP status `200 OK`.
  - Response body:
    ```json
    {
      "status": "healthy",
      "timestamp": "...",
      "checks": {
        "database": "healthy"
      }
    }
    ```

### Step 2: Non-Demo Mode Verification
- **Request**:
  ```bash
  curl -i https://<preview-app-url>/gallery
  ```
- **Expected Output**:
  - HTTP status `404 Not Found`. (In production mode without `NEXT_PUBLIC_DEMO_MODE=true`, the gallery route is disabled).

### Step 3: Login Page & Turnstile CAPTCHA Enforcement
- **Action**: Open `https://<preview-app-url>/login` in a clean incognito window.
- **Verification**:
  - Zero "Demo Mode Presets" buttons appear on the login card.
  - Cloudflare Turnstile CAPTCHA widget renders properly above or inside the sign-in button.
  - Submitting login without completing Turnstile displays: `"Please complete the CAPTCHA verification."`
  - When verified, the Turnstile token is forwarded to Supabase GoTrue.

### Step 4: Security Headers Check
- **Request**:
  ```bash
  curl -I https://<preview-app-url>/login
  ```
- **Expected Headers Present**:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Content-Security-Policy: default-src 'self' ...`

### Step 5: First Admin Invite Link Onboarding
- **Action**: Run the production bootstrap script:
  ```bash
  npm run bootstrap:production
  ```
- **Verification**:
  - Bootstrap creates the initial organization and admin record without emergency backup credentials.
  - Single-use invite link is printed only to interactive stdout (never logged in CI or Sentry).
  - Navigate to the invite URL in browser.
  - Set password (minimum 12 characters).
  - Enforce initial MFA setup: verify Base32 setup key on `/mfa-setup`, input 6-digit TOTP, confirm session elevation to AAL2.
  - Land on `/admin` dashboard.

### Step 6: Forgot Password Email OTP Flow
- **Action**: On `/login`, click "Forgot Password?", enter the admin email, retrieve the 6-digit OTP code from Resend / inbox, enter code on verification screen.
- **Verification**:
  - Signs in directly and routes to `/settings` with password update prompt.

---

## 13. Supabase Studio SQL Verification Cheat Sheet

Open **Supabase Studio** at [http://127.0.0.1:54323](http://127.0.0.1:54323) > **SQL Editor** to run these direct verification queries using real schema tables:

### 1. Check Member Shifts and Assigned Job Titles
```sql
SELECT 
  e.full_name,
  e.email,
  om.role,
  jt.title_name AS job_title,
  om.shift_start_time,
  om.shift_end_time,
  CASE WHEN om.shift_end_time < om.shift_start_time THEN 'Night Shift' ELSE 'Day Shift' END AS shift_type
FROM organization_members om
JOIN employees e ON e.id = om.user_id
LEFT JOIN job_titles jt ON jt.id = om.job_title_id
ORDER BY om.shift_start_time;
```

### 2. Check Today's Live Attendance Sessions
```sql
SELECT 
  s.id,
  s.work_date,
  e.full_name,
  om.role,
  s.check_in_at,
  s.check_out_at,
  s.source,
  s.note
FROM attendance_sessions s
JOIN employees e ON e.id = s.employee_id
JOIN organization_members om ON om.user_id = s.employee_id
WHERE s.work_date = CURRENT_DATE
ORDER BY s.check_in_at DESC;
```

### 3. Check Daily Attendance Summaries & Late Flags
```sql
SELECT 
  ad.work_date,
  e.full_name,
  ad.total_minutes,
  ad.status,
  ad.is_late,
  ad.locked
FROM attendance_days ad
JOIN employees e ON e.id = ad.employee_id
WHERE ad.work_date = CURRENT_DATE
ORDER BY ad.work_date DESC;
```

### 4. Verify Leave Balances & Usages
```sql
SELECT 
  e.full_name,
  lt.name AS leave_type,
  lb.allocated,
  lb.used,
  (lb.allocated + lb.carried_forward + lb.adjusted - lb.used) AS remaining_days
FROM leave_balances lb
JOIN employees e ON e.id = lb.user_id
JOIN leave_types lt ON lt.id = lb.leave_type_id
ORDER BY e.full_name, lt.name;
```

### 5. Verify MFA Factors (AAL1 vs AAL2)
```sql
SELECT 
  u.id,
  u.email,
  f.friendly_name,
  f.factor_type,
  f.status,
  f.created_at
FROM auth.users u
LEFT JOIN auth.mfa_factors f ON f.user_id = u.id
ORDER BY u.email;
```

### 6. Inspect Lean KPI Audit Logs
```sql
SELECT 
  id,
  action,
  actor_id,
  target_entity,
  created_at,
  payload
FROM audit_logs
WHERE action = 'compute_kpi_scores'
ORDER BY created_at DESC
LIMIT 5;
```

### 7. Inspect Retention Archive Run History
```sql
SELECT 
  id,
  organization_id,
  archive_bucket,
  file_path,
  rows_archived,
  status,
  executed_at
FROM retention_archive_runs
ORDER BY executed_at DESC;
```

---

## 14. Troubleshooting & Common Error Reference

| Issue / Error | Root Cause | Solution |
| :--- | :--- | :--- |
| **HTTP 429 Too Many Requests** | Exceeded 5 failed login attempts in 15 minutes. | Wait 15 minutes, or clear the lockout key in Upstash Redis. |
| **HTTP 403 Forbidden on `/admin`** | User role is `employee` or `manager`, or MFA step-up (`aal2`) is incomplete. | Complete TOTP verification on `/mfa-challenge` or sign in as Admin. |
| **Check constraint `chk_leave_request_half_day_single_date`** | Attempted to select `first_half` or `second_half` on a multi-day range. | Set `day_part = 'full'` when `start_date != end_date`. |
| **Check-in button disabled before shift** | Current time is prior to allowed 5-minute pre-shift window. | Wait until 5 minutes before `shift_start_time` or update shift in `/admin/users`. |
| **Invite link / OTP not arriving** | In local dev, emails are captured by Mailpit (`http://127.0.0.1:54324`). In production, verify Resend DNS verification status. | Open Mailpit locally or check Resend dashboard logs. |
| **Retention archiver returns 503** | `RETENTION_CRON_SECRET` is unset or mismatched. | Verify secret in Supabase Vault and match the `x-retention-secret` header. |

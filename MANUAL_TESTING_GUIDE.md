# RemoteHR — Comprehensive Manual Testing Guide & QA Playbook

**Document Version**: 2.0.0  
**Target Environment**: Local Development Stack (`http://localhost:3000`)  
**Backend**: Supabase Local Docker Stack (`http://127.0.0.1:54321`)  
**Studio UI**: `http://127.0.0.1:54323`  
**Mailpit UI**: `http://127.0.0.1:54324`  
**Application Branch**: `phase-2-multitenancy`  

---

## Table of Contents
1. [Test Environment & Architecture](#1-test-environment--architecture)
2. [Testing Personas & Access Matrix](#2-testing-personas--access-matrix)
3. [Pre-Flight Verification Checklist](#3-pre-flight-verification-checklist)
4. [Test Suite 1: Authentication, MFA & Session Lifecycle](#4-test-suite-1-authentication-mfa--session-lifecycle)
5. [Test Suite 2: Attendance Tracking & Geofencing](#5-test-suite-2-attendance-tracking--geofencing)
6. [Test Suite 3: Leave Management & Policy Rules](#6-test-suite-3-leave-management--policy-rules)
7. [Test Suite 4: Management Approvals & Delegation](#7-test-suite-4-management-approvals--delegation)
8. [Test Suite 5: Tasks & Performance (KPI Engine)](#8-test-suite-5-tasks--performance-kpi-engine)
9. [Test Suite 6: Multi-Tenant Data Isolation & RLS](#9-test-suite-6-multi-tenant-data-isolation--rls)
10. [Test Suite 7: System Administration & Data Retention](#10-test-suite-7-system-administration--data-retention)
11. [Test Suite 8: Shifts, Continuous Timer, Password Management & Resend Delivery](#11-test-suite-8-shifts-continuous-timer-password-management--resend-delivery)
12. [Supabase Studio SQL Verification Cheat Sheet](#12-supabase-studio-sql-verification-cheat-sheet)
13. [Troubleshooting & Common Error Reference](#13-troubleshooting--common-error-reference)

---

## 1. Test Environment & Architecture

The application is deployed locally across three integrated services:

```
┌────────────────────────────────────────────────────────────────────────┐
│ BROWSER CLIENT (http://localhost:3000)                                 │
│ Next.js 14 App Router, Tailwind CSS, Lucide, Recharts, Sonner Toaster │
└───────────────────────────┬────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌───────────────────────────┐ ┌──────────────────────────────────────────┐
│ NEXT.JS BACKEND RUNTIME   │ │ SUPABASE LOCAL STACK (Docker Containers) │
│ • Server Actions          │ │ • Kong API Gateway (:54321)              │
│ • /api/auth/login (Limiter│ │ • PostgreSQL Database (:54322)           │
│ • /api/admin/* Routes     │ │ • Supabase Studio Dashboard (:54323)     │
│ • Dynamic App Pages       │ │ • Mailpit Local Mail Server (:54324)     │
└───────────────────────────┘ └──────────────────────────────────────────┘
```

### Local URLs & Service Endpoints
| Component | Local URL / Port | Purpose |
| :--- | :--- | :--- |
| **Web UI** | `http://localhost:3000` | Frontend application interface |
| **Supabase Studio** | `http://127.0.0.1:54323` | Database inspection, SQL editor, Auth user tables |
| **Mailpit (InBucket)** | `http://127.0.0.1:54324` | Local mail inbox for Magic Links and OTPs |
| **Supabase API** | `http://127.0.0.1:54321` | Auth, PostgREST (`/rest/v1`), Storage |
| **PostgreSQL** | `127.0.0.1:54322` | Direct DB connection (`postgres:postgres`) |

---

## 2. Testing Personas & Access Matrix

The system includes pre-seeded accounts configured for both Organization 1 (Acme Corp) and Organization 2 (Beta Ltd).

### Organization 1: Acme Corp (`org-1-uuid`)
| Persona | Email | Default Password | Role | MFA Required | Primary Work Mode |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Employee** | `employee@remotehr.io` | `DemoPassword123!` | `employee` | No | Hybrid |
| **Manager** | `manager@remotehr.io` | `DemoPassword123!` | `manager` | No | Office |
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
| `/team` | Manager Team Overview | ❌ (403) | ✅ | ✅ | ✅ |
| `/requests` | Leave & Punch Approvals | ❌ (403) | ✅ | ✅ | ✅ |
| `/reports` | Analytics & Export | ❌ (403) | ❌ (403) | ✅ | ✅ |
| `/hr/leave` | Leave Policy Allocation | ❌ (403) | ❌ (403) | ✅ | ✅ |
| `/kpi` | KPI Scorecard & Governance | ✅ (View) | ✅ (Team) | ✅ (Full) | ✅ (Full) |
| `/admin/*` | System Settings & Users | ❌ (403) | ❌ (403) | ❌ (403) | ✅ (Full) |
| `/gallery` | UI Component Gallery | ✅ | ✅ | ✅ | ✅ |

---

## 3. Pre-Flight Verification Checklist

Before starting manual tests, verify that local services are operating normally:

1. **Verify Web Application**: Open [http://localhost:3000](http://localhost:3000) in your browser. It should redirect automatically to `/login`.
2. **Verify Demo Presets**: On the login page, verify the 4 "Demo Mode Presets" buttons appear at the bottom: `Employee`, `Manager`, `HR Admin`, `System Admin`.
3. **Verify Supabase Studio**: Open [http://127.0.0.1:54323](http://127.0.0.1:54323). Navigate to **Table Editor** to confirm tables exist (`attendance_records`, `leave_requests`, `organizations`, `kpi_scorecards`, etc.).
4. **Verify Mailpit**: Open [http://127.0.0.1:54324](http://127.0.0.1:54324). Confirm the Mailpit inbox loads with zero connection errors.

---

## 4. Test Suite 1: Authentication, MFA & Session Lifecycle

### TC-AUTH-01: Standard Employee Sign-In (Single Factor)
- **Goal**: Verify normal employee login without MFA gating.
- **Steps**:
  1. Navigate to `http://localhost:3000/login`.
  2. Click the **Employee** preset button (`employee@remotehr.io`).
  3. Click **Sign In**.
- **Expected Result**:
  - Toast: `"Signed in successfully!"`.
  - Browser redirects to dashboard (`/`).
  - Header displays user avatar, employee name, and role badge.
  - Sidebar shows Employee navigation items (no `/admin` or `/reports` links).

---

### TC-AUTH-02: Privileged Role Login with MFA Enforcement (Admin / HR)
- **Goal**: Verify that privileged roles are gated by AAL2 TOTP Multi-Factor Authentication.
- **Steps**:
  1. Navigate to `http://localhost:3000/login`.
  2. Click the **System Admin** preset button (`admin@remotehr.io`).
  3. Click **Sign In**.
- **Expected Result**:
  - System detects privileged role requirement.
  - Toast: `"Two-Factor Authentication required"` or `"Security Policy: Privileged accounts require Two-Factor Authentication"`.
  - Browser is immediately redirected to `/mfa-challenge` or `/mfa-setup` (depending on enrollment status).
  - Direct URL access to `/admin` or `/` before completing MFA returns `403 Access Denied` or redirects back to `/mfa-challenge`.

---

### TC-AUTH-03: MFA Setup & Challenge Verification
- **Goal**: Verify TOTP factor enrollment and verification.
- **Steps**:
  1. On `/mfa-setup`, view the generated QR code and secret key.
  2. In local development mode, open the test helper at `http://localhost:3000/api/auth/demo-totp` (or use Google Authenticator / 1Password with the secret string).
  3. Enter the 6-digit TOTP code and submit.
- **Expected Result**:
  - Verification succeeds with toast confirmation.
  - Session is promoted from `aal1` to `aal2`.
  - Browser transitions to the requested destination (`/admin` or `/`).

---

### TC-AUTH-04: Brute-Force Rate Limiting (Account & IP Lockout)
- **Goal**: Verify that 5 consecutive failed login attempts trigger a 15-minute lockout.
- **Steps**:
  1. On `/login`, enter `employee@remotehr.io` with an incorrect password (e.g. `WrongPass!`).
  2. Click **Sign In** 5 consecutive times.
- **Expected Result**:
  - Attempts 1–4 return error toast: `"Invalid email or password. Please verify your credentials and try again."`.
  - On the 5th attempt, the endpoint `/api/auth/login` returns HTTP 429.
  - UI displays an alert box: `"Too many failed attempts. Login locked for 15 minutes."`.
  - Subsequent sign-in attempts are immediately blocked without hitting the Supabase Auth backend.

---

### TC-AUTH-05: Magic Link Passwordless Sign-In
- **Goal**: Verify email magic link generation and authentication callback.
- **Steps**:
  1. On `/login`, toggle the **Magic Link** mode.
  2. Enter `employee@remotehr.io` and click **Send Magic Link**.
  3. Open Mailpit at `http://127.0.0.1:54324`.
  4. Locate the newly arrived message with subject containing your login link.
  5. Click the sign-in URL inside the email.
- **Expected Result**:
  - The URL routes to `/auth/callback?code=...`.
  - Next.js exchanges the auth code for a valid session.
  - Browser safely redirects to `/`.

---

### TC-AUTH-06: Safe Redirect Protection (Open Redirect & CRLF Rejection)
- **Goal**: Ensure attackers cannot abuse the `?redirect=` parameter.
- **Steps**:
  1. Navigate to `http://localhost:3000/login?redirect=https://evil-phishing-site.com`.
  2. Sign in as `employee@remotehr.io`.
  3. Test newline bypass: `http://localhost:3000/login?redirect=%2F%0Aevil.com`.
  4. Test tab trick: `http://localhost:3000/login?redirect=%2F%09evil.com`.
- **Expected Result**:
  - In all cases, `sanitizeRedirectPath` rejects the external URL.
  - Browser redirects safely to the root path `/` or fallback internal route.
  - No external redirects occur.

---

## 5. Test Suite 2: Attendance Tracking & Geofencing

### TC-ATT-01: Live Real-Time Check-In
- **Goal**: Verify employee clock-in with timer initiation.
- **Steps**:
  1. Log in as `employee@remotehr.io` and view the dashboard (`/`).
  2. Locate the **Hero Check-In Card** on the Bento Grid.
  3. Click the primary **Check In** button.
- **Expected Result**:
  - Browser prompts for Geolocation permission (allow it).
  - Button state flips to active clocked-in status.
  - Live stopwatch initiates counting up seconds and minutes.
  - Status pill displays **Present** in green.
  - Daily hours card updates dynamically.

---

### TC-ATT-02: Geofence Validation (Office Perimeter Check)
- **Goal**: Verify attendance compliance against organization office locations.
- **Steps**:
  1. In Supabase Studio, open `locations` table. Note the coordinates (latitude, longitude, radius: 200m).
  2. On the employee dashboard, attempt clock-in.
  3. In browser DevTools > Sensors, override Geolocation to:
     - Scenario A: Exact office coordinates (within 50 meters).
     - Scenario B: Coordinates 5 kilometers away from office.
- **Expected Result**:
  - Scenario A: Check-in succeeds with `geofence_status: 'inside'`.
  - Scenario B: Check-in records `geofence_status: 'outside'`. If organization policy strictly requires geofence compliance, an alert or warning pill flags the out-of-bounds punch.

---

### TC-ATT-03: Real-Time Check-Out & Working Duration
- **Goal**: Complete an attendance session and calculate total minutes.
- **Steps**:
  1. With an active session running, click **Check Out**.
  2. Provide optional check-out notes in the prompt modal.
  3. Confirm check-out.
- **Expected Result**:
  - Live timer stops.
  - Total elapsed minutes are computed and stored in `attendance_records.total_minutes`.
  - The record is appended to the **Recent Activity** list and **Calendar** view.

---

### TC-ATT-04: Attendance Regularization Request (Missed Punch)
- **Goal**: Submit a time correction request for manager approval.
- **Steps**:
  1. Navigate to `/attendance`.
  2. Click **Request Regularization** (or click the plus icon on any past date row).
  3. Fill in the modal:
     - Date: Select yesterday's date.
     - Requested Check In: `09:00 AM`.
     - Requested Check Out: `05:30 PM`.
     - Reason: `"Forgot to clock out due to client meeting"`.
  4. Click **Submit Request**.
- **Expected Result**:
  - Toast: `"Regularization request submitted successfully"`.
  - A pending request card appears on the employee's request list with status `pending`.

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
  3. Start Date: Pick an upcoming weekday (e.g. Wednesday).
  4. End Date: Same weekday.
  5. Day Part: `Full Day`.
  6. Reason: `"Personal errands"`.
  7. Click **Submit Request**.
- **Expected Result**:
  - Toast confirmation: `"Leave request submitted"`.
  - Estimated working days calculates to `1.0`.
  - Request appears in table with status `pending`.

---

### TC-LV-03: Apply for Half-Day Leave
- **Goal**: Verify half-day selection (First Half vs Second Half).
- **Steps**:
  1. Click **Apply for Leave**.
  2. Select Leave Type: `Sick Leave`.
  3. Set Start Date and End Date to the same date.
  4. Select Day Part: `First Half (Morning)`.
  5. Reason: `"Doctor appointment"`.
  6. Click **Submit Request**.
- **Expected Result**:
  - Estimated duration shows `0.5 Days`.
  - Request saves with `day_part: 'first_half'`.

---

### TC-LV-04: Multi-Day Range with Weekend Exclusion
- **Goal**: Verify that non-working days (Saturdays & Sundays) do not consume leave balance.
- **Steps**:
  1. Click **Apply for Leave**.
  2. Select Start Date: **Friday**.
  3. Select End Date: **Tuesday** of the following week (5 calendar days total).
  4. Click **Submit**.
- **Expected Result**:
  - System automatically calculates working days as `3.0 Days` (Friday, Monday, Tuesday), correctly skipping Saturday and Sunday.

---

### TC-LV-05: Half-Day on Multi-Day Range Negative Test
- **Goal**: Verify database check constraint `chk_leave_request_half_day_single_date`.
- **Steps**:
  1. Open browser console / network inspector on `/leave`.
  2. Attempt to submit a leave request where `startDate != endDate` (e.g., Nov 10 to Nov 12) while forcing `day_part = 'first_half'`.
- **Expected Result**:
  - UI validation blocks the submission (disables half-day option when dates differ).
  - If sent directly to API, PostgreSQL rejects the insert with check constraint violation: `chk_leave_request_half_day_single_date`.

---

## 7. Test Suite 4: Management Approvals & Delegation

### TC-APP-01: Manager Review of Leave Request
- **Goal**: Approve or reject subordinate leave requests.
- **Steps**:
  1. Sign in as `manager@remotehr.io`.
  2. Navigate to `/requests` or `/team`.
  3. Locate the pending leave request submitted by `employee@remotehr.io`.
  4. Click **Approve** (with optional note: `"Approved, enjoy your time off"`).
- **Expected Result**:
  - Status updates in real-time to `approved`.
  - Subordinate's leave balance in `leave_balances.used` increments by the approved days.
  - Notification is sent to the employee.

---

### TC-APP-02: Manager Review of Attendance Regularization
- **Goal**: Authorize a missed punch correction.
- **Steps**:
  1. On `/requests` as `manager@remotehr.io`, select the **Regularizations** tab.
  2. Locate the employee's regularization request.
  3. Click **Approve**.
- **Expected Result**:
  - Status becomes `approved`.
  - Underlying `attendance_records` row is created/updated with the approved punch times.
  - Total minutes for the work date are recalculated.

---

### TC-APP-03: Approval Delegation (Acting Manager Setup)
- **Goal**: Delegate approval authority during manager absence.
- **Steps**:
  1. On `/requests`, locate the **Delegations** section.
  2. Click **Create Delegation**.
  3. Select Delegate: Another manager or HR user.
  4. Set Start Date: Today; End Date: 7 days from now.
  5. Reason: `"Annual leave coverage"`.
  6. Submit.
- **Expected Result**:
  - Delegation row appears in `approval_delegations`.
  - The designated delegate can now view and act on pending team requests.

---

### TC-APP-04: Separation of Duties (Anti-Self-Approval)
- **Goal**: Verify managers cannot approve their own requests.
- **Steps**:
  1. As `manager@remotehr.io`, submit a personal leave request.
  2. Navigate to `/requests`.
- **Expected Result**:
  - The manager's own request does NOT show an "Approve" button for themselves.
  - If approval RPC is invoked with caller == requester, PostgreSQL returns error: `"Forbidden: Users cannot approve their own requests"`.

---

## 8. Test Suite 5: Tasks & Performance (KPI Engine)

### TC-KPI-01: Task Creation and Lifecycle
- **Goal**: Create and track work tasks that feed into the KPI engine.
- **Steps**:
  1. Log in as `employee@remotehr.io` and navigate to `/tasks`.
  2. Click **New Task**.
  3. Title: `"Prepare Quarterly Attendance Report"`.
  4. Due Date: Set to today.
  5. Priority: `High`.
  6. Click **Create**.
  7. Change status to `In Progress`, then to `Completed`.
- **Expected Result**:
  - Task status transitions smoothly.
  - `completed_at` timestamp is recorded.
  - The task contributes to the "Task Completion" and "On-Time Delivery" metrics.

---

### TC-KPI-02: View Employee KPI Scorecard (8 Metrics)
- **Goal**: Verify all 8 core performance indicators render accurately.
- **Steps**:
  1. Navigate to `/kpi`.
  2. Verify that the following 8 metrics are present on the scorecard:
     1. **Attendance Rate** (Higher is better, %)
     2. **Punctuality Score** (Higher is better, %)
     3. **Task Completion Rate** (Higher is better, %)
     4. **On-Time Delivery Rate** (Higher is better, %)
     5. **Work Quality Rating** (Higher is better, 1–5 Scale)
     6. **Overtime Compliance** (Target-aligned hours)
     7. **Leave Utilization** (Policy-aligned days taken)
     8. **Training & Skill Completion** (Completed courses/certifications)
- **Expected Result**:
  - Each metric card displays: Current Value, Target, Weight %, and Performance Band (Exceptional, Strong, Meets Expectations, Needs Improvement).

---

### TC-KPI-03: Zero-Weight KPI Handling
- **Goal**: Verify metrics with weight = 0 do not dilute the composite score.
- **Steps**:
  1. Log in as `hr@remotehr.io` (with MFA).
  2. Navigate to `/kpi` > **Governance / Configuration** tab.
  3. Set the weight of "Training Completion" to `0.0`.
  4. Save changes.
- **Expected Result**:
  - Check constraint `weight >= 0 AND weight <= 1000` accepts 0.
  - The composite weighted score divides strictly by the sum of non-zero weights (`NULLIF(SUM(weight), 0)`).
  - The overall score remains mathematically undistorted.

---

### TC-KPI-04: Periodic Score Calculation & Lean Audit Logging
- **Goal**: Execute `compute_kpi_scores` and verify clean, non-bloated audit logs.
- **Steps**:
  1. In Supabase Studio SQL Editor or via the UI **Compute Scores** button, trigger score evaluation for the current period.
  2. Open Supabase Studio > `audit_logs` table.
- **Expected Result**:
  - Scores are populated in `kpi_scores`.
  - The `audit_logs` row contains a lean payload: `{ "period_id": "...", "scores_written": N, "actor_id": "..." }`.
  - Individual score dumps are NOT duplicated into the audit log, keeping storage usage minimal.

---

## 9. Test Suite 6: Multi-Tenant Data Isolation & RLS

### TC-TEN-01: Cross-Tenant Data Invisibility
- **Goal**: Verify complete cryptographic data segregation between Organization 1 and Organization 2.
- **Steps**:
  1. In browser Window A (Normal mode), log in as Org 1 Admin (`admin@remotehr.io`).
  2. Note total employee count and attendance logs for Org 1.
  3. In browser Window B (Incognito mode), log in as Org 2 Admin (`admin@tenant2.io`).
- **Expected Result**:
  - Org 2 Admin sees only Org 2 employees and Org 2 attendance records.
  - Org 1 records are 100% invisible. Total counts, employee lists, and department names do not leak.

---

### TC-TEN-02: RPC Cross-Tenant Parameter Tampering
- **Goal**: Ensure authenticated users cannot query or mutate another organization's records by injecting UUIDs.
- **Steps**:
  1. As Org 2 Admin, open DevTools Console.
  2. Invoke an RPC with an Org 1 UUID:
     ```js
     await supabase.rpc('get_user_role', { user_id: 'org-1-employee-uuid' })
     ```
- **Expected Result**:
  - RPC returns `null` or denies execution with `Forbidden / Unauthorized`.
  - Cross-tenant lookups fail closed.

---

### TC-TEN-03: Suspended Employee Policy Denial
- **Goal**: Ensure deactivated or suspended staff are instantly cut off from data.
- **Steps**:
  1. In Supabase Studio, update an employee's status in `organization_members`:
     ```sql
     UPDATE organization_members SET status = 'suspended' WHERE user_id = 'employee-uuid';
     ```
  2. As that employee, refresh the dashboard or attempt to clock in.
- **Expected Result**:
  - RLS policies instantly block access.
  - Queries return 0 rows or redirect to `/403`.
  - Check-in button returns error toast: `"Account is suspended. Contact HR."`.

---

## 10. Test Suite 7: System Administration & Data Retention

### TC-ADM-01: User Administration & Role Modification
- **Goal**: Manage organization personnel.
- **Steps**:
  1. Log in as `admin@remotehr.io` (with MFA) and navigate to `/admin/users`.
  2. Click **Invite User**:
     - Email: `newjoiner@remotehr.io`.
     - Full Name: `Test New Joiner`.
     - Role: `Employee`.
     - Department: `Engineering`.
  3. Submit the invitation.
- **Expected Result**:
  - User is added to the organization roster.
  - In Mailpit, an invitation email is captured.

---

### TC-ADM-02: Office Location & Geofence Perimeter Management
- **Goal**: Create and adjust office locations for geofenced clock-in.
- **Steps**:
  1. Navigate to `/admin/locations`.
  2. Click **Add Location**:
     - Name: `Chennai Headquarters`.
     - Latitude: `13.0827`.
     - Longitude: `80.2707`.
     - Radius: `250` meters.
  3. Save the location.
- **Expected Result**:
  - New location appears on the admin map / list.
  - Mobile/desktop check-in evaluates distances against this new boundary.

---

### TC-ADM-03: Retention Archiving Run (Dedicated Secret)
- **Goal**: Verify the automated retention archiver endpoint.
- **Steps**:
  1. As Admin, navigate to `/admin/settings` > **Data Retention**.
  2. View the table health breakdown (Row counts, DB storage size, Archive size).
  3. Click **Run Archival Preview (Dry Run)**.
  4. Trigger a live execution using PowerShell / curl:
     ```bash
     curl -X POST http://127.0.0.1:54321/functions/v1/retention-archiver \
       -H "Content-Type: application/json" \
       -H "x-retention-secret: super-secret-retention-token-12345"
     ```
- **Expected Result**:
  - GET requests return `405 Method Not Allowed`.
  - Requests with missing or wrong secret return `503 Service Unavailable` or `401 Unauthorized`.
  - Valid POST creates zipped JSON/CSV archives in the `attendance-archives` storage bucket and records execution history in `retention_archive_runs`.

---

## 11. Test Suite 8: Shifts, Continuous Timer, Password Management & Resend Delivery

### TC-NEW-01: Login Loading Overlay (`isAuthenticating`)
- **Goal**: Verify immediate visual feedback and control lockout during authentication requests.
- **Steps**:
  1. Navigate to `http://localhost:3000/login`.
  2. Click any preset button (e.g., `Employee`) or enter valid credentials and click **Sign In**.
- **Expected Result**:
  - Immediately, the login card is covered with a semi-transparent, backdrop-blurred overlay.
  - An animated spinner displays alongside the text `"Authenticating & Syncing Session..."`.
  - All form inputs, preset buttons, and submit actions are disabled, preventing double submission.
  - The overlay smoothly dismisses upon redirection to dashboard or error display.

---

### TC-NEW-02: Persistent Live Attendance Timer Across Navigation
- **Goal**: Verify the active attendance timer persists continuously across route changes without resetting or flashing 00:00:00.
- **Steps**:
  1. Sign in as `employee@remotehr.io`.
  2. On `/`, click **Check In**. Observe the live stopwatch ticker start running (e.g. `00:00:15`).
  3. Navigate in the sidebar to `/leave`.
  4. Wait 10 seconds.
  5. Navigate back to `/` (Dashboard).
- **Expected Result**:
  - The live attendance counter does NOT reset to `00:00:00` or re-initialize from scratch.
  - The elapsed seconds seamlessly reflect the full time elapsed since check-in (`Math.floor((Date.now() - checkInTime) / 1000)`), e.g. displaying `00:00:25+`.
  - Global `AttendanceProvider` and React Query cache keep state intact.

---

### TC-NEW-03: 5-Minute Pre-Check-In Lock & Badge
- **Goal**: Verify employees cannot clock in prematurely before the allowed 5-minute pre-shift window.
- **Steps**:
  1. Log in as System Admin (`admin@remotehr.io`).
  2. Navigate to `/admin/users`. Locate `employee@remotehr.io` and click **Manage Shift**.
  3. Set their Shift Start Time to 30 minutes in the future (e.g. if current local time is 14:00, set shift to `14:30:00`).
  4. Save the shift. Sign out and log in as `employee@remotehr.io`.
  5. Inspect the Hero Check-In Card on `/`.
- **Expected Result**:
  - The **Check In** button is disabled with an opacity lock.
  - A pill badge is clearly visible: `"Check-in opens at [HH:MM AM/PM]"` (exactly 5 minutes before shift start, e.g. `14:25`).
  - Attempting to submit via network/form before 5 minutes prior is blocked.

---

### TC-NEW-04: Shift Start In-App Notification Toast
- **Goal**: Verify an automated reminder toast prompts employees who are online at their shift start time.
- **Steps**:
  1. With an assigned shift, keep the dashboard (`/`) open as the clock ticks past the exact shift start time without having checked in.
- **Expected Result**:
  - A toast notification automatically triggers in the browser:
    `"Your shift starts now! Please check in."`
  - The badge updates to show check-in is now open.

---

### TC-NEW-05: Automatic Late Flagging (`is_late = TRUE`)
- **Goal**: Verify check-in records are automatically flagged late if punch occurs after `shift_start_time + 15 mins`.
- **Steps**:
  1. Configure an employee's shift start time to `09:00:00`.
  2. Clock in at `09:16:00` or later (or run a test punch with timestamp > 09:15:00 UTC).
  3. Check the database `attendance_days` and `attendance_records` records:
     ```sql
     SELECT user_id, work_date, check_in, is_late 
     FROM attendance_days 
     WHERE user_id = '00000000-0000-0000-0000-000000000001' 
     ORDER BY work_date DESC LIMIT 1;
     ```
- **Expected Result**:
  - `is_late` is set to `TRUE`.
  - The attendance history table shows a yellow/red `"Late"` badge next to the session.

---

### TC-NEW-06: Employee Credentials Provisioning & Resend Delivery with Admin Modal
- **Goal**: Verify new employee invite provisions credentials, attempts Resend email delivery, and provides a 1-click copy modal.
- **Steps**:
  1. As System Admin, navigate to `/admin/users`.
  2. Click **Add Employee / Invite User**.
  3. Fill in:
     - Full Name: `Resend Test Employee`
     - Work Email: `test-resend@remotehr.io`
     - Role: `Employee`
     - Shift Start Time: `09:00`
     - Shift End Time: `17:00`
  4. Submit the form.
- **Expected Result**:
  - System generates a secure 16-character temporary password.
  - Dispatches welcome email with credentials via Resend API (`lib/email/resend.ts`). (In local dev without `RESEND_API_KEY`, logs simulated delivery safely).
  - An **"Employee Credentials Created"** modal pops up immediately on the screen displaying:
    - User's Work Email
    - Temporary Password (in a mono font badge)
    - Shift Schedule (`09:00 - 17:00`)
    - A **"Copy Credentials"** button that copies full login details to the clipboard.
  - The employee is instantly added to the directory table with the assigned shift.

---

### TC-NEW-07: Temporary Password Update in Dashboard Settings
- **Goal**: Verify employee or admin can securely change their temporary password from their account settings.
- **Steps**:
  1. Navigate to `/settings` (or `/profile`).
  2. Scroll to the **"Security & Change Password"** section.
  3. Enter New Password: `Short` (less than 12 characters).
  4. Observe validation error: `"Password must be at least 12 characters long."`
  5. Enter New Password: `SecureNewPassword2026!` and Confirm Password: `DifferentPassword!`.
  6. Observe validation error: `"Passwords do not match."`
  7. Enter matching `SecureNewPassword2026!` in both fields and click **Update Password**.
- **Expected Result**:
  - Button shows loading spinner.
  - Toast: `"Password updated successfully! You can now use your new password."`.
  - Inputs are cleared.
  - Subsequent sign-in with the new password succeeds.

---

### TC-NEW-08: Night Shift & Midnight Crossover (17:00 to 01:00) with Auto-Checkout Skip
- **Goal**: Verify shifts that cross midnight are supported and exempted from 23:59 auto-checkout.
- **Steps**:
  1. Set an employee's shift in `/admin/users` to `17:00:00` to `01:00:00` (Night Shift).
  2. Observe the Directory table displays a purple moon badge (`🌙 17:00 - 01:00 (Night)`).
  3. Employee checks in at `18:00:00`.
  4. At `23:59:00`, the scheduled pg_cron auto-checkout runs (`SELECT cron_auto_checkout();`).
- **Expected Result**:
  - The system recognizes `shift_end_time < shift_start_time` (Night Shift).
  - The active session is **NOT** prematurely checked out at 23:59.
  - The session remains open until the post-midnight shift end (`01:00 + grace buffer`).
  - Total duration accurately calculates continuous elapsed hours across the midnight boundary via UTC `TIMESTAMPTZ`.

---

## 12. Supabase Studio SQL Verification Cheat Sheet

Open **Supabase Studio** at [http://127.0.0.1:54323](http://127.0.0.1:54323) > **SQL Editor** to run these direct verification queries:

### 1. Check Member Shifts and Assigned Hours
```sql
SELECT 
  p.full_name,
  u.email,
  om.role,
  om.shift_start_time,
  om.shift_end_time,
  CASE WHEN om.shift_end_time < om.shift_start_time THEN 'Night Shift' ELSE 'Day Shift' END AS shift_type
FROM organization_members om
JOIN profiles p ON p.id = om.user_id
JOIN auth.users u ON u.id = om.user_id
ORDER BY om.shift_start_time;
```

### 1. Check Today's Live Attendance Sessions
```sql
SELECT 
  ar.work_date,
  p.full_name,
  om.role,
  ar.check_in,
  ar.check_out,
  ar.total_minutes,
  ar.status,
  ar.geofence_status
FROM attendance_records ar
JOIN profiles p ON p.id = ar.user_id
JOIN organization_members om ON om.user_id = ar.user_id
WHERE ar.work_date = CURRENT_DATE
ORDER BY ar.check_in DESC;
```

### 2. Verify Leave Balances & Usages
```sql
SELECT 
  p.full_name,
  lt.name AS leave_type,
  lb.allocated,
  lb.used,
  (lb.allocated + lb.carried_forward + lb.adjusted - lb.used) AS remaining_days
FROM leave_balances lb
JOIN profiles p ON p.id = lb.user_id
JOIN leave_types lt ON lt.id = lb.leave_type_id
ORDER BY p.full_name, lt.name;
```

### 3. Verify MFA Factors (AAL1 vs AAL2)
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

### 4. Inspect Lean KPI Audit Logs
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

### 5. Inspect Retention Archive Run History
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

## 13. Troubleshooting & Common Error Reference

| Issue / Error | Root Cause | Solution |
| :--- | :--- | :--- |
| **HTTP 429 Too Many Requests** | Exceeded 5 failed login attempts in 15 minutes. | Wait 15 minutes, or clear the lockout in Redis / database rate-limiting table. |
| **HTTP 403 Forbidden on `/admin`** | User role is `employee` or `manager`, or MFA step-up (`aal2`) is incomplete. | Complete TOTP verification on `/mfa-challenge` or sign in as Admin. |
| **Check constraint `chk_leave_request_half_day_single_date`** | Attempted to select `first_half` or `second_half` on a multi-day range. | Set `day_part = 'full'` when `start_date != end_date`. |
| **Check-in button disabled / Geofence error** | Browser denied location access or coordinates fall outside office radius. | Allow location permission in browser URL bar, or adjust location coordinates in `/admin/locations`. |
| **Magic Link not arriving** | Mailpit service not viewed or email blocked. | Open `http://127.0.0.1:54324` to read captured emails locally. |
| **Retention archiver returns 503** | `RETENTION_CRON_SECRET` is unset or mismatched. | Verify secret in Supabase Vault and match the `x-retention-secret` header. |


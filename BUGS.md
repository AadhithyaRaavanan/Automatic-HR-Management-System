# RemoteHR — Known Bugs & Code Discrepancies

This document catalogs code discrepancies, security bug fixes, and specification reconciliation across the RemoteHR codebase (`phase-2-multitenancy`).

---

## 1. Security Bugs & Vulnerability Fixes

### BUG-1: Cleartext Temporary Password Leakage in Console Output & Missing Production Fail-Closed in Resend Simulation
- **Severity**: High (CWE-532: Insertion of Sensitive Information into Log File)
- **Component**: `lib/email/resend.ts`
- **Discovered In**: Test output review (`npm run test:db` printed `[Resend Simulated Credentials] Password: TempTestPass123!`).
- **Root Cause**: When `RESEND_API_KEY` was missing from the environment, `sendWelcomeCredentialsEmail()` fell back to a simulation block that printed both the recipient email and cleartext temporary password via `console.log`. Furthermore, this fallback executed even in production mode without returning an error.
- **Security Impact**: Temporary credentials could leak to standard output, terminal captures, container logging streams, and centralized log sinks.
- **Fix Implemented**:
  1. Removed `console.log` of passwords in `lib/email/resend.ts`: only recipient and email subject are logged in non-production environments.
  2. Enforced fail-closed behavior in production: if `process.env.NODE_ENV === 'production'` and no `RESEND_API_KEY` is configured, `sendWelcomeCredentialsEmail()` returns `{ success: false, error: 'Email delivery service unavailable: RESEND_API_KEY is not configured in production environment.' }`.
  3. Added regression test `[F8.1.3]` in `tests/database/f8-admin.test.ts` spying on `console.log`, `console.info`, `console.warn`, `console.error`, and checking `public.audit_logs` to mathematically prove the password is never emitted into any log stream or database audit column.

### BUG-2: Temporary Password Expiration & Must-Change-Password Flag Enforcement
- **Severity**: Medium (CWE-262: Not Using Expiration Dates on Passwords)
- **Component**: `lib/admin/invite-employee.ts`, `app/api/auth/login/route.ts`, `lib/supabase/middleware.ts`, `app/settings/page.tsx`
- **Root Cause**: Provisioned temporary passwords previously lacked a forced change redirect at first login and had no expiration threshold if left unused.
- **Fix Implemented**:
  1. Added `must_change_password: true`, `temp_password_created_at`, and `temp_password_expires_at` (24-hour expiration) to user metadata during admin provisioning (`lib/admin/invite-employee.ts`).
  2. In `app/api/auth/login/route.ts`, if an unused temporary password has exceeded 24 hours, the login attempt is aborted with HTTP 401 (`Temporary password has expired (24-hour limit)`).
  3. In `lib/supabase/middleware.ts`, users with `must_change_password: true` are restricted from application routes and redirected to `/settings?must_change_password=true` until a new permanent password (minimum 12 characters) is saved.
  4. In `app/settings/page.tsx`, updating the password with `supabase.auth.updateUser({ password, data: { must_change_password: false } })` clears the restriction.

---

## 2. Specification Discrepancies vs. Implementation

### F7.1.1: FEATURES.md 8 KPI Metrics vs. Authoritative `compute_kpi_scores` SQL
- **Specification Claim**: `FEATURES.md` §7.1 lists 8 conceptual metrics:
  1. *Attendance Rate*
  2. *Punctuality Rate*
  3. *Task Completion Rate*
  4. *On-Time Task Delivery*
  5. *Billable / Logged Hours*
  6. *Overtime Volume*
  7. *Leave Policy Adherence*
  8. *Manager Qualitative Review*
- **Database Reality**: The authoritative schema definition in `kpi_definitions` (Migration `20261108000015_kpi_system.sql`) and `public.compute_kpi_scores(p_period_id UUID)` compute 8 automated source metrics:
  1. `attendance_on_time_rate`: Ratio of on-time check-ins to scheduled workdays.
  2. `hours_vs_target`: Total actual hours logged divided by expected target hours.
  3. `absence_days`: Count of unexcused absence days during the evaluation window.
  4. `leave_days_taken`: Approved leave days taken during the period.
  5. `tasks_completed`: Total count of tasks transitioned to `'done'`.
  6. `tasks_on_time_rate`: Proportion of completed tasks where `completed_at <= due_date`.
  7. `tasks_overdue`: Count of open tasks past due date.
  8. `avg_task_cycle_days`: Average elapsed days from task creation to completion.
  *Manager Qualitative Review* is captured in `kpi_reviews` (`manager_rating`, 1.00 to 5.00) and factored separately during period closure.

### Additional FEATURES.md Discrepancies
1. **Section 3.3 Punch Channels**:
   - `FEATURES.md` lists Geofencing, Office IP Whitelist, Rotating QR Codes, and Kiosk Tablet mode as active punch channels.
   - **Code Reality**: These are not implemented in the frontend time-clock or backend API; only the web portal direct punch (`source = 'web'`) is active.
   - **Tracking**: Marked `NOT IMPLEMENTED` (`test.todo`) in `docs/TEST_TRACEABILITY.md` and `tests/database/f3-attendance.test.ts`.

2. **Section 6.1.1 Task Status Enum Value**:
   - `FEATURES.md` states tasks use `'completed'`.
   - **Code Reality**: Postgres check constraint enforces `status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')`. The correct terminal state is `'done'`.

3. **Section 9.2 Retention Table & Bucket Names**:
   - `FEATURES.md` references bucket `attendance-archives` and history table `retention_archive_runs`.
   - **Code Reality**: Migrations `20261108000013` and `20261108000016` establish `retention-archives` as the private Storage bucket and `public.retention_archives` as the manifest table.

4. **Section 3.4 Table Naming (`attendance_records`)**:
   - `FEATURES.md` references `attendance_records`.
   - **Code Reality**: The system models attendance through `public.attendance_days` and `public.attendance_sessions`.

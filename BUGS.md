# RemoteHR — Known Bugs & Code Discrepancies

This document catalogs non-blocking code discrepancies, historical defects identified and resolved during automated test authoring, and edge-case behaviors across the RemoteHR codebase (`phase-2-multitenancy`).

## 1. Resolved Inconsistencies & Schema Verifications

1. **Task Status Enum Value (`F6.1.1`)**
   - **Specification Claim**: `FEATURES.md` references `completed` as the terminal completed state for tasks.
   - **Database Reality**: Postgres schema definition enforces `status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')`. The valid completed status is `done`.
   - **Resolution**: Test assertions in `tests/database/f6-tasks.test.ts` verify `'done'` as authoritative and record the naming mismatch.

2. **Retention Table & Bucket Naming (`F9.2.2`, `F9.2.3`)**
   - **Specification Claim**: `FEATURES.md` specifies bucket `attendance-archives` and history table `retention_archive_runs`.
   - **Database Reality**: Migrations `20261108000013` and `20261108000016` establish `retention-archives` as the private Storage bucket and `public.retention_archives` as the manifest table.
   - **Resolution**: Test suite `tests/database/f9-retention.test.ts` verifies `retention-archives` and `retention_archives`, asserting that legacy names do not exist.

3. **Audit Log Direct Client Insert Prohibition (`F8.2.2`, `F8.2.3`)**
   - **Behavior**: Direct `INSERT` into `public.audit_logs` by `authenticated` clients is strictly forbidden (`42501`) under RLS policy `audit_logs_select_policy`.
   - **Resolution**: Administrative actions (such as user force signout and MFA reset) execute server-side using `service_role` (via `supabaseAdmin`), and admins query audit entries via `SELECT`.

4. **Closed KPI Period Immutability (`F7.2.3`)**
   - **Behavior**: Database trigger `trg_enforce_kpi_closed_immutability` strictly prohibits updating or deleting closed KPI periods and their associated scorecard records.
   - **Resolution**: Verified by automated database tests asserting that modifying closed periods throws error code `42501`.

## 2. Unimplemented Feature Claims (Marked `test.todo`)

- **Section 3.3 Punch Channels**:
  - `[F3.3.1]` Geofence-Restricted Mobile Punches: Not implemented in current frontend/backend.
  - `[F3.3.2]` Office-IP Whitelisted Terminal Punches: Not implemented.
  - `[F3.3.3]` Dynamic Rotating QR Code Scanner: Not implemented.
  - `[F3.3.4]` Shared Tablet Kiosk Mode with PIN: Not implemented.
  - *All 4 items are explicitly marked `test.todo` in `tests/database/f3-attendance.test.ts` and tracked in `docs/TEST_TRACEABILITY.md`.*

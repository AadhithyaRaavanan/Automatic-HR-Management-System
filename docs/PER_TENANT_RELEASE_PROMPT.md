# Antigravity implementation prompt

Prepare Pulse HRMS for independent organizations sharing one deployment. Start from the current working tree. Preserve concurrent edits and existing employee records. Implement fixes in small independently verifiable changes. Inspect each finding against current code before editing. Use a disposable database and synthetic identities for all verification.

## 1. Establish a reproducible release candidate

Record the baseline commit and working diff. Reproduce the KPI task projection TypeScript build failure and fix the data contract without suppressing type checking. Run the production build from a clean checkout. Replay migrations on a fresh instance and on a disposable copy of the previous schema with representative historical data. Resolve the user_roles table/view incompatibility and the legacy KPI review period/rating schema. Check preserved IDs, values, relationships, constraints and row-level policies. Verify backup restoration before proposing production migrations.

## 2. Enforce organization boundaries

Use one server-side authorization context for sensitive routes and jobs. Resolve the signed-in user, active membership, selected organization, role, team scope and required MFA assurance from trusted sources. Authorize the target object before reading, signing a file link or mutating it. Require explicit organization predicates when using privileged database clients. Remove authorization fallbacks to editable user metadata, arbitrary first memberships and placeholder organization IDs. Implement an explicit organization selection policy for users with multiple memberships. Scope query caches, reports, notification recipients, attachments, exports and queued jobs accordingly.

Prioritize HR onboarding candidate lists and documents, employee-directory fallback queries, live presence, leave and correction review, KPI employee access and settings history, holiday announcements, notifications and scheduled leave accrual. Minimize sensitive fields in list responses. Keep government IDs and bank details in separately authorized detail views. Test employee, manager, HR and admin access for same-organization, other-organization, inactive and multi-membership cases.

## 3. Make business operations reliable

Make leave approval, balance movement and audit recording one transaction with a pending-state precondition and idempotency. Use approved correction timestamps and the attendance engine to recalculate sessions and totals. Enforce delegation scope, approval separation, locked periods and policy timezone. Run accrual per organization and policy with unique ledger entries and bounded batches. Require scheduler authentication even when configuration is missing. Dispatch notifications after commit with retry and deduplication.

Make profile and onboarding writes return actual persistence outcomes, including field clearing. Support retry after partial task/project creation without duplicating completed work. Make failures distinguishable from a genuine empty list. Reconcile historical task assignment/completion, half-day leave, active sessions, holidays and KPI policy versions across Dashboard, Attendance, Tasks, Leave, Requests, KPI and Reports. Export the exact authorized data matching the selected filters and period; paginate large results.

## 4. Verify identity and recovery end to end

Verify password login, onboarding redirects, stale sessions, magic links, code-only password recovery, password changes and lost-device recovery. Bind each verification to its intended purpose. Require appropriate recent proof for sensitive account changes. Use expiring, centrally stored, atomically consumed recovery challenges and shared attempt limits. Remove public or built-in signing-key fallbacks. Require successful factor changes and durable audit records before reporting recovery success. Exercise both configured mail transports with a disposable inbox. Check delivery failures, expired and used links, role changes and a fresh browser session after password replacement.

## 5. Finish the employee and admin journeys

Make current organization and reporting period visible. Preserve filters and selection across drill-down, back and export. Make correction links open the intended date. Distinguish saved, pending, partially completed and failed changes. Provide accessible small-screen recovery, keyboard navigation, focus restoration and understandable empty/error states. Keep settings clearly divided between personal preferences and organization-wide policies.

## Acceptance evidence

Create two synthetic organizations with distinct policies, calendars and departments; give each an employee, manager, HR and admin. Include a delegate, a deactivated user, one multi-membership user and an employee working a partial shift. Run the actual handlers, database routines and browser flows, then compare persisted results with UI, notifications, exports and audit records. Test duplicate submissions, concurrent approvals, partial email delivery, two application instances, historical periods and datasets over 300 rows. Include sign-out or organization switch on a shared browser. Run unit, database, browser, clean-build and release checks. Record exact results, remaining failures, migration/rollback steps and what still needs a staging provider. Mark a workflow verified only when its acceptance evidence exists.

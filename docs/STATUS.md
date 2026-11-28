# Pulse Release Handoff Status

Last updated: 2026-11-28 (Pulse Product Review Items 1–10 implemented & verified locally from baseline `732bf1c`)

## Summary of Fixes (Baseline `732bf1c` → Current Revision)

1. **Reproducible installs and upgrades**:
   - Renumbered duplicate `20261120000002_kpi_improvements_phase5.sql` → `supabase/migrations/20261120000004_kpi_improvements_phase5.sql`; updated `supabase/seed.sql` to `ON CONFLICT (organization_id, user_id) DO UPDATE`.
   - Added `supabase/migrations/20261128000002_reconcile_migrations_and_upgrades.sql` to reconcile schema versions and apply deterministic `employee_onboarding_audit` attribution and `trg_derive_audit_log_org_id()` updates on both fresh installs and existing databases.
2. **Demo behavior & test origins out of production**:
   - Switched `isDemoModeEnabled()` (`src/lib/config/demo.ts`) and `src/lib/env.ts` to strictly opt-in (`NEXT_PUBLIC_DEMO_MODE === "true"`), gated `/api/demo/state` (`404` when disabled) and `demo-store.ts` writes, and replaced hardcoded production hosts in `playwright.config.ts`, `tests/helpers/auth.ts`, and E2E specs with allowlisted local origins (`127.0.0.1` / `localhost`).
3. **Employment dates in Attendance, Reports, and KPI**:
   - Preserved explicit `"UTC"` employee timezones in `src/lib/date/timezone.ts`, checked `employees.joined_on` in `recalculate_day()` / `cron_nightly_finalize()`, intersected KPI evaluation windows with `joined_on` + empty elapsed-day messaging (`src/features/kpi/compute.ts`, KPI UI), filtered pre-hire absent anomalies from Reports denominators/exports (`src/app/reports/page.tsx`, `src/app/api/attendance/export/route.ts`), and added `attendance_repair_proposals` with `scan_pre_hire_absent_records()` / `review_pre_hire_attendance_repair()` for locked payroll periods (`supabase/migrations/20261128000003_employment_date_attendance_repairs.sql`).
4. **Onboarding organization routing & audit durability**:
   - Scoped `onboarding_profiles` & `onboarding_documents` by `organization_id` (`supabase/migrations/20261128000004_onboarding_org_scoping_and_durability.sql`, composite `(organization_id, user_id)` key), added `getAuthorizedOnboardingEmailRecipients(organizationId)`, removed deployment-wide fallback mailboxes in `sendOnboardingSubmittedEmail`, made `/api/onboarding/complete` audit writes durable/rollback-safe, and updated `schema-meta.test.ts` exemptions strictly for global user-keyed tables (`notification_preferences`, `profiles`).
5. **Admin Task Types**:
   - Enforced `verifyAdminRouteCaller(request, ["admin", "hr"])` on `/api/tasks/types?all=true`, verified `department_id` belongs to caller's organization on create/update, and refactored `src/app/admin/task-types/page.tsx` to use `<AppShell>` / `useAppSession()` cleanly.
6. **Notifications and holidays**:
   - Aligned `notifications_type_check` with all real notification event types (`holiday_scheduled`, review outcomes, security, reminders) and added composite keyset indexes (`supabase/migrations/20261128000005_align_notifications_type_and_indexes.sql`).
   - Replaced dropped-item timestamp cursor with composite `(created_at, id)` keyset pagination, removed GET side-effect `"Example Notification"` deletion and body-text filtering, scoped list/unread-count/mark-read/mark-all and client query keys/Realtime listeners by active `organization_id`, added infinite history loading beyond 50 on `/notifications`, and surfaced accurate delivery counts/errors in `notify.ts` & `/api/holidays/notify`.
7. **Reports and payroll close**:
   - Surfaced chunk/query errors with Retry instead of empty-state success, invalidated previous month checklists on period switch with stale-request sequence guards, gated `Lock Month` on fresh `checklist.ready_to_lock` with explicit pending-item explanations, added deterministic table pagination, clearly labeled CSV (`.csv`) and Excel (`.xlsx`) downloads, and paginated `/api/attendance/export` beyond PostgREST's 1,000-row cap.
8. **Navigation, Tasks board, Hierarchy, and Profile**:
   - Expanded nonempty Tasks board columns on initial visit (`src/features/tasks/board-columns.ts`, `tasks-workspace.tsx`) while persisting user toggles.
   - Replaced hardcoded `"ZEN XEA"` / `"Zenxea Headquarters"` in EMS hierarchy & navigation (`ems/organization`, `ems/departments`, `ems-navigation-header`) with the selected organization name.
   - Rendered missing Profile education/experience as `"Unknown"`, gave exempt admins clear `"Admin Account · Onboarding Exempt"` status and review actions, fixed loaded session role precedence in `CurvedSidebar` / `BottomTabBar`, and explained role/feature-gated destinations (`FeatureOrRoleGate`).
9. **Sign-in, MFA, and recovery**:
   - Allowed `/login`, `/forgot-password`, `/mfa-setup`, `/mfa-challenge`, `/auth/confirm`, `/onboarding`, and `/select-organization` below 1024px in `DesktopOnlyGatekeeper` with responsive narrow padding.
   - Added email-link-specific copy on magic-link sign-in, aligned configured 6-digit recovery codes across UI and `/api/auth/verify-otp`, preserved code-only recovery emails, and standardized loopback origin handling (`getSiteUrl(request)` + `supabase/config.toml` redirect allowlist for `127.0.0.1` and `localhost`).

## Verified Local Checks (Latest Run)

- **TypeScript (`npx tsc --noEmit --incremental false`)**: Passed (`0` errors).
- **Full Unit Suite (`npx vitest run tests/unit`)**: Passed (`52` files, `295` tests).
- **Production Build (`npm run build` with `NEXT_PUBLIC_DEMO_MODE=false` / disabled)**: Clean `.next` build (`54` static/dynamic pages, exit code `0`).
- **Fresh Install & Upgrade Replay (`npx supabase db reset --local`, `verify-item1.mjs`, `verify-item3.mjs`)**: Passed — fresh reset applied all migrations through `20261128000005` + `seed.sql`; legacy upgrade replay preserved historical records and applied all target schema/trigger effects; pre-hire attendance repair scan & review passed.
- **Database Schema Contract (`tests/database/schema-meta.test.ts`)**: Passed (`10/10`). Also passed cleanly on local DB: `cross-tenant-isolation.test.ts` (`32/32`) and `cron-timezone-isolation.test.ts` (`4/4`).
- **Two-Organization & Production E2E (`verify-item10-journeys.mjs` & `verify-two-org-e2e.mjs`)**: Both passed end to end against `next start` with demo routes disabled (`404` on `/api/demo/state` and `/gallery`), narrow-width auth screens (`420x800`), Task Types, dynamic Org Hierarchy, Exempt Profile/`Unknown`, EMS Employee search→detail→Back, expanded Tasks board, Notifications/holiday publish, KPI `?date=` correction link, multi-org switcher, and cross-instance Mailpit MFA recovery.
- **Documentation & Secrets (`npm run verify:docs`, `npm run scan:secrets`)**: Passed cleanly.

## Remaining Local / Legacy Classification

- `tests/database/leave-rpcs.test.ts` ran `26/28`; 2 cases fail against the refreshed late-November seed fixtures because `2026-11-23` is already locked/punched in `seed.sql` (date-coupled legacy fixture expectation, not an approval regression — atomic two-org concurrent leave/correction checks passed in `verify-two-org-e2e.mjs`).
- `tests/database/admin-routes-integration.test.ts` requires `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` in shell env so its localhost safety guard does not match `.env.local`'s staging API URL.
- Legacy policy/grant/RLS snapshot DB tests (`f8-admin`, `f9-retention`, `f11-design`, `grants-snapshot`, `policy-inventory`, `rpc-reconciliation`, etc.) were not re-run in full after the late-November migrations.

## Staging-Only Checks Required Before Cutover

- Apply migrations `20261128000001` through `20261128000005` on staging and inspect/run `scan_pre_hire_absent_records(org_id, true)` for any pre-hire locked payroll absence repair proposals.
- Confirm build/deployment env omits `NEXT_PUBLIC_DEMO_MODE` (or keeps `"false"`), sets staging Supabase URL/keys, `CRON_SECRET`, `MFA_RECOVERY_HMAC_SECRET`, Upstash Redis rate-limit store, and real SMTP/Resend credentials.
- Exercise in staging with a real inbox: fresh, expired, and reused magic links; separate password-reset 6-digit OTP verification and subsequent password login; email delivery/bounce handling; hosted Supabase MFA (TOTP setup, challenge, and lost-device reset); and cron schedules (`/api/cron/notifications`, `/api/cron/leave-accrual`).

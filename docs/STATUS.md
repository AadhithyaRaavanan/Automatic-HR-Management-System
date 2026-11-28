# Pulse Release Handoff Status

Last updated: 2026-11-28 (post-`7cf59f0` hardening + verification)

## Summary of Latest Changes (Post-`7cf59f0`)

- **Onboarding workspace selection (`resolveOnboardingCaller`)**:
  - Added `resolveOnboardingCaller` in `src/features/auth/tenant-context.ts`, unifying `GET`/`PATCH /api/onboarding/profile`, `POST /api/onboarding/draft`, `POST /api/onboarding/upload`, and `POST /api/onboarding/complete`.
  - Reads non-suspended `organization_members` (`active` or `invited`), validates `x-organization-id` / `pulse_org_id` cookie UUIDs, returns `409 ORG_SELECTION_REQUIRED` when a candidate belongs to multiple organizations without an explicit selection, and rejects non-member or suspended organizations with `403`.
  - Updated `src/app/api/auth/organizations/route.ts` (`GET`/`POST`) to include `invited` memberships alongside `active`, `src/features/onboarding/access.ts` (`getOnboardingGate`) to require an explicit `organizationId` or single-org membership (removing arbitrary `.limit(1)` role lookup), and `src/app/onboarding/page.tsx` to prompt organization selection on `409 ORG_SELECTION_REQUIRED` and allow switching via header selector when multiple organizations exist.
- **Deterministic historical audit ownership**:
  - Updated `supabase/migrations/20261128000001_atomic_reviews_and_auth_challenges.sql` (Section 9) so legacy `NULL` rows in `employee_onboarding_audit` are backfilled deterministically only when `performed_by`, `employees`, or single-org `organization_members` uniquely resolves to one organization (`HAVING COUNT(DISTINCT organization_id) = 1`), leaving ambiguous historical multi-org rows `NULL` with self-only read access (`employee_id = auth.uid()`).
  - Updated `trg_derive_audit_log_org_id()` (Section 12) to remove the placeholder default-org UUID fallback and raise SQLSTATE `23502` when `organization_id` cannot be uniquely derived.

## Verified Checks (Latest Run)

- **Typecheck (`npx tsc --noEmit --incremental false`)**: Passed (`0` errors).
- **Unit suite (`npx vitest run tests/unit`)**: `46 passed (46)` files, `275 passed (275)` tests (includes `tests/unit/invite-and-onboarding-audit.test.ts` covering `409` ambiguous org, `403` forged org, and `200` selected-org audit stamping).
- **Production build (`npm run build`)**: Clean `.next` build succeeded (`54/54` static pages generated, exit code `0`).
- **Fresh & upgrade migration replays (`verify-migrations.mjs`)**: `ALL UPGRADE + FRESH REPLAYS PASSED AND CLEANED UP!` (against disposable local Postgres schemas on `127.0.0.1:54322`).
- **Two-organization & multi-instance browser/API verification (`verify-two-org-e2e.mjs`)**: `ALL TWO-ORGANIZATION & MULTI-INSTANCE ACCEPTANCE CHECKS PASSED!`, including `/api/onboarding/profile` `409` on ambiguous multi-org without selection and `200` with `x-organization-id`, overlapping-name two-org policies, attendance/leave/KPI/export reconciliation, Playwright multi-org switcher, and cross-instance Mailpit MFA recovery.
- **Database schema/contract check (`tests/database/schema-meta.test.ts`)**: `9 passed | 1 failed (10)` — `trg_derive_audit_log_org_id()` and `SECURITY DEFINER` grant checks passed; fails on global `user_id`-keyed table `notification_preferences` (plus `onboarding_documents`, `onboarding_profiles`, `profiles`) missing `organization_id` / exemption in `ORG_ID_EXEMPTIONS`.

## Remaining Release Blockers (Local / Codebase)

- **Pre-existing local database test suite failures**: `tests/database/schema-meta.test.ts` (`9/10`, global user-keyed tables vs `ORG_ID_EXEMPTIONS`), `tests/database/admin-routes-integration.test.ts` (legacy `kpi/export` expectation), `tests/database/f8-admin.test.ts` (`[F8.2.5]` leftover fixture rows in `ORG_1_ID`), and legacy policy/grant/RLS inventory suites (`f11-design`, `f9-retention`, `policy-inventory`, `grants-snapshot`, `rpc-reconciliation`, `uuid-tenant-isolation`, `rls-database-matrix`, `section3-tasks`, `f1.4-provisioning-without-passwords`, `intra-tenant-authorization`, `section2-retention`) were not part of a clean 100% green `tests/database` pass.
- **Full `tests/database` re-run after Section 12 migration edit**: Prior passing DB suites (`cross-tenant-isolation`, `leave-rpcs`, `phase3-rpc-matrix`, `section4-kpi`, `suspended-member-isolation`, `section1-hr-tools`, `cron-timezone-isolation`, `f1-multitenancy`, `f4-shifts`, `f5-leave`, `f6-tasks`, `f7-kpi`, `f12-persona-matrix`, `mfa-policy-matrix`, `f1.5-job-titles`, `section5-shifts-and-night-shifts`) passed before the final Section 12 trigger update; re-running the clean DB suite after pushing is recommended.

## Staging-Only Requirements (Not Runnable Locally)

- Apply `supabase/migrations/20261128000001_atomic_reviews_and_auth_challenges.sql` (and inspect any legacy ambiguous `NULL` rows in `employee_onboarding_audit` in staging data) during staged cutover.
- Verify real SMTP/SES delivery (`AUTH_MAILBOX_URL` / Resend / Supabase Auth hooks), Supabase hosted JWT/MFA AAL2 session behavior, and production cron scheduler secrets (`CRON_SECRET`) against staging infrastructure.
- Set production `NEXT_PUBLIC_DEMO_MODE=false` and staging Supabase URL/anon key in deployment environment variables before building release artifacts.

# Current handoff

Updated 28 November 2026.

## Multi-tenant release hardening summary

All five phases of [PER_TENANT_RELEASE_PROMPT.md](PER_TENANT_RELEASE_PROMPT.md) are implemented across migrations, server authorization, atomic Postgres review RPCs, multi-instance recovery challenges, reports/exports, and the workspace switcher UI.

### Verified release checks (local clean environment)

1. **Unit & TypeScript check**
   - `npx tsc --noEmit --incremental false`: passed (exit `0`).
   - `npx vitest run tests/unit`: `45` test files passed, `272` tests passed (`multi-tenant-release.test.ts` + all existing suites).
   - `npm run verify:docs`: passed (`scripts/verify-docs.mjs`).
2. **Clean production build**
   - `Remove-Item -Recurse -Force .next; npm run build`: passed cleanly (exit `0`, `54` static routes + dynamic API handlers).
3. **Database migrations & DB isolation suites**
   - `verify-migrations.mjs` passed both full **fresh replay** (`pulse_fresh_check`: `20261107000001` through `20261128000001_atomic_reviews_and_auth_challenges.sql`) and **upgrade replay** from pre-`20261116` backup/restore (`pulse_upgrade_check`, preserving legacy `kpi_reviews` row `22222222-2222-2222-2222-222222222222`). Temporary DBs cleaned up.
   - Local Docker DB suites executed after migration fixes (`cross-tenant-isolation` 32/32, `leave-rpcs` 28/28, `phase3-rpc-matrix` 37/37, `section4-kpi` 8/8, `suspended-member-isolation` 3/3, `section1-hr-tools` 9/9, `cron-timezone-isolation` 4/4, `f1-multitenancy` 9/9, `f4-shifts` 7/7, `f5-leave` 9/9, `f6-tasks` 7/7, `f7-kpi` 7/7, `f12-persona-matrix` 30/30, `mfa-policy-matrix` 6/6, `f1.5-job-titles` 5/5, `section5-shifts-and-night-shifts` 4/4 passed).
   - Pre-existing DB test suite drift unrelated to this release remains in legacy snapshot/design specs (`f11-design` old indigo tokens, `f9-retention` comment assertion, `policy-inventory`/`grants-snapshot`/`rpc-reconciliation`/`uuid-tenant-isolation` pre-Nov 17 snapshots, `section3-tasks` old `create_task` return wrapper, `f1.4` no-temp-password check, `admin-routes-integration` old `kpi/export` AAL2 / hyphenated name rules, `schema-meta` global `user_id`-keyed profile/notification tables, `intra-tenant-authorization` / `section2-retention` / `f8-admin` local seed state).
4. **Two-organization, dual-instance E2E suite** (`node .../scratch/verify-two-org-e2e.mjs` against `:3101` & `:3102` with `NEXT_PUBLIC_DEMO_MODE=false` + local Supabase `127.0.0.1:54321`)
   - Verified `Org Alpha` & `Org Beta` isolation with overlapping employee names (`Aarav Sharma`), delegated manager approvals, deactivated user `403` blocks, multi-org `409` guard, concurrent leave & partial-shift regularization approvals (`[200, 409]` + idempotency + `270m` recalculation), locked-period `400` refusal, idempotent cron accrual, org-scoped CSV export & `/reports` `320`-row pagination, field clearing on onboarding profile, dual mail transports (Nodemailer SMTP sink + Supabase GoTrue/Mailpit `127.0.0.1:54324`), fail-closed mail transport error handling, password change re-auth + durable audit logs, and Playwright multi-org switcher + cross-instance MFA recovery challenge consumption (`:3101` -> `:3102` -> replay `400`).

### Migration, rollback, and staging notes

- **Apply migrations in order**: ensure `supabase/migrations/20261128000001_atomic_reviews_and_auth_challenges.sql` is applied (plus all fixed November migrations).
- **Backup before deploy**: take a logical snapshot (`pg_dump`) prior to running migrations; rollback restores pre-migration `organization_members_user_id_key` only if no multi-org user rows exist yet, and drops new RPCs/`auth_recovery_challenges` if reverting.
- **Required production env vars**: set `CRON_SECRET`, `MFA_RECOVERY_HMAC_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_DEMO_MODE=false`, and either `RESEND_API_KEY` or authenticated `SMTP_*` credentials.
- **Remaining staging verification**: exercise live Resend webhook/production SMTP provider delivery, production Upstash Redis rate limiting (`UPSTASH_REDIS_REST_*`), and cron scheduler triggers against the staging environment.

## Module & feature references

Start feature changes at [the module map](MODULES.md) and check [the document index](INDEX.md) for architecture and security requirements.

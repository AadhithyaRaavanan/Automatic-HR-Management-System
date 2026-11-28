# Current handoff

Updated 28 November 2026.

## Multi-tenant release hardening summary

All five phases of [PER_TENANT_RELEASE_PROMPT.md](PER_TENANT_RELEASE_PROMPT.md) are implemented across migrations, server authorization, atomic Postgres review RPCs, multi-instance recovery challenges, invite & onboarding-audit boundaries, reports/exports, and the workspace switcher UI.

### Verified checks

1. **Unit, docs, and TypeScript check**
   - `npx tsc --noEmit --incremental false`: passed (`0` errors).
   - `npx vitest run tests/unit`: `46` test files passed, `275` tests passed (including `multi-tenant-release.test.ts` and `invite-and-onboarding-audit.test.ts`).
   - `npm run verify:docs`: passed (`scripts/verify-docs.mjs`).
2. **Clean production build**
   - `Remove-Item -Recurse -Force .next; npm run build`: passed cleanly (exit `0`, `54` static routes + dynamic API routes).
3. **Database migrations & local DB suites**
   - `verify-migrations.mjs` passed both full **fresh replay** (`20261107000001` through `20261128000001_atomic_reviews_and_auth_challenges.sql`) and **upgrade replay** from pre-`20261116` backup/restore (preserving legacy `kpi_reviews` row `22222222-2222-2222-2222-222222222222`). Temporary DBs cleaned up.
   - Local Docker DB suites passing: `cross-tenant-isolation` (`32/32`), `leave-rpcs` (`28/28`), `phase3-rpc-matrix` (`37/37`), `section4-kpi` (`8/8`), `suspended-member-isolation` (`3/3`), `section1-hr-tools` (`9/9`), `cron-timezone-isolation` (`4/4`), `f1-multitenancy` (`9/9`), `f4-shifts` (`7/7`), `f5-leave` (`9/9`), `f6-tasks` (`7/7`), `f7-kpi` (`7/7`), `f12-persona-matrix` (`30/30`), `mfa-policy-matrix` (`6/6`), `f1.5-job-titles` (`5/5`), `section5-shifts-and-night-shifts` (`4/4`).
   - `admin-routes-integration.test.ts` passed cross-tenant denials (`409` on cross-org invite) plus live invite, bulk-import, reset-mfa, force-signout, deactivate, and audit export workflows (only legacy pre-KPI-redesign assertions on `kpi/export` `.xlsx`/AAL2 remain mismatched).
4. **Two-organization, dual-instance E2E suite** (`verify-two-org-e2e.mjs` against `:3101` & `:3102` with `NEXT_PUBLIC_DEMO_MODE=false` + local Supabase `127.0.0.1:54321`)
   - Passed prior to the final invite/`onboarding/complete`/`kpi/export` patches: `Org Alpha` & `Org Beta` isolation with overlapping names (`Aarav Sharma`), delegated manager approvals, deactivated `403` blocks, multi-org `409` guard, concurrent leave & partial-shift regularization approvals (`[200, 409]` + `270m` recalculation), locked-period `400` refusal, idempotent cron accrual, org-scoped CSV export & `/reports` `320`-row pagination, field clearing, dual mail transports (Nodemailer SMTP sink + Supabase GoTrue/Mailpit `127.0.0.1:54324`), fail-closed mail transport error handling, password change re-auth + durable audits, and Playwright multi-org switcher + cross-instance MFA recovery challenge consumption.

### Release blockers / staging items still open

- **Staging provider verification:** Exercise live Resend / production SMTP email delivery, webhook/bounce handling, Upstash Redis distributed rate limiting (`UPSTASH_REDIS_REST_*`), and hosted cron triggers against staging.
- **Re-run two-org E2E against final build:** Re-run `verify-two-org-e2e.mjs` built with `NEXT_PUBLIC_DEMO_MODE=false` and local Supabase URL if pre-deploy sign-off requires end-to-end replay after the final `invite` / `onboarding/complete` / `kpi/export` patches.
- **Pre-existing DB suite drift:** Align legacy DB snapshot/design tests (`f11-design`, `f9-retention`, `policy-inventory`, `grants-snapshot`, `rpc-reconciliation`, `uuid-tenant-isolation`, `rls-database-matrix`, `section3-tasks`, `f1.4-provisioning-without-passwords`, `admin-routes-integration` `.xlsx`/AAL2 `kpi/export`, `schema-meta` global `user_id` profile/notification exemptions, `intra-tenant-authorization`, `section2-retention`, `f8-admin` stale seed rows) if CI gates on `tests/database`.
- **Production configuration required on deploy:** Apply `20261128000001_atomic_reviews_and_auth_challenges.sql` after `pg_dump` backup, and set `CRON_SECRET`, `MFA_RECOVERY_HMAC_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_DEMO_MODE=false`, and mail credentials.

## Module & feature references

Start feature changes at [the module map](MODULES.md) and check [the document index](INDEX.md) for architecture and security requirements.

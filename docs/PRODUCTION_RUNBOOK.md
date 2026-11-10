# Production Rebuild & Deployment Runbook

> [!CAUTION]
> **NEVER run automated test suites (`npm run test:db`, `npx playwright test`, seed scripts) or destructive commands against a production/remote database.** All commands in `tests/` intentionally fail on non-localhost targets, and manual execution of reset SQL against production will permanently destroy tenant data.

This runbook documents the exact ordered procedure to **rebuild from scratch and deploy to production** on a hosted Supabase project that currently contains only seeded/demo data (`00000000-0000-0000-0000-000000000001` / `@remotehr.io`) and a Vercel Next.js 14 deployment.

---

## 0. Preflight Verification (Local Machine)

1. Confirm you are on the release commit and working tree is clean:
   ```bash
   git status -sb
   git log -1 --oneline
   ```
2. Verify required CLI tools are installed:
   ```bash
   npx supabase --version
   psql --version
   pg_dump --version
   vercel --version
   ```
3. Set shell session variables (**do not commit these to git**):
   ```bash
   export SUPABASE_PROJECT_REF="<your-project-ref>"
   export SUPABASE_DB_URL="postgresql://postgres:<DB_PASSWORD>@db.<your-project-ref>.supabase.co:5432/postgres?sslmode=require"
   export SUPABASE_URL="https://<your-project-ref>.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="<service-role-jwt>"
   export SUPABASE_ANON_KEY="<anon-jwt>"
   export PROD_APP_URL="https://app.yourdomain.com"
   export CRON_SECRET="$(openssl rand -hex 32)"
   ```

---

## 1. Mandatory Pre-Rebuild Backup (Before Wiping Demo Project)

1. Link CLI to the remote Supabase project (without executing local tests against it):
   ```bash
   npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
   ```
2. Capture a full custom-format backup (schema + roles/grants/data across `public`, `auth`, `storage`, `cron`) plus a plain-SQL schema snapshot BEFORE modifying anything:
   ```bash
   mkdir -p backups
   TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
   pg_dump "$SUPABASE_DB_URL" \
     --format=custom \
     --no-owner \
     --no-acl \
     --schema=public \
     --schema=auth \
     --schema=storage \
     --file="backups/pre_rebuild_${SUPABASE_PROJECT_REF}_${TIMESTAMP}.dump"

   npx supabase db dump --linked --schema=public -f "backups/pre_rebuild_public_schema_${TIMESTAMP}.sql"
   sha256sum "backups/pre_rebuild_${SUPABASE_PROJECT_REF}_${TIMESTAMP}.dump" > "backups/pre_rebuild_${TIMESTAMP}.sha256"
   ```
3. (Recommended) Verify PITR / create a manual Snapshot in **Supabase Dashboard -> Database -> Backups** prior to the maintenance window.

---

## 2. Clean Rebuild & Apply All 16 Migrations (From Scratch)

The repository contains **16 sequential migrations** (the **15 core schema/feature migrations** through KPI management, plus **Migration 16** for final-review UUID validation hardening, timezone-correct 15-minute crons, and automated retention archive scheduling):

- `20261107000001_initial_schema.sql` — Base attendance, holidays, requests, audit logs
- `20261107000002_custom_access_token_hook.sql` — JWT claim hook (`user_role`, `organization_id`)
- `20261107000003_rls_policies.sql` — Initial RLS
- `20261107000004_attendance_rpcs.sql` — Check-in / check-out / `recalculate_day`
- `20261107000005_regularization_rpcs.sql` — Regularization submission & approvals
- `20261107000006_cron_jobs.sql` — Initial cron extensions & jobs
- `20261107000007_security_and_mfa.sql` — MFA / security hardening & rate limits
- `20261107000008_multi_tenancy_and_workforce.sql` — Multi-tenancy, `organizations`, `organization_members`, `cron_run_state`, restrictive AAL2/membership policies
- `20261108000009_phase3_organization_admin.sql` — Admin RPCs, departments, locations, shift templates
- `20261108000010_leave_management.sql` — Leave types, policies, balances, requests, RPCs
- `20261108000011_security_hardening_and_leave_fixes.sql` — Suspended-member isolation, GiST half-day exclusion, leave recalculation
- `20261108000012_hr_tools_and_employee_experience.sql` — Attendance corrections, month close, regional holiday templates (`India - Tamil Nadu`), bulk CSV, delegations, private realtime notifications, avatars bucket
- `20261108000013_retention_and_system_health.sql` — Retention floors, batched cleanup, `retention-archives` bucket, tenant system health
- `20261108000014_task_management.sql` — Projects, tasks, comments, time logs, events, due/overdue notifications
- `20261108000015_kpi_system.sql` — KPI definitions, periods, 8 metrics, `calculate_kpi_score`, reviews, immutability
- `20261108000016_final_review_hardening.sql` — UUID leave/admin hardening, 15-min timezone-aware org/location crons, `pg_net` weekly retention archive trigger

1. **Wipe existing demo `public` schema, migration history, and cron schedules cleanly:**
   ```bash
   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
   DO $$
   DECLARE r RECORD;
   BEGIN
     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
       FOR r IN SELECT jobname FROM cron.job LOOP
         PERFORM cron.unschedule(r.jobname);
       END LOOP;
     END IF;
     IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
       EXECUTE 'TRUNCATE TABLE supabase_migrations.schema_migrations';
     END IF;
   END $$;

   DROP SCHEMA IF EXISTS public CASCADE;
   CREATE SCHEMA public AUTHORIZATION postgres;
   GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
   SQL
   ```
   *(If rebuilding a non-empty storage state cleanly, also remove test objects in `storage.objects` where `bucket_id IN ('avatars', 'retention-archives')` via Storage API before recreating buckets.)*

2. **Push all 16 migrations from clean git state (do NOT run `seed.sql`):**
   ```bash
   npx supabase db push --include-all
   ```

3. **Verify exact migration ledger (all 16 applied, zero pending):**
   ```bash
   npx supabase migration list --linked
   ```

---

## 3. Configure Supabase Auth Hooks, MFA, CAPTCHA & Email SMTP

1. **Custom Access Token Hook (REQUIRED for multi-tenant JWT claims):**
   - Open **Supabase Dashboard -> Authentication -> Hooks**.
   - Enable **Customize Access Token (JWT) Claims**.
   - Hook type: **Postgres Function**, schema: `public`, function: `custom_access_token_hook`.
   - Verify permissions in SQL:
     ```bash
     psql "$SUPABASE_DB_URL" -c "\df+ public.custom_access_token_hook" -c "SELECT has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE');"
     ```
     Expected: `t`.
2. **MFA (TOTP) Enforcement:**
   - Open **Authentication -> Multi-Factor Authentication**:
     - Enable **App Authenticator (TOTP)** (`enroll_enabled = true`, `verify_enabled = true`, max factors = `10`).
     - Ensure elevated roles (`hr`, `admin`) will enroll TOTP on first login so tokens obtain `aal2`.
3. **Attack Protection (Cloudflare Turnstile CAPTCHA) & Sign-Up Policy:**
   - Open **Authentication -> Attack Protection**:
     - Enable **CAPTCHA protection**, provider: **Cloudflare Turnstile**, paste Turnstile Secret Key.
   - Open **Authentication -> Sign In / Up**:
     - Disable anonymous sign-ins (`enable_anonymous_sign_ins = false`).
     - Keep email confirmations enabled (`Confirm email = ON`); disable self-serve public signup if onboarding is invite-only via `/admin/users`.
4. **URL Configuration & Production SMTP:**
   - **Authentication -> URL Configuration**:
     - **Site URL**: `https://app.yourdomain.com`
     - **Redirect URLs**: `https://app.yourdomain.com/**` (do **not** leave `localhost` in production redirect allowlist).
   - **Project Settings -> Authentication -> SMTP Settings**:
     - Configure Resend / custom SMTP host (`smtp.resend.com`, port `465`/`587`) because Supabase's built-in emailer is capped at ~2 emails/hour and fails invite flows cleanly at scale.

---

## 4. Verify Private Storage Buckets & RLS Policies

Run SQL verification to confirm both buckets exist, are **non-public**, enforce byte caps & MIME whitelists, and have active RLS policies:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('avatars', 'retention-archives')
ORDER BY id;

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
ORDER BY policyname;
SQL
```

Expected:
- `avatars`: `public = f`, `file_size_limit = 204800` (200 KB), `allowed_mime_types = {image/jpeg,image/png,image/webp}`.
- `retention-archives`: `public = f`, `file_size_limit = 52428800` (50 MB), `allowed_mime_types = {application/gzip,application/x-gzip,application/json}`.

---

## 5. Deploy Automated Retention Archiver & Verify `pg_cron` Schedules

Two complementary automated mechanisms handle monthly `.json.gz` compression and Storage upload BEFORE Postgres purge (`03:00 UTC Sunday`):

1. **Deploy the Supabase Edge Function (`retention-archiver`) & set secrets:**
   ```bash
   npx supabase functions deploy retention-archiver --no-verify-jwt --project-ref "$SUPABASE_PROJECT_REF"
   npx supabase secrets set \
     --project-ref "$SUPABASE_PROJECT_REF" \
     RETENTION_CRON_SECRET="$CRON_SECRET" \
     CRON_SECRET="$CRON_SECRET"
   ```
   *(Auth is enforced inside `supabase/functions/retention-archiver/index.ts` via constant-time bearer comparison against `RETENTION_CRON_SECRET` / `CRON_SECRET`.)*

2. **Store Vault secrets so Postgres `pg_cron` + `pg_net` can invoke the archiver automatically at `02:00 UTC` every Sunday:**
   ```bash
   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
     -v archiver_url="${SUPABASE_URL}/functions/v1/retention-archiver" \
     -v cron_secret="$CRON_SECRET" <<'SQL'
   SELECT vault.create_secret(:'archiver_url', 'retention_archiver_url', 'Edge Function URL for automated retention archival');
   SELECT vault.create_secret(:'cron_secret', 'retention_archiver_token', 'Bearer secret for automated retention archival');
   SQL
   ```
   *(If updating an existing secret, delete/update via `vault.secrets` first rather than inserting duplicates.)*

3. **Verify all 5 `pg_cron` jobs are active with exact schedules:**
   ```bash
   psql "$SUPABASE_DB_URL" -c "SELECT jobid, jobname, schedule, command, active FROM cron.job ORDER BY jobname;"
   ```
   Expected active jobs:
   | `jobname` | `schedule` | Purpose |
   | :--- | :--- | :--- |
   | `daily-task-due-notifications` | `0 8 * * *` | Daily task due-soon & overdue alerts |
   | `nightly-auto-checkout` | `*/15 * * * *` | Every 15m per-org/location timezone-aware auto-checkout |
   | `nightly-finalize-attendance` | `*/15 * * * *` | Every 15m per-org/location timezone-aware `01:00` local finalize |
   | `weekly-retention-archive` | `0 2 * * 0` | Dispatches Edge Function monthly `.json.gz` archival via `pg_net` |
   | `weekly-retention-cleanup` | `0 3 * * 0` | Batched purge (`<=500` rows/batch) only after verified archive exists |

---

## 6. Bootstrap First Production Organization & Admin (with MFA AAL2)

1. **Create the first Auth user via Supabase Admin API** (do **not** insert raw `auth.users` rows manually in production):
   ```bash
   FIRST_ADMIN_EMAIL="owner@yourcompany.com"
   FIRST_ADMIN_NAME="Primary Administrator"

   curl -sS -X POST "${SUPABASE_URL}/auth/v1/admin/users" \
     -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
     -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
     -H "Content-Type: application/json" \
     -d "{
       \"email\": \"${FIRST_ADMIN_EMAIL}\",
       \"email_confirm\": true,
       \"user_metadata\": {\"full_name\": \"${FIRST_ADMIN_NAME}\"}
     }"
   ```
   Copy the returned `id` (`FIRST_ADMIN_ID`). Trigger a password-reset / invite email or set an initial temporary password and force rotation on first sign-in.

2. **Create the organization & bind the admin using `service_role` RPCs:**
   ```bash
   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
     -v admin_id="<FIRST_ADMIN_ID>" \
     -v admin_email="owner@yourcompany.com" \
     -v admin_name="Primary Administrator" <<'SQL'
   BEGIN;
   SELECT public.admin_create_organization(
     p_name      => 'Acme Production Corp',
     p_slug      => 'acme-prod',
     p_work_mode => 'hybrid',
     p_timezone  => 'America/Los_Angeles'
   ) AS org_result \gset

   -- Extract organization_id and provision first AAL2-eligible admin
   SELECT public.provision_invited_employee(
     p_user_id          => :'admin_id'::uuid,
     p_organization_id  => (SELECT id FROM public.organizations WHERE slug = 'acme-prod'),
     p_email            => :'admin_email',
     p_full_name        => :'admin_name',
     p_role             => 'admin',
     p_work_mode        => 'hybrid',
     p_timezone         => 'America/Los_Angeles'
   );
   COMMIT;
   SQL
   ```
3. **Complete First-Admin MFA Enrollment Immediately:**
   - Sign in as `owner@yourcompany.com` at `https://app.yourdomain.com/login`.
   - Follow the mandatory `/mfa` TOTP authenticator enrollment & verify 6-digit OTP to obtain an `aal2` session.
   - Inside `/admin/settings` -> confirm attendance policy (`auto_checkout_time`, `grace_minutes`, `weekly_off_days`) and retention policy floors (`>= 18m` sessions, `>= 24m` audit logs, `>= 90d` read notifications).
   - Inside `/hr/holidays` -> import regional holiday template (e.g., **India - Tamil Nadu** or company holidays) and allocate initial yearly leave balances (`/hr/leave`).

---

## 7. Delete Seeded Demo Accounts & Demo Organization Data

If the remote project started with demo seed users (`@remotehr.io`) or the `'demo'` organization (`00000000-0000-0000-0000-000000000001`), purge every demo record cleanly BEFORE opening traffic:

1. **Delete all 8 seeded demo users via Supabase Auth Admin API** (removing `auth.users` & `auth.identities` cleanly):
   ```bash
   for DEMO_UID in \
     00000000-0000-0000-0000-000000000001 \
     00000000-0000-0000-0000-000000000002 \
     00000000-0000-0000-0000-000000000003 \
     00000000-0000-0000-0000-000000000004 \
     00000000-0000-0000-0000-000000000005 \
     00000000-0000-0000-0000-000000000006 \
     00000000-0000-0000-0000-000000000007 \
     00000000-0000-0000-0000-000000000008; do
     curl -sS -X DELETE "${SUPABASE_URL}/auth/v1/admin/users/${DEMO_UID}" \
       -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
       -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
   done
   ```
2. **Delete remaining demo organization rows (`00000000-0000-0000-0000-000000000001` / `slug = 'demo'`) & assert zero demo leftovers:**
   ```bash
   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
   DELETE FROM public.audit_logs
   WHERE organization_id = '00000000-0000-0000-0000-000000000001'::uuid;

   DELETE FROM public.organizations
   WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
      OR slug = 'demo';

   DELETE FROM auth.users WHERE email LIKE '%@remotehr.io';

   -- Verification: both counts MUST be 0
   SELECT
     (SELECT COUNT(*) FROM public.organizations WHERE slug = 'demo') AS demo_orgs,
     (SELECT COUNT(*) FROM auth.users WHERE email LIKE '%@remotehr.io') AS demo_users;
   SQL
   ```

---

## 8. Vercel Environment Variables & Production Deployment

Set every variable in **Vercel Project -> Settings -> Environment Variables (Production)** (or via `vercel env add ... production`):

| Variable | Value / Requirement | Secret? |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project anon key | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Project `service_role` JWT (server-only) | **Yes** |
| `NEXT_PUBLIC_APP_URL` | `https://app.yourdomain.com` | No |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key | No |
| `CRON_SECRET` | Same 32-byte random hex secret used by Vercel Cron `/api/cron/retention` | **Yes** |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint (distributed server rate limiting) | **Yes** |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token | **Yes** |
| `RESEND_API_KEY` | Production Resend API key | **Yes** |
| `EMAIL_FROM` | Verified domain sender e.g. `"Acme HR <hr@yourdomain.com>"` | No |
| `SLACK_WEBHOOK_URL` | Optional operational alert webhook | **Yes** |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional Sentry error DSN | No |
| `NEXT_PUBLIC_DEMO_MODE` | **MUST BE UNSET** (never `"true"` in production; guarantees `/api/auth/demo-totp` returns `404`) | Guard |

Deploy and verify Vercel Cron registration (`vercel.json` -> `GET /api/cron/retention` every Sunday `02:00 UTC`):

```bash
vercel --prod
vercel env ls production
```

---

## 9. Non-Destructive Post-Deploy Smoke Checks

1. **Verify demo endpoints are hard-disabled in production (`404`):**
   ```bash
   curl -i -X POST "${PROD_APP_URL}/api/auth/demo-totp" \
     -H "Content-Type: application/json" \
     -d '{"secret":"test"}'
   # Expected: HTTP/2 404
   ```
2. **Verify cron endpoint fails closed on missing / invalid bearer (`401` / `403`):**
   ```bash
   curl -i "${PROD_APP_URL}/api/cron/retention"         # Expected: 401
   curl -i -H "Authorization: Bearer invalid" "${PROD_APP_URL}/api/cron/retention"  # Expected: 403
   ```
3. **Verify authenticated flows manually in browser:**
   - Unauthenticated `/dashboard` -> redirects to `/login`.
   - Admin login (`owner@yourcompany.com`) -> Turnstile challenge -> MFA TOTP challenge (`aal2`) -> `/admin/settings` & `/admin/system` load tenant-scoped stats (no platform DB size exposed).
   - Audit CSV export (`/api/admin/audits/export`) succeeds with `aal2` cookie; non-admin hits `/403`.
   - Invite a second test team member (`/admin/users`), verify email arrives via SMTP, confirm member check-in/out & leave request flow, then deactivate or retain real team accounts.
4. **Verify initial `pg_cron` 15-minute runs & `cron_run_state`:**
   ```bash
   psql "$SUPABASE_DB_URL" -c "SELECT jobid, status, return_message, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;"
   ```

---

## 10. Rollback Procedure

If a regression, migration defect, or availability issue occurs after cutover:

1. **Freeze write traffic & roll back Vercel frontend/API:**
   - In Vercel Dashboard (**Deployments -> Previous Production Deployment -> Promote to Production**) or CLI:
     ```bash
     vercel rollback <previous-deployment-url> --yes
     ```
2. **Temporarily pause cron jobs before DB restore (prevent mid-restore execution):**
   ```bash
   psql "$SUPABASE_DB_URL" -c "UPDATE cron.job SET active = FALSE;"
   ```
3. **Restore database from pre-rebuild backup (verified by SHA-256 first):**
   ```bash
   sha256sum -c "backups/pre_rebuild_${TIMESTAMP}.sha256"
   pg_restore "$SUPABASE_DB_URL" \
     --clean \
     --if-exists \
     --no-owner \
     --no-acl \
     "backups/pre_rebuild_${SUPABASE_PROJECT_REF}_${TIMESTAMP}.dump"
   ```
   *(Or trigger **Point-in-Time Recovery** in **Supabase Dashboard -> Database -> Backups** to the exact pre-cutover timestamp recorded in Step 1.)*
4. **Re-enable Auth Hook & verify health:**
   - Confirm `custom_access_token_hook` remains enabled under **Authentication -> Hooks**.
   - Re-enable `cron.job` (`UPDATE cron.job SET active = TRUE;`) only after confirming data consistency.
   - Re-run Step 9 smoke checks before restoring user access.


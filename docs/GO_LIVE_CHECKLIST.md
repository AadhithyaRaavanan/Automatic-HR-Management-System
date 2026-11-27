# RemoteHR — Production Go-Live Checklist & Deployment Runbook

This document is the authoritative, step-by-step ordered checklist for deploying RemoteHR from an empty Supabase project and raw hosting environment to a live enterprise production instance.

---

## 1. Pre-Deployment & Infrastructure Setup

- [ ] **Step 1.1: Project Creation & Initial Backup**
  - Create a new project in the [Supabase Dashboard](https://supabase.com/dashboard).
  - Select your target production region (e.g. `us-east-1` or `eu-central-1`) matching your application hosting region.
  - Enable Point-in-Time Recovery (PITR) and schedule daily automated backups under **Database** -> **Backups**.

- [ ] **Step 1.2: Enable Required PostgreSQL Extensions**
  - Navigate to **Database** -> **Extensions** and ensure the following extensions are toggled ON:
    - `pgcrypto` (Cryptographic hashing, UUID generation)
    - `pg_net` (Asynchronous HTTP dispatch for webhooks/cron)
    - `pg_cron` (Automated cron scheduling for attendance cutoff and retention)

- [ ] **Step 1.3: Apply Database Migrations**
  - Run the Supabase CLI to apply all schema migrations `01` through `19` in chronological order:
    ```bash
    npx supabase db push --db-url "postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"
    ```
  - Verify all 19 migrations applied cleanly with zero errors.

- [ ] **Step 1.4: Deploy Data Retention Edge Function**
  - Deploy the automated storage retention worker:
    ```bash
    npx supabase functions deploy retention-archive-worker
    ```
  - Configure the function secret:
    ```bash
    npx supabase secrets set RETENTION_CRON_SECRET="your-high-entropy-cron-secret-32-chars"
    ```

- [ ] **Step 1.5: Configure Vault Secrets**
  - Store database credentials and webhook secrets securely in the Supabase Vault (`vault.secrets`).

---

## 2. Supabase Dashboard Authentication Settings

Configure the following settings in **Authentication** in the Supabase Dashboard:

- [ ] **Step 2.1: Custom Access Token Hook**
  - Navigate to **Authentication** -> **Hooks (Beta)**.
  - Enable **Customize Access Token (JWT) Claims**.
  - Set Hook Type to `PostgreSQL function`.
  - Select schema `public` and function `custom_access_token_hook`.
  - Save changes. This injects `user_role`, `organization_id`, and `aal` claims directly into signed JWTs.

- [ ] **Step 2.2: Multi-Factor Authentication (TOTP)**
  - Navigate to **Authentication** -> **MFA**.
  - Enable **Time-based One-Time Password (TOTP)**.
  - Set Maximum Factors Per User: `2`.

- [ ] **Step 2.3: Bot Protection (CAPTCHA Setting)**
  - Navigate to **Authentication** -> **Bot Detection (CAPTCHA)**.
  - **Set CAPTCHA to OFF in the Supabase Dashboard**.
  - *Rationale*: RemoteHR implements authoritative server-side Turnstile verification in Next.js API routes (`/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/verify-otp`) using `challenges.cloudflare.com/turnstile/v0/siteverify`. Keeping Supabase Dashboard CAPTCHA off prevents double-verification failures when administrative SDK calls are made.

- [ ] **Step 2.4: User Signups & Password Policies**
  - In **Authentication** -> **Providers** -> **Email**:
    - **Disable "Allow new users to sign up"** (Signups OFF; RemoteHR is strictly invite-only).
    - Set Minimum Password Length: `12` characters.
    - Require Letters, Numbers, and Symbols: `Enabled`.

- [ ] **Step 2.5: OTP Expiry Duration**
  - In **Authentication** -> **Email Auth**:
    - Set OTP Expiration: `300 seconds` (5 minutes).

- [ ] **Step 2.6: Custom SMTP Configuration (Resend)**
  - For hosted Supabase Auth delivery, install the [code-only Reset Password template](../supabase/templates/recovery.html) and the [Magic Link template](../supabase/templates/magic-link.html) in Authentication → Email Templates. Set the email OTP length to six, set Site URL to the deployed app origin, and allow its `/auth/confirm` redirect. A new magic link should open Pulse and wait for **Continue** before signing in. The application's SMTP and Resend transports render their own messages.
  - Enable **Custom SMTP** in **Authentication** -> **SMTP Settings**.
  - Configure with separate dedicated Resend SMTP credentials:
    - **Host**: `smtp.resend.com`
    - **Port**: `465` (SSL) or `587` (TLS)
    - **User**: `resend`
    - **Password**: `<YOUR_DEDICATED_RESEND_SMTP_API_KEY>` (Generate a dedicated SMTP key in Resend; do not reuse the application API key).
    - **Sender Email**: `noreply@yourdomain.com` (Must match your verified domain in Resend).
    - **Sender Name**: `RemoteHR Security`

- [ ] **Step 2.7: Site URL and EXACT Redirect URLs**
  - In **Authentication** -> **URL Configuration**:
    - **Site URL**: `https://app.yourcompany.com`
    - **Redirect URLs** (Explicit paths only; **strictly no wildcards** to prevent open-redirect vulnerabilities):
      - `https://app.yourcompany.com/auth/callback`
      - `https://app.yourcompany.com/settings`
      - `https://app.yourcompany.com/mfa-setup`
      - `https://app.yourcompany.com/mfa-challenge`
      - `https://app.yourcompany.com/login`
      - `https://app.yourcompany.com/profile`

---

## 3. Storage Bucket & pg_cron Verification

- [ ] **Step 3.1: Storage Bucket Security**
  - In **Storage**, verify that bucket `attendance-archives` exists.
  - Confirm **Public Bucket** is set to `FALSE` (Private).
  - Verify RLS policies restrict read and write access exclusively to `service_role`.

- [ ] **Step 3.2: pg_cron Scheduled Jobs**
  - In SQL Editor, run:
    ```sql
    SELECT jobid, schedule, command, active FROM cron.job;
    ```
  - Verify that:
    - `cron_auto_checkout` is scheduled every 15 minutes (`*/15 * * * *`).
    - `cron_nightly_finalize` is scheduled nightly at 00:05 (`5 0 * * *`).

---

## 4. Environment Variables Reference

Configure the following environment variables in your production hosting platform (e.g., Vercel Project Settings):

| Environment Variable | Where Used | Required / Optional | Example Value | Classification |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client & Server | **Required** | `https://xyzproject.supabase.co` | **Public** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client & Server | **Required** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ...` | **Public** |
| `SUPABASE_SERVICE_ROLE_KEY` | Server API & Cron | **Required** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ...` | **Secret** |
| `DATABASE_URL` | Server Migrations & Tests | **Required** | `postgresql://postgres:pass@db.xyz.supabase.co:5432/postgres` | **Secret** |
| `NEXT_PUBLIC_APP_URL` | Client & Server | **Required** | `https://app.yourcompany.com` | **Public** |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Client Login Form | **Required** | `0x4AAAAAAAXxxxxxxxxxxxxx` | **Public** |
| `TURNSTILE_SECRET_KEY` | Server Auth APIs | **Required** | `0x4AAAAAAAYyyyyyyyyyyyyy` | **Secret** |
| `RESEND_API_KEY` | Server (Invites & Alerts) | **Required** | `re_prod_app_key_123456789` | **Secret** |
| `RESEND_FROM_EMAIL` | Server Email Templates | **Required** | `RemoteHR <noreply@yourdomain.com>` | **Public** |
| `UPSTASH_REDIS_REST_URL` | Server Rate Limiter | **Required** | `https://prompt-squid-12345.upstash.io` | **Secret** |
| `UPSTASH_REDIS_REST_TOKEN` | Server Rate Limiter | **Required** | `AZy...=` | **Secret** |
| `RETENTION_CRON_SECRET` | Edge Function & Server | **Required** | `cron_secret_high_entropy_32_chars` | **Secret** |
| `NEXT_PUBLIC_SENTRY_DSN` | Client Error Tracker | Optional | `https://abc@o123.ingest.sentry.io/456` | **Public** |
| `SENTRY_DSN` | Server Error Tracker | Optional | `https://abc@o123.ingest.sentry.io/456` | **Secret** |
| `COMPANY_NAME` | Client UI & Legal Pages | Optional | `Acme Global Corp` | **Public** |
| `SUPPORT_EMAIL` | Client UI & Emails | Optional | `support@acme.com` | **Public** |

> [!IMPORTANT]
> **Resend Key Separation**: Generate two distinct API keys in Resend:
> 1. **App Transactional Key** (`RESEND_API_KEY`): Restricted to sending domain in your hosting environment.
> 2. **GoTrue SMTP Key**: Configured strictly in the Supabase Dashboard Custom SMTP section.
>
> **DNS Configuration**: Never use placeholder DNS records. Copy exact DKIM, SPF (`TXT`), and MX values directly from the Resend Dashboard verification screen for your registered domain.

---

## 5. Tenant Bootstrapping & Initial Administrator Enrollment

- [ ] **Step 5.1: Execute Production Bootstrapping Script**
  Run the idempotent tenant bootstrapping script from an authorized deployment terminal:
  ```bash
  npx tsx scripts/bootstrap-production.ts \
    --name="Acme Corporation" \
    --slug="acme-corp" \
    --domain="acme.com" \
    --timezone="America/New_York" \
    --currency="USD" \
    --work-mode="hybrid" \
    --admin-email="admin@acme.com" \
    --admin-name="Chief People Officer"
  ```

- [ ] **Step 5.2: First Admin Passwordless Enrollment**
  - In an interactive terminal, the script outputs:
    `[ADMIN INVITE LINK]: https://app.yourcompany.com/auth/v1/verify?token=...&type=invite&redirect_to=https://app.yourcompany.com/settings?must_change_password=true`
  - In CI or non-interactive environments, the link is redacted from stdout to prevent log leakage and dispatched strictly via Resend to `admin@acme.com`.
  - The administrator opens the invite link within 24 hours, sets an initial 12+ character password, and enrolls their TOTP authenticator app.
  - Zero persistent or emergency backup credentials exist or are stored.

---

## 6. Vercel Preview Deploy, Smoke Testing & Promotion

- [ ] **Step 6.1: Vercel Preview Deployment**
  - Push the release commit to a staging branch or pull request.
  - Verify that Vercel builds the preview environment successfully (`NODE_ENV=production`).

- [ ] **Step 6.2: Production Smoke Tests**
  - Verify `https://app.yourcompany.com/api/health` returns status `healthy` with database and redis `connected: true`.
  - Verify demo routes `/gallery` return HTTP 404.
  - Verify no demo role preset buttons exist on `/login`.
  - Verify security headers (CSP, HSTS, X-Frame-Options) are present on all responses.
  - Verify zero Content Security Policy violations in the browser console.
  - Verify login enforces Turnstile challenge.
  - Verify forgot-password email OTP flow sends verification code and redirects to `/settings`.

- [ ] **Step 6.3: Production Promotion**
  - Merge branch into `main` and trigger production deployment.
  - Bind custom domain `app.yourcompany.com`.
  - Confirm SSL certificate is active.

---

## 7. Rollback Procedures

If critical defects or telemetry errors are observed post-promotion:

1. **Application Rollback**:
   - In Vercel / hosting dashboard, click **Instant Rollback** to the previous known-good deployment SHA.
2. **Database Schema Rollback**:
   - If a migration caused breaking column constraints, connect via direct psql and apply the documented rollback SQL from `docs/history/`.
3. **MFA Emergency Reset**:
   - If an administrator loses their TOTP factor during initial enrollment, follow the recovery procedure in [`docs/ADMIN_RECOVERY.md`](ADMIN_RECOVERY.md).

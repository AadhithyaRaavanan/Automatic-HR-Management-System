# RemoteHR Platform Operations Guide

This guide details routine administrative and DevOps procedures for managing tenants, executing compliance runs, and maintaining operational health.

---

## 1. Onboarding a New Tenant
To onboard a new enterprise organization into RemoteHR, run the production bootstrapping script:

```bash
# Dry run to preview schema insertions:
npx tsx scripts/bootstrap-production.ts \
  --name "Acme Global Technologies" \
  --slug "acme-global" \
  --domain "acmeglobal.com" \
  --admin-email "admin@acmeglobal.com" \
  --admin-name "Jane Doe" \
  --timezone "Asia/Kolkata" \
  --dry-run

# Execute live tenant provisioning:
npx tsx scripts/bootstrap-production.ts \
  --name "Acme Global Technologies" \
  --slug "acme-global" \
  --domain "acmeglobal.com" \
  --admin-email "admin@acmeglobal.com" \
  --admin-name "Jane Doe" \
  --timezone "Asia/Kolkata"
```

### What gets provisioned automatically:
1. `organizations` tenant record with 14-day trial period.
2. Standard leave types: Annual Leave (12 days), Sick Leave (10 days), Casual Leave (6 days), Maternity (182 days), Paternity (14 days).
3. Shift templates: General Shift (`09:00 - 18:00`), Morning Shift (`06:00 - 15:00`), Night Shift (`22:00 - 07:00`).
4. Organization attendance policy with 15-minute late grace period.
5. Standard public holiday calendar.
6. Initial tenant Administrator with secure single-use invitation link delivered via Resend.

---

## 2. Tenant Suspension & Lifecycle Management
To suspend a tenant (e.g. for non-payment or security investigation):

```sql
UPDATE public.organizations
SET status = 'suspended',
    updated_at = NOW()
WHERE id = '<organization-uuid>';
```
*Effect*: All users of that organization immediately receive HTTP 403 Forbidden on API endpoints and are redirected away by application middleware.

---

## 3. Data Retention & Archival Operations
RemoteHR adheres to statutory record retention schedules:
- **Audit Logs**: 365-day active retention
- **Attendance Records**: 90-day active retention
- **KPI Scores**: 180-day active retention

### Automated Execution:
A `pg_cron` schedule executes every Sunday at 02:00 UTC (`weekly-retention-archive`), invoking the `retention-archiver` Supabase Edge Function with a secret bearer token. Older records are compressed, uploaded to the `retention-archives` Supabase Storage bucket, and cleaned in safe 500-row batches.

### Manual Retention Run (Via Admin UI or API):
Admins can trigger an ad-hoc retention run from `/admin/settings` or via authenticated POST request:

```bash
curl -X POST https://app.yourdomain.com/api/admin/retention/run \
  -H "Authorization: Bearer <ADMIN_JWT_AAL2>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false}'
```

---

## 4. Audit Log Inspection & Compliance Exports
To review high-privilege configuration changes and security events:
1. Navigate to `/admin/audits` in the browser.
2. Filter by date range, actor, or action type (e.g., `MFA_POLICY_CHANGED`, `USER_INVITED`, `ROLE_UPDATED`).
3. Click "Export Audit CSV" to download an immutable audit package for compliance reporting.

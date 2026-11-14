# RemoteHR Administrator Recovery Runbook

This runbook outlines authoritative emergency recovery procedures when an administrator loses MFA factors, gets locked out due to rate limits or credential issues, or needs to recover corrupted tenant status.

---

## 1. Prerequisites for Recovery Operations
Recovery requires administrative database access via PostgreSQL connection string (`DATABASE_URL`) or Supabase CLI.

- **Local Development**: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- **Hosted Production**: Direct Supabase Project Database URI or Connection Pooler (port 5432 / 6543) with Superuser credentials.

---

## 2. Emergency Admin Password Reset
If an administrator is unable to sign in via standard auth or forgot-password OTP:

```bash
# Using Supabase CLI locally:
supabase auth reset admin@remotehr.io --password "NewEmergencyPass123!"
```

Or via direct SQL query against the `auth.users` table:
```sql
UPDATE auth.users
SET encrypted_password = crypt('NewEmergencyPass123!', gen_salt('bf')),
    raw_user_meta_data = raw_user_meta_data || '{"must_change_password": true}'::jsonb,
    updated_at = NOW()
WHERE email = 'admin@remotehr.io';
```

---

## 3. Clearing Locked Admin MFA Factors
If an admin loses their authenticator app and cannot satisfy AAL2:

### Step 1: Identify the User ID and Factor ID
```sql
SELECT u.id AS user_id, u.email, f.id AS factor_id, f.factor_type, f.status
FROM auth.users u
LEFT JOIN auth.mfa_factors f ON f.user_id = u.id
WHERE u.email = 'admin@remotehr.io';
```

### Step 2: Delete Enrolled TOTP Factors
```sql
DELETE FROM auth.mfa_factors
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'admin@remotehr.io');
```

### Step 3: Verify Organization Privilege Policy
If the organization requires MFA for privileged users (`require_mfa_for_privileged = true`), the admin will be guided to enroll a new TOTP factor immediately on next login (`/mfa-setup`).

To temporarily relax the organization MFA requirement in an emergency:
```sql
UPDATE public.organizations
SET require_mfa_for_privileged = FALSE
WHERE slug = 'acme-corp';
```

---

## 4. Resetting IP or Email Rate Limit Locks
If an administrator's IP or email address is locked out by rate limiting:

### Method A: Redis Flush (If Upstash Redis is Configured)
Using Upstash REST API or Redis CLI:
```bash
# Delete rate limit key for admin email
DEL "@remotehr/login_email:admin@remotehr.io"
DEL "@remotehr/admin:<admin-user-uuid>"
```

### Method B: PostgreSQL Fallback Store
```sql
DELETE FROM public.auth_rate_limits
WHERE key LIKE '%admin@remotehr.io%';
```

---

## 5. Un-suspending a Suspended Organization
When an organization is suspended (`status = 'suspended'`), all non-admin sessions and RPC calls are blocked by RLS policies and middleware.

To reactivate the tenant:
```sql
UPDATE public.organizations
SET status = 'active',
    updated_at = NOW()
WHERE slug = 'target-tenant-slug';

-- Audit log the reactivation
INSERT INTO public.audit_logs (
    organization_id,
    actor_id,
    action,
    entity_type,
    metadata
)
SELECT id, (SELECT id FROM auth.users WHERE email = 'admin@remotehr.io'),
       'ORGANIZATION_ACTIVATED', 'organizations',
       jsonb_build_object('reason', 'Emergency recovery procedure completed')
FROM public.organizations
WHERE slug = 'target-tenant-slug';
```

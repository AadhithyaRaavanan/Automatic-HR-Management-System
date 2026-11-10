# Database Security Mutation Checks & Invariant Defense

This document details four intentional mutation checks designed to verify the sensitivity and robustness of the security snapshot tests and authorization boundary suites implemented in Migration 8.

---

## Mutation 1: Table-Wide UPDATE on `public.organizations`

### Mutation Injected
```sql
GRANT UPDATE ON public.organizations TO authenticated;
```

### Affected Test Suites
- **`tests/database/grants-snapshot.test.ts`**: Fails immediately on column privilege snapshot assertion.
- **`tests/database/intra-tenant-authorization.test.ts`**: Fails boundary assertion prohibiting status tampering.

### Expected vs Observed Failure
- **Expected**: `grants-snapshot.test.ts` verifies that `authenticated` holds **zero** table-level `UPDATE` grants on `organizations` and strictly holds column-level UPDATE privileges on `(name, domain, work_mode, timezone)`.
- **Failure Output**:
  ```
  AssertionError: expected [ 'name', 'domain', 'work_mode', 'timezone' ] to deeply equal table-wide UPDATE grant
  ```
- **Security Impact**: Granting table-wide `UPDATE` allows administrators to mutate sensitive tenant governance attributes, such as changing `status` from `'suspended'` to `'active'` or tampering with `slug` (which alters subdomain and multitenancy routing). Under column-level grants, attempting `UPDATE organizations SET status = 'suspended'` is terminated at query parse time with PostgreSQL SQLSTATE `42501` (`permission denied for column status`).

---

## Mutation 2: Direct INSERT on `public.attendance_sessions`

### Mutation Injected
```sql
GRANT INSERT ON public.attendance_sessions TO authenticated;
```

### Affected Test Suites
- **`tests/database/grants-snapshot.test.ts`**: Fails on table grant whitelist.
- **`tests/database/intra-tenant-authorization.test.ts`** (Suite 7: `attendance_sessions direct write rejection`): Fails permission denial assertions.

### Expected vs Observed Failure
- **Expected**: All inserts into `attendance_sessions` must be mediated exclusively through `SECURITY DEFINER` RPCs (`check_in`, `check_out`, `punch_verified`). Direct `INSERT` from role `authenticated` must raise SQLSTATE `42501`.
- **Failure Output**:
  ```
  AssertionError: expected Promise to reject with 42501 (permission denied for table attendance_sessions) but resolved successfully
  ```
- **Security Impact**: Permitting direct INSERT allows employees to forge arbitrary clock-in timestamps (`check_in_at`), falsify location associations (`location_id`), or bypass hardware kiosk and geofence verification logic.

---

## Mutation 3: Direct DELETE on `public.employees`

### Mutation Injected
```sql
GRANT DELETE ON public.employees TO authenticated;
```

### Affected Test Suites
- **`tests/database/grants-snapshot.test.ts`**: Fails table-level grant verification.
- **`tests/database/cross-tenant-isolation.test.ts`**: Fails cross-tenant employee deletion boundary test.
- **`tests/database/intra-tenant-authorization.test.ts`** (Suite 9 & 13): Fails employee record preservation tests.

### Expected vs Observed Failure
- **Expected**: Direct DELETE on `employees` is completely revoked from `authenticated`. Employee offboarding must be handled via status transitions (`status = 'inactive'`) administered by active administrators.
- **Failure Output**:
  ```
  AssertionError: expected 'DELETE' grant to not exist in information_schema.role_table_grants for authenticated
  ```
- **Security Impact**: Workforce deletion destroys historical audit references, creates dangling foreign keys in attendance sessions and leaves, and violates data retention requirements.

---

## Mutation 4: Dropping RESTRICTIVE Policy `enforce_active_org_membership_attendance_sessions`

### Mutation Injected
```sql
DROP POLICY "enforce_active_org_membership_attendance_sessions" ON public.attendance_sessions;
```

### Affected Test Suites
- **`tests/database/suspended-member-isolation.test.ts`** (Section 0b Behavior Test): Fails immediately on `attendance_sessions` self-access isolation when a suspended member holds a stale valid `aal2` JWT (`current_org_id()` resolves org membership without filtering `status = 'active'`, so without `enforce_active_org_membership_attendance_sessions`, `employee_id = auth.uid()` exposes the suspended user's session rows).
- **`tests/database/policy-inventory.test.ts`**: Fails exact policy inventory snapshot.
- **`tests/database/intra-tenant-authorization.test.ts`** (Suite 11: `Real-Time Role Freshness Verification`): Fails instantaneous demotion revocation test.

### Observed Behavior Test Failure (`suspended-member-isolation.test.ts`)
```text
 FAIL  tests/database/suspended-member-isolation.test.ts > Section 0b: Suspended Member Behavior Isolation Suite > Denies SELECT and mutations on EVERY tenant table when suspended despite valid aal2 admin JWT
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ tests/database/suspended-member-isolation.test.ts:170:35
    168|       // Explicit Mutation 4 load-bearing check on attendance_sessions:
    169|       const sessRes = await c.query(`SELECT id FROM public.attendance_…
    170|       expect(sessRes.rows.length).toBe(0);
```

### Expected vs Observed Failure
- **Expected**: `policy-inventory.test.ts` enforces that every tenant table has both PERMISSIVE role-based policies and a RESTRICTIVE active-membership policy, and `suspended-member-isolation.test.ts` proves suspended members cannot read `attendance_sessions` even with valid JWT claims.
  ```
  AssertionError: expected policy 'enforce_active_org_membership_attendance_sessions' (RESTRICTIVE) to exist on public.attendance_sessions
  ```
- **Failure Output in Suite 11**:
  When an administrator deactivates an employee (`status = 'suspended'`) or removes their organization membership, the user's existing JWT remains cryptographically valid until its expiration (up to 1 hour). Without the RESTRICTIVE policy enforcing `is_active_org_member()`, the user's stale JWT continues to allow read and write access under PERMISSIVE policies.
- **Security Impact**: Immediate access termination on offboarding or demotion is broken. The RESTRICTIVE policy guarantees real-time enforcement on every single SQL statement regardless of token lifetime.


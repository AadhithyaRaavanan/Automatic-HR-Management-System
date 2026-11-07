-- ============================================================================
-- Migration: 20261107000008_multi_tenancy_and_workforce.sql
-- Description: Phase 2 Multi-Tenancy & Workforce Foundation
--   Section 1: Schema Extensions (btree_gist)
--   Section 2: Organizations & Organization Members (Canonical Tenancy)
--   Section 3: Workforce Scheduling & Hardware Infrastructure (locations, shifts, kiosk)
--   Section 4: Operational Compliance & Resilience (privacy_acknowledgments, cron_run_state)
--   Section 5: Deterministic Tenant Backfill (organization_id NOT NULL across all tables)
--   Section 6: User Roles Migration & Deprecation (Explicit drops without CASCADE)
--   Section 7: Automatic Organization Derivation Triggers
--   Section 8: Tenant Context Helpers & custom_access_token_hook
--   Section 9: Core Scoped Attendance RPCs (recalculate_day, check_in, check_out, lock/unlock, regularization)
--   Section 10: Service-Role Verified Punch RPC (punch_verified)
--   Section 11: Member Administration RPCs with Last-Admin Advisory Lock
--   Section 12: Defense-in-Depth Triggers (Field Protection & IP Range Gate)
--   Section 13: Strict Privilege Hardening (Revokes & Column-Level Grants)
--   Section 14: Per-Command Role-Gated & Active Membership RLS Policies
--   Section 15: Administrative Organization Provisioning (admin_create_organization)
-- ============================================================================

-- ============================================================================
-- SECTION 1: Schema Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA extensions;

-- ============================================================================
-- SECTION 2: Organizations & Organization Members Infrastructure
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    domain TEXT,
    work_mode TEXT NOT NULL DEFAULT 'remote' CHECK (work_mode IN ('remote', 'office', 'hybrid')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial', 'cancelled')),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- Deterministic Default Organization for Backfilled Demo Data
INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'demo',
    'demo',
    'remote',
    'active',
    'UTC'
)
ON CONFLICT (id) DO UPDATE SET 
    name = 'demo', 
    slug = 'demo', 
    work_mode = 'remote',
    status = 'active';

-- Canonical Organization Members Table (Single Source of Truth, Single Org Per User)
CREATE TABLE IF NOT EXISTS public.organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'hr', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'invited')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- ============================================================================
-- SECTION 3: Locations, Shifts & Hardware Infrastructure
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    address TEXT,
    city TEXT,
    country TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    working_hours INTEGER NOT NULL DEFAULT 480,
    weekly_off_days INTEGER[] NOT NULL DEFAULT '{0, 6}',
    allowed_ip_ranges TEXT[] DEFAULT '{}',
    geofence_latitude DOUBLE PRECISION,
    geofence_longitude DOUBLE PRECISION,
    geofence_radius_meters INTEGER NOT NULL DEFAULT 150,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_location_code_per_org UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.shift_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    grace_minutes INTEGER NOT NULL DEFAULT 15,
    half_day_minutes INTEGER NOT NULL DEFAULT 240,
    full_day_minutes INTEGER NOT NULL DEFAULT 480,
    break_duration_minutes INTEGER NOT NULL DEFAULT 60,
    crosses_midnight BOOLEAN NOT NULL DEFAULT FALSE,
    is_night_shift BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_shift_code_per_org UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.employee_shift_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    shift_template_id UUID NOT NULL REFERENCES public.shift_templates(id) ON DELETE RESTRICT,
    day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT exclude_overlapping_shifts EXCLUDE USING gist (
        employee_id WITH =,
        daterange(effective_from, coalesce(effective_to, '9999-12-31'::date), '[]') WITH &&
    )
);

CREATE TABLE IF NOT EXISTS public.kiosk_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    enrollment_token_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- Dedicated PIN credentials table with ZERO read grants to authenticated or public
CREATE TABLE IF NOT EXISTS public.kiosk_credentials (
    employee_id UUID PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- ============================================================================
-- SECTION 4: Operational Compliance & Resilience Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.privacy_acknowledgments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    policy_version TEXT NOT NULL,
    enabled_methods TEXT[] NOT NULL DEFAULT '{}',
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    ip_address TEXT,
    CONSTRAINT uq_privacy_ack UNIQUE (organization_id, employee_id, policy_version)
);

-- Background Cron Run State with surrogate key and sentinel NOT NULL location_id
CREATE TABLE IF NOT EXISTS public.cron_run_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name TEXT NOT NULL,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    target_date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    error_message TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_cron_run_state UNIQUE (job_name, organization_id, location_id, target_date)
);

-- ============================================================================
-- SECTION 5: Deterministic Tenant Backfill (organization_id NOT NULL)
-- ============================================================================

-- A. employees
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS primary_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS work_mode TEXT CHECK (work_mode IN ('remote', 'office', 'hybrid'));
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS expected_office_days INTEGER[] DEFAULT '{1, 3}';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS required_office_days_per_week INTEGER DEFAULT 2;

UPDATE public.employees 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.employees ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.employees ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS fk_employees_organization;
ALTER TABLE public.employees ADD CONSTRAINT fk_employees_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- B. attendance_policies
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS work_mode TEXT NOT NULL DEFAULT 'remote' CHECK (work_mode IN ('remote', 'office', 'hybrid'));
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS shift_start_time TIME NOT NULL DEFAULT '09:00:00';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS weekly_off_days INTEGER[] NOT NULL DEFAULT '{0, 6}';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS allowed_methods TEXT[] NOT NULL DEFAULT '{"web"}';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS leave_year_start_month INTEGER NOT NULL DEFAULT 1;

UPDATE public.attendance_policies 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.attendance_policies ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.attendance_policies ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.attendance_policies DROP CONSTRAINT IF EXISTS fk_policies_organization;
ALTER TABLE public.attendance_policies ADD CONSTRAINT fk_policies_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- C. attendance_sessions
ALTER TABLE public.attendance_sessions ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.attendance_sessions ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;

UPDATE public.attendance_sessions 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.attendance_sessions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.attendance_sessions ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.attendance_sessions DROP CONSTRAINT IF EXISTS fk_sessions_organization;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT fk_sessions_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.attendance_sessions DROP CONSTRAINT IF EXISTS attendance_sessions_source_check;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT attendance_sessions_source_check 
    CHECK (source IN ('web', 'office_ip', 'rotating_qr', 'geofence', 'kiosk', 'auto', 'manual'));

-- D. attendance_days
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shift_templates(id) ON DELETE SET NULL;
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS work_location TEXT CHECK (work_location IN ('office', 'remote'));
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER NOT NULL DEFAULT 0;

UPDATE public.attendance_days 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.attendance_days ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.attendance_days ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.attendance_days DROP CONSTRAINT IF EXISTS fk_days_organization;
ALTER TABLE public.attendance_days ADD CONSTRAINT fk_days_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- E. regularization_requests
ALTER TABLE public.regularization_requests ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.regularization_requests 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.regularization_requests ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.regularization_requests ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.regularization_requests DROP CONSTRAINT IF EXISTS fk_requests_organization;
ALTER TABLE public.regularization_requests ADD CONSTRAINT fk_requests_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- F. notifications
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.notifications 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.notifications ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.notifications ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS fk_notifications_organization;
ALTER TABLE public.notifications ADD CONSTRAINT fk_notifications_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- G. holidays
ALTER TABLE public.holidays ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.holidays 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.holidays ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.holidays ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.holidays DROP CONSTRAINT IF EXISTS fk_holidays_organization;
ALTER TABLE public.holidays ADD CONSTRAINT fk_holidays_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- H. audit_logs
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.audit_logs 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.audit_logs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.audit_logs ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS fk_audit_organization;
ALTER TABLE public.audit_logs ADD CONSTRAINT fk_audit_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- ============================================================================
-- SECTION 6: User Roles Migration & Deprecation (Explicit drops without CASCADE)
-- ============================================================================

-- Step 1: Copy existing roles into organization_members
INSERT INTO public.organization_members (user_id, organization_id, role, created_at)
SELECT user_id, '00000000-0000-0000-0000-000000000001'::uuid, role, created_at
FROM public.user_roles
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

-- Step 2: Explicitly drop dependent policies on user_roles
DROP POLICY IF EXISTS "user_roles_select_policy" ON public.user_roles;
DROP POLICY IF EXISTS "enforce_mfa_aal2_user_roles" ON public.user_roles;

-- Step 3: Tenant Context Helpers
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT om.organization_id
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = (SELECT auth.uid())
      AND om.status = 'active'
      AND o.status IN ('active', 'trial')
      AND (
          NULLIF((auth.jwt())->>'organization_id', '') IS NULL
          OR om.organization_id = NULLIF((auth.jwt())->>'organization_id', '')::uuid
      )
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.current_org_id();
$$;

CREATE OR REPLACE FUNCTION public.is_active_org_member()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = (SELECT auth.uid())
          AND om.organization_id = public.current_org_id()
          AND om.status = 'active'
          AND o.status IN ('active', 'trial')
    );
$$;

-- Step 4: Update role-checking functions (NO default 'employee' for users without membership)
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT role INTO v_role
    FROM public.organization_members
    WHERE user_id = p_user_id
    LIMIT 1;

    RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT role 
    FROM public.organization_members 
    WHERE user_id = (SELECT auth.uid()) 
      AND organization_id = public.current_org_id() 
      AND status = 'active'
    LIMIT 1;
$$;

-- Step 4: Safely drop table public.user_roles WITHOUT CASCADE
DROP TABLE public.user_roles;

-- Step 5: Recreate user_roles as a strictly read-only compatibility view with security_invoker = true
CREATE VIEW public.user_roles WITH (security_invoker = true) AS
    SELECT user_id, role, created_at FROM public.organization_members;

REVOKE ALL ON public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated, service_role;

-- ============================================================================
-- SECTION 7: Automatic organization_id Derivation Triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_derive_session_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        SELECT organization_id INTO NEW.organization_id
        FROM public.employees
        WHERE id = NEW.employee_id;
        IF NEW.organization_id IS NULL THEN
            NEW.organization_id := '00000000-0000-0000-0000-000000000001'::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_session_org_id_before_insert ON public.attendance_sessions;
CREATE TRIGGER set_session_org_id_before_insert
BEFORE INSERT ON public.attendance_sessions
FOR EACH ROW EXECUTE FUNCTION public.trg_derive_session_org_id();

CREATE OR REPLACE FUNCTION public.trg_derive_day_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        SELECT organization_id INTO NEW.organization_id
        FROM public.employees
        WHERE id = NEW.employee_id;
        IF NEW.organization_id IS NULL THEN
            NEW.organization_id := '00000000-0000-0000-0000-000000000001'::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_day_org_id_before_insert ON public.attendance_days;
CREATE TRIGGER set_day_org_id_before_insert
BEFORE INSERT ON public.attendance_days
FOR EACH ROW EXECUTE FUNCTION public.trg_derive_day_org_id();

CREATE OR REPLACE FUNCTION public.trg_derive_request_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        SELECT organization_id INTO NEW.organization_id
        FROM public.employees
        WHERE id = NEW.employee_id;
        IF NEW.organization_id IS NULL THEN
            NEW.organization_id := '00000000-0000-0000-0000-000000000001'::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_request_org_id_before_insert ON public.regularization_requests;
CREATE TRIGGER set_request_org_id_before_insert
BEFORE INSERT ON public.regularization_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_derive_request_org_id();

CREATE OR REPLACE FUNCTION public.trg_derive_notification_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        SELECT organization_id INTO NEW.organization_id
        FROM public.employees
        WHERE id = NEW.user_id;
        IF NEW.organization_id IS NULL THEN
            NEW.organization_id := '00000000-0000-0000-0000-000000000001'::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_notification_org_id_before_insert ON public.notifications;
CREATE TRIGGER set_notification_org_id_before_insert
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.trg_derive_notification_org_id();

CREATE OR REPLACE FUNCTION public.trg_derive_audit_log_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        IF NEW.actor_id IS NOT NULL THEN
            SELECT organization_id INTO NEW.organization_id
            FROM public.employees
            WHERE id = NEW.actor_id;
        END IF;

        IF NEW.organization_id IS NULL THEN
            NEW.organization_id := '00000000-0000-0000-0000-000000000001'::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_audit_log_org_id_before_insert ON public.audit_logs;
CREATE TRIGGER set_audit_log_org_id_before_insert
BEFORE INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_derive_audit_log_org_id();

REVOKE ALL ON FUNCTION public.trg_derive_session_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_derive_day_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_derive_request_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_derive_notification_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_derive_audit_log_org_id() FROM PUBLIC, anon;

-- ============================================================================
-- SECTION 8: custom_access_token_hook
-- ============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_claims JSONB;
    v_user_id UUID;
    v_org_id UUID;
    v_user_role TEXT;
    v_org_status TEXT;
BEGIN
    v_user_id := (event->>'user_id')::uuid;
    v_claims := event->'claims';

    -- Fetch primary organization membership and status
    SELECT om.organization_id, om.role, o.status
    INTO v_org_id, v_user_role, v_org_status
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = v_user_id
    LIMIT 1;

    -- Strictly refuse tokens ONLY if organization is suspended or cancelled
    IF v_org_status IN ('suspended', 'cancelled') THEN
        RAISE EXCEPTION 'Organization account is %: access denied.', v_org_status;
    END IF;

    -- If no membership row found: permit login, NO user_role, NO organization_id claim
    IF v_org_id IS NULL THEN
        v_claims := v_claims - 'user_role' - 'organization_id' - 'organization_status';
    ELSE
        -- Inject role, organization_id, and organization_status (active or trial)
        v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_user_role));
        v_claims := jsonb_set(v_claims, '{organization_id}', to_jsonb(v_org_id::text));
        v_claims := jsonb_set(v_claims, '{organization_status}', to_jsonb(v_org_status));
    END IF;

    event := jsonb_set(event, '{claims}', v_claims);
    RETURN event;
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(JSONB) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.custom_access_token_hook(JSONB) TO service_role;
GRANT ALL ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;

-- ============================================================================
-- SECTION 9: Scoped Core Attendance RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recalculate_day(
    p_employee_id UUID,
    p_work_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total_minutes INTEGER := 0;
    v_sessions_count INTEGER := 0;
    v_first_in TIMESTAMPTZ;
    v_last_out TIMESTAMPTZ;
    v_open_sessions INTEGER := 0;
    v_status TEXT := 'absent';
    v_is_late BOOLEAN := FALSE;
    v_overtime_minutes INTEGER := 0;
    v_work_location TEXT := 'remote';
    v_policy RECORD;
    v_is_holiday BOOLEAN := FALSE;
    v_day_of_week INTEGER;
    v_is_weekend BOOLEAN := FALSE;
    v_target_minutes INTEGER := 480;
    v_org_id UUID;
    v_work_mode TEXT;
    v_emp_tz TEXT;
    v_loc_tz TEXT;
    v_org_tz TEXT;
    v_effective_tz TEXT;
BEGIN
    SELECT 
        e.organization_id,
        COALESCE(e.work_mode, o.work_mode, 'remote'),
        e.timezone,
        l.timezone,
        COALESCE(o.timezone, 'UTC'),
        COALESCE(e.work_target_minutes, 480)
    INTO 
        v_org_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_target_minutes
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.locations l ON l.id = e.primary_location_id
    WHERE e.id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id 
          AND (check_in_at AT TIME ZONE COALESCE(v_emp_tz, v_org_tz, 'UTC'))::date = p_work_date
          AND (location_id IS NOT NULL OR source IN ('office_ip', 'rotating_qr', 'kiosk'))
    ) THEN
        v_work_location := 'office';
    ELSE
        v_work_location := 'remote';
    END IF;

    v_effective_tz := CASE 
        WHEN v_work_mode = 'remote' THEN COALESCE(v_emp_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'hybrid' THEN 
            CASE 
                WHEN v_work_location = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
                ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
            END
        ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
    END;

    SELECT * INTO v_policy 
    FROM public.attendance_policies 
    WHERE organization_id = v_org_id
    LIMIT 1;

    SELECT 
        COALESCE(SUM(
            CASE 
                WHEN check_out_at IS NOT NULL 
                THEN EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60
                ELSE EXTRACT(EPOCH FROM (pg_catalog.now() - check_in_at)) / 60
            END
        ), 0)::INTEGER,
        COUNT(*),
        MIN(check_in_at),
        MAX(check_out_at),
        COUNT(*) FILTER (WHERE check_out_at IS NULL)
    INTO 
        v_total_minutes,
        v_sessions_count,
        v_first_in,
        v_last_out,
        v_open_sessions
    FROM public.attendance_sessions
    WHERE employee_id = p_employee_id 
      AND (check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date;

    SELECT EXISTS (
        SELECT 1 FROM public.holidays 
        WHERE organization_id = v_org_id AND date = p_work_date
    ) INTO v_is_holiday;

    v_day_of_week := EXTRACT(DOW FROM p_work_date)::INTEGER;
    v_is_weekend := v_day_of_week IN (0, 6);

    IF v_first_in IS NOT NULL THEN
        DECLARE
            v_expected_start TIME := '09:00:00'::time;
            v_grace INTEGER := COALESCE(v_policy.grace_minutes, 15);
            v_actual_time TIME := (v_first_in AT TIME ZONE v_effective_tz)::time;
        BEGIN
            IF v_actual_time > (v_expected_start + (v_grace || ' minutes')::interval) THEN
                v_is_late := TRUE;
            END IF;
        END;
    END IF;

    IF v_is_holiday THEN
        v_status := 'holiday';
    ELSIF v_is_weekend THEN
        v_status := 'weekend';
    ELSIF v_sessions_count = 0 THEN
        v_status := 'absent';
    ELSIF v_total_minutes >= COALESCE(v_policy.half_day_minutes, 240) AND v_total_minutes < v_target_minutes THEN
        v_status := 'half_day';
    ELSIF v_total_minutes >= v_target_minutes THEN
        v_status := 'present';
        v_overtime_minutes := GREATEST(0, v_total_minutes - v_target_minutes);
    ELSE
        v_status := 'half_day';
    END IF;

    INSERT INTO public.attendance_days (
        organization_id,
        employee_id,
        work_date,
        total_minutes,
        overtime_minutes,
        status,
        is_late,
        locked,
        updated_at
    ) VALUES (
        v_org_id,
        p_employee_id,
        p_work_date,
        v_total_minutes,
        v_overtime_minutes,
        v_status,
        v_is_late,
        FALSE,
        pg_catalog.now()
    )
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        total_minutes = EXCLUDED.total_minutes,
        overtime_minutes = EXCLUDED.overtime_minutes,
        status = EXCLUDED.status,
        is_late = EXCLUDED.is_late,
        updated_at = EXCLUDED.updated_at;

    RETURN;
END;
$$;

-- check_in (Self)
CREATE OR REPLACE FUNCTION public.check_in(
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_employee_id UUID;
    v_org_id UUID;
    v_allowed_methods TEXT[];
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
BEGIN
    v_employee_id := (SELECT auth.uid());
    IF v_employee_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated');
    END IF;

    SELECT e.organization_id, COALESCE(p.allowed_methods, '{"web"}'), COALESCE(e.timezone, o.timezone, 'UTC')
    INTO v_org_id, v_allowed_methods, v_effective_tz
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.attendance_policies p ON p.organization_id = e.organization_id
    WHERE e.id = v_employee_id;

    IF v_org_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee record not found');
    END IF;

    IF NOT ('web' = ANY(v_allowed_methods)) THEN
        RAISE EXCEPTION 'Direct web check-in is disabled for this organization. Physical verification required.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions 
        WHERE employee_id = v_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'You already have an active open session');
    END IF;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    INSERT INTO public.attendance_sessions (
        organization_id,
        employee_id,
        work_date,
        check_in_at,
        source,
        note
    ) VALUES (
        v_org_id,
        v_employee_id,
        v_work_date,
        pg_catalog.now(),
        'web',
        p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(v_employee_id, v_work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_org_id,
        v_employee_id,
        'CHECK_IN',
        'attendance_sessions',
        v_session_id,
        jsonb_build_object('source', 'web', 'note', p_note)
    );

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

-- check_in (Administrative Override)
CREATE OR REPLACE FUNCTION public.check_in(
    p_employee_id UUID,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_target_org UUID;
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated');
    END IF;

    IF v_caller_id != p_employee_id THEN
        v_caller_role := public.current_user_role();
        IF v_caller_role NOT IN ('hr', 'admin') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized check-in attempt for another employee.');
        END IF;

        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal != 'aal2' THEN
            RETURN jsonb_build_object('success', false, 'error', 'MFA AAL2 verification required for administrative check-in override.');
        END IF;

        v_caller_org := public.current_org_id();
        SELECT organization_id INTO v_target_org FROM public.employees WHERE id = p_employee_id;

        IF v_target_org IS NULL OR v_caller_org != v_target_org THEN
            RETURN jsonb_build_object('success', false, 'error', 'Target employee not found in your organization.');
        END IF;
    END IF;

    SELECT organization_id, timezone INTO v_target_org, v_effective_tz
    FROM public.employees WHERE id = p_employee_id;

    IF v_target_org IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Target employee not found');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions 
        WHERE employee_id = p_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee already has an active open session');
    END IF;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, source, note
    ) VALUES (
        v_target_org, p_employee_id, v_work_date, pg_catalog.now(), 'manual', p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(p_employee_id, v_work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_target_org, v_caller_id, 'CHECK_IN_OVERRIDE', 'attendance_sessions', v_session_id,
        jsonb_build_object('employee_id', p_employee_id, 'source', 'manual', 'note', p_note)
    );

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

-- check_out
CREATE OR REPLACE FUNCTION public.check_out()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_employee_id UUID;
    v_session_id UUID;
    v_check_in_at TIMESTAMPTZ;
    v_org_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
BEGIN
    v_employee_id := (SELECT auth.uid());
    IF v_employee_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated');
    END IF;

    SELECT id, check_in_at, organization_id INTO v_session_id, v_check_in_at, v_org_id
    FROM public.attendance_sessions
    WHERE employee_id = v_employee_id AND check_out_at IS NULL
    ORDER BY check_in_at DESC
    LIMIT 1;

    IF v_session_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active session found to check out');
    END IF;

    UPDATE public.attendance_sessions
    SET check_out_at = pg_catalog.now()
    WHERE id = v_session_id;

    SELECT timezone INTO v_effective_tz FROM public.employees WHERE id = v_employee_id;
    v_work_date := (v_check_in_at AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    PERFORM public.recalculate_day(v_employee_id, v_work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id)
    VALUES (v_org_id, v_employee_id, 'CHECK_OUT', 'attendance_sessions', v_session_id);

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

-- lock_month
CREATE OR REPLACE FUNCTION public.lock_month(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_role TEXT;
    v_caller_id UUID;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_user_role := public.current_user_role();
    IF v_user_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can lock attendance months.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to lock attendance months.';
    END IF;

    v_org_id := public.current_org_id();

    UPDATE public.attendance_days
    SET locked = TRUE,
        updated_at = pg_catalog.now()
    WHERE organization_id = v_org_id
      AND EXTRACT(YEAR FROM work_date) = p_year
      AND EXTRACT(MONTH FROM work_date) = p_month;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_org_id,
        v_caller_id,
        'LOCK_MONTH',
        'attendance_days',
        gen_random_uuid(),
        jsonb_build_object('year', p_year, 'month', p_month, 'records_locked', v_count)
    );

    RETURN jsonb_build_object('success', true, 'records_locked', v_count);
END;
$$;

-- unlock_month
CREATE OR REPLACE FUNCTION public.unlock_month(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_role TEXT;
    v_caller_id UUID;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_user_role := public.current_user_role();
    IF v_user_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only Administrators can unlock attendance months.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to unlock attendance months.';
    END IF;

    v_org_id := public.current_org_id();

    UPDATE public.attendance_days
    SET locked = FALSE,
        updated_at = pg_catalog.now()
    WHERE organization_id = v_org_id
      AND EXTRACT(YEAR FROM work_date) = p_year
      AND EXTRACT(MONTH FROM work_date) = p_month;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_org_id,
        v_caller_id,
        'UNLOCK_MONTH',
        'attendance_days',
        gen_random_uuid(),
        jsonb_build_object('year', p_year, 'month', p_month, 'records_unlocked', v_count)
    );

    RETURN jsonb_build_object('success', true, 'records_unlocked', v_count);
END;
$$;

-- approve_regularization
CREATE OR REPLACE FUNCTION public.approve_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_req 
    FROM public.regularization_requests 
    WHERE id = p_request_id;

    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request not found');
    END IF;

    -- Strict Tenant isolation check
    v_caller_org := public.current_org_id();
    IF v_req.organization_id != v_caller_org THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request does not belong to your organization');
    END IF;

    IF v_req.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request is not pending');
    END IF;

    -- Separation of duties: No self-approval by HR or anyone
    IF v_caller_id = v_req.employee_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot approve your own regularization request.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal != 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative regularization approval.';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_req.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to approve requests for this employee.';
    END IF;

    UPDATE public.regularization_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, check_out_at, source, note
    ) VALUES (
        v_req.organization_id, v_req.employee_id, v_req.work_date, v_req.requested_in, v_req.requested_out, 'manual',
        'Regularized: ' || COALESCE(v_req.reason, '')
    );

    PERFORM public.recalculate_day(v_req.employee_id, v_req.work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_req.organization_id, v_caller_id, 'APPROVE_REGULARIZATION', 'regularization_requests', p_request_id,
        jsonb_build_object('employee_id', v_req.employee_id, 'work_date', v_req.work_date)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

-- reject_regularization
CREATE OR REPLACE FUNCTION public.reject_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_req 
    FROM public.regularization_requests 
    WHERE id = p_request_id;

    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request not found');
    END IF;

    -- Strict Tenant isolation check
    v_caller_org := public.current_org_id();
    IF v_req.organization_id != v_caller_org THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request does not belong to your organization');
    END IF;

    IF v_req.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request is not pending');
    END IF;

    -- Separation of duties: No self-rejection
    IF v_caller_id = v_req.employee_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot reject your own regularization request.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal != 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative regularization review.';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_req.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to review requests for this employee.';
    END IF;

    UPDATE public.regularization_requests
    SET status = 'rejected',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id)
    VALUES (v_req.organization_id, v_caller_id, 'REJECT_REGULARIZATION', 'regularization_requests', p_request_id);

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Multi-Tenant Background Cron Functions
CREATE OR REPLACE FUNCTION public.cron_auto_checkout()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_session RECORD;
    v_closed_count INTEGER := 0;
    v_error_count INTEGER := 0;
BEGIN
    FOR v_session IN 
        SELECT s.id, s.employee_id, s.check_in_at, s.organization_id, e.timezone
        FROM public.attendance_sessions s
        JOIN public.employees e ON e.id = s.employee_id
        WHERE s.check_out_at IS NULL
          AND s.check_in_at < (pg_catalog.now() - INTERVAL '12 hours')
    LOOP
        BEGIN
            UPDATE public.attendance_sessions
            SET check_out_at = pg_catalog.now(),
                source = 'auto',
                note = COALESCE(note, '') || ' [Auto-closed by nightly cron]'
            WHERE id = v_session.id;

            PERFORM public.recalculate_day(
                v_session.employee_id,
                (v_session.check_in_at AT TIME ZONE COALESCE(v_session.timezone, 'UTC'))::date
            );

            v_closed_count := v_closed_count + 1;
        EXCEPTION WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
        END;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

-- ============================================================================
-- SECTION 10: Service-Role Verified Punch RPC (punch_verified)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.punch_verified(
    p_employee_id UUID,
    p_source TEXT,
    p_location_id UUID DEFAULT NULL,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
    v_emp_status TEXT;
    v_org_status TEXT;
    v_loc_org_id UUID;
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
    v_emp_tz TEXT;
    v_loc_tz TEXT;
    v_org_tz TEXT;
    v_work_mode TEXT;
BEGIN
    IF p_source NOT IN ('office_ip', 'rotating_qr', 'geofence', 'kiosk') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid verified source type');
    END IF;

    SELECT 
        e.organization_id,
        COALESCE(e.work_mode, o.work_mode, 'remote'),
        e.timezone,
        l.timezone,
        COALESCE(o.timezone, 'UTC'),
        e.status,
        o.status,
        l.organization_id
    INTO 
        v_org_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_emp_status, v_org_status, v_loc_org_id
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.locations l ON l.id = p_location_id
    WHERE e.id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee or Organization not found');
    END IF;

    IF COALESCE(v_emp_status, 'active') != 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee is inactive');
    END IF;

    IF v_org_status NOT IN ('active', 'trial') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Organization is not active');
    END IF;

    IF p_location_id IS NOT NULL AND (v_loc_org_id IS NULL OR v_loc_org_id != v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Location does not belong to employee organization');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee already has an active open session');
    END IF;

    v_effective_tz := CASE 
        WHEN v_work_mode = 'remote' THEN COALESCE(v_emp_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'hybrid' THEN 
            CASE 
                WHEN p_location_id IS NOT NULL OR p_source IN ('office_ip', 'rotating_qr', 'kiosk')
                THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
                ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
            END
        ELSE COALESCE(v_emp_tz, v_loc_tz, v_org_tz, 'UTC')
    END;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    INSERT INTO public.attendance_sessions (
        organization_id,
        employee_id,
        location_id,
        work_date,
        check_in_at,
        source,
        note
    ) VALUES (
        v_org_id,
        p_employee_id,
        p_location_id,
        v_work_date,
        pg_catalog.now(),
        p_source,
        p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(p_employee_id, v_work_date);

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, new_data
    ) VALUES (
        v_org_id,
        p_employee_id,
        'VERIFIED_PUNCH',
        'attendance_sessions',
        v_session_id,
        jsonb_build_object('source', p_source, 'location_id', p_location_id, 'note', p_note)
    );

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id, 'work_date', v_work_date);
END;
$$;

REVOKE ALL ON FUNCTION public.punch_verified(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.punch_verified(UUID, TEXT, UUID, TEXT) TO service_role;

-- ============================================================================
-- SECTION 11: Member Administration & Employee Governance RPCs with Last-Admin Advisory Lock
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_add_org_member(
    p_organization_id UUID,
    p_user_id UUID,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_aal TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Derive caller's organization strictly from caller's active admin membership
    SELECT organization_id INTO v_caller_org
    FROM public.organization_members
    WHERE user_id = v_caller_id AND role = 'admin' AND status = 'active'
    LIMIT 1;

    IF v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can add organization members.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.';
    END IF;

    -- Reject any mismatch with caller's own organization
    IF p_organization_id IS NOT NULL AND p_organization_id != v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    IF p_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role;
    END IF;

    -- Transaction-level advisory lock serializes member mutations
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    -- Re-verify caller's active admin role after acquiring advisory lock
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (v_caller_org, p_user_id, p_role, 'active')
    ON CONFLICT (user_id) DO UPDATE 
    SET organization_id = v_caller_org, role = p_role, status = 'active', updated_at = pg_catalog.now();

    -- Audit log entry
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_caller_org,
        v_caller_id,
        'MEMBER_ADDED',
        'organization_members',
        p_user_id,
        jsonb_build_object('user_id', p_user_id, 'role', p_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_org_member_role(
    p_organization_id UUID,
    p_user_id UUID,
    p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_aal TEXT;
    v_current_role TEXT;
    v_admin_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Derive caller's organization strictly from caller's active admin membership
    SELECT organization_id INTO v_caller_org
    FROM public.organization_members
    WHERE user_id = v_caller_id AND role = 'admin' AND status = 'active'
    LIMIT 1;

    IF v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can update member roles.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.';
    END IF;

    -- Reject any mismatch with caller's own organization
    IF p_organization_id IS NOT NULL AND p_organization_id != v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    IF p_new_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_new_role;
    END IF;

    -- Per-org advisory lock serializes concurrent role modifications
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    -- Re-verify caller's active admin role after acquiring advisory lock
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT role INTO v_current_role
    FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id AND status = 'active';

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'Member not found in organization.';
    END IF;

    -- Last-admin protection & self-demotion rule
    IF v_current_role = 'admin' AND p_new_role != 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            IF v_caller_id = p_user_id THEN
                RAISE EXCEPTION 'Last admin protection: Cannot demote yourself as the last active administrator.';
            ELSE
                RAISE EXCEPTION 'Last admin protection: Cannot demote the last active administrator of the organization.';
            END IF;
        END IF;
    END IF;

    UPDATE public.organization_members
    SET role = p_new_role, updated_at = pg_catalog.now()
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    -- Audit log entry
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_caller_org,
        v_caller_id,
        'MEMBER_ROLE_UPDATED',
        'organization_members',
        p_user_id,
        jsonb_build_object('user_id', p_user_id, 'old_role', v_current_role, 'new_role', p_new_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_org_member(
    p_organization_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_aal TEXT;
    v_current_role TEXT;
    v_admin_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Derive caller's organization strictly from caller's active admin membership
    SELECT organization_id INTO v_caller_org
    FROM public.organization_members
    WHERE user_id = v_caller_id AND role = 'admin' AND status = 'active'
    LIMIT 1;

    IF v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can remove organization members.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.';
    END IF;

    -- Reject any mismatch with caller's own organization
    IF p_organization_id IS NOT NULL AND p_organization_id != v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    -- Per-org advisory lock serializes concurrent member removals
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    -- Re-verify caller's active admin role after acquiring advisory lock
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT role INTO v_current_role
    FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'Member not found in organization.';
    END IF;

    -- Last admin protection & self-removal check
    IF v_current_role = 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            IF v_caller_id = p_user_id THEN
                RAISE EXCEPTION 'Last admin protection: Cannot remove yourself as the last active administrator.';
            ELSE
                RAISE EXCEPTION 'Last admin protection: Cannot remove the last active administrator of the organization.';
            END IF;
        END IF;
    END IF;

    DELETE FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    -- Audit log entry
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_caller_org,
        v_caller_id,
        'MEMBER_REMOVED',
        'organization_members',
        p_user_id,
        jsonb_build_object('user_id', p_user_id, 'removed_role', v_current_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Privileged HR/Admin RPC for creating employee records
CREATE OR REPLACE FUNCTION public.admin_create_employee(
    p_user_id UUID,
    p_email TEXT,
    p_full_name TEXT DEFAULT 'New Employee',
    p_role TEXT DEFAULT 'employee',
    p_manager_id UUID DEFAULT NULL,
    p_work_mode TEXT DEFAULT 'remote',
    p_primary_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_org UUID;
    v_caller_aal TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and administrators can create employees.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to create employees.';
    END IF;

    v_caller_org := public.current_org_id();

    -- Add membership
    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (v_caller_org, p_user_id, p_role, 'active')
    ON CONFLICT (user_id) DO UPDATE SET organization_id = v_caller_org, role = p_role, status = 'active';

    -- Add employee profile
    INSERT INTO public.employees (
        id, organization_id, email,
        full_name, manager_id, work_mode, primary_location_id, status
    ) VALUES (
        p_user_id, v_caller_org, p_email,
        COALESCE(p_full_name, 'New Employee'),
        p_manager_id, p_work_mode, p_primary_location_id, 'active'
    )
    ON CONFLICT (id) DO UPDATE SET organization_id = v_caller_org, work_mode = p_work_mode;

    -- Audit log entry
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (v_caller_org, v_caller_id, 'EMPLOYEE_CREATED', 'employees', p_user_id, jsonb_build_object('email', p_email, 'role', p_role));

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Privileged HR/Admin RPC for updating employee governance attributes
CREATE OR REPLACE FUNCTION public.admin_update_employee(
    p_employee_id UUID,
    p_manager_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_work_mode TEXT DEFAULT NULL,
    p_primary_location_id UUID DEFAULT NULL,
    p_work_target_minutes INTEGER DEFAULT NULL,
    p_expected_office_days INTEGER[] DEFAULT NULL,
    p_required_office_days_per_week INTEGER DEFAULT NULL,
    p_timezone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_org UUID;
    v_caller_aal TEXT;
    v_emp RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Authoritative role check from organization_members
    v_caller_role := public.current_user_role();
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and administrators can update employee governance attributes.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for employee administrative updates.';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT * INTO v_emp
    FROM public.employees
    WHERE id = p_employee_id;

    IF v_emp.id IS NULL THEN
        RAISE EXCEPTION 'Employee not found.';
    END IF;

    IF v_emp.organization_id != v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Target employee belongs to another organization.';
    END IF;

    -- Verify location belongs to same org if updating
    IF p_primary_location_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.locations 
            WHERE id = p_primary_location_id AND organization_id = v_caller_org
        ) THEN
            RAISE EXCEPTION 'Invalid primary_location_id: Location does not belong to this organization.';
        END IF;
    END IF;

    -- Verify manager belongs to same org if updating
    IF p_manager_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.employees 
            WHERE id = p_manager_id AND organization_id = v_caller_org
        ) THEN
            RAISE EXCEPTION 'Invalid manager_id: Manager does not belong to this organization.';
        END IF;
    END IF;

    -- Apply updates
    UPDATE public.employees
    SET 
        manager_id = COALESCE(p_manager_id, manager_id),
        status = COALESCE(p_status, status),
        work_mode = COALESCE(p_work_mode, work_mode),
        primary_location_id = COALESCE(p_primary_location_id, primary_location_id),
        work_target_minutes = COALESCE(p_work_target_minutes, work_target_minutes),
        expected_office_days = COALESCE(p_expected_office_days, expected_office_days),
        required_office_days_per_week = COALESCE(p_required_office_days_per_week, required_office_days_per_week),
        timezone = COALESCE(p_timezone, timezone),
        updated_at = pg_catalog.now()
    WHERE id = p_employee_id;

    -- Audit log entry
    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, new_data
    ) VALUES (
        v_caller_org,
        v_caller_id,
        'EMPLOYEE_UPDATED',
        'employees',
        p_employee_id,
        jsonb_build_object(
            'manager_id', p_manager_id,
            'status', p_status,
            'work_mode', p_work_mode,
            'primary_location_id', p_primary_location_id,
            'work_target_minutes', p_work_target_minutes,
            'expected_office_days', p_expected_office_days,
            'required_office_days_per_week', p_required_office_days_per_week,
            'timezone', p_timezone
        )
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_org_member(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.admin_add_org_member(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_update_org_member_role(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.admin_update_org_member_role(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_remove_org_member(UUID, UUID) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.admin_remove_org_member(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_create_employee(UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.admin_create_employee(UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_update_employee(UUID, UUID, TEXT, TEXT, UUID, INTEGER, INTEGER[], INTEGER, TEXT) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.admin_update_employee(UUID, UUID, TEXT, TEXT, UUID, INTEGER, INTEGER[], INTEGER, TEXT) TO authenticated, service_role;

-- ============================================================================
-- SECTION 12: Defense-in-Depth Triggers (Field Protection & IP Range Gate)
-- ============================================================================

-- Protect employee governance fields against direct API tampering
CREATE OR REPLACE FUNCTION public.trg_protect_employee_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF NEW.organization_id != OLD.organization_id THEN
        RAISE EXCEPTION 'organization_id cannot be changed.';
    END IF;

    v_role := public.current_user_role();
    IF v_role NOT IN ('hr', 'admin') THEN
        IF NEW.manager_id IS DISTINCT FROM OLD.manager_id OR
           NEW.status IS DISTINCT FROM OLD.status OR
           NEW.work_mode IS DISTINCT FROM OLD.work_mode OR
           NEW.primary_location_id IS DISTINCT FROM OLD.primary_location_id OR
           NEW.work_target_minutes IS DISTINCT FROM OLD.work_target_minutes OR
           NEW.expected_office_days IS DISTINCT FROM OLD.expected_office_days OR
           NEW.required_office_days_per_week IS DISTINCT FROM OLD.required_office_days_per_week OR
           NEW.timezone IS DISTINCT FROM OLD.timezone THEN
            RAISE EXCEPTION 'Permission denied: Employees cannot modify administrative attributes.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_employee_fields_before_update ON public.employees;
CREATE TRIGGER protect_employee_fields_before_update
BEFORE UPDATE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.trg_protect_employee_fields();

REVOKE ALL ON FUNCTION public.trg_protect_employee_fields() FROM PUBLIC, anon;

-- Protect location allowed_ip_ranges on both INSERT and UPDATE (Admin-only modification)
CREATE OR REPLACE FUNCTION public.trg_protect_location_ip_ranges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.allowed_ip_ranges IS NOT NULL AND NEW.allowed_ip_ranges != '{}'::text[] THEN
            IF public.current_user_role() != 'admin' THEN
                RAISE EXCEPTION 'Permission denied: Only administrators can specify allowed_ip_ranges.';
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.allowed_ip_ranges IS DISTINCT FROM OLD.allowed_ip_ranges THEN
            IF public.current_user_role() != 'admin' THEN
                RAISE EXCEPTION 'Permission denied: Only administrators can modify allowed_ip_ranges.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_location_ip_ranges_before_update ON public.locations;
DROP TRIGGER IF EXISTS protect_location_ip_ranges_before_write ON public.locations;
CREATE TRIGGER protect_location_ip_ranges_before_write
BEFORE INSERT OR UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.trg_protect_location_ip_ranges();

REVOKE ALL ON FUNCTION public.trg_protect_location_ip_ranges() FROM PUBLIC, anon;

-- Enforce server timestamp and self-identity on privacy acknowledgments
CREATE OR REPLACE FUNCTION public.trg_set_privacy_acknowledgment_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.acknowledged_at := pg_catalog.now();
    NEW.policy_version := COALESCE(NEW.policy_version, 'v1.0');
    IF NEW.employee_id != (SELECT auth.uid()) AND public.current_user_role() NOT IN ('service_role') THEN
        RAISE EXCEPTION 'Cannot acknowledge privacy for another employee.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_privacy_acknowledgment_defaults ON public.privacy_acknowledgments;
CREATE TRIGGER set_privacy_acknowledgment_defaults
BEFORE INSERT ON public.privacy_acknowledgments
FOR EACH ROW EXECUTE FUNCTION public.trg_set_privacy_acknowledgment_defaults();

REVOKE ALL ON FUNCTION public.trg_set_privacy_acknowledgment_defaults() FROM PUBLIC, anon;

-- ============================================================================
-- SECTION 13: Strict Privilege Hardening (Revokes & Column-Level Grants)
-- ============================================================================

-- 0. Revoke default privileges in schema public for future objects created by migration owner
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 1. Revoke default permissive table grants from anon and authenticated across ALL public tables
REVOKE ALL ON public.organizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.organization_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.locations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.shift_templates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.employee_shift_assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.kiosk_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.kiosk_credentials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.privacy_acknowledgments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cron_run_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.employees FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.attendance_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.attendance_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.attendance_days FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.regularization_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.holidays FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.audit_logs FROM PUBLIC, anon, authenticated;

-- Service role retains full administrative privileges
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- 2. Strictly grant ONLY authorized operations to authenticated:

-- organizations: SELECT by members, UPDATE limited columns by admin, NO DELETE via API
GRANT SELECT ON public.organizations TO authenticated;
GRANT UPDATE (name, domain, work_mode, timezone) ON public.organizations TO authenticated;

-- organization_members: writes strictly through admin RPCs with advisory lock
GRANT SELECT ON public.organization_members TO authenticated;

-- locations: SELECT, INSERT, UPDATE, DELETE (IP ranges protected by trigger)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;

-- shift_templates & shift_assignments
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_shift_assignments TO authenticated;

-- kiosk_devices: Admin-only management, enrollment_token_hash HIDDEN from SELECT for non-admins
GRANT SELECT (id, organization_id, location_id, device_name, is_active, created_at) ON public.kiosk_devices TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.kiosk_devices TO authenticated;

-- privacy_acknowledgments: self INSERT only, immutable append-only
GRANT SELECT, INSERT ON public.privacy_acknowledgments TO authenticated;

-- attendance_sessions & attendance_days: WRITES ONLY THROUGH RPCs
GRANT SELECT ON public.attendance_sessions TO authenticated;
GRANT SELECT ON public.attendance_days TO authenticated;

-- regularization_requests: Self INSERT, SELECT, decisions strictly through RPCs
GRANT SELECT, INSERT ON public.regularization_requests TO authenticated;

-- notifications: SELECT own, UPDATE read_at only
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

-- holidays
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;

-- attendance_policies
GRANT SELECT, UPDATE ON public.attendance_policies TO authenticated;

-- audit_logs: Read-only for HR/Admin
GRANT SELECT ON public.audit_logs TO authenticated;

-- employees: authenticated has SELECT only at table level, and UPDATE only on non-administrative self-service attributes
GRANT SELECT ON public.employees TO authenticated;
GRANT UPDATE (full_name, avatar_url) ON public.employees TO authenticated;

-- 3. Routine privileges: Revoke all from PUBLIC and anon, grant ONLY required RPCs to authenticated
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

GRANT EXECUTE ON FUNCTION public.check_in(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_in(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_out() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_regularization(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_regularization(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_month(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_month(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_org_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_org_member(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_org_member_role(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_org_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_employee(UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_employee(UUID, UUID, TEXT, TEXT, UUID, INTEGER, INTEGER[], INTEGER, TEXT) TO authenticated;

-- custom_access_token_hook is called by supabase_auth_admin and service_role
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin, service_role;

-- 4. Sequences: Revoke all from PUBLIC and anon
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;


-- ============================================================================
-- SECTION 14: Per-Command Role-Gated, Subquery-Optimized & Active Membership RLS Policies
-- ============================================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_run_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regularization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. organizations
CREATE POLICY "tenant_organizations_select_policy" ON public.organizations
FOR SELECT TO authenticated
USING (id = (SELECT public.current_org_id()));

CREATE POLICY "tenant_organizations_update_policy" ON public.organizations
FOR UPDATE TO authenticated
USING (id = (SELECT public.current_org_id()) AND (SELECT public.current_user_role()) = 'admin')
WITH CHECK (id = (SELECT public.current_org_id()) AND (SELECT public.current_user_role()) = 'admin');

CREATE POLICY "enforce_mfa_aal2_organizations" ON public.organizations
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_organizations" ON public.organizations
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 2. organization_members
CREATE POLICY "tenant_members_select_policy" ON public.organization_members
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        user_id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "enforce_mfa_aal2_organization_members" ON public.organization_members
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_members" ON public.organization_members
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 3. locations
CREATE POLICY "tenant_locations_select_policy" ON public.locations
FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "tenant_locations_insert_policy" ON public.locations
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_locations_update_policy" ON public.locations
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_locations_delete_policy" ON public.locations
FOR DELETE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) = 'admin'
);

CREATE POLICY "enforce_mfa_aal2_locations" ON public.locations
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_locations" ON public.locations
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 4. shift_templates
CREATE POLICY "tenant_shift_templates_select_policy" ON public.shift_templates
FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "tenant_shift_templates_insert_policy" ON public.shift_templates
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_shift_templates_update_policy" ON public.shift_templates
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_shift_templates_delete_policy" ON public.shift_templates
FOR DELETE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "enforce_mfa_aal2_shift_templates" ON public.shift_templates
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_shift_templates" ON public.shift_templates
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 5. employee_shift_assignments
CREATE POLICY "tenant_shift_assignments_select_policy" ON public.employee_shift_assignments
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        employee_id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "tenant_shift_assignments_insert_policy" ON public.employee_shift_assignments
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_shift_assignments_update_policy" ON public.employee_shift_assignments
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_shift_assignments_delete_policy" ON public.employee_shift_assignments
FOR DELETE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "enforce_mfa_aal2_shift_assignments" ON public.employee_shift_assignments
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_shift_assignments" ON public.employee_shift_assignments
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 6. kiosk_devices (writes strictly admin-only at aal2)
CREATE POLICY "tenant_kiosk_devices_select_policy" ON public.kiosk_devices
FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "tenant_kiosk_devices_insert_policy" ON public.kiosk_devices
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) = 'admin'
);

CREATE POLICY "tenant_kiosk_devices_update_policy" ON public.kiosk_devices
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) = 'admin'
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) = 'admin'
);

CREATE POLICY "tenant_kiosk_devices_delete_policy" ON public.kiosk_devices
FOR DELETE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) = 'admin'
);

CREATE POLICY "enforce_mfa_aal2_kiosk_devices" ON public.kiosk_devices
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_kiosk_devices" ON public.kiosk_devices
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 7. privacy_acknowledgments
CREATE POLICY "tenant_privacy_acknowledgments_select_policy" ON public.privacy_acknowledgments
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        employee_id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "tenant_privacy_acknowledgments_insert_policy" ON public.privacy_acknowledgments
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND employee_id = (SELECT auth.uid())
);

CREATE POLICY "enforce_mfa_aal2_privacy_acknowledgments" ON public.privacy_acknowledgments
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_privacy_acknowledgments" ON public.privacy_acknowledgments
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 8. employees
DROP POLICY IF EXISTS "employees_select_policy" ON public.employees;
DROP POLICY IF EXISTS "employees_insert_policy" ON public.employees;
DROP POLICY IF EXISTS "employees_update_policy" ON public.employees;
DROP POLICY IF EXISTS "employees_delete_policy" ON public.employees;
DROP POLICY IF EXISTS "enforce_active_org_membership_employees" ON public.employees;

CREATE POLICY "employees_select_policy" ON public.employees
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        id = (SELECT auth.uid())
        OR manager_id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "employees_update_policy" ON public.employees
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (
        id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "enforce_active_org_membership_employees" ON public.employees
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 9. attendance_policies
DROP POLICY IF EXISTS "attendance_policies_select_policy" ON public.attendance_policies;
DROP POLICY IF EXISTS "attendance_policies_admin_policy" ON public.attendance_policies;
DROP POLICY IF EXISTS "enforce_active_org_membership_attendance_policies" ON public.attendance_policies;

CREATE POLICY "attendance_policies_select_policy" ON public.attendance_policies
FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "attendance_policies_admin_policy" ON public.attendance_policies
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "enforce_active_org_membership_attendance_policies" ON public.attendance_policies
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 10. attendance_sessions (Writes strictly via RPC)
DROP POLICY IF EXISTS "attendance_sessions_select_policy" ON public.attendance_sessions;
DROP POLICY IF EXISTS "attendance_sessions_admin_override" ON public.attendance_sessions;
DROP POLICY IF EXISTS "enforce_active_org_membership_attendance_sessions" ON public.attendance_sessions;

CREATE POLICY "attendance_sessions_select_policy" ON public.attendance_sessions
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        employee_id = (SELECT auth.uid())
        OR employee_id IN (
            SELECT employees.id
            FROM public.employees
            WHERE employees.manager_id = (SELECT auth.uid())
        )
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "enforce_active_org_membership_attendance_sessions" ON public.attendance_sessions
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 11. attendance_days
DROP POLICY IF EXISTS "attendance_days_select_policy" ON public.attendance_days;
DROP POLICY IF EXISTS "attendance_days_admin_override" ON public.attendance_days;
DROP POLICY IF EXISTS "enforce_active_org_membership_attendance_days" ON public.attendance_days;

CREATE POLICY "attendance_days_select_policy" ON public.attendance_days
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        employee_id = (SELECT auth.uid())
        OR employee_id IN (
            SELECT employees.id
            FROM public.employees
            WHERE employees.manager_id = (SELECT auth.uid())
        )
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "enforce_active_org_membership_attendance_days" ON public.attendance_days
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 12. regularization_requests (Status decisions strictly via RPC)
DROP POLICY IF EXISTS "regularization_requests_select_policy" ON public.regularization_requests;
DROP POLICY IF EXISTS "regularization_requests_insert_policy" ON public.regularization_requests;
DROP POLICY IF EXISTS "regularization_requests_review_policy" ON public.regularization_requests;
DROP POLICY IF EXISTS "enforce_active_org_membership_regularization_requests" ON public.regularization_requests;

CREATE POLICY "regularization_requests_select_policy" ON public.regularization_requests
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        employee_id = (SELECT auth.uid())
        OR employee_id IN (
            SELECT employees.id
            FROM public.employees
            WHERE employees.manager_id = (SELECT auth.uid())
        )
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "regularization_requests_insert_policy" ON public.regularization_requests
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND employee_id = (SELECT auth.uid())
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND review_note IS NULL
);

CREATE POLICY "enforce_active_org_membership_regularization_requests" ON public.regularization_requests
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 13. notifications
DROP POLICY IF EXISTS "notifications_select_policy" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_policy" ON public.notifications;
DROP POLICY IF EXISTS "enforce_active_org_membership_notifications" ON public.notifications;

CREATE POLICY "notifications_select_policy" ON public.notifications
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND user_id = (SELECT auth.uid())
);

CREATE POLICY "notifications_update_policy" ON public.notifications
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND user_id = (SELECT auth.uid())
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND user_id = (SELECT auth.uid())
);

CREATE POLICY "enforce_active_org_membership_notifications" ON public.notifications
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 14. holidays
DROP POLICY IF EXISTS "holidays_select_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_admin_manage_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_insert_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_update_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_delete_policy" ON public.holidays;
DROP POLICY IF EXISTS "enforce_active_org_membership_holidays" ON public.holidays;

CREATE POLICY "holidays_select_policy" ON public.holidays
FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "holidays_insert_policy" ON public.holidays
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "holidays_update_policy" ON public.holidays
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "holidays_delete_policy" ON public.holidays
FOR DELETE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "enforce_active_org_membership_holidays" ON public.holidays
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 15. audit_logs (SELECT only by HR/Admin)
DROP POLICY IF EXISTS "audit_logs_select_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "enforce_active_org_membership_audit_logs" ON public.audit_logs;

CREATE POLICY "audit_logs_select_policy" ON public.audit_logs
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "enforce_active_org_membership_audit_logs" ON public.audit_logs
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- ============================================================================
-- SECTION 15: Administrative Organization Provisioning RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_organization(
    p_name TEXT,
    p_slug TEXT,
    p_work_mode TEXT DEFAULT 'remote',
    p_timezone TEXT DEFAULT 'UTC'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
BEGIN
    INSERT INTO public.organizations (name, slug, work_mode, timezone)
    VALUES (p_name, p_slug, p_work_mode, p_timezone)
    RETURNING id INTO v_org_id;

    INSERT INTO public.attendance_policies (
        organization_id, work_mode, timezone, shift_start_time,
        grace_minutes, half_day_minutes, auto_checkout_time
    ) VALUES (
        v_org_id, p_work_mode, p_timezone, '09:00:00'::time, 15, 240, '20:00:00'::time
    );

    RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_organization(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.admin_create_organization(TEXT, TEXT, TEXT, TEXT) TO service_role;
